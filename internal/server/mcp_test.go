package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"
)

// ---------- 测试脚手架 ----------

func newMCPServer(t *testing.T, mutate func(*Options)) (*Server, string) {
	t.Helper()
	dir := t.TempDir()
	opts := Options{
		ProjectsDir: t.TempDir(),
		Push:        false,
		MCPEnabled:  true,
		Version:     "test",
	}
	if mutate != nil {
		mutate(&opts)
	}
	s := New(opts)
	if err := s.Open(dir); err != nil {
		t.Fatalf("Open(%s): %v", dir, err)
	}
	return s, dir
}

type rpcError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

type rpcResult struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id"`
	Result  json.RawMessage `json:"result"`
	Error   *rpcError       `json:"error"`
}

// post 发一条 JSON-RPC 消息，返回 HTTP 状态码与解析后的响应（通知类是空体）。
func post(t *testing.T, h http.Handler, body string, headers map[string]string) (int, *rpcResult, string) {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/mcp", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	raw := rec.Body.String()
	if strings.TrimSpace(raw) == "" {
		return rec.Code, nil, raw
	}
	trimmed := strings.TrimSpace(raw)
	// 批处理（数组）与 HTTP 层错误体（{"error":"…"}）不按 JSON-RPC 解析。
	if strings.HasPrefix(trimmed, "[") || !strings.Contains(trimmed, `"jsonrpc"`) {
		return rec.Code, nil, raw
	}
	var out rpcResult
	if err := json.Unmarshal([]byte(raw), &out); err != nil {
		t.Fatalf("响应不是合法 JSON: %v\n%s", err, raw)
	}
	return rec.Code, &out, raw
}

// rpc 以 id=1 调用一个方法，返回原始响应。
func rpc(t *testing.T, h http.Handler, method string, params any) (*rpcResult, int) {
	t.Helper()
	req := map[string]any{"jsonrpc": "2.0", "id": 1, "method": method}
	if params != nil {
		req["params"] = params
	}
	b, _ := json.Marshal(req)
	code, res, raw := post(t, h, string(b), nil)
	if res == nil {
		t.Fatalf("%s 没有响应体（HTTP %d）", method, code)
	}
	if res.Error != nil {
		return res, code
	}
	if res.JSONRPC != "2.0" {
		t.Fatalf("%s 响应 jsonrpc 字段错误: %s", method, raw)
	}
	return res, code
}

// tool 调用一个工具，返回结构化结果、isError 与文本内容。
func tool(t *testing.T, h http.Handler, name string, args map[string]any) (map[string]any, bool, string) {
	t.Helper()
	res, _ := rpc(t, h, "tools/call", map[string]any{"name": name, "arguments": args})
	if res.Error != nil {
		t.Fatalf("tools/call %s 返回协议错误: %d %s", name, res.Error.Code, res.Error.Message)
	}
	var out struct {
		Content           []struct{ Type, Text string } `json:"content"`
		StructuredContent map[string]any                `json:"structuredContent"`
		IsError           bool                          `json:"isError"`
	}
	if err := json.Unmarshal(res.Result, &out); err != nil {
		t.Fatalf("解析 %s 结果失败: %v\n%s", name, err, res.Result)
	}
	text := ""
	if len(out.Content) > 0 {
		text = out.Content[0].Text
	}
	return out.StructuredContent, out.IsError, text
}

// toolErr 调用一个预期会失败的工具，返回错误文本（协议错误或 isError 结果都算失败）。
func toolErr(t *testing.T, h http.Handler, name string, args map[string]any) string {
	t.Helper()
	res, _ := rpc(t, h, "tools/call", map[string]any{"name": name, "arguments": args})
	if res.Error != nil {
		return res.Error.Message
	}
	var out struct {
		Content []struct{ Text string } `json:"content"`
		IsError bool                    `json:"isError"`
	}
	if err := json.Unmarshal(res.Result, &out); err != nil {
		t.Fatalf("解析 %s 结果失败: %v", name, err)
	}
	if !out.IsError {
		t.Fatalf("%s 本应失败，却返回成功", name)
	}
	if len(out.Content) > 0 {
		return out.Content[0].Text
	}
	return ""
}

// ---------- 协议层 ----------

