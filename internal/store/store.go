package store

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
	"github.com/nonex-code/vellum/internal/i18n"

	"gopkg.in/yaml.v3"

	"github.com/nonex-code/vellum/internal/gitrepo"
	"github.com/nonex-code/vellum/internal/model"
)

// Store 以纯文本文件为后端，读写任务/条目/附件，并提交到 git。
type Store struct {
	root   string
	prefix string
	repo   *gitrepo.Repo
	push   bool
	mu     sync.Mutex // 单写者，串行化所有写操作
}

// New 创建 Store。prefix 为空时默认 WB。
func New(root, prefix string, repo *gitrepo.Repo, push bool) *Store {
	if prefix == "" {
		prefix = "WB"
	}
	return &Store{root: root, prefix: prefix, repo: repo, push: push}
}

func (s *Store) issueDir(id string) string {
	return filepath.Join(s.root, "issues", id)
}

// commit 提交并（可选）推送。推送失败不致命：改动已本地提交。
func (s *Store) commit(msg string) error {
	if s.repo == nil {
		return nil
	}
	if err := s.repo.CommitAll(msg); err != nil {
		return err
	}
	if s.push {
		if err := s.repo.Push(); err != nil {
			fmt.Printf("vellum: push 失败（已本地提交）: %v\n", err)
		}
	}
	return nil
}

// ---------- 读取 ----------

func (s *Store) readIssueFile(id string) (model.Issue, error) {
	data, err := os.ReadFile(filepath.Join(s.issueDir(id), "issue.md"))
	if err != nil {
		return model.Issue{}, err
	}
	fm, body := splitFrontmatter(data)
	var iss model.Issue
	if len(fm) > 0 {
		if err := yaml.Unmarshal(fm, &iss); err != nil {
			return iss, err
		}
	}
	iss.Body = body
	if iss.ID == "" {
		iss.ID = id
	}
	return iss, nil
}

func (s *Store) readEntries(id string) []model.Entry {
	dir := filepath.Join(s.issueDir(id), "entries")
	ents, err := os.ReadDir(dir)
	if err != nil {
		return nil
	}
	var names []string
	for _, e := range ents {
		if !e.IsDir() && strings.HasSuffix(e.Name(), ".md") {
			names = append(names, e.Name())
		}
	}
	sort.Strings(names)
	out := make([]model.Entry, 0, len(names))
	for _, n := range names {
		data, err := os.ReadFile(filepath.Join(dir, n))
		if err != nil {
			continue
		}
		fm, body := splitFrontmatter(data)
		var en model.Entry
		if len(fm) > 0 {
			if err := yaml.Unmarshal(fm, &en); err != nil {
				continue
			}
		}
		en.Body = body
		en.File = n
		out = append(out, en)
	}
	return out
}

// ListIssues 返回全部任务，按 updated 倒序。
func (s *Store) ListIssues() ([]model.Issue, error) {
	dir := filepath.Join(s.root, "issues")
	ents, err := os.ReadDir(dir)
	if err != nil {
		if os.IsNotExist(err) {
			return []model.Issue{}, nil
		}
		return nil, err
	}
	out := make([]model.Issue, 0, len(ents))
	for _, e := range ents {
		if !e.IsDir() {
			continue
		}
		iss, err := s.readIssueFile(e.Name())
		if err != nil {
			continue
		}
		out = append(out, iss)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Updated > out[j].Updated })
	return out, nil
}

// ReadIssue 返回单个任务及其时间线。
func (s *Store) ReadIssue(id string) (model.Issue, []model.Entry, error) {
	iss, err := s.readIssueFile(id)
	if err != nil {
		return iss, nil, i18n.New(i18n.IssueNotFound, id)
	}
	return iss, s.readEntries(id), nil
}

// ---------- 写入 ----------

func (s *Store) writeIssueFile(iss model.Issue) error {
	p := filepath.Join(s.issueDir(iss.ID), "issue.md")
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		return err
	}
	fm, err := yaml.Marshal(iss)
	if err != nil {
		return err
	}
	var b strings.Builder
	b.WriteString("---\n")
	b.Write(fm)
	b.WriteString("---\n")
	b.WriteString(iss.Body)
	return os.WriteFile(p, []byte(b.String()), 0o644)
}

