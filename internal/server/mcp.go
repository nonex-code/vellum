package server

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/nonex-code/vellum/internal/i18n"
	"github.com/nonex-code/vellum/internal/mcp"
	"github.com/nonex-code/vellum/internal/model"
	"github.com/nonex-code/vellum/internal/store"
)

// 本文件把 Vellum 的工作台数据能力暴露成 MCP 工具：
// 一个 HTTP 端点 /mcp（Streamable HTTP 传输），无状态、无会话。
// 工具直接复用 store 层读写，因此和界面操作走同一条路径——落到仓库里的纯文本并自动 commit。

const mcpProjectDesc = `项目 id（项目集模式下即 projects/<id>，如 "main"）。缺省用当前项目；"~" 表示仓库根项目`

const mcpInstructions = `Vellum 是「仓库即工作台」的 issue 跟踪工具：任务、跟进、文档、配置全部是仓库里的纯文本
（issues/<ID>/issue.md、issues/<ID>/entries/*.md、docs/**/*.md、workbench.yaml），每次写入都会自动 git commit。

使用建议：
1. 先调用 get_workspace 拿到工作台名、项目列表与 schema（状态/优先级/标签/类型/里程碑/自定义字段的合法 id）。
2. 用 list_issues / get_issue / search 了解现状，再决定是否写入。
3. 写操作用 create_issue / update_issue / add_comment / write_doc；字段值请使用 schema 里的 id，不要自造。
4. 多项目工作台下用 project 参数指定项目；不传则作用于当前项目。
5. 删除不可逆（虽然能从 git 历史找回），调用前先与用户确认，并显式传 confirm=true。`

// mcpVersion 返回服务端版本号（构建时由 -ldflags 注入）。
func (s *Server) mcpVersion() string {
	if s.opts.Version != "" {
		return s.opts.Version
	}
	return "dev"
}

// buildMCPServer 装配 MCP 服务端。工具与资源都绑定在 s 上（闭包），
// 所以每次调用看到的都是最新的仓库/项目状态。
func (s *Server) buildMCPServer() *mcp.Server {
	return &mcp.Server{
		Name:         "vellum",
		Title:        "Vellum 工作台",
		Version:      s.mcpVersion(),
		Instructions: mcpInstructions,
		Tools:        s.mcpTools(),
		Resources:    &mcpResources{s: s},
	}
}

// ---------- 作用域 ----------

// mcpPID 解析工具参数里的 project，缺省取服务端当前项目。
func (s *Server) mcpPID(args map[string]any) string {
	if v := mcp.ArgTrim(args, "project"); v != "" {
		pid, _ := s.normPID(v)
		return pid
	}
	pid, _ := s.normPID("")
	return pid
}

// mcpStoreFor 返回项目作用域对应的 store 与生效配置。
func (s *Server) mcpStoreFor(pid string) (*store.Store, model.Config, error) {
	root, cfg, repo, err := s.scopeFor(pid)
	if err != nil {
		return nil, cfg, err
	}
	return store.New(root, cfg.IDPrefix, repo, s.opts.Push), cfg, nil
}

// mcpErr 把 i18n 错误按仓库默认语言渲染成一句话（工具结果里只带文本）。
func (s *Server) mcpErr(err error) error {
	if err == nil {
		return nil
	}
	s.mu.RLock()
	lang := s.projCfg.Language
	s.mu.RUnlock()
	return fmt.Errorf("%s", i18n.Msg(lang, err))
}

// ---------- 工具清单 ----------