func TestMCPInitialize(t *testing.T) {
	s, _ := newMCPServer(t, nil)
	res, code := rpc(t, s, "initialize", map[string]any{
		"protocolVersion": "2025-06-18",
		"capabilities":    map[string]any{},
		"clientInfo":      map[string]any{"name": "test", "version": "1.0"},
	})
	if code != http.StatusOK || res.Error != nil {
		t.Fatalf("initialize 失败: %d %+v", code, res.Error)
	}
	var out struct {
		ProtocolVersion string         `json:"protocolVersion"`
		Capabilities    map[string]any `json:"capabilities"`
		ServerInfo      struct {
			Name    string `json:"name"`
			Version string `json:"version"`
		} `json:"serverInfo"`
		Instructions string `json:"instructions"`
	}
	if err := json.Unmarshal(res.Result, &out); err != nil {
		t.Fatal(err)
	}
	if out.ProtocolVersion != "2025-06-18" {
		t.Errorf("protocolVersion = %q", out.ProtocolVersion)
	}
	if _, ok := out.Capabilities["tools"]; !ok {
		t.Errorf("缺少 tools 能力: %+v", out.Capabilities)
	}
	if _, ok := out.Capabilities["resources"]; !ok {
		t.Errorf("缺少 resources 能力: %+v", out.Capabilities)
	}
	if out.ServerInfo.Name != "vellum" || out.ServerInfo.Version != "test" {
		t.Errorf("serverInfo = %+v", out.ServerInfo)
	}
	if out.Instructions == "" {
		t.Error("instructions 为空")
	}
}

func TestMCPVersionNegotiation(t *testing.T) {
	s, _ := newMCPServer(t, nil)
	for _, tc := range []struct{ req, want string }{
		{"2024-11-05", "2024-11-05"},
		{"2025-03-26", "2025-03-26"},
		{"2099-01-01", "2025-06-18"}, // 不认识的版本按最新版应答
	} {
		res, _ := rpc(t, s, "initialize", map[string]any{"protocolVersion": tc.req})
		var out struct {
			ProtocolVersion string `json:"protocolVersion"`
		}
		if err := json.Unmarshal(res.Result, &out); err != nil {
			t.Fatal(err)
		}
		if out.ProtocolVersion != tc.want {
			t.Errorf("请求 %s 协商出 %s，期望 %s", tc.req, out.ProtocolVersion, tc.want)
		}
	}
}

func TestMCPNotificationAccepted(t *testing.T) {
	s, _ := newMCPServer(t, nil)
	code, res, raw := post(t, s, `{"jsonrpc":"2.0","method":"notifications/initialized"}`, nil)
	if code != http.StatusAccepted {
		t.Fatalf("通知应回 202，实际 %d", code)
	}
	if res != nil || raw != "" {
		t.Fatalf("通知不应有响应体: %q", raw)
	}
}

func TestMCPToolsList(t *testing.T) {
	s, _ := newMCPServer(t, nil)
	res, _ := rpc(t, s, "tools/list", nil)
	var out struct {
		Tools []struct {
			Name        string         `json:"name"`
			Description string         `json:"description"`
			InputSchema map[string]any `json:"inputSchema"`
		} `json:"tools"`
	}
	if err := json.Unmarshal(res.Result, &out); err != nil {
		t.Fatal(err)
	}
	want := []string{"get_workspace", "list_issues", "get_issue", "create_issue", "update_issue",
		"add_comment", "delete_issue", "search", "list_docs", "read_doc", "write_doc", "delete_doc"}
	got := map[string]bool{}
	for _, tl := range out.Tools {
		got[tl.Name] = true
		if tl.Description == "" {
			t.Errorf("%s 缺少 description", tl.Name)
		}
		if tl.InputSchema["type"] != "object" {
			t.Errorf("%s 的 inputSchema.type 不是 object", tl.Name)
		}
	}
	for _, name := range want {
		if !got[name] {
			t.Errorf("缺少工具 %s", name)
		}
	}
}

func TestMCPBadJSON(t *testing.T) {
	s, _ := newMCPServer(t, nil)
	_, res, _ := post(t, s, "{not json", nil)
	if res == nil || res.Error == nil || res.Error.Code != -32700 {
		t.Fatalf("非法 JSON 应返回 -32700，实际 %+v", res)
	}
}

