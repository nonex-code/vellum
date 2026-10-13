package server

import (
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"github.com/nonex-code/vellum/internal/i18n"

	"gopkg.in/yaml.v3"

	"github.com/nonex-code/vellum/internal/config"
	"github.com/nonex-code/vellum/internal/model"
	"github.com/nonex-code/vellum/internal/store"
)

// ---------- 甘特图 ----------

// handleGantt 返回按里程碑分组的时间轴数据（含未排期组）。
func (s *Server) handleGantt(w http.ResponseWriter, r *http.Request) {
	st, ok := s.activeStore()
	if !ok {
		s.err(w, r, 400, i18n.NoRepo)
		return
	}
	cfg, _, _ := s.snapshot()
	issues, err := st.ListIssues()
	if err != nil {
		writeJSON(w, map[string]any{"groups": []any{}})
		return
	}
	doneCat := func(sid string) bool {
		for _, sc := range cfg.Statuses {
			if sc.ID == sid {
				return sc.Category == "done"
			}
		}
		return false
	}
	type gItem struct {
		ID       string `json:"id"`
		Title    string `json:"title"`
		Status   string `json:"status"`
		Done     bool   `json:"done"`
		Priority string `json:"priority,omitempty"`
		Assignee string `json:"assignee,omitempty"`
		Start    string `json:"start,omitempty"`
		Due      string `json:"due,omitempty"`
	}
	byID := map[string][]gItem{}
	var order []string
	unscheduled := []gItem{}
	for _, iss := range issues {
		it := gItem{ID: iss.ID, Title: iss.Title, Status: iss.Status, Done: doneCat(iss.Status),
			Priority: iss.Priority, Assignee: iss.Assignee, Start: iss.Start, Due: iss.Due}
		if iss.Milestone != "" && byID[iss.Milestone] == nil {
			order = append(order, iss.Milestone)
		}
		if iss.Milestone != "" {
			byID[iss.Milestone] = append(byID[iss.Milestone], it)
		} else {
			unscheduled = append(unscheduled, it)
		}
	}
	type gGroup struct {
		ID    string  `json:"id"`
		Name  string  `json:"name"`
		Color string  `json:"color,omitempty"`
		Start string  `json:"start,omitempty"`
		End   string  `json:"end,omitempty"`
		Items []gItem `json:"items"`
	}
	groups := make([]gGroup, 0, len(cfg.Milestones)+1)
	seen := map[string]bool{}
	for _, m := range cfg.Milestones {
		seen[m.ID] = true
		items := byID[m.ID]
		if items == nil {
			items = []gItem{}
		}
		groups = append(groups, gGroup{ID: m.ID, Name: m.Name, Color: m.Color, Start: m.Start, End: m.End, Items: items})
	}
	for _, id := range order {
		if !seen[id] {
			groups = append(groups, gGroup{ID: id, Name: id, Items: byID[id]})
		}
	}
	if len(unscheduled) > 0 {
		groups = append(groups, gGroup{ID: "", Name: i18n.T(s.langOf(r), i18n.Unscheduled), Items: unscheduled})
	}
	writeJSON(w, map[string]any{"groups": groups})
}

// ---------- 项目集管理 ----------

// countIssuesLite 只解析 frontmatter 统计任务数，避免整库读取。
func countIssuesLite(projDir string) (total, done int, latest string) {
	doneID := map[string]bool{"done": true, "cancelled": true}
	ents, err := os.ReadDir(filepath.Join(projDir, "issues"))
	if err != nil {
		return
	}
	for _, e := range ents {
		if !e.IsDir() {
			continue
		}
		data, err := os.ReadFile(filepath.Join(projDir, "issues", e.Name(), "issue.md"))
		if err != nil {
			continue
		}
		total++
		fm, _ := store.SplitFrontmatter(data)
		var head struct {
			Status  string `yaml:"status"`
			Updated string `yaml:"updated"`
		}
		if yaml.Unmarshal(fm, &head) == nil {
			if doneID[head.Status] {
				done++
			}
			if head.Updated > latest {
				latest = head.Updated
			}
		}
	}
	return
}