func (s *Server) mcpTools() []mcp.Tool {
	return []mcp.Tool{
		{
			Name:  "get_workspace",
			Title: "工作台概况",
			Description: "读取工作台与当前项目的基本信息、项目列表、任务统计，以及完整 schema（状态、优先级、标签、类型、" +
				"里程碑、自定义字段、模板的合法 id）。写任务或文档前先调用它，避免使用不存在的 id。",
			InputSchema: mcp.Object(map[string]any{
				"project": mcp.Str(mcpProjectDesc),
			}),
			Handler: s.mcpGetWorkspace,
		},
		{
			Name:  "list_issues",
			Title: "任务列表",
			Description: "按状态/优先级/类型/负责人/标签/里程碑/关键字筛选任务，返回精简列表（不含正文），默认按更新时间倒序。" +
				"根项目可带 include_children 聚合子项目。",
			InputSchema: mcp.Object(map[string]any{
				"project":          mcp.Str(mcpProjectDesc),
				"status":           mcp.Str("状态 id，可用逗号分隔多个（见 schema.statuses）"),
				"status_category":  mcp.StrEnum("按状态语义分类筛选，等价于「待办/进行中/已完成」", "todo", "active", "done"),
				"priority":         mcp.Str("优先级 id（见 schema.priorities）"),
				"type":             mcp.Str("类型 id（见 schema.types）"),
				"assignee":         mcp.Str("负责人"),
				"label":            mcp.Str("标签 id（见 schema.labels）"),
				"milestone":        mcp.Str("里程碑 id（见 schema.milestones）"),
				"parent":           mcp.Str("父任务 id，只看它的子任务"),
				"q":                mcp.Str("关键字，匹配编号/标题/正文/标签"),
				"include_children": mcp.Bool("是否聚合子项目的任务（仅根项目且多项目模式有效）"),
				"sort":             mcp.StrEnum("排序字段", "updated", "created", "priority", "title"),
				"order":            mcp.StrEnum("排序方向", "asc", "desc"),
				"limit":            mcp.Int("最多返回多少条，默认 50，上限 500", 50),
			}),
			Handler: s.mcpListIssues,
		},
		{
			Name:        "get_issue",
			Title:       "任务详情",
			Description: "读取单个任务的完整字段、Markdown 正文与跟进时间线（含状态流转记录）。",
			InputSchema: mcp.Object(map[string]any{
				"id":              mcp.Str("任务 id，如 WB-0001"),
				"project":         mcp.Str(mcpProjectDesc),
				"include_entries": mcp.Bool("是否返回跟进时间线，默认 true"),
			}, "id"),
			Handler: s.mcpGetIssue,
		},
		{
			Name:  "create_issue",
			Title: "新建任务",
			Description: "新建任务并返回分配到的 id（写入仓库后自动 git commit）。status 省略时用第一个「待办」类状态。" +
				"字段值请使用 schema 里的 id；不认识的 id 会在 warnings 里提示，但不会拒绝写入。",
			InputSchema: mcp.Object(map[string]any{
				"title":     mcp.Str("标题（必填）"),
				"body":      mcp.Str("Markdown 正文"),
				"status":    mcp.Str("状态 id"),
				"priority":  mcp.Str("优先级 id"),
				"type":      mcp.Str("类型 id"),
				"assignee":  mcp.Str("负责人"),
				"labels":    mcp.StrArray("标签 id 列表"),
				"milestone": mcp.Str("里程碑 id"),
				"parent":    mcp.Str("父任务 id（建子任务时）"),
				"start":     mcp.Str("开始日期 YYYY-MM-DD"),
				"due":       mcp.Str("截止日期 YYYY-MM-DD"),
				"fields":    mcp.StrMap("自定义字段：字段 id → 值"),
				"project":   mcp.Str(mcpProjectDesc),
			}, "title"),
			Handler: s.mcpCreateIssue,
		},
		{
			Name:  "update_issue",
			Title: "修改任务",
			Description: "按字段修改任务（只改传入的字段）。状态变化会自动追加一条 status 时间线，可用 note 写说明。" +
				"传空字符串可清空字段（如 assignee）。",
			InputSchema: mcp.Object(map[string]any{
				"id":        mcp.Str("任务 id"),
				"title":     mcp.Str("新标题"),
				"body":      mcp.Str("新正文（整体替换）"),
				"status":    mcp.Str("新状态 id"),
				"note":      mcp.Str("状态变化时写进时间线的说明"),
				"priority":  mcp.Str("新优先级 id"),
				"type":      mcp.Str("新类型 id"),
				"assignee":  mcp.Str("新负责人；空串表示清空"),
				"labels":    mcp.StrArray("新标签列表（整体替换）"),
				"milestone": mcp.Str("新里程碑 id"),
				"parent":    mcp.Str("新父任务 id"),
				"start":     mcp.Str("开始日期 YYYY-MM-DD"),
				"due":       mcp.Str("截止日期 YYYY-MM-DD"),
				"fields":    mcp.StrMap("自定义字段：字段 id → 值（整体替换）"),
				"project":   mcp.Str(mcpProjectDesc),
			}, "id"),
			Handler: s.mcpUpdateIssue,
		},
		{
			Name:  "add_comment",
			Title: "追加跟进",
			Description: "给任务追加一条跟进（Markdown），author 缺省为 ai。记录进展与结论优先用它，" +
				"比直接改正文更容易回溯。",
			InputSchema: mcp.Object(map[string]any{
				"id":      mcp.Str("任务 id"),
				"body":    mcp.Str("跟进内容（Markdown，必填）"),
				"author":  mcp.Str("作者，默认 ai"),
				"project": mcp.Str(mcpProjectDesc),
			}, "id", "body"),
			Handler: s.mcpAddComment,
		},
		{
			Name:  "delete_issue",
			Title: "删除任务",
			Description: "删除任务及其全部跟进/附件（做法是删掉 issues/<ID>/ 目录并 commit）。" +
				"不可逆，必须显式传 confirm=true，且应先与用户确认。",
			InputSchema: mcp.Object(map[string]any{
				"id":      mcp.Str("任务 id"),
				"confirm": mcp.Bool("确认删除，必须为 true"),
				"project": mcp.Str(mcpProjectDesc),
			}, "id", "confirm"),
			Handler: s.mcpDeleteIssue,
		},
		{
			Name:  "search",
			Title: "全文检索",
			Description: "在任务（标题/正文/标签/编号/跟进）与文档（标题/正文/路径/标签）中做不区分大小写的全文检索，" +
				"返回命中片段。",
			InputSchema: mcp.Object(map[string]any{
				"q":       mcp.Str("关键字（必填）"),
				"kind":    mcp.StrEnum("检索范围", "all", "issue", "doc"),
				"limit":   mcp.Int("最多返回多少条，默认 20，上限 100", 20),
				"project": mcp.Str(mcpProjectDesc),
			}, "q"),
			Handler: s.mcpSearch,
		},
		{
			Name:        "list_docs",
			Title:       "文档列表",
			Description: "列出 docs/ 下的 Markdown 文档（路径、标题、标签、置顶、更新时间），不含正文。",
			InputSchema: mcp.Object(map[string]any{
				"q":       mcp.Str("按标题/路径/标签过滤"),
				"limit":   mcp.Int("最多返回多少篇，默认 100，上限 500", 100),
				"project": mcp.Str(mcpProjectDesc),
			}),
			Handler: s.mcpListDocs,
		},
		{
			Name:        "read_doc",
			Title:       "读取文档",
			Description: "按路径读取一篇文档的完整内容。路径相对 docs/，可省略 .md 后缀。",
			InputSchema: mcp.Object(map[string]any{
				"path":    mcp.Str("文档路径，如 guide/setup 或 docs/guide/setup.md"),
				"project": mcp.Str(mcpProjectDesc),
			}, "path"),
			Handler: s.mcpReadDoc,
		},
		{
			Name:  "write_doc",
			Title: "写入文档",
			Description: "新建或更新文档（存在即更新、不存在即新建），正文整体替换。更新时可用 new_path 重命名/移动，" +
				"只传 title/tags/pinned 时正文保持不变。",
			InputSchema: mcp.Object(map[string]any{
				"path":     mcp.Str("文档路径（必填），相对 docs/，可省略 .md"),
				"title":    mcp.Str("标题；新建时可省略，默认取文件名"),
				"body":     mcp.Str("Markdown 正文"),
				"tags":     mcp.StrArray("标签列表"),
				"pinned":   mcp.Bool("是否置顶"),
				"new_path": mcp.Str("更新时的新路径（重命名/移动）"),
				"project":  mcp.Str(mcpProjectDesc),
			}, "path"),
			Handler: s.mcpWriteDoc,
		},
		{
			Name:        "delete_doc",
			Title:       "删除文档",
			Description: "删除一篇文档并 commit。必须显式传 confirm=true，且应先与用户确认。",
			InputSchema: mcp.Object(map[string]any{
				"path":    mcp.Str("文档路径"),
				"confirm": mcp.Bool("确认删除，必须为 true"),
				"project": mcp.Str(mcpProjectDesc),
			}, "path", "confirm"),
			Handler: s.mcpDeleteDoc,
		},
	}
}