// CreateIssue 分配 ID、建目录、写 issue.md 并提交。
func (s *Store) CreateIssue(in model.Issue) (model.Issue, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	id, err := s.nextID()
	if err != nil {
		return in, err
	}
	now := time.Now().Format(time.RFC3339)
	in.ID = id
	in.Created = now
	in.Updated = now
	if in.Status == "" {
		in.Status = "todo"
	}
	if err := os.MkdirAll(filepath.Join(s.issueDir(id), "entries"), 0o755); err != nil {
		return in, err
	}
	if err := s.writeIssueFile(in); err != nil {
		return in, err
	}
	if err := s.commit("create " + id + ": " + in.Title); err != nil {
		return in, err
	}
	return in, nil
}

// appendEntryLocked 在持有锁时追加一条时间线文件。
func (s *Store) appendEntryLocked(id string, in model.Entry) (model.Entry, error) {
	dir := filepath.Join(s.issueDir(id), "entries")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return in, err
	}
	if in.Author == "" {
		in.Author = "me"
	}
	if in.Type == "" {
		in.Type = "comment"
	}
	if in.Created == "" {
		in.Created = time.Now().Format(time.RFC3339)
	}
	ents, _ := os.ReadDir(dir)
	n := 0
	for _, e := range ents {
		if strings.HasSuffix(e.Name(), ".md") {
			n++
		}
	}
	n++
	fname := fmt.Sprintf("%04d-%s-%s.md", n, time.Now().Format("20060102T150405"), sanitize(in.Author))

	fm, err := yaml.Marshal(in)
	if err != nil {
		return in, err
	}
	var b strings.Builder
	b.WriteString("---\n")
	b.Write(fm)
	b.WriteString("---\n")
	b.WriteString(in.Body)
	if err := os.WriteFile(filepath.Join(dir, fname), []byte(b.String()), 0o644); err != nil {
		return in, err
	}
	in.File = fname
	return in, nil
}

// AddEntry 追加跟进并刷新任务的 updated。
func (s *Store) AddEntry(id string, in model.Entry) (model.Entry, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	iss, err := s.readIssueFile(id)
	if err != nil {
		return in, i18n.New(i18n.IssueNotFound, id)
	}
	en, err := s.appendEntryLocked(id, in)
	if err != nil {
		return in, err
	}
	iss.Updated = en.Created
	if err := s.writeIssueFile(iss); err != nil {
		return en, err
	}
	if err := s.commit(fmt.Sprintf("%s: %s", id, en.Type)); err != nil {
		return en, err
	}
	return en, nil
}

// UpdateIssue 修改任务字段；状态变化时自动补一条 status 条目。
func (s *Store) UpdateIssue(id string, patch map[string]any) (model.Issue, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	iss, err := s.readIssueFile(id)
	if err != nil {
		return iss, i18n.New(i18n.IssueNotFound, id)
	}
	oldStatus := iss.Status
	if v, ok := patch["title"].(string); ok {
		iss.Title = v
	}
	if v, ok := patch["status"].(string); ok {
		iss.Status = v
	}
	if v, ok := patch["priority"].(string); ok {
		iss.Priority = v
	}
	if v, ok := patch["type"].(string); ok {
		iss.Type = v
	}
	if v, ok := patch["assignee"].(string); ok {
		iss.Assignee = v
	}
	if v, ok := patch["body"].(string); ok {
		iss.Body = v
	}
	if v, ok := patch["labels"]; ok {
		iss.Labels = toStringSlice(v)
	}
	if v, ok := patch["milestone"].(string); ok {
		iss.Milestone = v
	}
	if v, ok := patch["parent"].(string); ok {
		iss.Parent = v
	}
	if v, ok := patch["start"].(string); ok {
		iss.Start = v
	}
	if v, ok := patch["due"].(string); ok {
		iss.Due = v
	}
	if v, ok := patch["fields"]; ok {
		iss.Fields = toStringMap(v)
	}
	now := time.Now().Format(time.RFC3339)
	iss.Updated = now
	if err := s.writeIssueFile(iss); err != nil {
		return iss, err
	}
	if oldStatus != iss.Status {
		note, _ := patch["note"].(string)
		if _, err := s.appendEntryLocked(id, model.Entry{
			Author: "me", Created: now, Type: "status",
			From: oldStatus, To: iss.Status, Body: note,
		}); err != nil {
			return iss, err
		}
	}
	if err := s.commit(fmt.Sprintf("%s: update", id)); err != nil {
		return iss, err
	}
	return iss, nil
}