// handleProjectStats 返回项目集下各项目概况（含归档）。
func (s *Server) handleProjectStats(w http.ResponseWriter, r *http.Request) {
	_, repoRoot, _ := s.snapshot()
	s.mu.RLock()
	cur := s.projectID
	s.mu.RUnlock()
	if repoRoot == "" {
		s.err(w, r, 400, i18n.NoRepo)
		return
	}
	type stat struct {
		ID          string `json:"id"`
		Name        string `json:"name"`
		Description string `json:"description,omitempty"`
		Archived    bool   `json:"archived"`
		Current     bool   `json:"current"`
		Total       int    `json:"total"`
		Done        int    `json:"done"`
		Updated     string `json:"updated,omitempty"`
	}
	dir := filepath.Join(repoRoot, "projects")
	ents, err := os.ReadDir(dir)
	out := make([]stat, 0)
	if err == nil {
		for _, e := range ents {
			if !e.IsDir() {
				continue
			}
			pdir := filepath.Join(dir, e.Name())
			meta := model.ProjectMeta{ID: e.Name(), Name: e.Name()}
			if c, err := config.Load(pdir); err == nil && c.Project.Name != "" {
				meta = c.Project
				meta.ID = e.Name()
			}
			_, aerr := os.Stat(filepath.Join(pdir, ".archived"))
			archived := aerr == nil
			total, done, latest := countIssuesLite(pdir)
			out = append(out, stat{ID: meta.ID, Name: meta.Name, Description: meta.Description,
				Archived: archived, Current: e.Name() == cur, Total: total, Done: done, Updated: latest})
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	writeJSON(w, map[string]any{"projects": out, "current": cur})
}

// handleRenameProject 修改项目显示名/简介（写 projects/<id>/workbench.yaml）。
func (s *Server) handleRenameProject(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var in struct {
		Name        string `json:"name"`
		Description string `json:"description"`
	}
	if err := readJSON(r, &in); err != nil {
		s.errOf(w, r, 400, err)
		return
	}
	if strings.TrimSpace(in.Name) == "" {
		s.err(w, r, 400, i18n.ProjectNameRequired)
		return
	}
	s.mu.Lock()
	pdir := filepath.Join(s.repoRoot, "projects", id)
	if _, err := os.Stat(pdir); err != nil {
		s.mu.Unlock()
		s.err(w, r, 404, i18n.ProjectNotFound, id)
		return
	}
	err := config.InitProject(pdir, id, in.Name, in.Description)
	if err == nil && s.repo != nil {
		_ = s.repo.CommitAll("rename project " + id)
	}
	if err == nil && s.projectID == id {
		err = s.setProjectLocked(id)
	}
	s.mu.Unlock()
	if err != nil {
		s.errOf(w, r, 500, err)
		return
	}
	writeJSON(w, map[string]any{"ok": true, "projects": s.projectsMeta()})
}

// handleArchiveProject 归档/取消归档项目（marker 文件，纯文本可见）。
func (s *Server) handleArchiveProject(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var in struct {
		Archived *bool `json:"archived"`
	}
	if err := readJSON(r, &in); err != nil {
		s.errOf(w, r, 400, err)
		return
	}
	if in.Archived == nil {
		s.err(w, r, 400, i18n.MissingArchived)
		return
	}
	s.mu.Lock()
	if s.repoRoot == "" {
		s.mu.Unlock()
		s.err(w, r, 400, i18n.NoRepo)
		return
	}
	if s.projectID == id && *in.Archived {
		s.mu.Unlock()
		s.err(w, r, 400, i18n.CannotArchiveActive)
		return
	}
	pdir := filepath.Join(s.repoRoot, "projects", id)
	if _, err := os.Stat(pdir); err != nil {
		s.mu.Unlock()
		s.err(w, r, 404, i18n.ProjectNotFound, id)
		return
	}
	marker := filepath.Join(pdir, ".archived")
	err := error(nil)
	if *in.Archived {
		err = os.WriteFile(marker, []byte("archived\n"), 0o644)
	} else {
		err = os.Remove(marker)
	}
	if err == nil && s.repo != nil {
		_ = s.repo.CommitAll(fmt.Sprintf("%s project %s", map[bool]string{true: "archive", false: "unarchive"}[*in.Archived], id))
	}
	s.mu.Unlock()
	if err != nil {
		s.errOf(w, r, 500, err)
		return
	}
	writeJSON(w, map[string]any{"ok": true})
}

// handleConfigMode 在 single ↔ multi 之间转换并迁移数据。
func (s *Server) handleConfigMode(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Mode string `json:"mode"`
	}
	if err := readJSON(r, &in); err != nil {
		s.errOf(w, r, 400, err)
		return
	}
	if in.Mode != "single" && in.Mode != "multi" {
		s.err(w, r, 400, i18n.BadMode)
		return
	}
	s.mu.Lock()
	if s.repoRoot == "" {
		s.mu.Unlock()
		s.err(w, r, 400, i18n.NoRepo)
		return
	}
	if s.cfg.Workspace.Mode == in.Mode {
		s.mu.Unlock()
		writeJSON(w, map[string]any{"ok": true, "mode": in.Mode})
		return
	}
	pid, err := s.convertModeLocked(in.Mode)
	if err == nil {
		if cfg, e := config.Load(s.repoRoot); e == nil {
			s.cfg = cfg
		}
		if s.cfg.Workspace.Mode == "multi" {
			err = s.setProjectLocked(pid)
		} else {
			err = s.setProjectLocked("")
		}
	}
	if err == nil && s.repo != nil {
		_ = s.repo.CommitAll("switch mode to " + in.Mode)
	}
	name := s.cfg.Workspace.Name
	remote := ""
	if s.repo != nil {
		remote = s.repo.Remote()
	}
	s.mu.Unlock()
	if err != nil {
		s.errOf(w, r, 500, err)
		return
	}
	s.recordRepo(name, s.snapshotRoot(), remote, in.Mode)
	writeJSON(w, map[string]any{"ok": true, "mode": in.Mode})
}

// convertModeLocked 执行数据迁移（须持有写锁），返回多项目模式下的当前项目 id。
func (s *Server) convertModeLocked(mode string) (string, error) {
	move := func(from, to string) error {
		if _, err := os.Stat(from); err != nil {
			return nil // 源不存在则跳过
		}
		if _, err := os.Stat(to); err == nil {
			return i18n.New(i18n.TargetExists, to)
		}
		if err := os.MkdirAll(filepath.Dir(to), 0o755); err != nil {
			return err
		}
		return os.Rename(from, to)
	}
	// multi→single 时，合并回来的那个项目的目录与配置文件
	var projectDir, projectCfg string
	// 转为多项目后所在的项目 id
	var currentID string
	switch mode {
	case "multi":
		// 单项目升多项目：沿用仓库里已有的项目名/简介，别把它变成匿名的“默认项目”。
		id, name, desc := "main", "默认项目", ""
		if p := s.cfg.Project; p.ID != "" || p.Name != "" {
			if p.ID != "" {
				id = slug(p.ID)
			}
			if p.Name != "" {
				name = p.Name
			}
			desc = p.Description
		}
		if err := os.MkdirAll(filepath.Join(s.repoRoot, "projects"), 0o755); err != nil {
			return "", err
		}
		mainDir := filepath.Join(s.repoRoot, "projects", id)
		hasIssues := false
		if _, err := os.Stat(filepath.Join(s.repoRoot, "issues")); err == nil {
			hasIssues = true
			if err := move(filepath.Join(s.repoRoot, "issues"), filepath.Join(mainDir, "issues")); err != nil {
				return "", err
			}
		}
		if _, err := os.Stat(filepath.Join(s.repoRoot, "meta")); err == nil {
			if err := move(filepath.Join(s.repoRoot, "meta"), filepath.Join(mainDir, "meta")); err != nil {
				return "", err
			}
			hasIssues = true
		}
		if _, err := os.Stat(filepath.Join(s.repoRoot, "docs")); err == nil {
			if err := move(filepath.Join(s.repoRoot, "docs"), filepath.Join(mainDir, "docs")); err != nil {
				return "", err
			}
		}
		if !hasIssues {
			if _, err := s.createProjectLocked(id, name, desc); err != nil {
				return "", err
			}
		} else {
			if err := os.MkdirAll(filepath.Join(mainDir, "docs"), 0o755); err != nil {
				return "", err
			}
			if _, err := os.Stat(filepath.Join(mainDir, "workbench.yaml")); err != nil {
				if err := config.InitProject(mainDir, id, name, desc); err != nil {
					return "", err
				}
			}
		}
		currentID = id
	case "single":
		all := s.projectIDsLocked()
		// 归档项目中若仍有数据，禁止静默丢弃
		for _, id := range all {
			pdir := filepath.Join(s.repoRoot, "projects", id)
			if _, err := os.Stat(filepath.Join(pdir, ".archived")); err != nil {
				continue
			}
			if total, _, _ := countIssuesLite(pdir); total > 0 {
				return "", i18n.New(i18n.ArchivedProjectHasIssues, id, total)
			}
		}
		var live []string
		for _, id := range all {
			if _, err := os.Stat(filepath.Join(s.repoRoot, "projects", id, ".archived")); err != nil {
				live = append(live, id)
			}
		}
		if len(live) != 1 {
			return "", i18n.New(i18n.TooManyLiveProjects, len(live))
		}
		src := filepath.Join(s.repoRoot, "projects", live[0])
		projectDir, projectCfg = src, filepath.Join(src, "workbench.yaml")
		for _, sub := range []string{"issues", "meta", "docs"} {
			if err := move(filepath.Join(src, sub), filepath.Join(s.repoRoot, sub)); err != nil {
				return "", err
			}
		}
	}
	// 更新仓库 workbench.yaml 的 workspace.mode：只覆盖 workspace 段，其余键与注释保留。
	p := filepath.Join(s.repoRoot, "workbench.yaml")
	name := s.cfg.Workspace.Name
	incoming := fmt.Sprintf("workspace:\n  name: %q\n  mode: %q\n", name, mode)
	existing, _ := os.ReadFile(p)
	merged, err := config.MergeYAMLKeys(existing, incoming, []string{"workspace"})
	if err != nil {
		return "", err
	}
	if mode == "single" {
		// 合并回单项目：把该项目的配置（含项目名/简介）带到仓库级，
		// 免得项目级自定义随目录一起消失，也避免同一份覆盖在项目目录里留下失效副本。
		if data, err := os.ReadFile(projectCfg); err == nil {
			owned := []string{}
			var keys map[string]any
			if yaml.Unmarshal(data, &keys) == nil {
				for k := range keys {
					if k != "workspace" {
						owned = append(owned, k)
					}
				}
			}
			sort.Strings(owned)
			if len(owned) > 0 {
				merged, err = config.MergeYAMLKeys([]byte(merged), string(data), owned)
				if err != nil {
					return "", err
				}
			}
		}
	}
	if err := os.WriteFile(p, []byte(merged), 0o644); err != nil {
		return "", err
	}
	if mode == "single" && projectDir != "" {
		// 项目配置已并入仓库级，删掉项目目录里的副本；目录空了就一起移除。
		_ = os.Remove(projectCfg)
		if ents, err := os.ReadDir(projectDir); err == nil && len(ents) == 0 {
			_ = os.Remove(projectDir)
		}
		if ents, err := os.ReadDir(filepath.Join(s.repoRoot, "projects")); err == nil && len(ents) == 0 {
			_ = os.Remove(filepath.Join(s.repoRoot, "projects"))
		}
	}
	return currentID, nil
}

// ---------- 配置中心（原始 YAML） ----------

func rawConfigPath(root, scope, projectID string) (string, error) {
	switch scope {
	case "repo":
		return filepath.Join(root, "workbench.yaml"), nil
	case "project":
		if projectID == "" {
			return filepath.Join(root, "workbench.yaml"), nil
		}
		return filepath.Join(root, "projects", projectID, "workbench.yaml"), nil
	}
	return "", i18n.New(i18n.BadScope)
}

const rawConfigTemplate = `# Vellum 配置（跟随仓库/项目走，脱离平台也能直接阅读）
# 全部字段可缺省，未写的使用内置默认。参考 workbench.yaml.example。
`

// handleConfigRawGet 返回指定作用域的原始 YAML（不存在时给模板）。
func (s *Server) handleConfigRawGet(w http.ResponseWriter, r *http.Request) {
	scope := r.URL.Query().Get("scope")
	_, repoRoot, _ := s.snapshot()
	s.mu.RLock()
	pid := s.projectID
	s.mu.RUnlock()
	if repoRoot == "" {
		s.err(w, r, 400, i18n.NoRepo)
		return
	}
	p, err := rawConfigPath(repoRoot, scope, pid)
	if err != nil {
		s.errOf(w, r, 400, err)
		return
	}
	data, err := os.ReadFile(p)
	exists := err == nil
	if !exists {
		data = []byte(rawConfigTemplate)
	}
	writeJSON(w, map[string]any{"path": filepath.ToSlash(p), "yaml": string(data), "exists": exists})
}

// handleConfigRawPut 校验并写入原始 YAML，然后热重载。
// 带 managed 时按表单拥有的键做合并写入，其余键保留；不带则整份覆盖（YAML 源码标签的语义）。
func (s *Server) handleConfigRawPut(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Scope   string   `json:"scope"`
		Yaml    string   `json:"yaml"`
		Managed []string `json:"managed"`
	}
	if err := readJSON(r, &in); err != nil {
		s.errOf(w, r, 400, err)
		return
	}
	_, repoRoot, _ := s.snapshot()
	s.mu.RLock()
	pid := s.projectID
	repo := s.repo
	s.mu.RUnlock()
	if repoRoot == "" {
		s.err(w, r, 400, i18n.NoRepo)
		return
	}
	p, err := rawConfigPath(repoRoot, in.Scope, pid)
	if err != nil {
		s.errOf(w, r, 400, err)
		return
	}
	var probe map[string]any
	if err := yaml.Unmarshal([]byte(in.Yaml), &probe); err != nil {
		s.err(w, r, 400, i18n.YamlInvalid, err.Error())
		return
	}
	if probe == nil {
		s.err(w, r, 400, i18n.YamlEmpty)
		return
	}
	if in.Scope == "project" && pid != "" {
		// 项目身份由 projects/<id>/ 目录名决定，配置里写错 id 会让项目和目录对不上。
		if pm, ok := probe["project"].(map[string]any); ok {
			if got, _ := pm["id"].(string); got != "" && got != pid {
				s.err(w, r, 400, i18n.ProjectIDMismatch, got, pid)
				return
			}
		}
	}
	out := in.Yaml
	if len(in.Managed) > 0 {
		existing, _ := os.ReadFile(p)
		out, err = config.MergeYAMLKeys(existing, in.Yaml, in.Managed)
		if err != nil {
			s.errOf(w, r, 400, err)
			return
		}
		if in.Scope == "project" && pid != "" {
			// 项目级只写覆盖项：与仓库生效配置相同的键不落在项目文件里，继承才能生效。
			repoCfg, err := config.LoadFor(repoRoot, "")
			if err != nil {
				s.errOf(w, r, 500, err)
				return
			}
			out, err = config.PruneInherited(out, repoCfg, in.Managed)
			if err != nil {
				s.errOf(w, r, 400, err)
				return
			}
		}
	}
	s.mu.Lock()
	err = os.WriteFile(p, []byte(out), 0o644)
	if err == nil {
		s.reloadLocked()
		if repo != nil {
			_ = repo.CommitAll("update " + in.Scope + " config")
		}
	}
	s.mu.Unlock()
	if err != nil {
		s.errOf(w, r, 500, err)
		return
	}
	writeJSON(w, map[string]any{"ok": true})
}