// ---------- 工具实现 ----------

func (s *Server) mcpGetWorkspace(_ context.Context, args map[string]any) (any, error) {
	pid := s.mcpPID(args)
	_, cfg, repo, err := s.scopeFor(pid)
	if err != nil {
		return nil, s.mcpErr(err)
	}
	include := pid == RootPID && s.isMulti()
	issues, _, err := s.issuesForPID(pid, include)
	if err != nil {
		return nil, s.mcpErr(err)
	}

	catOf := map[string]string{}
	for _, st := range cfg.Statuses {
		catOf[st.ID] = st.Category
	}
	today := time.Now().Format("2006-01-02")
	stats := map[string]int{"total": len(issues), "todo": 0, "active": 0, "done": 0, "overdue": 0}
	for _, iss := range issues {
		cat := statusCategory(iss.Status, catOf)
		switch cat {
		case "done":
			stats["done"]++
		case "active":
			stats["active"]++
		default:
			stats["todo"]++
		}
		if cat != "done" && isOverdue(iss.Due, today) {
			stats["overdue"]++
		}
	}

	ws := map[string]any{
		"name":     cfg.Workspace.Name,
		"mode":     cfg.Workspace.Mode,
		"repoRoot": s.snapshotRoot(),
	}
	if repo != nil {
		ws["remote"] = repo.Remote()
		ws["head"] = repo.Head()
	}
	out := map[string]any{
		"workspace":      ws,
		"currentProject": pid,
		"projectMeta":    cfg.Project,
		"schema":         schemaSummary(cfg),
		"stats":          stats,
		"layout":         "issues/<ID>/{issue.md, entries/, files/} · docs/**/*.md · workbench.yaml",
	}
	if cfg.Workspace.Mode == "multi" {
		out["projects"] = s.projectsMeta()
	}
	return out, nil
}

// schemaSummary 提炼 schema 的合法 id 与展示名，供模型挑选字段值。
func schemaSummary(cfg model.Config) map[string]any {
	options := func(list []model.Option) []map[string]any {
		out := make([]map[string]any, 0, len(list))
		for _, o := range list {
			m := map[string]any{"id": o.ID, "name": o.Name}
			if o.Start != "" {
				m["start"] = o.Start
			}
			if o.End != "" {
				m["end"] = o.End
			}
			out = append(out, m)
		}
		return out
	}
	statuses := make([]map[string]any, 0, len(cfg.Statuses))
	for _, st := range cfg.Statuses {
		m := map[string]any{"id": st.ID, "name": st.Name, "category": st.Category}
		if st.WIP > 0 {
			m["wip"] = st.WIP
		}
		statuses = append(statuses, m)
	}
	labels := make([]map[string]any, 0, len(cfg.Labels))
	for _, l := range cfg.Labels {
		labels = append(labels, map[string]any{"id": l.ID, "name": l.Name})
	}
	fields := make([]map[string]any, 0, len(cfg.Fields))
	for _, f := range cfg.Fields {
		m := map[string]any{"id": f.ID, "name": f.Name, "type": f.Type}
		if len(f.Options) > 0 {
			m["options"] = f.Options
		}
		fields = append(fields, m)
	}
	templates := make([]map[string]any, 0, len(cfg.Templates))
	for _, tp := range cfg.Templates {
		templates = append(templates, map[string]any{"id": tp.ID, "name": tp.Name, "type": tp.Type})
	}
	return map[string]any{
		"idPrefix":   cfg.IDPrefix,
		"statuses":   statuses,
		"priorities": options(cfg.Priorities),
		"labels":     labels,
		"types":      options(cfg.Types),
		"milestones": options(cfg.Milestones),
		"fields":     fields,
		"templates":  templates,
	}
}

