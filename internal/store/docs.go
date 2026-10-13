package store

import (
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
	"unicode"
	"github.com/nonex-code/vellum/internal/i18n"

	"gopkg.in/yaml.v3"

	"github.com/nonex-code/vellum/internal/model"
)

// docs 以纯 Markdown 存于 <root>/docs/，目录层级即组织方式，直接入 git。

// docPath 校验并解析文档相对路径，统一补全 docs/ 前缀与 .md 后缀，拒绝穿越与非法名。
func docPath(rel string) (string, error) {
	rel = filepath.ToSlash(strings.TrimSpace(rel))
	if rel == "" {
		return "", i18n.New(i18n.DocPathEmpty)
	}
	rel = strings.TrimPrefix(rel, "./")
	rel = strings.TrimPrefix(rel, "docs/") // 允许传入已含前缀的路径（列表返回值）
	if !strings.HasSuffix(rel, ".md") {
		rel += ".md"
	}
	var parts []string
	for _, seg := range strings.Split(rel, "/") {
		if seg == "" || seg == "." || seg == ".." {
			return "", i18n.New(i18n.DocPathInvalid, rel)
		}
		for _, r := range seg {
			if r == ':' || r == '*' || r == '?' || r == '"' || r == '<' || r == '>' || r == '|' || r == '\\' {
				return "", i18n.New(i18n.PathSegInvalid, seg)
			}
		}
		parts = append(parts, seg)
	}
	return filepath.Join(append([]string{"docs"}, parts...)...), nil
}

// Slug 把标题转为可作文件名的片段（保留字母数字与 CJK，空白转 -）。
func Slug(title string) string {
	var b strings.Builder
	lastDash := false
	for _, r := range strings.TrimSpace(title) {
		switch {
		case unicode.IsLetter(r) || unicode.IsDigit(r) || r == '_':
			b.WriteRune(r)
			lastDash = false
		case r == ' ' || r == '-' || r == '/' || r == '.':
			if b.Len() > 0 && !lastDash {
				b.WriteByte('-')
				lastDash = true
			}
		}
	}
	out := strings.Trim(b.String(), "-")
	if out == "" {
		out = "doc"
	}
	if len([]rune(out)) > 60 {
		out = string([]rune(out)[:60])
	}
	return out
}

func (s *Store) readDocFile(abs, rel string) (model.Doc, error) {
	data, err := os.ReadFile(abs)
	if err != nil {
		return model.Doc{}, err
	}
	fm, body := splitFrontmatter(data)
	var d model.Doc
	if len(fm) > 0 {
		if err := yaml.Unmarshal(fm, &d); err != nil {
			return d, err
		}
	}
	d.Body = body
	d.Path = filepath.ToSlash(rel)
	if d.Title == "" {
		base := strings.TrimSuffix(filepath.Base(rel), ".md")
		d.Title = base
	}
	return d, nil
}

func (s *Store) writeDocFile(abs string, d model.Doc) error {
	if err := os.MkdirAll(filepath.Dir(abs), 0o755); err != nil {
		return err
	}
	fm, err := yaml.Marshal(struct {
		Title   string   `yaml:"title"`
		Tags    []string `yaml:"tags,omitempty"`
		Pinned  bool     `yaml:"pinned,omitempty"`
		Created string   `yaml:"created"`
		Updated string   `yaml:"updated"`
	}{d.Title, d.Tags, d.Pinned, d.Created, d.Updated})
	if err != nil {
		return err
	}
	var b strings.Builder
	b.WriteString("---\n")
	b.Write(fm)
	b.WriteString("---\n")
	b.WriteString(d.Body)
	return os.WriteFile(abs, []byte(b.String()), 0o644)
}

// ListDocs 返回全部文档（不含正文），置顶优先、再按更新时间倒序。
func (s *Store) ListDocs() ([]model.Doc, error) {
	var out []model.Doc
	dir := filepath.Join(s.root, "docs")
	err := filepath.Walk(dir, func(p string, info os.FileInfo, err error) error {
		if err != nil {
			if os.IsNotExist(err) {
				return filepath.SkipAll
			}
			return err
		}
		if info.IsDir() || !strings.HasSuffix(info.Name(), ".md") {
			return nil
		}
		rel, _ := filepath.Rel(s.root, p)
		d, err := s.readDocFile(p, rel)
		if err != nil {
			return nil
		}
		d.Body = ""
		out = append(out, d)
		return nil
	})
	if err != nil && !os.IsNotExist(err) {
		return nil, err
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Pinned != out[j].Pinned {
			return out[i].Pinned
		}
		return out[i].Updated > out[j].Updated
	})
	return out, nil
}