// ---------- 文档（wiki） ----------

func (s *Server) handleDocsList(w http.ResponseWriter, r *http.Request) {
	st, ok := s.activeStore()
	if !ok {
		s.err(w, r, 400, i18n.NoRepo)
		return
	}
	docs, err := st.ListDocs()
	if err != nil {
		s.errOf(w, r, 500, err)
		return
	}
	writeJSON(w, map[string]any{"docs": docs})
}

func (s *Server) handleDocsCreate(w http.ResponseWriter, r *http.Request) {
	st, ok := s.activeStore()
	if !ok {
		s.err(w, r, 400, i18n.NoRepo)
		return
	}
	var in struct {
		Title string   `json:"title"`
		Path  string   `json:"path"`
		Tags  []string `json:"tags"`
		Body  string   `json:"body"`
	}
	if err := readJSON(r, &in); err != nil {
		s.errOf(w, r, 400, err)
		return
	}
	if strings.TrimSpace(in.Title) == "" {
		s.err(w, r, 400, i18n.TitleRequired)
		return
	}
	path := in.Path
	if strings.TrimSpace(path) == "" {
		path = store.Slug(in.Title)
	}
	d, err := st.CreateDoc(model.Doc{Title: in.Title, Path: path, Tags: in.Tags, Body: in.Body})
	if err != nil {
		s.errOf(w, r, 500, err)
		return
	}
	s.fire("doc.create", map[string]any{"path": d.Path})
	writeJSON(w, map[string]any{"doc": d})
}