func TestMCPUnknownMethodAndTool(t *testing.T) {
	s, _ := newMCPServer(t, nil)
	if res, _ := rpc(t, s, "no/such/method", nil); res.Error == nil || res.Error.Code != -32601 {
		t.Fatalf("未知方法应返回 -32601: %+v", res.Error)
	}
	if res, _ := rpc(t, s, "tools/call", map[string]any{"name": "nope"}); res.Error == nil || res.Error.Code != -32602 {
		t.Fatalf("未知工具应返回 -32602: %+v", res.Error)
	}
	if res, _ := rpc(t, s, "tools/call", map[string]any{"name": "create_issue", "arguments": map[string]any{}}); res.Error == nil || res.Error.Code != -32602 {
		t.Fatalf("缺少必填参数应返回 -32602: %+v", res.Error)
	}
}

func TestMCPGetRequiresPost(t *testing.T) {
	s, _ := newMCPServer(t, nil)
	rec := httptest.NewRecorder()
	s.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/mcp", nil))
	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("GET /mcp 应回 405，实际 %d", rec.Code)
	}
	if allow := rec.Header().Get("Allow"); allow != http.MethodPost {
		t.Errorf("Allow = %q", allow)
	}
}

func TestMCPDisabled(t *testing.T) {
	s, _ := newMCPServer(t, func(o *Options) { o.MCPEnabled = false })
	code, _, _ := post(t, s, `{"jsonrpc":"2.0","id":1,"method":"ping"}`, nil)
	if code != http.StatusServiceUnavailable {
		t.Fatalf("未启用时应回 503，实际 %d", code)
	}
	rec := httptest.NewRecorder()
	s.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/mcp/info", nil))
	if !strings.Contains(rec.Body.String(), `"enabled":false`) {
		t.Errorf("/api/mcp/info = %s", rec.Body.String())
	}
}

func TestMCPToken(t *testing.T) {
	s, _ := newMCPServer(t, func(o *Options) { o.MCPToken = "s3cret" })
	body := `{"jsonrpc":"2.0","id":1,"method":"ping"}`

	if code, _, _ := post(t, s, body, nil); code != http.StatusUnauthorized {
		t.Fatalf("缺 token 应回 401，实际 %d", code)
	}
	if code, _, _ := post(t, s, body, map[string]string{"Authorization": "Bearer wrong"}); code != http.StatusUnauthorized {
		t.Fatalf("错误 token 应回 401，实际 %d", code)
	}
	if code, _, _ := post(t, s, body, map[string]string{"Authorization": "Bearer s3cret"}); code != http.StatusOK {
		t.Fatalf("正确 token 应回 200，实际 %d", code)
	}
	if code, _, _ := post(t, s, body, map[string]string{"X-WB-MCP-Token": "s3cret"}); code != http.StatusOK {
		t.Fatalf("X-WB-MCP-Token 应被接受，实际 %d", code)
	}
}

// ---------- 工具行为 ----------

func TestMCPWorkspaceSchema(t *testing.T) {
	s, _ := newMCPServer(t, nil)
	out, isErr, text := tool(t, s, "get_workspace", nil)
	if isErr {
		t.Fatalf("get_workspace 出错: %s", text)
	}
	schema, ok := out["schema"].(map[string]any)
	if !ok {
		t.Fatalf("缺少 schema: %+v", out)
	}
	for _, key := range []string{"statuses", "priorities", "labels", "types", "fields"} {
		if _, ok := schema[key]; !ok {
			t.Errorf("schema 缺少 %s", key)
		}
	}
	statuses, _ := schema["statuses"].([]any)
	if len(statuses) == 0 {
		t.Fatal("statuses 为空")
	}
	first, _ := statuses[0].(map[string]any)
	if first["id"] != "todo" || first["category"] != "todo" {
		t.Errorf("首个状态异常: %+v", first)
	}
	stats, _ := out["stats"].(map[string]any)
	if stats["total"].(float64) != 0 {
		t.Errorf("空仓库 stats.total = %v", stats["total"])
	}
}