func (s *Server) mcpListIssues(_ context.Context, args map[string]any) (any, error) {
	pid := s.mcpPID(args)
	include := mcp.ArgBool(args, "include_children", pid == RootPID && s.isMulti())
	issues, cfg, err := s.issuesForPID(pid, include)
	if err != nil {
		return nil, s.mcpErr(err)
	}

	q := strings.ToLower(mcp.ArgTrim(args, "q"))
	statusSet := map[string]bool{}
	for _, v := range mcp.ArgStrings(args, "status") {
		statusSet[v] = true
	}
	priority := mcp.ArgTrim(args, "priority")
	typ := mcp.ArgTrim(args, "type")
	assignee := mcp.ArgTrim(args, "assignee")
	label := mcp.ArgTrim(args, "label")
	milestone := mcp.ArgTrim(args, "milestone")
	parent := mcp.ArgTrim(args, "parent")
	category := mcp.ArgTrim(args, "status_category")

	catOf := map[string]string{}
	for _, st := range cfg.Statuses {
		catOf[st.ID] = st.Category
	}

	out := make([]model.Issue, 0, len(issues))
	for _, iss := range issues {
		if len(statusSet) > 0 && !statusSet[iss.Status] {
			continue
		}
		if category != "" && statusCategory(iss.Status, catOf) != category {
			continue
		}
		if priority != "" && iss.Priority != priority {
			continue
		}
		if typ != "" && iss.Type != typ {
			continue
		}
		if assignee != "" && iss.Assignee != assignee {
			continue
		}
		if milestone != "" && iss.Milestone != milestone {
			continue
		}
		if parent != "" && iss.Parent != parent {
			continue
		}
		if label != "" && !containsStr(iss.Labels, label) {
			continue
		}
		if q != "" && !strings.Contains(strings.ToLower(iss.ID+" "+iss.Title+" "+iss.Body+" "+strings.Join(iss.Labels, " ")), q) {
			continue
		}
		out = append(out, iss)
	}

	prioRank := map[string]int{}
	for i, p := range cfg.Priorities {
		prioRank[p.ID] = i
	}
	sortIssues(out, mcp.ArgTrim(args, "sort"), mcp.ArgTrim(args, "order"), prioRank)

	limit := mcp.ArgInt(args, "limit", 50)
	if limit <= 0 {
		limit = 50
	}
	if limit > 500 {
		limit = 500
	}
	truncated := false
	if len(out) > limit {
		out, truncated = out[:limit], true
	}
	items := make([]map[string]any, 0, len(out))
	for _, iss := range out {
		items = append(items, issueSummary(iss))
	}
	return map[string]any{"project": pid, "count": len(items), "truncated": truncated, "issues": items}, nil
}

func (s *Server) mcpGetIssue(_ context.Context, args map[string]any) (any, error) {
	pid := s.mcpPID(args)
	st, _, err := s.mcpStoreFor(pid)
	if err != nil {
		return nil, s.mcpErr(err)
	}
	iss, entries, err := st.ReadIssue(mcp.ArgTrim(args, "id"))
	if err != nil {
		return nil, s.mcpErr(err)
	}
	out := map[string]any{"project": pid, "issue": issueFull(iss)}
	if mcp.ArgBool(args, "include_entries", true) {
		list := make([]map[string]any, 0, len(entries))
		for _, e := range entries {
			m := map[string]any{"author": e.Author, "created": e.Created, "type": e.Type, "body": e.Body, "file": e.File}
			if e.From != "" || e.To != "" {
				m["from"], m["to"] = e.From, e.To
			}
			if e.Edited {
				m["edited"] = true
			}
			list = append(list, m)
		}
		out["entries"] = list
	}
	return out, nil
}

func (s *Server) mcpCreateIssue(_ context.Context, args map[string]any) (any, error) {
	pid := s.mcpPID(args)
	st, cfg, err := s.mcpStoreFor(pid)
	if err != nil {
		return nil, s.mcpErr(err)
	}
	title := mcp.ArgTrim(args, "title")
	if title == "" {
		return nil, fmt.Errorf("title 不能为空")
	}
	status := mcp.ArgTrim(args, "status")
	if status == "" {
		status = defaultStatusID(cfg)
	}
	iss, err := st.CreateIssue(model.Issue{
		Title:     title,
		Body:      mcp.ArgString(args, "body"),
		Status:    status,
		Priority:  mcp.ArgTrim(args, "priority"),
		Type:      mcp.ArgTrim(args, "type"),
		Assignee:  mcp.ArgTrim(args, "assignee"),
		Labels:    mcp.ArgStrings(args, "labels"),
		Milestone: mcp.ArgTrim(args, "milestone"),
		Parent:    mcp.ArgTrim(args, "parent"),
		Start:     mcp.ArgTrim(args, "start"),
		Due:       mcp.ArgTrim(args, "due"),
		Fields:    mcp.ArgMap(args, "fields"),
	})
	if err != nil {
		return nil, s.mcpErr(err)
	}
	out := map[string]any{"project": pid, "issue": issueFull(iss), "committed": true}
	if w := validateIssueRefs(cfg, iss); len(w) > 0 {
		out["warnings"] = w
	}
	return out, nil
}

