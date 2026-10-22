package store

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/nonex-code/vellum/internal/model"
)

// 迁移必须对所有合规的旧数据成立，而不是只对某一份真实仓库成立。
// 下面逐项覆盖边界形态。

// 1) 空仓库 / 没有 issues 目录：不 panic、不报错。
func TestMigrateEmptyStore(t *testing.T) {
	s, root := newTestStore(t)
	n, f, err := s.MigrateEntriesToInline()
	if err != nil || n != 0 || f != 0 {
		t.Fatalf("空仓库应为空操作: n=%d f=%d err=%v", n, f, err)
	}
	if _, err := os.Stat(filepath.Join(root, "issues")); err == nil {
		t.Fatal("不应凭空创建 issues 目录")
	}
}

// 2) 有 issues 但没有 tasks：正常返回。
func TestMigrateNoIssues(t *testing.T) {
	s, root := newTestStore(t)
	if err := os.MkdirAll(filepath.Join(root, "issues"), 0o755); err != nil {
		t.Fatal(err)
	}
	if n, _, err := s.MigrateEntriesToInline(); err != nil || n != 0 {
		t.Fatalf("n=%d err=%v", n, err)
	}
}

// 3) 条目文件缺 frontmatter / 字段残缺：正文不能丢，类型与作者回退到默认值。
func TestMigrateMalformedLegacyEntries(t *testing.T) {
	dir := t.TempDir()
	writeLegacyIssue(t, dir, "WB-0001", "t", "desc")
	edir := filepath.Join(dir, "issues", "WB-0001", "entries")
	if err := os.MkdirAll(edir, 0o755); err != nil {
		t.Fatal(err)
	}
	// 完全没有 frontmatter
	if err := os.WriteFile(filepath.Join(edir, "0001-plain.md"), []byte("裸正文"), 0o644); err != nil {
		t.Fatal(err)
	}
	// frontmatter 里只有 author
	if err := os.WriteFile(filepath.Join(edir, "0002-part.md"), []byte("---\nauthor: bob\n---\n部分字段"), 0o644); err != nil {
		t.Fatal(err)
	}
	// 损坏的 YAML
	if err := os.WriteFile(filepath.Join(edir, "0003-bad.md"), []byte("---\n: : :\n---\n坏 frontmatter"), 0o644); err != nil {
		t.Fatal(err)
	}

	s := New(dir, "WB", nil, false)
	if _, _, err := s.MigrateEntriesToInline(); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	_, ents, err := s.ReadIssue("WB-0001")
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if len(ents) != 3 {
		t.Fatalf("三条残缺条目都应保留，实际 %d: %+v", len(ents), ents)
	}
	bodies := map[string]bool{}
	for _, e := range ents {
		bodies[e.Body] = true
		if e.Type == "" || e.Author == "" {
			t.Errorf("缺省值未补齐: %+v", e)
		}
	}
	for _, want := range []string{"裸正文", "部分字段", "坏 frontmatter"} {
		if !bodies[want] {
			t.Errorf("正文丢失: %q", want)
		}
	}
}

// 4) entries 目录里的非 markdown、隐藏文件、子目录：忽略且不误删数据。
func TestMigrateIgnoresNonMarkdown(t *testing.T) {
	dir := t.TempDir()
	writeLegacyIssue(t, dir, "WB-0001", "t", "desc")
	edir := filepath.Join(dir, "issues", "WB-0001", "entries")
	if err := os.MkdirAll(filepath.Join(edir, "subdir"), 0o755); err != nil {
		t.Fatal(err)
	}
	os.WriteFile(filepath.Join(edir, "0001-real.md"), []byte("---\nauthor: a\n---\n真正条目"), 0o644)
	os.WriteFile(filepath.Join(edir, ".DS_Store"), []byte("junk"), 0o644)
	os.WriteFile(filepath.Join(edir, "notes.txt"), []byte("不是条目"), 0o644)

	s := New(dir, "WB", nil, false)
	if _, _, err := s.MigrateEntriesToInline(); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	_, ents, _ := s.ReadIssue("WB-0001")
	if len(ents) != 1 || ents[0].Body != "真正条目" {
		t.Fatalf("应只迁移 1 条，实际 %+v", ents)
	}
}

