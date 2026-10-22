package store

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/nonex-code/vellum/internal/model"
)

// issue.md 必须「人可读」：渲染后能看到时间、作者、状态变更，
// 而不是全靠注释。这里锁定这个契约。

func TestIssueFileIsHumanReadable(t *testing.T) {
	dir := t.TempDir()
	os.MkdirAll(filepath.Join(dir, "issues"), 0o755)
	s := New(dir, "WB", nil, false)

	iss, err := s.CreateIssue(model.Issue{Title: "可读性", Body: "描述正文"})
	if err != nil {
		t.Fatal(err)
	}
	id := iss.ID
	if _, err := s.AddEntry(id, model.Entry{Type: "comment", Author: "alice", Body: "跟进内容"}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.UpdateIssue(id, map[string]any{"status": "doing"}); err != nil {
		t.Fatal(err)
	}

	raw, err := os.ReadFile(filepath.Join(dir, "issues", id, "issue.md"))
	if err != nil {
		t.Fatal(err)
	}
	txt := string(raw)

	// 1) 作者和时间必须以可见 markdown 形式出现（不是只在注释里）。
	if !strings.Contains(txt, "#### ") {
		t.Fatalf("缺少可见标题行:\n%s", txt)
	}
	if !strings.Contains(txt, "alice") {
		t.Fatalf("作者不可见:\n%s", txt)
	}
	// 2) 状态变更要有可读文字，而不是只有 todo/doing 这种内部 id。
	if !strings.Contains(txt, "状态变更：待办 → 进行中") {
		t.Fatalf("状态变更不可读:\n%s", txt)
	}
	// 3) 标题行必须在注释之前（渲染时先看到信息）。
	hdr := strings.Index(txt, "#### ")
	meta := strings.Index(txt, metaOpen)
	if hdr < 0 || meta < 0 || hdr > meta {
		t.Fatalf("标题行应在元数据注释之前: hdr=%d meta=%d", hdr, meta)
	}
	// 4) 程序仍需能读回结构化数据。
	_, ents, err := s.ReadIssue(id)
	if err != nil || len(ents) != 2 {
		t.Fatalf("读回失败: %d %+v %v", len(ents), ents, err)
	}
	if ents[0].Author != "alice" || ents[0].Type != "comment" || ents[0].Body != "跟进内容" {
		t.Fatalf("评论条目字段丢失: %+v", ents[0])
	}
	if ents[1].Type != "status" || ents[1].From != "todo" || ents[1].To != "doing" {
		t.Fatalf("状态条目字段丢失: %+v", ents[1])
	}
	// 5) 正文里不能混入标题行。
	for _, e := range ents {
		if strings.Contains(e.Body, entryHeaderPrefix) {
			t.Fatalf("正文被标题行污染: %q", e.Body)
		}
	}
}

// 状态变更的可见文字在各种 from/to 组合下都要合理。
func TestStatusTextVariants(t *testing.T) {
	cases := []struct{ from, to, want string }{
		{"todo", "doing", "状态变更：待办 → 进行中"},
		{"todo", "done", "状态变更：待办 → 已完成"},
		{"", "doing", "状态变更 → 进行中"},
		{"todo", "", "状态变更：待办"},
		{"", "", "状态变更"},
		// 未知状态 id 原样显示，不能吞掉。
		{"todo", "custom", "状态变更：待办 → custom"},
	}
	for _, c := range cases {
		if got := statusText(c.from, c.to); got != c.want {
			t.Errorf("statusText(%q,%q) = %q, 期望 %q", c.from, c.to, got, c.want)
		}
	}
}

// 时间显示要可读；解析不了也不能丢。
func TestHeadTime(t *testing.T) {
	if got := headTime("2025-10-22T10:15:00+08:00"); !strings.Contains(got, "2025-10-22") || !strings.Contains(got, ":") {
		t.Errorf("headTime 结果不可读: %q", got)
	}
	if got := headTime("不是时间"); got != "不是时间" {
		t.Errorf("异常时间应原样返回, got %q", got)
	}
	if got := headTime(""); got == "" {
		t.Error("空时间应有占位文字")
	}
}

// 编辑过的条目要标出来。
func TestEditedVisible(t *testing.T) {
	dir := t.TempDir()
	os.MkdirAll(filepath.Join(dir, "issues"), 0o755)
	s := New(dir, "WB", nil, false)
	iss, _ := s.CreateIssue(model.Issue{Title: "t", Body: "b"})
	id := iss.ID
	en, _ := s.AddEntry(id, model.Entry{Type: "comment", Author: "me", Body: "原始"})
	if _, err := s.UpdateEntry(id, en.ID, "改过"); err != nil {
		t.Fatal(err)
	}
	raw, _ := os.ReadFile(filepath.Join(dir, "issues", id, "issue.md"))
	if !strings.Contains(string(raw), "已编辑") {
		t.Fatalf("编辑标记不可见:\n%s", raw)
	}
	// 读回仍带 edited 标志
	_, ents, _ := s.ReadIssue(id)
	if !ents[0].Edited {
		t.Fatalf("edited 标志丢失: %+v", ents[0])
	}
}

// 旧格式（纯注释 + YAML）必须继续可读，且一旦写入就升级为新格式。
func TestLegacyFormatStillParsed(t *testing.T) {
	legacy := "描述\n\n" + entriesMarker + "\n\n" +
		entryOpen + "\n" +
		"id: 0001-a\nauthor: bob\ncreated: \"2025-01-01T10:00:00Z\"\ntype: comment\n---\n" // 占位
	_ = legacy

	raw := "---\nid: WB-0001\ntitle: t\nstatus: todo\ncreated: \"2025-01-01T00:00:00Z\"\n---\n" +
		"描述\n\n" + entriesMarker + "\n\n" +
		entryOpen + "\n" +
		"id: 0001-a\nauthor: bob\ncreated: \"2025-01-01T10:00:00Z\"\ntype: comment\n" +
		entryClose + "\n既有正文\n"

	dir := t.TempDir()
	d := filepath.Join(dir, "issues", "WB-0001")
	os.MkdirAll(d, 0o755)
	os.WriteFile(filepath.Join(d, "issue.md"), []byte(raw), 0o644)

	s := New(dir, "WB", nil, false)
	iss, ents, err := s.ReadIssue("WB-0001")
	if err != nil {
		t.Fatalf("旧格式读取失败: %v", err)
	}
	if iss.Body != "描述" {
		t.Fatalf("描述异常: %q", iss.Body)
	}
	if len(ents) != 1 || ents[0].Author != "bob" || ents[0].Body != "既有正文" {
		t.Fatalf("旧格式条目解析异常: %+v", ents)
	}

	// 追加一条后，文件里应出现新的可见标题行。
	if _, err := s.AddEntry("WB-0001", model.Entry{Type: "comment", Author: "carol", Body: "新条目"}); err != nil {
		t.Fatal(err)
	}
	out, _ := os.ReadFile(filepath.Join(d, "issue.md"))
	if !strings.Contains(string(out), entryHeaderPrefix) {
		t.Fatalf("写入后未升级为可见格式:\n%s", out)
	}
	// 旧条目内容仍在
	_, ents2, _ := s.ReadIssue("WB-0001")
	if len(ents2) != 2 {
		t.Fatalf("升级后条目数异常: %d", len(ents2))
	}
	var bodies []string
	for _, e := range ents2 {
		bodies = append(bodies, e.Body)
	}
	joined := strings.Join(bodies, "|")
	if !strings.Contains(joined, "既有正文") || !strings.Contains(joined, "新条目") {
		t.Fatalf("内容丢失: %v", bodies)
	}
	for _, e := range ents2 {
		if strings.Contains(e.Body, entryHeaderPrefix) {
			t.Fatalf("正文被标题污染: %q", e.Body)
		}
	}
}

// 正文里自己写了 #### 标题，不能被当成条目分隔而截断。
func TestBodyWithOwnHeadings(t *testing.T) {
	dir := t.TempDir()
	os.MkdirAll(filepath.Join(dir, "issues"), 0o755)
	s := New(dir, "WB", nil, false)
	iss, _ := s.CreateIssue(model.Issue{Title: "t", Body: "b"})
	id := iss.ID
	body := "## 小标题\n\n内容\n\n#### 更小的标题\n\n更多内容"
	if _, err := s.AddEntry(id, model.Entry{Type: "comment", Author: "me", Body: body}); err != nil {
		t.Fatal(err)
	}
	_, ents, _ := s.ReadIssue(id)
	if len(ents) != 1 {
		t.Fatalf("应为 1 条，实际 %d", len(ents))
	}
	if ents[0].Body != body {
		t.Fatalf("正文被截断或改动:\n got: %q\nwant: %q", ents[0].Body, body)
	}
}

// 作者名含空格/引号时，元数据不能把文件写坏。
func TestAuthorWithSpaces(t *testing.T) {
	dir := t.TempDir()
	os.MkdirAll(filepath.Join(dir, "issues"), 0o755)
	s := New(dir, "WB", nil, false)
	iss, _ := s.CreateIssue(model.Issue{Title: "t", Body: "b"})
	id := iss.ID
	if _, err := s.AddEntry(id, model.Entry{Type: "comment", Author: "张 三", Body: "内容一"}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.AddEntry(id, model.Entry{Type: "comment", Author: "a\"b", Body: "内容二"}); err != nil {
		t.Fatal(err)
	}
	_, ents, _ := s.ReadIssue(id)
	if len(ents) != 2 {
		t.Fatalf("条目数异常: %d", len(ents))
	}
	if ents[0].Author != "张 三" {
		t.Errorf("含空格作者丢失: %q", ents[0].Author)
	}
	if ents[1].Author != "a\"b" && ents[1].Author != "a'b" {
		t.Errorf("含引号作者异常: %q", ents[1].Author)
	}
	// 两条正文都要在
	if ents[0].Body != "内容一" || ents[1].Body != "内容二" {
		t.Errorf("正文异常: %+v", ents)
	}
}

// 存量「纯注释」格式（上一次迁移的产物）必须自动升级为可读格式。
func TestUpgradeLegacyCommentOnlyFormat(t *testing.T) {
	raw := "---\nid: WB-0001\ntitle: t\nstatus: done\ncreated: \"2025-01-01T00:00:00Z\"\n---\n" +
		"描述内容\n\n" + entriesMarker + "\n\n" +
		entryOpen + "\nid: 0001-a\nauthor: bob\ncreated: \"2025-01-01T10:00:00Z\"\ntype: comment\n" + entryClose + "\n旧评论\n\n" +
		entryOpen + "\nid: 0002-b\nauthor: bob\ncreated: \"2025-01-02T10:00:00Z\"\ntype: status\nfrom: todo\nto: done\n" + entryClose + "\n\n"

	dir := t.TempDir()
	d := filepath.Join(dir, "issues", "WB-0001")
	os.MkdirAll(d, 0o755)
	os.WriteFile(filepath.Join(d, "issue.md"), []byte(raw), 0o644)

	s := New(dir, "WB", nil, false)
	n, _, err := s.MigrateEntriesToInline()
	if err != nil {
		t.Fatalf("升级失败: %v", err)
	}
	if n != 1 {
		t.Fatalf("应升级 1 个任务，实际 %d", n)
	}

	out, _ := os.ReadFile(filepath.Join(d, "issue.md"))
	txt := string(out)
	if strings.Contains(txt, entryOpen+"\n") {
		t.Fatalf("旧注释格式未清除:\n%s", txt)
	}
	if !strings.Contains(txt, "#### ") || !strings.Contains(txt, "bob") {
		t.Fatalf("未升级为可读格式:\n%s", txt)
	}
	if !strings.Contains(txt, "状态变更：待办 → 已完成") {
		t.Fatalf("状态变更不可读:\n%s", txt)
	}
	// 数据不丢
	iss, ents, _ := s.ReadIssue("WB-0001")
	if iss.Body != "描述内容" || len(ents) != 2 {
		t.Fatalf("升级后数据异常: %q %+v", iss.Body, ents)
	}
	if ents[0].Body != "旧评论" {
		t.Fatalf("评论丢失: %+v", ents[0])
	}
	// 幂等：再跑一次不应报“升级了任务”
	if n2, _, _ := s.MigrateEntriesToInline(); n2 != 0 {
		t.Fatalf("升级不幂等，第二次仍处理了 %d 个", n2)
	}
}