func docParam(r *http.Request) string {
	return r.URL.Query().Get("path")
}

func (s *Server) handleDocsGet(w http.ResponseWriter, r *http.Request) {
	st, ok := s.activeStore()
	if !ok {
		s.err(w, r, 400, i18n.NoRepo)
		return
	}
	d, err := st.ReadDoc(docParam(r))
	if err != nil {
		s.errOf(w, r, 404, err)
		return
	}
	writeJSON(w, map[string]any{"doc": d})
}

func (s *Server) handleDocsUpdate(w http.ResponseWriter, r *http.Request) {
	st, ok := s.activeStore()
	if !ok {
		s.err(w, r, 400, i18n.NoRepo)
		return
	}
	var patch map[string]any
	if err := readJSON(r, &patch); err != nil {
		s.errOf(w, r, 400, err)
		return
	}
	d, err := st.UpdateDoc(docParam(r), patch)
	if err != nil {
		s.errOf(w, r, 500, err)
		return
	}
	s.fire("doc.update", map[string]any{"path": d.Path})
	writeJSON(w, map[string]any{"doc": d})
}

func (s *Server) handleDocsDelete(w http.ResponseWriter, r *http.Request) {
	st, ok := s.activeStore()
	if !ok {
		s.err(w, r, 400, i18n.NoRepo)
		return
	}
	path := docParam(r)
	if err := st.DeleteDoc(path); err != nil {
		s.errOf(w, r, 500, err)
		return
	}
	s.fire("doc.delete", map[string]any{"path": path})
	writeJSON(w, map[string]any{"ok": true})
}

func (s *Server) handleDocsSearch(w http.ResponseWriter, r *http.Request) {
	st, ok := s.activeStore()
	if !ok {
		s.err(w, r, 400, i18n.NoRepo)
		return
	}
	hits, err := st.SearchDocs(r.URL.Query().Get("q"))
	if err != nil {
		s.errOf(w, r, 500, err)
		return
	}
	writeJSON(w, map[string]any{"hits": hits})
}