// ReadDoc 读取单篇文档。
func (s *Store) ReadDoc(rel string) (model.Doc, error) {
	rp, err := docPath(rel)
	if err != nil {
		return model.Doc{}, err
	}
	return s.readDocFile(filepath.Join(s.root, rp), rp)
}

// CreateDoc 新建文档；同路径已存在时报错。
func (s *Store) CreateDoc(in model.Doc) (model.Doc, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	rp, err := docPath(in.Path)
	if err != nil {
		return in, err
	}
	abs := filepath.Join(s.root, rp)
	if _, err := os.Stat(abs); err == nil {
		return in, i18n.New(i18n.DocExists, filepath.ToSlash(rp))
	}
	now := time.Now().Format(time.RFC3339)
	in.Path = filepath.ToSlash(rp)
	in.Created, in.Updated = now, now
	if in.Title == "" {
		in.Title = strings.TrimSuffix(filepath.Base(rp), ".md")
	}
	if err := s.writeDocFile(abs, in); err != nil {
		return in, err
	}
	if err := s.commit("docs: create " + in.Path); err != nil {
		return in, err
	}
	return in, nil
}

// UpdateDoc 更新文档；newPath 非空时移动/重命名。
func (s *Store) UpdateDoc(path string, patch map[string]any) (model.Doc, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	rp, err := docPath(path)
	if err != nil {
		return model.Doc{}, err
	}
	abs := filepath.Join(s.root, rp)
	d, err := s.readDocFile(abs, rp)
	if err != nil {
		return d, i18n.New(i18n.DocNotFound, filepath.ToSlash(rp))
	}
	if v, ok := patch["title"].(string); ok && v != "" {
		d.Title = v
	}
	if v, ok := patch["body"].(string); ok {
		d.Body = v
	}
	if v, ok := patch["tags"]; ok {
		d.Tags = toStringSlice(v)
	}
	if v, ok := patch["pinned"].(bool); ok {
		d.Pinned = v
	}
	d.Updated = time.Now().Format(time.RFC3339)

	target := abs
	if np, ok := patch["path"].(string); ok && strings.TrimSpace(np) != "" {
		rp2, err := docPath(np)
		if err != nil {
			return d, err
		}
		if rp2 != rp {
			target = filepath.Join(s.root, rp2)
			if _, err := os.Stat(target); err == nil {
				return d, i18n.New(i18n.TargetExists, filepath.ToSlash(rp2))
			}
			d.Path = filepath.ToSlash(rp2)
		}
	}
	if err := s.writeDocFile(target, d); err != nil {
		return d, err
	}
	if target != abs {
		if err := os.Remove(abs); err != nil {
			return d, err
		}
	}
	if err := s.commit("docs: update " + d.Path); err != nil {
		return d, err
	}
	return d, nil
}

// DeleteDoc 删除文档。
func (s *Store) DeleteDoc(path string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	rp, err := docPath(path)
	if err != nil {
		return err
	}
	abs := filepath.Join(s.root, rp)
	if _, err := os.Stat(abs); err != nil {
		return i18n.New(i18n.DocNotFound, filepath.ToSlash(rp))
	}
	if err := os.Remove(abs); err != nil {
		return err
	}
	return s.commit("docs: delete " + filepath.ToSlash(rp))
}

// DocHit 是一条文档搜索结果。
type DocHit struct {
	Doc     model.Doc `json:"doc"`
	Snippet string    `json:"snippet"`
	Tags    []string  `json:"-"`
}

// SearchDocs 在标题、正文、路径与标签中检索文档。
func (s *Store) SearchDocs(q string) ([]DocHit, error) {
	q = strings.ToLower(strings.TrimSpace(q))
	if q == "" {
		return []DocHit{}, nil
	}
	docs, err := s.ListDocs()
	if err != nil {
		return nil, err
	}
	out := make([]DocHit, 0)
	for _, d := range docs {
		abs := filepath.Join(s.root, filepath.FromSlash(d.Path))
		full, err := s.readDocFile(abs, d.Path)
		if err != nil {
			continue
		}
		matched := strings.Contains(strings.ToLower(full.Title), q) ||
			strings.Contains(strings.ToLower(full.Path), q) ||
			containsFold(full.Tags, q) ||
			strings.Contains(strings.ToLower(full.Body), q)
		snippet := ""
		if strings.Contains(strings.ToLower(full.Body), q) {
			snippet = snippetAround(full.Body, q)
		}
		if matched {
			full.Body = ""
			out = append(out, DocHit{Doc: full, Snippet: snippet})
		}
	}
	return out, nil
}
