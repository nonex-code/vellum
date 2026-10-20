package store

import (
	"os"
	"path/filepath"
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
	if en.File == "" {
		t.Fatal("entry file not set")
	}

	// 编辑：内容更新且 edited 标记。
	got, err := s.UpdateEntry(id, en.File, "hello world")
	if err != nil {
		t.Fatalf("update entry: %v", err)
	}
	if got.Body != "hello world" || !got.Edited {
		t.Fatalf("unexpected after update: %+v", got)
	}
	// 磁盘内容确实被改写。
	_, ents, _ := s.ReadIssue(id)
	if len(ents) != 1 || ents[0].Body != "hello world" || !ents[0].Edited {
		t.Fatalf("persisted update mismatch: %+v", ents)
	}

	// 删除。
	if err := s.DeleteEntry(id, en.File); err != nil {
		t.Fatalf("delete entry: %v", err)
	}
	_, ents2, _ := s.ReadIssue(id)
	if len(ents2) != 0 {
		t.Fatalf("entry not deleted, got %d", len(ents2))
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
	statusFile := ents[0].File

	if _, err := s.UpdateEntry(id, statusFile, "x"); err == nil {
		t.Fatal("expected status entry to be non-editable")
	}
	if err := s.DeleteEntry(id, statusFile); err == nil {
		t.Fatal("expected status entry to be non-deletable")
	}
}

func TestEntryNotFound(t *testing.T) {
	s, _ := newTestStore(t)
	iss, _ := s.CreateIssue(model.Issue{Title: "t", Body: "b"})
	id := iss.ID

	// 不存在的文件路径应报错，且不能越目录。
	if _, err := s.UpdateEntry(id, "../escape.md", "x"); err == nil {
		t.Fatal("expected path traversal to be rejected")
	}
	if err := s.DeleteEntry(id, "nope.md"); err == nil {
		t.Fatal("expected missing entry to error")
	}
	// 确保没有写到仓库外。
	if _, err := os.Stat(filepath.Join(s.issueDir(id), "entries", "escape.md")); err == nil {
		t.Fatal("path traversal wrote a file outside entries")
	}
}