func (s *Server) mcpUpdateIssue(_ context.Context, args map[string]any) (any, error) {
	pid := s.mcpPID(args)
	st, cfg, err := s.mcpStoreFor(pid)
	if err != nil {
		return nil, s.mcpErr(err)
	}
	id := mcp.ArgTrim(args, "id")
	if id == "" {
		return nil, fmt.Errorf("id 不能为空")
	}
	// 只把显式给出的字段放进 patch：空串表示清空，没给的字段保持不变。
	strFields := []string{"title", "status", "note", "priority", "type", "assignee",
		"milestone", "parent", "start", "due", "body"}
	patch := map[string]any{}
	for _, k := range strFields {
		if mcp.Has(args, k) {
			patch[k] = mcp.ArgString(args, k)
		}
	}
	if mcp.Has(args, "labels") {
		patch["labels"] = mcp.ArgStrings(args, "labels")
	}
	if mcp.Has(args, "fields") {
		fields := map[string]any{}
		for k, v := range mcp.ArgMap(args, "fields") {
			fields[k] = v
		}
		patch["fields"] = fields
	}
	if len(patch) == 0 {
		return nil, fmt.Errorf("没有要更新的字段：请给出 title/status/priority/type/assignee/labels/milestone/parent/start/due/body/fields 之一")
	}
	iss, err := st.UpdateIssue(id, patch)
	if err != nil {
		return nil, s.mcpErr(err)
	}
	out := map[string]any{"project": pid, "issue": issueFull(iss), "committed": true}
	if w := validateIssueRefs(cfg, iss); len(w) > 0 {
		out["warnings"] = w
	}
	// 不在白名单里的参数不会写盘，明确回给调用方，避免误以为生效。
	if unknown := unknownKeys(args, append(strFields, "id", "project", "labels", "fields")); len(unknown) > 0 {
		out["ignored"] = unknown
	}
	return out, nil
}

func (s *Server) mcpAddComment(_ context.Context, args map[string]any) (any, error) {
	pid := s.mcpPID(args)
	st, _, err := s.mcpStoreFor(pid)
	if err != nil {
		return nil, s.mcpErr(err)
	}
	id := mcp.ArgTrim(args, "id")
	body := mcp.ArgString(args, "body")
	if strings.TrimSpace(body) == "" {
		return nil, fmt.Errorf("body 不能为空")
	}
	author := mcp.ArgTrim(args, "author")
	if author == "" {
		author = "ai"
	}
	en, err := st.AddEntry(id, model.Entry{Body: body, Type: "comment", Author: author})
	if err != nil {
		return nil, s.mcpErr(err)
	}
	return map[string]any{"project": pid, "issueId": id, "entry": en, "committed": true}, nil
}

func (s *Server) mcpDeleteIssue(_ context.Context, args map[string]any) (any, error) {
	if !mcp.ArgBool(args, "confirm", false) {
		return nil, fmt.Errorf("删除任务需要显式传 confirm=true（请先与用户确认）")
	}
	pid := s.mcpPID(args)
	st, _, err := s.mcpStoreFor(pid)
	if err != nil {
		return nil, s.mcpErr(err)
	}
	id := mcp.ArgTrim(args, "id")
	if err := st.DeleteIssue(id); err != nil {
		return nil, s.mcpErr(err)
	}
	return map[string]any{"ok": true, "project": pid, "deleted": id}, nil
}

func (s *Server) mcpSearch(_ context.Context, args map[string]any) (any, error) {
	pid := s.mcpPID(args)
	q := mcp.ArgTrim(args, "q")
	if q == "" {
		return nil, fmt.Errorf("q 不能为空")
	}
	kind := mcp.ArgTrim(args, "kind")
	if kind == "" {
		kind = "all"
	}
	limit := mcp.ArgInt(args, "limit", 20)
	if limit <= 0 {
		limit = 20
	}
	if limit > 100 {
		limit = 100
	}

	out := map[string]any{"project": pid, "query": q}
	if kind == "all" || kind == "issue" {
		hits, err := s.searchHitsFor(pid, pid == RootPID && s.isMulti(), q)
		if err != nil {
			return nil, s.mcpErr(err)
		}
		truncated := false
		if len(hits) > limit {
			hits, truncated = hits[:limit], true
		}
		items := make([]map[string]any, 0, len(hits))
		for _, h := range hits {
			m := issueSummary(h.Issue)
			if h.Snippet != "" {
				m["snippet"] = h.Snippet
			}
			items = append(items, m)
		}
		out["issues"] = items
		out["issuesTruncated"] = truncated
	}
	if kind == "all" || kind == "doc" {
		st, _, err := s.mcpStoreFor(pid)
		if err != nil {
			return nil, s.mcpErr(err)
		}
		hits, err := st.SearchDocs(q)
		if err != nil {
			return nil, s.mcpErr(err)
		}
		truncated := false
		if len(hits) > limit {
			hits, truncated = hits[:limit], true
		}
		items := make([]map[string]any, 0, len(hits))
		for _, h := range hits {
			m := map[string]any{"path": h.Doc.Path, "title": h.Doc.Title}
			if len(h.Doc.Tags) > 0 {
				m["tags"] = h.Doc.Tags
			}
			if h.Snippet != "" {
				m["snippet"] = h.Snippet
			}
			items = append(items, m)
		}
		out["docs"] = items
		out["docsTruncated"] = truncated
	}
	return out, nil
}

func (s *Server) mcpListDocs(_ context.Context, args map[string]any) (any, error) {
	pid := s.mcpPID(args)
	st, _, err := s.mcpStoreFor(pid)
	if err != nil {
		return nil, s.mcpErr(err)
	}
	docs, err := st.ListDocs()
	if err != nil {
		return nil, s.mcpErr(err)
	}
	q := strings.ToLower(mcp.ArgTrim(args, "q"))
	limit := mcp.ArgInt(args, "limit", 100)
	if limit <= 0 {
		limit = 100
	}
	if limit > 500 {
		limit = 500
	}
	items := make([]map[string]any, 0, len(docs))
	for _, d := range docs {
		if q != "" {
			hay := strings.ToLower(d.Path + " " + d.Title + " " + strings.Join(d.Tags, " "))
			if !strings.Contains(hay, q) {
				continue
			}
		}
		m := map[string]any{"path": d.Path, "title": d.Title, "updated": d.Updated}
		if len(d.Tags) > 0 {
			m["tags"] = d.Tags
		}
		if d.Pinned {
			m["pinned"] = true
		}
		items = append(items, m)
	}
	truncated := false
	if len(items) > limit {
		items, truncated = items[:limit], true
	}
	return map[string]any{"project": pid, "count": len(items), "truncated": truncated, "docs": items}, nil
}