// SaveFile 以内容哈希命名保存附件，返回相对路径与访问 URL。
func (s *Store) SaveFile(id, name string, data []byte) (string, string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if _, err := os.Stat(s.issueDir(id)); err != nil {
		return "", "", i18n.New(i18n.IssueNotFound, id)
	}
	sum := sha256.Sum256(data)
	h := hex.EncodeToString(sum[:])
	ext := strings.ToLower(filepath.Ext(name))
	rel := filepath.ToSlash(filepath.Join("files", h[:2], h[2:4], h+ext))
	abs := filepath.Join(s.issueDir(id), filepath.FromSlash(rel))
	if _, err := os.Stat(abs); err == nil {
		return rel, fileURL(id, rel), nil // 已有，去重
	}
	if err := os.MkdirAll(filepath.Dir(abs), 0o755); err != nil {
		return "", "", err
	}
	if err := os.WriteFile(abs, data, 0o644); err != nil {
		return "", "", err
	}
	if err := s.commit(fmt.Sprintf("%s: attach %s", id, name)); err != nil {
		return "", "", err
	}
	return rel, fileURL(id, rel), nil
}

// ReadFile 读取附件内容，拒绝路径穿越。
func (s *Store) ReadFile(id, rel string) (string, []byte, error) {
	rel = filepath.ToSlash(rel)
	if strings.Contains(rel, "..") || strings.HasPrefix(rel, "/") {
		return "", nil, i18n.New(i18n.IllegalPath)
	}
	abs := filepath.Join(s.issueDir(id), filepath.FromSlash(rel))
	data, err := os.ReadFile(abs)
	return abs, data, err
}

func fileURL(id, rel string) string {
	return "/api/files/" + id + "/" + filepath.ToSlash(rel)
}

// ---------- ID ----------

func (s *Store) nextID() (string, error) {
	seqPath := filepath.Join(s.root, "meta", "seq")
	n := 0
	if b, err := os.ReadFile(seqPath); err == nil {
		n, _ = strconv.Atoi(strings.TrimSpace(string(b)))
	} else {
		n = s.maxExisting()
	}
	n++
	if err := os.MkdirAll(filepath.Dir(seqPath), 0o755); err != nil {
		return "", err
	}
	if err := os.WriteFile(seqPath, []byte(strconv.Itoa(n)), 0o644); err != nil {
		return "", err
	}
	return fmt.Sprintf("%s-%04d", s.prefix, n), nil
}

func (s *Store) maxExisting() int {
	ents, err := os.ReadDir(filepath.Join(s.root, "issues"))
	if err != nil {
		return 0
	}
	max := 0
	for _, e := range ents {
		if !e.IsDir() {
			continue
		}
		parts := strings.Split(e.Name(), "-")
		if v, err := strconv.Atoi(parts[len(parts)-1]); err == nil && v > max {
			max = v
		}
	}
	return max
}

// DeleteIssue 删除任务目录并提交。
func (s *Store) DeleteIssue(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	dir := s.issueDir(id)
	if _, err := os.Stat(dir); err != nil {
		return i18n.New(i18n.IssueNotFound, id)
	}
	if err := os.RemoveAll(dir); err != nil {
		return err
	}
	return s.commit("delete " + id)
}

// SearchHit 是一条搜索结果。
type SearchHit struct {
	Issue   model.Issue `json:"issue"`
	Snippet string      `json:"snippet"`
}