func TestMCPIssueLifecycle(t *testing.T) {
	s, dir := newMCPServer(t, nil)

	// 新建
	created, isErr, text := tool(t, s, "create_issue", map[string]any{
		"title":    "接通 MCP",
		"body":     "## 目标\n\n让助手能读写任务。",
		"priority": "high",
		"labels":   []any{"feature"},
		"due":      "2026-12-31",
	})
	if isErr {
		t.Fatalf("create_issue 出错: %s", text)
	}
	issue, _ := created["issue"].(map[string]any)
	id, _ := issue["id"].(string)
	if id != "WB-0001" {
		t.Fatalf("分配的 id = %q，期望 WB-0001", id)
	}
	if issue["status"] != "todo" {
		t.Errorf("默认状态 = %v，期望 todo", issue["status"])
	}
	// 落盘检查：纯文本 + 正文
	issueFile := filepath.Join(dir, "issues", id, "issue.md")
	data, err := os.ReadFile(issueFile)
	if err != nil {
		t.Fatalf("issue.md 未落盘: %v", err)
	}
	if !strings.Contains(string(data), "接通 MCP") || !strings.Contains(string(data), "让助手能读写任务") {
		t.Errorf("issue.md 内容异常:\n%s", data)
	}

	// 列表
	list, _, _ := tool(t, s, "list_issues", map[string]any{"status_category": "todo"})
	if list["count"].(float64) != 1 {
		t.Fatalf("list_issues count = %v", list["count"])
	}
	// 已经完成的分类应为空
	listDone, _, _ := tool(t, s, "list_issues", map[string]any{"status_category": "done"})
	if listDone["count"].(float64) != 0 {
		t.Errorf("done 分类不应有任务: %v", listDone["count"])
	}

	// 详情
	got, _, _ := tool(t, s, "get_issue", map[string]any{"id": id})
	full, _ := got["issue"].(map[string]any)
	if !strings.Contains(full["body"].(string), "让助手能读写任务") {
		t.Errorf("详情正文 = %v", full["body"])
	}

	// 跟进
	comment, isErr, text := tool(t, s, "add_comment", map[string]any{"id": id, "body": "已接入 `/mcp`"})
	if isErr {
		t.Fatalf("add_comment 出错: %s", text)
	}
	entry, _ := comment["entry"].(map[string]any)
	if entry["author"] != "ai" {
		t.Errorf("默认作者 = %v，期望 ai", entry["author"])
	}
	entries, err := os.ReadDir(filepath.Join(dir, "issues", id, "entries"))
	if err != nil || len(entries) != 1 {
		t.Fatalf("entries 目录异常: %v, %d 个文件", err, len(entries))
	}
	// 文件名即时间序：序号-时间-作者.md
	if !strings.HasSuffix(entries[0].Name(), "-ai.md") {
		t.Errorf("跟进文件名 = %s", entries[0].Name())
	}

	// 改状态：自动补一条 status 时间线
	updated, isErr, text := tool(t, s, "update_issue", map[string]any{
		"id": id, "status": "done", "note": "MCP 已可用",
	})
	if isErr {
		t.Fatalf("update_issue 出错: %s", text)
	}
	up, _ := updated["issue"].(map[string]any)
	if up["status"] != "done" {
		t.Errorf("状态 = %v，期望 done", up["status"])
	}
	detail, _, _ := tool(t, s, "get_issue", map[string]any{"id": id})
	list2, _ := detail["entries"].([]any)
	if len(list2) != 2 {
		t.Fatalf("时间线应有 2 条，实际 %d", len(list2))
	}
	last, _ := list2[1].(map[string]any)
	if last["type"] != "status" || last["from"] != "todo" || last["to"] != "done" {
		t.Errorf("状态条目异常: %+v", last)
	}
	if last["body"] != "MCP 已可用" {
		t.Errorf("状态条目 note = %v", last["body"])
	}

	// 检索
	found, _, _ := tool(t, s, "search", map[string]any{"q": "助手"})
	hits, _ := found["issues"].([]any)
	if len(hits) != 1 {
		t.Errorf("search 命中 %d 条，期望 1: %+v", len(hits), found["issues"])
	}

	// 未知 id 只告警不拒绝
	warned, isErr, text := tool(t, s, "create_issue", map[string]any{"title": "字段写错", "status": "不存在的状态"})
	if isErr {
		t.Fatalf("create_issue 不应因未知状态失败: %s", text)
	}
	if _, ok := warned["warnings"]; !ok {
		t.Errorf("未知状态应给 warnings: %+v", warned)
	}

	// 删除需要 confirm
	if msg := toolErr(t, s, "delete_issue", map[string]any{"id": id}); !strings.Contains(msg, "confirm") {
		t.Fatalf("未确认的删除应被拒绝，返回: %s", msg)
	}
	if _, err := os.Stat(issueFile); err != nil {
		t.Fatal("未确认的删除不应真的删除文件")
	}
	if _, isErr, text := tool(t, s, "delete_issue", map[string]any{"id": id, "confirm": true}); isErr {
		t.Fatalf("确认删除失败: %s", text)
	}
	if _, err := os.Stat(issueFile); !os.IsNotExist(err) {
		t.Error("删除后 issue.md 仍存在")
	}
}