func (s *Server) mcpReadDoc(_ context.Context, args map[string]any) (any, error) {
	pid := s.mcpPID(args)
	st, _, err := s.mcpStoreFor(pid)
	if err != nil {
		return nil, s.mcpErr(err)
	}
	d, err := st.ReadDoc(mcp.ArgTrim(args, "path"))
	if err != nil {
		return nil, s.mcpErr(err)
	}
	return map[string]any{"project": pid, "doc": docFull(d)}, nil
}

func (s *Server) mcpWriteDoc(_ context.Context, args map[string]any) (any, error) {
	pid := s.mcpPID(args)
	st, _, err := s.mcpStoreFor(pid)
	if err != nil {
		return nil, s.mcpErr(err)
	}
	path := mcp.ArgTrim(args, "path")
	if path == "" {
		return nil, fmt.Errorf("path 不能为空")
	}

	if _, rerr := st.ReadDoc(path); rerr == nil {
		patch := map[string]any{}
		if v := mcp.ArgTrim(args, "title"); v != "" {
			patch["title"] = v
		}
		if mcp.Has(args, "body") {
			patch["body"] = mcp.ArgString(args, "body")
		}
		if mcp.Has(args, "tags") {
			patch["tags"] = mcp.ArgStrings(args, "tags")
		}
		if mcp.Has(args, "pinned") {
			patch["pinned"] = mcp.ArgBool(args, "pinned", false)
		}
		if v := mcp.ArgTrim(args, "new_path"); v != "" {
			patch["path"] = v
		}
		d, err := st.UpdateDoc(path, patch)
		if err != nil {
			return nil, s.mcpErr(err)
		}
		return map[string]any{"project": pid, "created": false, "doc": docFull(d), "committed": true}, nil
	}

	d, err := st.CreateDoc(model.Doc{
		Path:   path,
		Title:  mcp.ArgTrim(args, "title"),
		Tags:   mcp.ArgStrings(args, "tags"),
		Pinned: mcp.ArgBool(args, "pinned", false),
		Body:   mcp.ArgString(args, "body"),
	})
	if err != nil {
		return nil, s.mcpErr(err)
	}
	return map[string]any{"project": pid, "created": true, "doc": docFull(d), "committed": true}, nil
}

func (s *Server) mcpDeleteDoc(_ context.Context, args map[string]any) (any, error) {
	if !mcp.ArgBool(args, "confirm", false) {
		return nil, fmt.Errorf("删除文档需要显式传 confirm=true（请先与用户确认）")
	}
	pid := s.mcpPID(args)
	st, _, err := s.mcpStoreFor(pid)
	if err != nil {
		return nil, s.mcpErr(err)
	}
	path := mcp.ArgTrim(args, "path")
	if err := st.DeleteDoc(path); err != nil {
		return nil, s.mcpErr(err)
	}
	return map[string]any{"ok": true, "project": pid, "deleted": path}, nil
}

// ---------- 展示辅助 ----------

func issueSummary(iss model.Issue) map[string]any {
	m := map[string]any{"id": iss.ID, "title": iss.Title, "status": iss.Status}
	if iss.Priority != "" {
		m["priority"] = iss.Priority
	}
	if iss.Type != "" {
		m["type"] = iss.Type
	}
	if iss.Assignee != "" {
		m["assignee"] = iss.Assignee
	}
	if len(iss.Labels) > 0 {
		m["labels"] = iss.Labels
	}
	if iss.Milestone != "" {
		m["milestone"] = iss.Milestone
	}
	if iss.Parent != "" {
		m["parent"] = iss.Parent
	}
	if iss.Due != "" {
		m["due"] = iss.Due
	}
	if iss.Updated != "" {
		m["updated"] = iss.Updated
	}
	if iss.Project != "" {
		m["project"] = iss.Project
	}
	return m
}

func issueFull(iss model.Issue) map[string]any {
	m := issueSummary(iss)
	if iss.Start != "" {
		m["start"] = iss.Start
	}
	if iss.Created != "" {
		m["created"] = iss.Created
	}
	if len(iss.Fields) > 0 {
		m["fields"] = iss.Fields
	}
	m["body"] = iss.Body
	return m
}

func docFull(d model.Doc) map[string]any {
	m := map[string]any{"path": d.Path, "title": d.Title, "created": d.Created, "updated": d.Updated}
	if len(d.Tags) > 0 {
		m["tags"] = d.Tags
	}
	if d.Pinned {
		m["pinned"] = true
	}
	m["body"] = d.Body
	return m
}

// defaultStatusID 取第一个「待办」类状态（没有则退回第一个非完成状态），新建任务时用它。
func defaultStatusID(cfg model.Config) string {
	for _, st := range cfg.Statuses {
		if st.Category == "todo" {
			return st.ID
		}
	}
	for _, st := range cfg.Statuses {
		if st.Category != "done" {
			return st.ID
		}
	}
	if len(cfg.Statuses) > 0 {
		return cfg.Statuses[0].ID
	}
	return "todo"
}

