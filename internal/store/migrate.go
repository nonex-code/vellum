package store

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"gopkg.in/yaml.v3"

	"github.com/nonex-code/vellum/internal/model"
)

// MigrateEntriesToInline 把旧版 issues/<ID>/entries/*.md 合并进 issue.md 的内联时间线，
// 然后删除 entries 目录。可安全重复执行：没有 entries 目录的任务会被跳过。
//
// 返回迁移的任务数与删除的条目文件数。
func (s *Store) MigrateEntriesToInline() (issues int, files int, err error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	dir := filepath.Join(s.root, "issues")
	dirents, err := os.ReadDir(dir)
	if err != nil {
		if os.IsNotExist(err) {
			return 0, 0, nil
		}
		return 0, 0, err
	}

	for _, d := range dirents {
		if !d.IsDir() {
			continue
		}
		id := d.Name()
		n, moved, err := s.migrateIssue(id)
		if err != nil {
			return issues, files, fmt.Errorf("迁移 %s 失败: %w", id, err)
		}
		if moved {
			issues++
			files += n
			continue
		}
		// 没有旧 entries/ 目录，但可能还是“纯注释”格式：升级为可读格式。
		if up, uerr := s.upgradeIssueFormat(id); uerr != nil {
			return issues, files, fmt.Errorf("升级 %s 格式失败: %w", id, uerr)
		} else if up {
			issues++
		}
	}
	if issues > 0 && s.repo != nil {
		msg := fmt.Sprintf("migrate: 内联 %d 个任务的时间线", issues)
		if files == 0 {
			// 仅仅做了格式升级（把元数据从纯注释换成可读标题行）。
			msg = fmt.Sprintf("migrate: %d 个任务的时间线转为可读格式", issues)
		}
		if err := s.commit(msg); err != nil {
			return issues, files, err
		}
	}
	return issues, files, nil
}

// upgradeIssueFormat 把旧版「纯注释条目」重写为「可见标题行 + 隐藏元数据」。
// 没有旧格式条目时返回 false。
func (s *Store) upgradeIssueFormat(id string) (bool, error) {
	p := filepath.Join(s.issueDir(id), "issue.md")
	raw, err := os.ReadFile(p)
	if err != nil {
		if os.IsNotExist(err) {
			return false, nil
		}
		return false, err
	}
	body := func() string { _, b := splitFrontmatter(raw); return b }()
	desc, timeline := splitBodyEntries(body)
	if timeline == "" {
		return false, nil
	}
	// 已经是新格式（有 meta 注释）且没有旧的 entry 头，就不用动。
	if !strings.Contains(timeline, entryOpen+"\n") {
		return false, nil
	}
	ents := parseEntries(timeline)
	if len(ents) == 0 {
		return false, nil
	}
	sortEntriesByCreated(ents)

	iss, rerr := s.readIssueFile(id)
	if rerr != nil {
		return false, rerr
	}
	iss.Body = desc
	fm, merr := yaml.Marshal(iss)
	if merr != nil {
		return false, merr
	}
	var b strings.Builder
	b.WriteString("---\n")
	b.Write(fm)
	b.WriteString("---\n")
	b.WriteString(joinBodyEntries(desc, formatEntries(ents)))
	if werr := os.WriteFile(p, []byte(b.String()), 0o644); werr != nil {
		return false, werr
	}
	return true, nil
}

// migrateIssue 迁移单个任务；moved 表示确实发生了迁移。
func (s *Store) migrateIssue(id string) (files int, moved bool, err error) {
	legacyDir := filepath.Join(s.issueDir(id), "entries")
	ents, err := os.ReadDir(legacyDir)
	if err != nil {
		if os.IsNotExist(err) {
			return 0, false, nil
		}
		return 0, false, err
	}

	// 读取旧条目文件。旧版命名以序号开头（0001-时间-作者.md），
	// 但用户可能手改过文件名，因此以「文件名 + 条目内 created」双保险排序。
	var names []string
	seenName := make(map[string]bool, len(ents))
	for _, e := range ents {
		n := e.Name()
		// 跳过子目录与隐藏文件（如 .DS_Store），只收 markdown。
		if e.IsDir() || strings.HasPrefix(n, ".") || !strings.HasSuffix(strings.ToLower(n), ".md") {
			continue
		}
		if seenName[n] {
			continue
		}
		seenName[n] = true
		names = append(names, n)
	}
	if len(names) == 0 {
		// 空目录（或只剩垃圾文件）也清掉，避免下次重复扫描。
		return 0, false, os.RemoveAll(legacyDir)
	}
	sort.Strings(names)

	legacy := make([]model.Entry, 0, len(names))
	for _, n := range names {
		data, rerr := os.ReadFile(filepath.Join(legacyDir, n))
		if rerr != nil {
			continue
		}
		fm, body := splitFrontmatter(data)
		var en model.Entry
		if len(fm) > 0 {
			if uerr := yaml.Unmarshal(fm, &en); uerr != nil {
				// frontmatter 损坏：条目内容仍保留，不丢掉用户数据。
				en = model.Entry{}
			}
		}
		en.Body = body
		// 沿用旧文件名（去后缀）作为条目 ID，保证迁移后仍可编辑/删除。
		en.ID = strings.TrimSuffix(n, filepath.Ext(n))
		en.File = en.ID
		// 缺字段时补充缺省值，避免前端渲染时出现空白/异常。
		if en.Type == "" {
			en.Type = "comment"
		}
		if en.Author == "" {
			en.Author = "me"
		}
		legacy = append(legacy, en)
	}
	if len(legacy) == 0 {
		return 0, false, nil
	}

	// 读取当前 issue.md（兼容“迁移过一部分”与“只剩 entries/ 无 issue.md”两种情况）。
	iss, err := s.readIssueFile(id)
	raw, rerr := os.ReadFile(filepath.Join(s.issueDir(id), "issue.md"))
	if err != nil || rerr != nil {
		// issue.md 缺失或损坏：用空任务打底，只保留可恢复的信息。
		// 标题先留空（不塞假值），ID 用目录名，前端不至于崩。
		iss = model.Issue{ID: id, Title: id, Status: "todo", Type: "task"}
		raw = nil
	}
	_, rawBody := splitFrontmatter(raw)
	desc, timeline := splitBodyEntries(rawBody)
	// 描述以 readIssueFile 解析结果为准（已处理各种边界）；
	// 它为空时回退到原始拆分结果。
	if iss.Body != "" {
		desc = iss.Body
	}

	existing := parseEntries(timeline)
	seen := make(map[string]bool, len(existing))
	for _, en := range existing {
		seen[en.ID] = true
	}
	for _, en := range legacy {
		if seen[en.ID] {
			continue
		}
		existing = append(existing, en)
		seen[en.ID] = true
	}
	sortEntriesByCreated(existing)

	// 重写 issue.md。
	iss.Body = desc
	p := filepath.Join(s.issueDir(id), "issue.md")
	fm, err := yaml.Marshal(iss)
	if err != nil {
		return 0, false, err
	}
	var b strings.Builder
	b.WriteString("---\n")
	b.Write(fm)
	b.WriteString("---\n")
	b.WriteString(joinBodyEntries(desc, formatEntries(existing)))
	if err := os.WriteFile(p, []byte(b.String()), 0o644); err != nil {
		return 0, false, err
	}
	if err := os.RemoveAll(legacyDir); err != nil {
		return 0, false, err
	}
	return len(legacy), true, nil
}