// 5) 大写扩展名 .MD 也应识别。
func TestMigrateUppercaseExt(t *testing.T) {
	dir := t.TempDir()
	writeLegacyIssue(t, dir, "WB-0001", "t", "desc")
	edir := filepath.Join(dir, "issues", "WB-0001", "entries")
	os.MkdirAll(edir, 0o755)
	os.WriteFile(filepath.Join(edir, "0001-x.MD"), []byte("---\nauthor: a\n---\n大写后缀"), 0o644)

	s := New(dir, "WB", nil, false)
	if _, _, err := s.MigrateEntriesToInline(); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	_, ents, _ := s.ReadIssue("WB-0001")
	if len(ents) != 1 || ents[0].Body != "大写后缀" {
		t.Fatalf("大写扩展名未识别: %+v", ents)
	}
}

// 6) 只有 entries 目录、没有 issue.md：不能崩，条目仍要保住。
func TestMigrateMissingIssueFile(t *testing.T) {
	dir := t.TempDir()
	edir := filepath.Join(dir, "issues", "WB-0009", "entries")
	if err := os.MkdirAll(edir, 0o755); err != nil {
		t.Fatal(err)
	}
	os.WriteFile(filepath.Join(edir, "0001-a.md"), []byte("---\nauthor: a\ncreated: \"2025-01-01T00:00:00Z\"\n---\n孤立条目"), 0o644)

	s := New(dir, "WB", nil, false)
	if _, _, err := s.MigrateEntriesToInline(); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	_, ents, err := s.ReadIssue("WB-0009")
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if len(ents) != 1 || ents[0].Body != "孤立条目" {
		t.Fatalf("孤立 entries 未保住: %+v", ents)
	}
}

// 7) 描述本身含看起来像标记的文本：不能被当成条目切走。
func TestMigrateBodyWithLookalikeMarkers(t *testing.T) {
	dir := t.TempDir()
	// 描述里出现 HTML 注释，但不是我们的分隔标记。
	writeLegacyIssue(t, dir, "WB-0001", "t", "描述里有 <!-- 普通注释 --> 和 --- 分隔线")
	edir := filepath.Join(dir, "issues", "WB-0001", "entries")
	os.MkdirAll(edir, 0o755)
	os.WriteFile(filepath.Join(edir, "0001-a.md"), []byte("---\nauthor: a\n---\n条目一"), 0o644)

	s := New(dir, "WB", nil, false)
	if _, _, err := s.MigrateEntriesToInline(); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	iss, ents, _ := s.ReadIssue("WB-0001")
	if !strings.Contains(iss.Body, "普通注释") || !strings.Contains(iss.Body, "分隔线") {
		t.Fatalf("描述被破坏: %q", iss.Body)
	}
	if len(ents) != 1 {
		t.Fatalf("条目数异常: %+v", ents)
	}
}

// 8) 已内联一部分 + 旧目录还剩一部分：两边都要在，且不重复。
func TestMigratePartialState(t *testing.T) {
	dir := t.TempDir()
	// 手工构造“已内联 id=0001”的 issue.md。
	raw := "---\nid: WB-0001\ntitle: t\nstatus: todo\ncreated: \"2025-01-01T00:00:00Z\"\n---\n描述\n\n" +
		entriesMarker + "\n\n" +
		entryOpen + "\nid: 0001-a\nauthor: a\ncreated: \"2025-01-01T00:00:00Z\"\ntype: comment\n-->\n已有条目\n"
	d := filepath.Join(dir, "issues", "WB-0001")
	os.MkdirAll(filepath.Join(d, "entries"), 0o755)
	os.WriteFile(filepath.Join(d, "issue.md"), []byte(raw), 0o644)
	// 旧目录里 0001 重复 + 0002 新增。
	os.WriteFile(filepath.Join(d, "entries", "0001-a.md"), []byte("---\nauthor: a\n---\n已有条目"), 0o644)
	os.WriteFile(filepath.Join(d, "entries", "0002-b.md"), []byte("---\nauthor: a\n---\n新增条目"), 0o644)

	s := New(dir, "WB", nil, false)
	if _, _, err := s.MigrateEntriesToInline(); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	iss, ents, _ := s.ReadIssue("WB-0001")
	if iss.Body != "描述" {
		t.Fatalf("描述异常: %q", iss.Body)
	}
	if len(ents) != 2 {
		t.Fatalf("应为 2 条（去重后），实际 %d: %+v", len(ents), ents)
	}
	if ents[0].Body != "已有条目" || ents[1].Body != "新增条目" {
		t.Fatalf("内容/顺序异常: %+v", ents)
	}
}