// Search 在标题、正文、标签、编号与跟进内容中做不区分大小写的检索。
func (s *Store) Search(q string) ([]SearchHit, error) {
	q = strings.ToLower(strings.TrimSpace(q))
	if q == "" {
		return []SearchHit{}, nil
	}
	issues, err := s.ListIssues()
	if err != nil {
		return nil, err
	}
	out := make([]SearchHit, 0)
	for _, iss := range issues {
		matched := strings.Contains(strings.ToLower(iss.Title), q) ||
			strings.Contains(strings.ToLower(iss.ID), q) ||
			containsFold(iss.Labels, q) ||
			strings.Contains(strings.ToLower(iss.Body), q)
		snippet := ""
		if strings.Contains(strings.ToLower(iss.Body), q) {
			snippet = snippetAround(iss.Body, q)
		}
		if !matched {
			for _, e := range s.readEntries(iss.ID) {
				if strings.Contains(strings.ToLower(e.Body), q) {
					matched = true
					snippet = snippetAround(e.Body, q)
					break
				}
			}
		}
		if matched {
			out = append(out, SearchHit{Issue: iss, Snippet: snippet})
		}
	}
	return out, nil
}

// Activity 是一条跨任务的动态（某任务的最新跟进）。
type Activity struct {
	IssueID string      `json:"issueId"`
	Title   string      `json:"title"`
	Status  string      `json:"status"`
	Entry   model.Entry `json:"entry"`
}

// RecentActivity 汇总全部任务的最新跟进，按时间倒序返回前 limit 条。
func (s *Store) RecentActivity(limit int) ([]Activity, error) {
	issues, err := s.ListIssues()
	if err != nil {
		return nil, err
	}
	all := make([]Activity, 0)
	for _, iss := range issues {
		entries := s.readEntries(iss.ID)
		if len(entries) == 0 {
			// 没有任何跟进的任务，用创建动作充当一条动态，避免首页空白。
			all = append(all, Activity{IssueID: iss.ID, Title: iss.Title, Status: iss.Status, Entry: model.Entry{
				Type: "create", Created: iss.Created, Author: "me", Body: iss.Body,
			}})
			continue
		}
		for _, e := range entries {
			all = append(all, Activity{IssueID: iss.ID, Title: iss.Title, Status: iss.Status, Entry: e})
		}
	}
	sort.Slice(all, func(i, j int) bool { return all[i].Entry.Created > all[j].Entry.Created })
	if limit > 0 && len(all) > limit {
		all = all[:limit]
	}
	return all, nil
}

func containsFold(list []string, q string) bool {
	for _, v := range list {
		if strings.Contains(strings.ToLower(v), q) {
			return true
		}
	}
	return false
}

func snippetAround(text, q string) string {
	rs := []rune(text)
	low := []rune(strings.ToLower(text))
	qr := []rune(q)
	i := indexRunes(low, qr)
	if i < 0 {
		return ""
	}
	start := i - 40
	if start < 0 {
		start = 0
	}
	end := i + len(qr) + 40
	if end > len(rs) {
		end = len(rs)
	}
	s := strings.TrimSpace(string(rs[start:end]))
	if start > 0 {
		s = "…" + s
	}
	if end < len(rs) {
		s = s + "…"
	}
	return s
}

func indexRunes(hay, needle []rune) int {
	if len(needle) == 0 || len(needle) > len(hay) {
		return -1
	}
	for i := 0; i+len(needle) <= len(hay); i++ {
		ok := true
		for j := range needle {
			if hay[i+j] != needle[j] {
				ok = false
				break
			}
		}
		if ok {
			return i
		}
	}
	return -1
}

func toStringMap(v any) map[string]string {
	m, ok := v.(map[string]any)
	if !ok {
		if ms, ok := v.(map[string]string); ok {
			return ms
		}
		return nil
	}
	out := make(map[string]string, len(m))
	for k, val := range m {
		if s, ok := val.(string); ok {
			out[k] = s
		}
	}
	return out
}

func toStringSlice(v any) []string {
	switch t := v.(type) {
	case []string:
		return t
	case []any:
		out := make([]string, 0, len(t))
		for _, x := range t {
			if s, ok := x.(string); ok {
				out = append(out, s)
			}
		}
		return out
	}
	return nil
}
