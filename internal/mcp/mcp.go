// Package mcp 实现 MCP（Model Context Protocol）服务端的协议层：
// JSON-RPC 2.0 消息编解码、initialize 握手、tools/resources 方法与调用分发。
//
// 这里不关心传输方式——本项目的 HTTP 入口见 internal/server/mcp.go，
// 走 MCP 的 Streamable HTTP 传输（POST JSON-RPC，响应 application/json）。
// 协议版本对齐 2025-06-18，同时兼容 2025-03-26 与 2024-11-05 的客户端。
package mcp

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"unicode/utf8"
)

// ProtocolVersion 是服务端实现的最新协议版本。
const ProtocolVersion = "2025-06-18"

// supportedVersions 是可与客户端协商的版本（新 → 旧）。
var supportedVersions = []string{ProtocolVersion, "2025-03-26", "2024-11-05"}

// JSON-RPC 2.0 标准错误码。
const (
	CodeParseError     = -32700
	CodeInvalidRequest = -32600
	CodeMethodNotFound = -32601
	CodeInvalidParams  = -32602
	CodeInternalError  = -32603
)

// maxTextBytes 限制单次工具结果写进 content 的文本长度，避免把整个仓库塞给模型。
const maxTextBytes = 256 << 10

// Tool 是一个可被客户端调用的工具。
type Tool struct {
	Name        string
	Title       string
	Description string
	InputSchema map[string]any
	// Handler 的返回值会被序列化为工具结果：字符串原样作为文本，
	// 其他类型按 JSON 写入 content（同时附 structuredContent）。
	Handler func(ctx context.Context, args map[string]any) (any, error)
}

// Resource 是资源列表里的一条（URI + 展示信息）。
type Resource struct {
	URI         string `json:"uri"`
	Name        string `json:"name"`
	Title       string `json:"title,omitempty"`
	Description string `json:"description,omitempty"`
	MimeType    string `json:"mimeType,omitempty"`
}

// ResourceContent 是 resources/read 返回的内容块。
type ResourceContent struct {
	URI      string `json:"uri"`
	MimeType string `json:"mimeType,omitempty"`
	Text     string `json:"text"`
}

// Provider 提供资源列表与内容；为 nil 时不对外声明 resources 能力。
type Provider interface {
	ListResources(ctx context.Context) ([]Resource, error)
	ReadResource(ctx context.Context, uri string) ([]ResourceContent, error)
}

// Server 是一个 MCP 服务端（工具 + 可选资源）。
type Server struct {
	Name         string
	Title        string
	Version      string
	Instructions string
	Tools        []Tool
	Resources    Provider
}

// Tool 按名字查找工具。
func (s *Server) Tool(name string) (Tool, bool) {
	for _, t := range s.Tools {
		if t.Name == name {
			return t, true
		}
	}
	return Tool{}, false
}

// ---------- JSON-RPC 消息 ----------

type request struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id,omitempty"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params,omitempty"`
}

type rpcError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
	Data    any    `json:"data,omitempty"`
}

func (e *rpcError) Error() string { return fmt.Sprintf("%d %s", e.Code, e.Message) }

type response struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id"`
	Result  any             `json:"result,omitempty"`
	Error   *rpcError       `json:"error,omitempty"`
}

// ---------- 入口 ----------

// Handle 处理一条（或一批）JSON-RPC 消息。
// respond 为 false 表示这是一条通知（notification），传输层不应回写响应体。
func (s *Server) Handle(ctx context.Context, body []byte) (out []byte, respond bool) {
	body = bytes.TrimSpace(body)
	if len(body) == 0 {
		return mustMarshal(errResp(nil, CodeInvalidRequest, "空请求体")), true
	}
	// 批处理在 2025-06-18 已移除，但旧客户端仍可能发数组：逐个处理以保持兼容。
	if body[0] == '[' {
		var batch []json.RawMessage
		if err := json.Unmarshal(body, &batch); err != nil {
			return mustMarshal(errResp(nil, CodeParseError, "JSON 解析失败: "+err.Error())), true
		}
		if len(batch) == 0 {
			return mustMarshal(errResp(nil, CodeInvalidRequest, "空的批处理请求")), true
		}
		resps := make([]json.RawMessage, 0, len(batch))
		for _, raw := range batch {
			if r, ok := s.handleOne(ctx, raw); ok {
				resps = append(resps, r)
			}
		}
		if len(resps) == 0 {
			return nil, false
		}
		return mustMarshal(resps), true
	}
	return s.handleOne(ctx, body)
}