// 9) 多项目：每个项目独立迁移，互不干扰。
func TestMigrateMultipleProjects(t *testing.T) {
	root := t.TempDir()
	mk := func(pid, id, body string) {
		pdir := filepath.Join(root, "projects", pid)
		writeLegacyIssue(t, pdir, id, "t-"+pid, "desc-"+pid)
		edir := filepath.Join(pdir, "issues", id, "entries")
		os.MkdirAll(edir, 0o755)
		os.WriteFile(filepath.Join(edir, "0001-a.md"), []byte("---\nauthor: a\n---\n"+body), 0o644)
	}
	mk("alpha", "WB-0001", "alpha 条目")
	mk("beta", "WB-0001", "beta 条目")
	// 一个没有 entries 的项目
	writeLegacyIssue(t, filepath.Join(root, "projects", "gamma"), "WB-0001", "t", "只有描述")

	for _, pid := range []string{"alpha", "beta", "gamma"} {
		pdir := filepath.Join(root, "projects", pid)
		s := New(pdir, "WB", nil, false)
		n, _, err := s.MigrateEntriesToInline()
		if err != nil {
			t.Fatalf("%s: %v", pid, err)
		}
		_, ents, _ := s.ReadIssue("WB-0001")
		switch pid {
		case "alpha", "beta":
			if n != 1 || len(ents) != 1 || ents[0].Body != pid+" 条目" {
				t.Fatalf("%s 迁移异常: n=%d %+v", pid, n, ents)
			}
		case "gamma":
			if n != 0 || len(ents) != 0 {
				t.Fatalf("gamma 不该产生条目: n=%d %+v", n, ents)
			}
		}
	}
}

// 10) 迁移后条目能被编辑/删除，且描述不受影响——迁移产物必须完全兼容新格式。
func TestMigratedEntriesFullyUsable(t *testing.T) {
	dir := t.TempDir()
	writeLegacyIssue(t, dir, "WB-0001", "t", "描述文本")
	edir := filepath.Join(dir, "issues", "WB-0001", "entries")
	os.MkdirAll(edir, 0o755)
	os.WriteFile(filepath.Join(edir, "0001-a.md"), []byte("---\nauthor: a\ncreated: \"2025-01-01T00:00:00Z\"\ntype: comment\n---\n原内容"), 0o644)
	os.WriteFile(filepath.Join(edir, "0002-b.md"), []byte("---\nauthor: a\ncreated: \"2025-01-02T00:00:00Z\"\ntype: status\nfrom: todo\nto: doing\n---\n"), 0o644)

	s := New(dir, "WB", nil, false)
	if _, _, err := s.MigrateEntriesToInline(); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	// 状态条目仍不可编辑。
	if _, err := s.UpdateEntry("WB-0001", "0002-b", "x"); err == nil {
		t.Error("迁移来的 status 条目应不可编辑")
	}
	// 普通条目可编辑。
	got, err := s.UpdateEntry("WB-0001", "0001-a", "改后内容")
	if err != nil || got.Body != "改后内容" || !got.Edited {
		t.Fatalf("编辑失败: %+v err=%v", got, err)
	}
	// 新追加的条目也正常。
	if _, err := s.AddEntry("WB-0001", model.Entry{Body: "新加", Type: "comment", Author: "me"}); err != nil {
		t.Fatalf("追加失败: %v", err)
	}
	iss, ents, _ := s.ReadIssue("WB-0001")
	if iss.Body != "描述文本" {
		t.Fatalf("描述被改动: %q", iss.Body)
	}
	if len(ents) != 3 {
		t.Fatalf("条目数应为 3，实际 %d", len(ents))
	}
	// 删除迁移来的条目。
	if err := s.DeleteEntry("WB-0001", "0001-a"); err != nil {
		t.Fatalf("删除失败: %v", err)
	}
	_, ents2, _ := s.ReadIssue("WB-0001")
	if len(ents2) != 2 {
		t.Fatalf("删除后应为 2 条，实际 %d", len(ents2))
	}
}