func TestMCPDocsLifecycle(t *testing.T) {
	s, dir := newMCPServer(t, nil)

	created, isErr, text := tool(t, s, "write_doc", map[string]any{
		"path":  "guide/mcp",
		"title": "MCP 接入",
		"body":  "# 接入\n\n填个 URL 就行。",
		"tags":  []any{"docs"},
	})
	if isErr {
		t.Fatalf("write_doc 出错: %s", text)
	}
	if created["created"] != true {
		t.Errorf("首次写入 created 应为 true: %+v", created)
	}
	if _, err := os.Stat(filepath.Join(dir, "docs", "guide", "mcp.md")); err != nil {
		t.Fatalf("文档未落盘: %v", err)
	}

	// 再次写入 = 更新
	updated, _, _ := tool(t, s, "write_doc", map[string]any{"path": "guide/mcp", "body": "# 更新后的正文"})
	if updated["created"] != false {
		t.Errorf("再次写入 created 应为 false: %+v", updated)
	}
	doc, _ := updated["doc"].(map[string]any)
	if doc["title"] != "MCP 接入" {
		t.Errorf("更新不应丢掉标题: %v", doc["title"])
	}
	if !strings.Contains(doc["body"].(string), "更新后的正文") {
		t.Errorf("正文未替换: %v", doc["body"])
	}

	list, _, _ := tool(t, s, "list_docs", map[string]any{})
	if list["count"].(float64) != 1 {
		t.Errorf("list_docs count = %v", list["count"])
	}

	read, _, _ := tool(t, s, "read_doc", map[string]any{"path": "guide/mcp.md"})
	rdoc, _ := read["doc"].(map[string]any)
	if rdoc["path"] != "docs/guide/mcp.md" {
		t.Errorf("path = %v", rdoc["path"])
	}

	if msg := toolErr(t, s, "delete_doc", map[string]any{"path": "guide/mcp"}); !strings.Contains(msg, "confirm") {
		t.Fatalf("未确认的删除应被拒绝，返回: %s", msg)
	}
	if _, isErr, text := tool(t, s, "delete_doc", map[string]any{"path": "guide/mcp", "confirm": true}); isErr {
		t.Fatalf("确认删除失败: %s", text)
	}
}

func TestMCPProjectScope(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "workbench.yaml"),
		[]byte("workspace:\n  name: 多项目\n  mode: multi\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	s := New(Options{ProjectsDir: t.TempDir(), MCPEnabled: true, Version: "test"})
	if err := s.Open(dir); err != nil {
		t.Fatalf("Open: %v", err)
	}
	s.mu.RLock()
	pid := s.projectID
	s.mu.RUnlock()
	if pid == "" {
		t.Fatal("multi 模式应有当前项目")
	}

	// 写进子项目
	created, isErr, text := tool(t, s, "create_issue", map[string]any{
		"title": "子项目任务", "project": pid,
	})
	if isErr {
		t.Fatalf("create_issue: %s", text)
	}
	issue, _ := created["issue"].(map[string]any)
	if _, err := os.Stat(filepath.Join(dir, "projects", pid, "issues", issue["id"].(string), "issue.md")); err != nil {
		t.Fatalf("任务未写进 projects/%s: %v", pid, err)
	}

	// 默认作用域 = 当前项目
	list, _, _ := tool(t, s, "list_issues", map[string]any{})
	if list["count"].(float64) != 1 {
		t.Errorf("当前项目应有 1 条任务，实际 %v", list["count"])
	}
	if list["project"] != pid {
		t.Errorf("默认 project = %v，期望 %v", list["project"], pid)
	}

	// 根项目 + 聚合：应能看到子项目的任务，并回填 project 字段
	root, _, _ := tool(t, s, "list_issues", map[string]any{"project": "~", "include_children": true})
	if root["count"].(float64) != 1 {
		t.Fatalf("聚合视图应有 1 条任务，实际 %v", root["count"])
	}
	first, _ := root["issues"].([]any)[0].(map[string]any)
	if first["project"] != pid {
		t.Errorf("聚合结果的 project = %v", first["project"])
	}

	// 根项目自身为空（显式关掉聚合）
	rootOnly, _, _ := tool(t, s, "list_issues", map[string]any{"project": "~", "include_children": false})
	if rootOnly["count"].(float64) != 0 {
		t.Errorf("根项目本身不应有任务: %v", rootOnly["count"])
	}
}