func (s *Server) handleOne(ctx context.Context, raw []byte) ([]byte, bool) {
	var req request
	if err := json.Unmarshal(raw, &req); err != nil {
		return mustMarshal(errResp(nil, CodeParseError, "JSON 解析失败: "+err.Error())), true
	}
	if req.JSONRPC != "2.0" {
		return mustMarshal(errResp(req.ID, CodeInvalidRequest, `jsonrpc 必须为 "2.0"`)), true
	}
	if strings.TrimSpace(req.Method) == "" {
		return mustMarshal(errResp(req.ID, CodeInvalidRequest, "缺少 method 字段")), true
	}
	// 没有 id 或 id 为 null 的是通知：只执行不回包。
	notify := len(req.ID) == 0 || string(bytes.TrimSpace(req.ID)) == "null"

	switch req.Method {
	case "initialize":
		return mustMarshal(okResp(req.ID, s.initializeResult(req.Params))), true
	case "ping":
		return mustMarshal(okResp(req.ID, map[string]any{})), true
	case "tools/list":
		return mustMarshal(okResp(req.ID, map[string]any{"tools": s.toolList()})), true
	case "tools/call":
		res, rerr := s.callTool(ctx, req.Params)
		if rerr != nil {
			return mustMarshal(errResp(req.ID, rerr.Code, rerr.Message)), true
		}
		return mustMarshal(okResp(req.ID, res)), true
	case "resources/list":
		if s.Resources == nil {
			return mustMarshal(okResp(req.ID, map[string]any{"resources": []Resource{}})), true
		}
		list, err := s.Resources.ListResources(ctx)
		if err != nil {
			return mustMarshal(errResp(req.ID, CodeInternalError, err.Error())), true
		}
		if list == nil {
			list = []Resource{}
		}
		return mustMarshal(okResp(req.ID, map[string]any{"resources": list})), true
	case "resources/templates/list":
		return mustMarshal(okResp(req.ID, map[string]any{"resourceTemplates": []any{}})), true
	case "prompts/list":
		// 目前不提供提示词模板：能力声明里保留 prompts，但要能正常应答空列表。
		return mustMarshal(okResp(req.ID, map[string]any{"prompts": []any{}})), true
	case "resources/read":
		return s.readResource(ctx, req)
	}

	if notify || strings.HasPrefix(req.Method, "notifications/") {
		return nil, false
	}
	return mustMarshal(errResp(req.ID, CodeMethodNotFound, "未实现的方法: "+req.Method)), true
}

func (s *Server) readResource(ctx context.Context, req request) ([]byte, bool) {
	if s.Resources == nil {
		return mustMarshal(errResp(req.ID, CodeMethodNotFound, "未启用 resources 能力")), true
	}
	var p struct {
		URI string `json:"uri"`
	}
	if err := json.Unmarshal(req.Params, &p); err != nil || p.URI == "" {
		return mustMarshal(errResp(req.ID, CodeInvalidParams, "resources/read 需要 uri 参数")), true
	}
	content, err := s.Resources.ReadResource(ctx, p.URI)
	if err != nil {
		return mustMarshal(errResp(req.ID, CodeInvalidParams, err.Error())), true
	}
	if content == nil {
		content = []ResourceContent{}
	}
	return mustMarshal(okResp(req.ID, map[string]any{"contents": content})), true
}

// ---------- initialize ----------

func (s *Server) initializeResult(params json.RawMessage) map[string]any {
	var p struct {
		ProtocolVersion string `json:"protocolVersion"`
	}
	_ = json.Unmarshal(params, &p)
	version := ""
	for _, v := range supportedVersions {
		if v == p.ProtocolVersion {
			version = v
			break
		}
	}
	if version == "" {
		version = ProtocolVersion // 客户端版本不认识时按最新版应答，由客户端决定是否继续
	}
	caps := map[string]any{
		"tools":   map[string]any{"listChanged": false},
		"prompts": map[string]any{"listChanged": false},
	}
	if s.Resources != nil {
		caps["resources"] = map[string]any{"subscribe": false, "listChanged": false}
	}
	name := s.Name
	if name == "" {
		name = "vellum"
	}
	info := map[string]any{"name": name, "version": s.Version}
	if s.Title != "" {
		info["title"] = s.Title
	}
	out := map[string]any{
		"protocolVersion": version,
		"capabilities":    caps,
		"serverInfo":      info,
	}
	if s.Instructions != "" {
		out["instructions"] = s.Instructions
	}
	return out
}

