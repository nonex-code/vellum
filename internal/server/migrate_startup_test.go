package server

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// 启动时迁移必须是通用的：给定任意仓库形态，
// 只要符合「issues/<ID>/entries/*.md」这一旧版约定，就要被内联，
// 且不影响无关目录。
//
// 这里不依赖任何真实仓库的具体内容，只按约定构造数据。

// seedLegacyIssue 按旧版约定写一个任务：issue.md + entries/*.md。
func seedLegacyIssue(t *testing.T, projDir, id, body string, entries map[string]string) {
	t.Helper()
	idir := filepath.Join(projDir, "issues", id)
	if err := os.MkdirAll(filepath.Join(idir, "entries"), 0o755); err != nil {
		t.Fatal(err)
	}
	raw := "---\nid: " + id + "\ntitle: 任务 " + id + "\nstatus: todo\ntype: task\ncreated: \"2025-01-01T00:00:00Z\"\nupdated: \"2025-01-01T00:00:00Z\"\n---\n" + body
	if err := os.WriteFile(filepath.Join(idir, "issue.md"), []byte(raw), 0o644); err != nil {
		t.Fatal(err)
	}
	for name, text := range entries {
		content := "---\nauthor: me\ncreated: \"2025-01-01T10:00:00Z\"\ntype: comment\n---\n" + text
		if err := os.WriteFile(filepath.Join(idir, "entries", name), []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
}

// assertInlined 断言某任务已内联，且条目正文都在、旧目录已删。
func assertInlined(t *testing.T, projDir, id string, wantBodies ...string) {
	t.Helper()
	idir := filepath.Join(projDir, "issues", id)
	if _, err := os.Stat(filepath.Join(idir, "entries")); err == nil {
		t.Errorf("%s: entries 目录未清理", id)
	}
	raw, err := os.ReadFile(filepath.Join(idir, "issue.md"))
	if err != nil {
		t.Fatalf("%s: 读 issue.md 失败: %v", id, err)
	}
	s := string(raw)
	if !strings.Contains(s, "<!-- vellum:entries -->") {
		t.Errorf("%s: 缺少时间线标记", id)
	}
	for _, b := range wantBodies {
		if !strings.Contains(s, b) {
			t.Errorf("%s: 条目正文丢失 %q", id, b)
		}
	}
}

// single 模式：仓库根就是一个项目。
func TestStartupMigrateSingleMode(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "workbench.yaml"), []byte("workspace:\n  name: T\n  mode: single\n"), 0o644)
	seedLegacyIssue(t, dir, "WB-0001", "描述一", map[string]string{"0001-a.md": "条目甲"})
	seedLegacyIssue(t, dir, "WB-0002", "描述二", map[string]string{"0001-b.md": "条目乙"})

	s := New(Options{ProjectsDir: t.TempDir(), Push: false, Version: "test"})
	if err := s.Open(dir); err != nil {
		t.Fatalf("Open: %v", err)
	}
	assertInlined(t, dir, "WB-0001", "描述一", "条目甲")
	assertInlined(t, dir, "WB-0002", "描述二", "条目乙")
}

// multi 模式：根 + projects/<id>/ 各自独立迁移，不能只迁默认项目。
func TestStartupMigrateMultiMode(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "workbench.yaml"), []byte("workspace:\n  name: T\n  mode: multi\n"), 0o644)

	projects := []string{"alpha", "beta", "中文项目"}
	for _, pid := range projects {
		pd := filepath.Join(dir, "projects", pid)
		os.MkdirAll(filepath.Join(pd, "meta"), 0o755)
		os.WriteFile(filepath.Join(pd, "workbench.yaml"), []byte("project:\n  id: "+pid+"\n  name: "+pid+"\n"), 0o644)
		seedLegacyIssue(t, pd, "WB-0001", "描述-"+pid, map[string]string{"0001-a.md": "条目-" + pid})
	}
	// 根项目也放一个任务。
	seedLegacyIssue(t, dir, "WB-0001", "根描述", map[string]string{"0001-r.md": "根条目"})

	s := New(Options{ProjectsDir: t.TempDir(), Push: false, Version: "test"})
	if err := s.Open(dir); err != nil {
		t.Fatalf("Open: %v", err)
	}

	assertInlined(t, dir, "WB-0001", "根描述", "根条目")
	for _, pid := range projects {
		assertInlined(t, filepath.Join(dir, "projects", pid), "WB-0001", "条目-"+pid)
	}
}

// 没有 issues 目录的项目、隐藏目录、文件形式的条目：都不能让启动失败。
func TestStartupMigrateTolerant(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "workbench.yaml"), []byte("workspace:\n  name: T\n  mode: multi\n"), 0o644)

	// 空项目（没有 issues）
	empty := filepath.Join(dir, "projects", "empty")
	os.MkdirAll(empty, 0o755)

	// 隐藏目录（如 .git / .archived）不应被当项目
	hidden := filepath.Join(dir, "projects", ".hidden")
	os.MkdirAll(filepath.Join(hidden, "issues", "WB-0001", "entries"), 0o755)
	os.WriteFile(filepath.Join(hidden, "issues", "WB-0001", "entries", "0001-a.md"), []byte("---\nauthor: a\n---\n不该被迁"), 0o644)

	// 正常项目
	normal := filepath.Join(dir, "projects", "normal")
	os.MkdirAll(filepath.Join(normal, "meta"), 0o755)
	seedLegacyIssue(t, normal, "WB-0001", "正常描述", map[string]string{"0001-a.md": "正常条目"})

	s := New(Options{ProjectsDir: t.TempDir(), Push: false, Version: "test"})
	if err := s.Open(dir); err != nil {
		t.Fatalf("Open 不应因异常目录失败: %v", err)
	}
	assertInlined(t, normal, "WB-0001", "正常描述", "正常条目")

	// 隐藏目录保持原样
	if _, err := os.Stat(filepath.Join(hidden, "issues", "WB-0001", "entries")); err != nil {
		t.Errorf("隐藏目录不应被迁移: %v", err)
	}
}

// 空仓库（新用户首次启动）：不能因为迁移逻辑报错。
func TestStartupMigrateEmptyRepo(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "workbench.yaml"), []byte("workspace:\n  name: T\n  mode: single\n"), 0o644)

	s := New(Options{ProjectsDir: t.TempDir(), Push: false, Version: "test"})
	if err := s.Open(dir); err != nil {
		t.Fatalf("空仓库启动失败: %v", err)
	}
}

// 重复启动（幂等）：第二次不应再改动任何文件。
func TestStartupMigrateIdempotentAcrossRestarts(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "workbench.yaml"), []byte("workspace:\n  name: T\n  mode: single\n"), 0o644)
	seedLegacyIssue(t, dir, "WB-0001", "描述", map[string]string{"0001-a.md": "条目"})

	for i := 0; i < 3; i++ {
		s := New(Options{ProjectsDir: t.TempDir(), Push: false, Version: "test"})
		if err := s.Open(dir); err != nil {
			t.Fatalf("第 %d 次启动失败: %v", i+1, err)
		}
	}
	raw, _ := os.ReadFile(filepath.Join(dir, "issues", "WB-0001", "issue.md"))
	if c := strings.Count(string(raw), "条目"); c != 1 {
		t.Fatalf("条目被重复追加 %d 次:\n%s", c, raw)
	}
}