// validateIssueRefs 检查任务引用的 id 是否在 schema 里，返回提示（不阻止写入）。
func validateIssueRefs(cfg model.Config, iss model.Issue) []string {
	var warn []string
	has := func(list []model.Option, id string) bool {
		for _, o := range list {
			if o.ID == id {
				return true
			}
		}
		return false
	}
	statusOK := false
	for _, st := range cfg.Statuses {
		if st.ID == iss.Status {
			statusOK = true
			break
		}
	}
	if !statusOK {
		warn = append(warn, fmt.Sprintf("状态 %q 不在 schema.statuses 中", iss.Status))
	}
	if iss.Priority != "" && !has(cfg.Priorities, iss.Priority) {
		warn = append(warn, fmt.Sprintf("优先级 %q 不在 schema.priorities 中", iss.Priority))
	}
	if iss.Type != "" && !has(cfg.Types, iss.Type) {
		warn = append(warn, fmt.Sprintf("类型 %q 不在 schema.types 中", iss.Type))
	}
	if iss.Milestone != "" && !has(cfg.Milestones, iss.Milestone) {
		warn = append(warn, fmt.Sprintf("里程碑 %q 不在 schema.milestones 中", iss.Milestone))
	}
	for _, l := range iss.Labels {
		ok := false
		for _, def := range cfg.Labels {
			if def.ID == l {
				ok = true
				break
			}
		}
		if !ok {
			warn = append(warn, fmt.Sprintf("标签 %q 不在 schema.labels 中", l))
		}
	}
	for k := range iss.Fields {
		ok := false
		for _, f := range cfg.Fields {
			if f.ID == k {
				ok = true
				break
			}
		}
		if !ok {
			warn = append(warn, fmt.Sprintf("自定义字段 %q 不在 schema.fields 中", k))
		}
	}
	return warn
}

func unknownKeys(args map[string]any, known []string) []string {
	allow := map[string]bool{}
	for _, k := range known {
		allow[k] = true
	}
	var out []string
	for k := range args {
		if !allow[k] {
			out = append(out, k)
		}
	}
	return out
}

// ---------- 资源 ----------

// mcpResources 把任务与文档暴露为可浏览的 MCP 资源：
// vellum://issues/<id> 与 vellum://docs/<path>，作用域为当前项目。
type mcpResources struct{ s *Server }

func (p *mcpResources) currentStore() (*store.Store, error) {
	st, _, err := p.s.mcpStoreFor(p.s.mcpPID(nil))
	return st, err
}

func (p *mcpResources) ListResources(_ context.Context) ([]mcp.Resource, error) {
	st, err := p.currentStore()
	if err != nil {
		return nil, p.s.mcpErr(err)
	}
	issues, err := st.ListIssues()
	if err != nil {
		return nil, p.s.mcpErr(err)
	}
	docs, err := st.ListDocs()
	if err != nil {
		return nil, p.s.mcpErr(err)
	}
	out := make([]mcp.Resource, 0, len(issues)+len(docs))
	for i, iss := range issues {
		if i >= 100 { // 只列最近的 100 条，避免资源列表过长
			break
		}
		out = append(out, mcp.Resource{
			URI:      issueURI(iss.ID),
			Name:     iss.ID,
			Title:    iss.Title,
			MimeType: "text/markdown",
		})
	}
	for _, d := range docs {
		out = append(out, mcp.Resource{
			URI:      docURI(d.Path),
			Name:     d.Path,
			Title:    d.Title,
			MimeType: "text/markdown",
		})
	}
	return out, nil
}

func (p *mcpResources) ReadResource(_ context.Context, uri string) ([]mcp.ResourceContent, error) {
	switch {
	case strings.HasPrefix(uri, "vellum://issues/"):
		id, err := url.PathUnescape(strings.TrimPrefix(uri, "vellum://issues/"))
		if err != nil || id == "" {
			return nil, fmt.Errorf("非法资源 URI: %s", uri)
		}
		st, err := p.currentStore()
		if err != nil {
			return nil, p.s.mcpErr(err)
		}
		iss, entries, err := st.ReadIssue(id)
		if err != nil {
			return nil, p.s.mcpErr(err)
		}
		return []mcp.ResourceContent{{URI: uri, MimeType: "text/markdown", Text: renderIssueMarkdown(iss, entries)}}, nil
	case strings.HasPrefix(uri, "vellum://docs/"):
		path, err := url.PathUnescape(strings.TrimPrefix(uri, "vellum://docs/"))
		if err != nil || path == "" {
			return nil, fmt.Errorf("非法资源 URI: %s", uri)
		}
		st, err := p.currentStore()
		if err != nil {
			return nil, p.s.mcpErr(err)
		}
		d, err := st.ReadDoc(path)
		if err != nil {
			return nil, p.s.mcpErr(err)
		}
		return []mcp.ResourceContent{{URI: uri, MimeType: "text/markdown", Text: renderDocMarkdown(d)}}, nil
	default:
		return nil, fmt.Errorf("未知资源 URI: %s", uri)
	}
}

func issueURI(id string) string { return "vellum://issues/" + url.PathEscape(id) }

func docURI(path string) string {
	path = strings.TrimPrefix(strings.TrimPrefix(path, "docs/"), "./")
	return "vellum://docs/" + url.PathEscape(path)
}