func TestMCPResources(t *testing.T) {
	s, _ := newMCPServer(t, nil)
	created, _, _ := tool(t, s, "create_issue", map[string]any{"title": "资源化", "body": "正文"})
	issue, _ := created["issue"].(map[string]any)
	id := issue["id"].(string)

	res, _ := rpc(t, s, "resources/list", nil)
	var list struct {
		Resources []struct {
			URI      string `json:"uri"`
			Name     string `json:"name"`
			MimeType string `json:"mimeType"`
		} `json:"resources"`
	}
	if err := json.Unmarshal(res.Result, &list); err != nil {
		t.Fatal(err)
	}
	if len(list.Resources) != 1 {
		t.Fatalf("资源数量 = %d", len(list.Resources))
	}
	uri := list.Resources[0].URI
	if uri != "vellum://issues/"+id {
		t.Errorf("资源 URI = %s", uri)
	}

	read, _ := rpc(t, s, "resources/read", map[string]any{"uri": uri})
	var content struct {
		Contents []struct {
			URI      string `json:"uri"`
			MimeType string `json:"mimeType"`
			Text     string `json:"text"`
		} `json:"contents"`
	}
	if err := json.Unmarshal(read.Result, &content); err != nil {
		t.Fatal(err)
	}
	if len(content.Contents) != 1 || !strings.Contains(content.Contents[0].Text, "资源化") {
		t.Fatalf("资源内容异常: %+v", content.Contents)
	}

	// 未知 URI 是协议错误
	if bad, _ := rpc(t, s, "resources/read", map[string]any{"uri": "vellum://nope/1"}); bad.Error == nil {
		t.Error("未知 URI 应返回错误")
	}
}

func TestMCPInfoEndpoint(t *testing.T) {
	s, _ := newMCPServer(t, nil)
	req := httptest.NewRequest(http.MethodGet, "/api/mcp/info", nil)
	req.Host = "127.0.0.1:8420"
	rec := httptest.NewRecorder()
	s.ServeHTTP(rec, req)
	var out struct {
		Enabled         bool           `json:"enabled"`
		Endpoint        string         `json:"endpoint"`
		ProtocolVersion string         `json:"protocolVersion"`
		Tools           []any          `json:"tools"`
		Config          map[string]any `json:"config"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("%v: %s", err, rec.Body.String())
	}
	if !out.Enabled || out.Endpoint != "http://127.0.0.1:8420/mcp" {
		t.Errorf("info = %+v", out)
	}
	if out.ProtocolVersion != "2025-06-18" || len(out.Tools) == 0 {
		t.Errorf("info 内容不完整: %+v", out)
	}
	servers, _ := out.Config["mcpServers"].(map[string]any)
	if _, ok := servers["vellum"]; !ok {
		t.Errorf("config 样例缺少 vellum: %+v", out.Config)
	}
}

// TestMCPRoutesWithStaticSite 回归：/mcp 必须按方法注册，
// 否则与静态站点 "GET /" 在同一 ServeMux 里冲突（启动即 panic）。
func TestMCPRoutesWithStaticSite(t *testing.T) {
	s := New(Options{
		ProjectsDir: t.TempDir(),
		MCPEnabled:  true,
		Web:         fstest.MapFS{},
	})
	if err := s.Open(t.TempDir()); err != nil {
		t.Fatalf("Open: %v", err)
	}
	code, res, _ := post(t, s, `{"jsonrpc":"2.0","id":1,"method":"ping"}`, nil)
	if code != http.StatusOK || res == nil || res.Error != nil {
		t.Fatalf("ping 失败: %d %+v", code, res)
	}
}

// TestMCPBatch 兼容旧客户端的 JSON-RPC 批处理。
func TestMCPBatch(t *testing.T) {
	s, _ := newMCPServer(t, nil)
	body := `[{"jsonrpc":"2.0","id":1,"method":"ping"},{"jsonrpc":"2.0","method":"notifications/initialized"}]`
	code, _, raw := post(t, s, body, nil)
	if code != http.StatusOK {
		t.Fatalf("批处理 HTTP 状态 = %d", code)
	}
	if strings.TrimSpace(raw) == "" {
		t.Fatal("批处理应返回响应体")
	}
	var batch []json.RawMessage
	if err := json.Unmarshal([]byte(raw), &batch); err != nil {
		t.Fatalf("批处理响应不是数组: %s", raw)
	}
	if len(batch) != 1 { // 通知不产生响应
		t.Errorf("批处理响应条数 = %d", len(batch))
	}
}