func (s *Server) toolList() []map[string]any {
	out := make([]map[string]any, 0, len(s.Tools))
	for _, t := range s.Tools {
		m := map[string]any{
			"name":        t.Name,
			"description": t.Description,
			"inputSchema": schemaOf(t),
		}
		if t.Title != "" {
			m["title"] = t.Title
		}
		out = append(out, m)
	}
	sort.SliceStable(out, func(i, j int) bool {
		return out[i]["name"].(string) < out[j]["name"].(string)
	})
	return out
}

func schemaOf(t Tool) map[string]any {
	if t.InputSchema != nil {
		return t.InputSchema
	}
	return map[string]any{"type": "object", "properties": map[string]any{}}
}

// ---------- tools/call ----------

func (s *Server) callTool(ctx context.Context, params json.RawMessage) (any, *rpcError) {
	var p struct {
		Name      string         `json:"name"`
		Arguments map[string]any `json:"arguments"`
	}
	if len(params) > 0 {
		if err := json.Unmarshal(params, &p); err != nil {
			return nil, &rpcError{CodeInvalidParams, "tools/call 参数不合法: " + err.Error(), nil}
		}
	}
	if p.Name == "" {
		return nil, &rpcError{CodeInvalidParams, "tools/call 缺少 name", nil}
	}
	t, ok := s.Tool(p.Name)
	if !ok {
		return nil, &rpcError{CodeInvalidParams, "未知工具: " + p.Name, nil}
	}
	if p.Arguments == nil {
		p.Arguments = map[string]any{}
	}
	if missing := missingRequired(t.InputSchema, p.Arguments); len(missing) > 0 {
		return nil, &rpcError{CodeInvalidParams,
			"缺少必填参数: " + strings.Join(missing, ", "), nil}
	}
	v, err := t.Handler(ctx, p.Arguments)
	if err != nil {
		// 工具执行期错误按 MCP 约定写在 result.isError 里，让模型看到原因后自行纠正。
		return toolErrorResult(err), nil
	}
	return toolResult(v), nil
}

func missingRequired(schema map[string]any, args map[string]any) []string {
	if schema == nil {
		return nil
	}
	var req []string
	switch v := schema["required"].(type) {
	case []string:
		req = v
	case []any:
		for _, x := range v {
			if s, ok := x.(string); ok {
				req = append(req, s)
			}
		}
	}
	var missing []string
	for _, k := range req {
		if _, ok := args[k]; !ok {
			missing = append(missing, k)
		}
	}
	return missing
}

func toolResult(v any) map[string]any {
	if v == nil {
		return map[string]any{"content": []any{textBlock("已完成")}}
	}
	if s, ok := v.(string); ok {
		return map[string]any{"content": []any{textBlock(s)}}
	}
	raw, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return toolErrorResult(err)
	}
	out := map[string]any{
		"content":           []any{textBlock(clip(string(raw)))},
		"structuredContent": v,
	}
	return out
}

func toolErrorResult(err error) map[string]any {
	return map[string]any{
		"content": []any{textBlock(err.Error())},
		"isError": true,
	}
}

func textBlock(s string) map[string]any {
	return map[string]any{"type": "text", "text": clip(s)}
}

// clip 截断过长文本，保留尾部提示，避免上下文被单个结果撑爆。
// 按 rune 边界切，避免把多字节字符劈成非法 UTF-8。
func clip(s string) string {
	if len(s) <= maxTextBytes {
		return s
	}
	cut := maxTextBytes
	for cut > 0 && !utf8.RuneStart(s[cut]) {
		cut--
	}
	return s[:cut] + "\n\n…（结果过长已截断，请用更精确的筛选参数重试）"
}

// ---------- 编码辅助 ----------

func okResp(id json.RawMessage, result any) response {
	return response{JSONRPC: "2.0", ID: id, Result: result}
}

func errResp(id json.RawMessage, code int, msg string) response {
	return response{JSONRPC: "2.0", ID: id, Error: &rpcError{Code: code, Message: msg}}
}

func mustMarshal(v any) []byte {
	b, err := json.Marshal(v)
	if err != nil {
		return []byte(`{"jsonrpc":"2.0","id":null,"error":{"code":-32603,"message":"响应序列化失败"}}`)
	}
	return b
}
