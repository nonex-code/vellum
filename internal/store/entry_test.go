package store

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/nonex-code/vellum/internal/model"
)

func newTestStore(t *testing.T) (*Store, string) {
	t.Helper()
	dir := t.TempDir()
	// repo 留空：commit 在 repo==nil 时为空操作，方便纯文件测。
	s := New(dir, "WB", nil, false)
	return s, dir
}

func TestEntryEditAndDelete(t *testing.T) {
	s, _ := newTestStore(t)

	iss, err := s.CreateIssue(model.Issue{Title: "t", Body: "b"})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	id := iss.ID

	en, err := s.AddEntry(id, model.Entry{Body: "hello", Type: "comment"})
	if err != nil {
		t.Fatalf("add entry: %v", err)
	}
	if en.ID == "" || en.File != en.ID {
		t.Fatalf("entry id not set: %+v", en)
	}

	// 编辑：内容更新且 edited 标记。
	got, err := s.UpdateEntry(id, en.ID, "hello world")
	if err != nil {
		t.Fatalf("update entry: %v", err)
	}
	if got.Body != "hello world" || !got.Edited {
		t.Fatalf("unexpected after update: %+v", got)
	}
	// 磁盘内容确实被改写，且与描述共存于同一个 issue.md。
	_, ents, _ := s.ReadIssue(id)
	if len(ents) != 1 || ents[0].Body != "hello world" || !ents[0].Edited {
		t.Fatalf("persisted update mismatch: %+v", ents)
	}
	if _, statErr := os.Stat(filepath.Join(s.issueDir(id), "entries")); statErr == nil {
		t.Fatal("entries directory should no longer be created")
	}

	// 旧 API 传文件名（无 .md 后缀也可）也要能定位。
	if _, err := s.UpdateEntry(id, en.File, "again"); err != nil {
		t.Fatalf("update by file alias: %v", err)
	}

	// 删除。
	if err := s.DeleteEntry(id, en.ID); err != nil {
		t.Fatalf("delete entry: %v", err)
	}
	_, ents2, _ := s.ReadIssue(id)
	if len(ents2) != 0 {
		t.Fatalf("entry not deleted, got %d", len(ents2))
	}
}

// 描述与时间线必须同时保留在 issue.md 中，且互相不串味。
func TestIssueBodyAndEntriesSameFile(t *testing.T) {
	s, _ := newTestStore(t)
	iss, _ := s.CreateIssue(model.Issue{Title: "t", Body: "# 描述\n\n正文内容"})
	id := iss.ID

	if _, err := s.AddEntry(id, model.Entry{Body: "第一条跟进", Type: "comment"}); err != nil {
		t.Fatalf("add: %v", err)
	}
	if _, err := s.AddEntry(id, model.Entry{Body: "第二条跟进", Type: "comment"}); err != nil {
		t.Fatalf("add: %v", err)
	}

	// 修改描述不应抹掉时间线。
	if _, err := s.UpdateIssue(id, map[string]any{"body": "# 新描述"}); err != nil {
		t.Fatalf("update body: %v", err)
	}

	got, ents, err := s.ReadIssue(id)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if got.Body != "# 新描述" {
		t.Fatalf("body mismatch: %q", got.Body)
	}
	if len(ents) != 2 {
		t.Fatalf("want 2 entries, got %d: %+v", len(ents), ents)
	}
	if ents[0].Body != "第一条跟进" || ents[1].Body != "第二条跟进" {
		t.Fatalf("entry order/content mismatch: %+v", ents)
	}

	// 原始文件里既要有描述也要有时间线。
	raw, _ := os.ReadFile(filepath.Join(s.issueDir(id), "issue.md"))
	txt := string(raw)
	if !strings.Contains(txt, "# 新描述") || !strings.Contains(txt, entriesMarker) ||
		!strings.Contains(txt, "第一条跟进") {
		t.Fatalf("issue.md does not contain both parts:\n%s", txt)
	}
}

func TestEntryStatusNotEditable(t *testing.T) {
	s, _ := newTestStore(t)
	iss, _ := s.CreateIssue(model.Issue{Title: "t", Body: "b"})
	id := iss.ID

	// 状态变更条目由 UpdateIssue 生成。
	_, err := s.UpdateIssue(id, map[string]any{"status": "doing"})
	if err != nil {
		t.Fatalf("update issue: %v", err)
	}
	_, ents, _ := s.ReadIssue(id)
	if len(ents) != 1 || ents[0].Type != "status" {
		t.Fatalf("expected one status entry, got %+v", ents)
	}
	statusID := ents[0].ID

	if _, err := s.UpdateEntry(id, statusID, "x"); err == nil {
		t.Fatal("expected status entry to be non-editable")
	}
	if err := s.DeleteEntry(id, statusID); err == nil {
		t.Fatal("expected status entry to be non-deletable")
	}
}

func TestEntryNotFound(t *testing.T) {
	s, _ := newTestStore(t)
	iss, _ := s.CreateIssue(model.Issue{Title: "t", Body: "b"})
	id := iss.ID

	// 不存在的条目标识应报错。
	if _, err := s.UpdateEntry(id, "nope", "x"); err == nil {
		t.Fatal("expected missing entry to error")
	}
	if err := s.DeleteEntry(id, "nope"); err == nil {
		t.Fatal("expected missing entry to error")
	}
	// 路径穿越同样不允许（不会被当成合法条目）。
	if _, err := s.UpdateEntry(id, "../escape.md", "x"); err == nil {
		t.Fatal("expected path traversal to be rejected")
	}
}