// renderIssueMarkdown 把任务与时间线渲染成一段 Markdown，作为资源内容返回。
func renderIssueMarkdown(iss model.Issue, entries []model.Entry) string {
	var b strings.Builder
	fmt.Fprintf(&b, "# %s %s\n\n", iss.ID, iss.Title)
	if iss.Status != "" {
		fmt.Fprintf(&b, "- 状态：%s\n", iss.Status)
	}
	if iss.Priority != "" {
		fmt.Fprintf(&b, "- 优先级：%s\n", iss.Priority)
	}
	if iss.Type != "" {
		fmt.Fprintf(&b, "- 类型：%s\n", iss.Type)
	}
	if iss.Assignee != "" {
		fmt.Fprintf(&b, "- 负责人：%s\n", iss.Assignee)
	}
	if len(iss.Labels) > 0 {
		fmt.Fprintf(&b, "- 标签：%s\n", strings.Join(iss.Labels, ", "))
	}
	if iss.Milestone != "" {
		fmt.Fprintf(&b, "- 里程碑：%s\n", iss.Milestone)
	}
	if iss.Due != "" {
		fmt.Fprintf(&b, "- 截止：%s\n", iss.Due)
	}
	fmt.Fprintf(&b, "- 更新：%s\n\n", iss.Updated)
	b.WriteString(iss.Body)
	for _, e := range entries {
		fmt.Fprintf(&b, "\n\n---\n\n**%s · %s · %s**\n\n", e.Created, e.Author, e.Type)
		if e.Type == "status" {
			fmt.Fprintf(&b, "%s → %s\n\n", e.From, e.To)
		}
		b.WriteString(e.Body)
	}
	return b.String()
}

func renderDocMarkdown(d model.Doc) string {
	var b strings.Builder
	fmt.Fprintf(&b, "# %s\n\n", d.Title)
	if len(d.Tags) > 0 {
		fmt.Fprintf(&b, "标签：%s\n\n", strings.Join(d.Tags, ", "))
	}
	fmt.Fprintf(&b, "路径：docs/%s · 更新：%s\n\n", strings.TrimPrefix(d.Path, "docs/"), d.Updated)
	b.WriteString(d.Body)
	return b.String()
}

// ---------- HTTP 端点 ----------

// handleMCP 是 MCP 的 Streamable HTTP 入口：POST 一条 JSON-RPC 消息，回一条 JSON。
// 本项目不提供服务端推送流（SSE），GET/DELETE 按协议返回 405。
func (s *Server) handleMCP(w http.ResponseWriter, r *http.Request) {
	if s.mcpSrv == nil {
		writeMCPJSON(w, http.StatusServiceUnavailable, map[string]string{
			"error": "MCP 未启用（启动时设了 WB_MCP=false）",
		})
		return
	}
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", http.MethodPost)
		writeMCPJSON(w, http.StatusMethodNotAllowed, map[string]string{
			"error": "该 MCP 端点只接受 POST（Streamable HTTP，未提供服务端推送流）",
		})
		return
	}
	if s.opts.MCPToken != "" && !s.mcpAuthorized(r) {
		w.Header().Set("WWW-Authenticate", `Bearer realm="vellum-mcp"`)
		writeMCPJSON(w, http.StatusUnauthorized, map[string]string{"error": "MCP token 无效"})
		return
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, 4<<20))
	if err != nil {
		writeMCPJSON(w, http.StatusBadRequest, map[string]string{"error": "读取请求体失败: " + err.Error()})
		return
	}
	out, respond := s.mcpSrv.Handle(r.Context(), body)
	if !respond {
		// 通知类消息（notifications/initialized 等）：202 + 空响应体。
		w.WriteHeader(http.StatusAccepted)
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(out)
}

// mcpAuthorized 校验 Bearer token（也接受 X-WB-MCP-Token 与 ?token= 便于手工调试）。
func (s *Server) mcpAuthorized(r *http.Request) bool {
	tok := ""
	if v := r.Header.Get("Authorization"); strings.HasPrefix(strings.ToLower(v), "bearer ") {
		tok = strings.TrimSpace(v[7:])
	}
	if tok == "" {
		tok = r.Header.Get("X-WB-MCP-Token")
	}
	if tok == "" {
		tok = r.URL.Query().Get("token")
	}
	return subtle.ConstantTimeCompare([]byte(tok), []byte(s.opts.MCPToken)) == 1
}

// handleMCPInfo 给界面与用户看的接入信息（端点地址、协议版本、工具清单、客户端配置样例）。
func (s *Server) handleMCPInfo(w http.ResponseWriter, r *http.Request) {
	if s.mcpSrv == nil {
		writeJSON(w, map[string]any{"enabled": false})
		return
	}
	endpoint := mcpEndpoint(r)
	tools := make([]map[string]any, 0, len(s.mcpSrv.Tools))
	for _, t := range s.mcpSrv.Tools {
		tools = append(tools, map[string]any{"name": t.Name, "title": t.Title, "description": t.Description})
	}
	writeJSON(w, map[string]any{
		"enabled":         true,
		"endpoint":        endpoint,
		"path":            "/mcp",
		"protocolVersion": mcp.ProtocolVersion,
		"requiresToken":   s.opts.MCPToken != "",
		"tools":           tools,
		"resources":       true,
		"config": map[string]any{
			"mcpServers": map[string]any{
				"vellum": map[string]any{
					"type": "http",
					"url":  endpoint,
				},
			},
		},
	})
}

// mcpEndpoint 按请求的 Host 拼出绝对地址；反向代理下优先用 X-Forwarded-*。
func mcpEndpoint(r *http.Request) string {
	scheme := "http"
	if r.TLS != nil {
		scheme = "https"
	}
	if v := r.Header.Get("X-Forwarded-Proto"); v != "" {
		scheme = strings.TrimSpace(strings.Split(v, ",")[0])
	}
	host := r.Host
	if v := r.Header.Get("X-Forwarded-Host"); v != "" {
		host = strings.TrimSpace(strings.Split(v, ",")[0])
	}
	if host == "" {
		host = "localhost:8420"
	}
	return scheme + "://" + host + "/mcp"
}

func writeMCPJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(code)
	b, err := json.Marshal(v)
	if err != nil {
		return
	}
	_, _ = w.Write(b)
}
