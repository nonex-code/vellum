package store

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/nonex-code/vellum/internal/model"
)

// writeLegacyEntry 按旧版格式写一个 entries/<name>.md。
func writeLegacyEntry(t *testing.T, root, id, name, body string, en model.Entry) {
	t.Helper()
	en.Body = ""
	dir := filepath.Join(root, "issues", id, "entries")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	var b strings.Builder
	b.WriteString("---\n")
	b.WriteString(fmt.Sprintf("author: %s\ncreated: %q\ntype: %s\n", en.Author, en.Created, en.Type))
	if en.From != "" || en.To != "" {
		b.WriteString(fmt.Sprintf("from: %s\nto: %s\n", en.From, en.To))
	}
	if en.Edited {
		b.WriteString("edited: true\n")
	}
	b.WriteString("---\n")
	b.WriteString(body)
	if err := os.WriteFile(filepath.Join(dir, name), []byte(b.String()), 0o644); err != nil {
		t.Fatal(err)
	}
}

// writeLegacyIssue 写一个旧版 issue.md（描述正文，无内联时间线）。
func writeLegacyIssue(t *testing.T, root, id, title, body string) {
	t.Helper()
	dir := filepath.Join(root, "issues", id)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	raw := fmt.Sprintf("---\nid: %s\ntitle: %s\nstatus: todo\ncreated: \"2025-01-01T00:00:00Z\"\nupdated: \"2025-01-02T00:00:00Z\"\n---\n%s", id, title, body)
	if err := os.WriteFile(filepath.Join(dir, "issue.md"), []byte(raw), 0o644); err != nil {
		t.Fatal(err)
	}
}

// 迁移：旧 entries/*.md 合并进 issue.md，条目顺序与内容保留，目录被清理。
func TestMigrateEntriesToInline(t *testing.T) {
	dir := t.TempDir()
	writeLegacyIssue(t, dir, "WB-0001", "老任务", "# 描述\n\n老正文")
	writeLegacyEntry(t, dir, "WB-0001", "0001-20250101T100000-me.md", "第一条",
		model.Entry{Author: "me", Created: "2025-01-01T10:00:00Z", Type: "comment"})
	writeLegacyEntry(t, dir, "WB-0001", "0002-20250102T100000-me.md", "状态变了",
		model.Entry{Author: "me", Created: "2025-01-02T10:00:00Z", Type: "status", From: "todo", To: "doing"})
	writeLegacyEntry(t, dir, "WB-0001", "0003-20250103T100000-me.md", "已改过",
		model.Entry{Author: "me", Created: "2025-01-03T10:00:00Z", Type: "comment", Edited: true})

	// 另一个任务没有 entries（不应被改动）。
	writeLegacyIssue(t, dir, "WB-0002", "无跟进", "only body")

	s := New(dir, "WB", nil, false)
	if _, _, err := s.MigrateEntriesToInline(); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	iss, ents, err := s.ReadIssue("WB-0001")
	if err != nil {
		t.Fatalf("read issue: %v", err)
	}
	if !strings.Contains(iss.Body, "老正文") {
		t.Fatalf("description lost: %q", iss.Body)
	}
	if strings.Contains(iss.Body, "第一条") {
		t.Fatalf("description should not contain entries: %q", iss.Body)
	}
	if len(ents) != 3 {
		t.Fatalf("want 3 entries, got %d: %+v", len(ents), ents)
	}
	want := []struct{ id, body string }{
		{"0001-20250101T100000-me", "第一条"},
		{"0002-20250102T100000-me", "状态变了"},
		{"0003-20250103T100000-me", "已改过"},
	}
	for i, w := range want {
		if ents[i].ID != w.id || ents[i].Body != w.body {
			t.Fatalf("entry %d mismatch: %+v", i, ents[i])
		}
	}
	if ents[1].Type != "status" || ents[1].From != "todo" || ents[1].To != "doing" {
		t.Fatalf("status entry fields lost: %+v", ents[1])
	}
	if !ents[2].Edited {
		t.Fatalf("edited flag lost: %+v", ents[2])
	}

	// 旧的 entries 目录应被删除。
	if _, err := os.Stat(filepath.Join(dir, "issues", "WB-0001", "entries")); err == nil {
		t.Fatal("legacy entries dir should be removed after migration")
	}

	// 另一个任务保持原样。
	iss2, ents2, _ := s.ReadIssue("WB-0002")
	if len(ents2) != 0 || iss2.Body != "only body" {
		t.Fatalf("unrelated issue changed: %+v / %+v", iss2, ents2)
	}
}

// 迁移是幂等的：重复执行不会重复追加。
func TestMigrateIdempotent(t *testing.T) {
	dir := t.TempDir()
	writeLegacyIssue(t, dir, "WB-0001", "t", "desc")
	writeLegacyEntry(t, dir, "WB-0001", "0001-x.md", "hi",
		model.Entry{Author: "me", Created: "2025-01-01T10:00:00Z", Type: "comment"})

	s1 := New(dir, "WB", nil, false)
	if _, _, err := s1.MigrateEntriesToInline(); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	if n, f, err := s1.MigrateEntriesToInline(); err != nil || n != 0 || f != 0 {
		t.Fatalf("second migrate should be no-op: n=%d f=%d err=%v", n, f, err)
	}
	// 模拟“迁移后又被写入旧目录”的场景，重新迁移不应产生重复条目。
	writeLegacyEntry(t, dir, "WB-0001", "0001-x.md", "hi",
		model.Entry{Author: "me", Created: "2025-01-01T10:00:00Z", Type: "comment"})
	s2 := New(dir, "WB", nil, false)
	if _, _, err := s2.MigrateEntriesToInline(); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	if _, _, err := s2.MigrateEntriesToInline(); err != nil {
		t.Fatalf("re-migrate: %v", err)
	}
	_, ents, _ := s2.ReadIssue("WB-0001")
	if len(ents) != 1 {
		t.Fatalf("entries duplicated after re-migration: %+v", ents)
	}
}

// 迁移后仍可正常编辑/删除被迁移的条目。
func TestMigratedEntryEditable(t *testing.T) {
	dir := t.TempDir()
	writeLegacyIssue(t, dir, "WB-0001", "t", "desc")
	writeLegacyEntry(t, dir, "WB-0001", "0001-a.md", "旧内容",
		model.Entry{Author: "me", Created: "2025-01-01T10:00:00Z", Type: "comment"})

	s := New(dir, "WB", nil, false)
	if _, _, err := s.MigrateEntriesToInline(); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	got, err := s.UpdateEntry("WB-0001", "0001-a", "新内容")
	if err != nil {
		t.Fatalf("edit migrated entry: %v", err)
	}
	if got.Body != "新内容" || !got.Edited {
		t.Fatalf("unexpected: %+v", got)
	}
	if err := s.DeleteEntry("WB-0001", "0001-a"); err != nil {
		t.Fatalf("delete migrated entry: %v", err)
	}
	iss, ents, _ := s.ReadIssue("WB-0001")
	if len(ents) != 0 || iss.Body != "desc" {
		t.Fatalf("state after delete: %+v / %+v", iss, ents)
	}
}
