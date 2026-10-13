package store

import "strings"

// SplitFrontmatter 导出给上层复用（分离 YAML frontmatter 与正文）。
func SplitFrontmatter(data []byte) (fm []byte, body string) { return splitFrontmatter(data) }

// splitFrontmatter 分离 YAML frontmatter 与正文。
// 支持以 "---" 开头、以 "\n---" 结束的块；无 frontmatter 时 fm 为空。
func splitFrontmatter(data []byte) (fm []byte, body string) {
	s := strings.ReplaceAll(string(data), "\r\n", "\n")
	if !strings.HasPrefix(s, "---") {
		return nil, s
	}
	rest := strings.TrimPrefix(s, "---")
	rest = strings.TrimPrefix(rest, "\n")
	idx := strings.Index(rest, "\n---")
	if idx < 0 {
		return nil, s
	}
	fm = []byte(rest[:idx])
	after := rest[idx+4:]
	after = strings.TrimPrefix(after, "\n")
	return fm, after
}

// sanitize 保留字母数字与 - _，用于文件名中的作者。
func sanitize(s string) string {
	var b strings.Builder
	for _, r := range s {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9', r == '-', r == '_':
			b.WriteRune(r)
		}
	}
	if b.Len() == 0 {
		return "user"
	}
	return b.String()
}