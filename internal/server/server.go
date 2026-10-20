package server

import (
	"bytes"
	"encoding/json"
	"fmt"
	"github.com/nonex-code/vellum/internal/i18n"
	"io"
	"io/fs"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode"

	"github.com/nonex-code/vellum/internal/config"
	"github.com/nonex-code/vellum/internal/gitrepo"
	"github.com/nonex-code/vellum/internal/mcp"
	"github.com/nonex-code/vellum/internal/model"
	"github.com/nonex-code/vellum/internal/store"
	"github.com/nonex-code/vellum/internal/update"
)

// Options 服务端配置。
type Options struct {
	ProjectsDir string // 远端克隆根目录
	Push        bool   // 提交后是否推送
	Web         fs.FS  // 前端静态资源
	MaxUploadMB int
	AuthUser    string // 可选 HTTP Basic Auth
	AuthPass    string
	WebhookURL  string // 可选覆盖 workbench.yaml 中的 webhook

	Version           string // 当前版本号（-ldflags 注入）
	UpdateRepo        string // GitHub 仓库 owner/name
	UpdateEnabled     bool   // 是否启用自更新接口
	UpdateAllowRemote bool   // 是否允许非本机发起更新

	MCPEnabled bool   // 是否暴露 MCP 端点 /mcp（给 AI 助手读写工作台）
	MCPToken   string // 非空时 /mcp 要求 Authorization: Bearer <token>
}

// repoEntry 是“已知仓库”的一条记录，持久化在 repos.json。
type repoEntry struct {
	Name       string `json:"name"`
	Path       string `json:"path"`
	Remote     string `json:"remote,omitempty"`
	Mode       string `json:"mode"`
	LastOpened string `json:"lastOpened"`
}

// Server 持有当前活动仓库与 schema。
type Server struct {
	opts Options
	mux  *http.ServeMux
	mu   sync.RWMutex

	cfg       model.Config // 仓库级配置（默认+仓库 workbench.yaml）
	projCfg   model.Config // 生效配置（再叠加当前项目 workbench.yaml）
	store     *store.Store
	repo      *gitrepo.Repo
	repoRoot  string // git 仓库根（项目集）
	root      string // 当前项目根（issues 所在目录）
	projectID string // 当前项目 id（multi 模式）

	reposFile string
	reposMu   sync.Mutex
	repos     []repoEntry

	updater *update.Updater // 非 nil 时启用自更新接口

	mcpSrv *mcp.Server // 非 nil 时暴露 MCP 端点
}

// New 构造服务并注册路由。
func New(o Options) *Server {
	if o.ProjectsDir == "" {
		o.ProjectsDir = "data"
	}
	if o.MaxUploadMB <= 0 {
		o.MaxUploadMB = 20
	}
	s := &Server{
		opts:      o,
		cfg:       config.Default(),
		projCfg:   config.Default(),
		reposFile: filepath.Join(o.ProjectsDir, "repos.json"),
	}
	s.repos = s.loadRepos()
	if o.UpdateEnabled {
		s.updater = update.New(o.UpdateRepo)
	}
	if o.MCPEnabled {
		s.mcpSrv = s.buildMCPServer()
	}
	s.routes()
	return s
}

func (s *Server) routes() {
	m := http.NewServeMux()
	m.HandleFunc("GET /api/repo", s.handleRepo)
	m.HandleFunc("POST /api/open", s.handleOpen)
	m.HandleFunc("POST /api/workspace", s.handleCreateWorkspace)
	m.HandleFunc("POST /api/remote", s.handleSetRemote)
	m.HandleFunc("POST /api/sync", s.handleSync)
	m.HandleFunc("GET /api/schema", s.handleSchema)
	m.HandleFunc("GET /api/overview", s.handleOverview)
	m.HandleFunc("GET /api/projects", s.handleProjects)
	m.HandleFunc("POST /api/projects", s.handleCreateProject)
	m.HandleFunc("GET /api/repos", s.handleRepos)
	m.HandleFunc("POST /api/select", s.handleSelectProject)
	m.HandleFunc("GET /api/issues", s.handleList)
	m.HandleFunc("POST /api/issues", s.handleCreate)
	m.HandleFunc("GET /api/issues/{id}", s.handleGet)
	m.HandleFunc("PATCH /api/issues/{id}", s.handlePatch)
	m.HandleFunc("DELETE /api/issues/{id}", s.handleDelete)
	m.HandleFunc("POST /api/issues/{id}/entries", s.handleAddEntry)
	m.HandleFunc("POST /api/issues/{id}/files", s.handleUpload)
	m.HandleFunc("GET /api/files/{id}/{path...}", s.handleFile)
	m.HandleFunc("GET /api/search", s.handleSearch)
	m.HandleFunc("GET /api/gantt", s.handleGantt)
	m.HandleFunc("GET /api/projects/stats", s.handleProjectStats)
	m.HandleFunc("PUT /api/projects/order", s.handleProjectOrder)
	m.HandleFunc("PATCH /api/projects/{id}", s.handleRenameProject)
	m.HandleFunc("DELETE /api/projects/{id}", s.handleArchiveProject)
	m.HandleFunc("POST /api/config/mode", s.handleConfigMode)
	m.HandleFunc("GET /api/config/raw", s.handleConfigRawGet)
	m.HandleFunc("PUT /api/config/raw", s.handleConfigRawPut)
	m.HandleFunc("GET /api/docs", s.handleDocsList)
	m.HandleFunc("POST /api/docs", s.handleDocsCreate)
	m.HandleFunc("GET /api/docs/search", s.handleDocsSearch)
	m.HandleFunc("GET /api/version", s.handleVersion)
	// MCP 端点必须按方法注册：无方法限定的 "/mcp" 会与下面的 "GET /"（静态站点）冲突。
	// 其他方法由 mux 直接回 405（带 Allow 头）。
	m.HandleFunc("POST /mcp", s.handleMCP)
	m.HandleFunc("GET /mcp", s.handleMCP)
	m.HandleFunc("DELETE /mcp", s.handleMCP)
	m.HandleFunc("GET /api/mcp/info", s.handleMCPInfo)
	if s.updater != nil {
		m.HandleFunc("GET /api/update/check", s.handleUpdateCheck)
		m.HandleFunc("POST /api/update/apply", s.handleUpdateApply)
	}
	m.HandleFunc("GET /api/docs/doc", s.handleDocsGet)
	m.HandleFunc("PUT /api/docs/doc", s.handleDocsUpdate)
	m.HandleFunc("DELETE /api/docs/doc", s.handleDocsDelete)
	if s.opts.Web != nil {
		m.Handle("GET /", http.FileServer(http.FS(s.opts.Web)))
	}
	s.mux = m
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if s.opts.AuthUser != "" {
		u, p, ok := r.BasicAuth()
		if !ok || u != s.opts.AuthUser || p != s.opts.AuthPass {
			w.Header().Set("WWW-Authenticate", `Basic realm="vellum"`)
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
	}
	s.mux.ServeHTTP(w, r)
}

// ---------- 仓库 / 项目加载 ----------

// Open 加载仓库（本地路径或 git 地址）并读取配置。
func (s *Server) Open(repo string) error {
	repoRoot, r, err := s.prepare(repo)
	if err != nil {
		return err
	}
	cfg, err := config.Load(repoRoot)
	if err != nil {
		return err
	}
	s.mu.Lock()
	s.repoRoot, s.repo, s.cfg = repoRoot, r, cfg
	if cfg.Workspace.Mode == "multi" {
		ids := s.projectIDsLocked()
		if len(ids) == 0 {
			id, err := s.createProjectLocked("main", "默认项目", "")
			if err != nil {
				s.mu.Unlock()
				return err
			}
			ids = []string{id}
		}
		err = s.setProjectLocked(ids[0])
	} else {
		err = s.setProjectLocked("")
	}
	if err != nil {
		s.mu.Unlock()
		return err
	}
	name := cfg.Workspace.Name
	mode := cfg.Workspace.Mode
	remote := ""
	if r != nil {
		remote = r.Remote()
	}
	s.mu.Unlock()
	s.recordRepo(name, repoRoot, remote, mode)
	return nil
}

// loadRepos 读取已知仓库列表（文件不存在时返回空）。
func (s *Server) loadRepos() []repoEntry {
	data, err := os.ReadFile(s.reposFile)
	if err != nil {
		return nil
	}
	var out []repoEntry
	if err := json.Unmarshal(data, &out); err != nil {
		return nil
	}
	return out
}

// saveRepos 持久化已知仓库列表。
func (s *Server) saveRepos() {
	dir := filepath.Dir(s.reposFile)
	_ = os.MkdirAll(dir, 0o755)
	data, err := json.MarshalIndent(s.repos, "", "  ")
	if err != nil {
		return
	}
	_ = os.WriteFile(s.reposFile, data, 0o644)
}

// recordRepo 写入/更新一条已知仓库记录（按 path 去重）。
func (s *Server) recordRepo(name, path, remote, mode string) {
	if path == "" {
		return
	}
	s.reposMu.Lock()
	defer s.reposMu.Unlock()
	now := time.Now().Format(time.RFC3339)
	idx := -1
	for i, e := range s.repos {
		if e.Path == path {
			idx = i
			break
		}
	}
	if idx >= 0 {
		s.repos[idx].Name = name
		s.repos[idx].Remote = remote
		s.repos[idx].Mode = mode
		s.repos[idx].LastOpened = now
	} else {
		s.repos = append(s.repos, repoEntry{Name: name, Path: path, Remote: remote, Mode: mode, LastOpened: now})
	}
	s.saveRepos()
}

func (s *Server) prepare(repo string) (string, *gitrepo.Repo, error) {
	if isURL(repo) {
		dir := filepath.Join(s.opts.ProjectsDir, sanitizeRepoName(repo))
		r, err := gitrepo.EnsureURL(repo, dir)
		return dir, r, err
	}
	abs, err := filepath.Abs(repo)
	if err != nil {
		return "", nil, err
	}
	st, err := os.Stat(abs)
	if err != nil {
		return "", nil, i18n.New(i18n.PathNotFound, repo)
	}
	if !st.IsDir() {
		return "", nil, i18n.New(i18n.NotADir, repo)
	}
	r, err := gitrepo.EnsureLocal(abs)
	return abs, r, err
}

// setProjectLocked 切换当前项目（须持有写锁）。生效配置 = 仓库级 + 项目级合并。
func (s *Server) setProjectLocked(id string) error {
	if s.cfg.Workspace.Mode != "multi" {
		s.projectID = ""
		s.root = s.repoRoot
		merged, err := config.LoadFor(s.repoRoot, "")
		if err != nil {
			return err
		}
		s.projCfg = merged
		s.store = store.New(s.repoRoot, merged.IDPrefix, s.repo, s.opts.Push)
		return nil
	}
	dir := filepath.Join(s.repoRoot, "projects", id)
	if st, err := os.Stat(dir); err != nil || !st.IsDir() {
		return i18n.New(i18n.ProjectNotFound, id)
	}
	if err := os.MkdirAll(filepath.Join(dir, "issues"), 0o755); err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Join(dir, "meta"), 0o755); err != nil {
		return err
	}
	merged, err := config.LoadFor(s.repoRoot, id)
	if err != nil {
		return err
	}
	s.projectID = id
	s.root = dir
	s.projCfg = merged
	s.store = store.New(dir, merged.IDPrefix, s.repo, s.opts.Push)
	return nil
}

func (s *Server) projectIDsLocked() []string {
	dir := filepath.Join(s.repoRoot, "projects")
	ents, err := os.ReadDir(dir)
	if err != nil {
		return nil
	}
	var ids []string
	for _, e := range ents {
		if e.IsDir() {
			ids = append(ids, e.Name())
		}
	}
	sort.Strings(ids)
	return ids
}

func (s *Server) createProjectLocked(id, name, desc string) (string, error) {
	if id == "" {
		id = slug(name)
	}
	dir := filepath.Join(s.repoRoot, "projects", id)
	if err := os.MkdirAll(filepath.Join(dir, "issues"), 0o755); err != nil {
		return id, err
	}
	if err := os.MkdirAll(filepath.Join(dir, "meta"), 0o755); err != nil {
		return id, err
	}
	if _, err := os.Stat(filepath.Join(dir, "workbench.yaml")); err != nil {
		if err := config.InitProject(dir, id, name, desc); err != nil {
			return id, err
		}
	}
	if s.repo != nil {
		_ = s.repo.CommitAll("create project " + id)
	}
	return id, nil
}

func (s *Server) reload() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.reloadLocked()
}

// reloadLocked 重读配置并重建当前项目状态（须持有写锁）。
func (s *Server) reloadLocked() {
	if s.repoRoot == "" {
		return
	}
	cfg, err := config.Load(s.repoRoot)
	if err != nil {
		return
	}
	s.cfg = cfg
	if s.cfg.Workspace.Mode == "multi" && s.projectID != "" {
		_ = s.setProjectLocked(s.projectID)
		return
	}
	if merged, err := config.LoadFor(s.repoRoot, ""); err == nil {
		s.projCfg = merged
		s.store = store.New(s.repoRoot, merged.IDPrefix, s.repo, s.opts.Push)
	}
}

func (s *Server) activeStore() (*store.Store, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.store, s.store != nil
}

func (s *Server) snapshot() (model.Config, string, *gitrepo.Repo) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.projCfg, s.repoRoot, s.repo
}

// reqProject 解析请求要操作的项目 id：查询参数 project / 请求头 X-WB-Project 优先，
// 其次回落到服务端当前项目，最后回落到项目树的根项目 "~"。
// 兼容旧的聚合 id "*"/"all"：一律视为根项目（配合 reqInclude 展开子项目）。
func (s *Server) reqProject(r *http.Request) string {
	p := s.explicitProject(r)
	if p == "" {
		s.mu.RLock()
		p = s.projectID
		s.mu.RUnlock()
	}
	if p == "" || isAggregate(p) {
		return RootPID
	}
	return p
}

// explicitProject 取请求显式指定的项目作用域：查询参数 project 优先，其次请求头。
// 请求头值由前端 encodeURIComponent 编码（浏览器 header 仅支持 ISO-8859-1），这里还原。
func (s *Server) explicitProject(r *http.Request) string {
	if p := r.URL.Query().Get("project"); p != "" {
		return p
	}
	h := r.Header.Get("X-WB-Project")
	if h == "" {
		return ""
	}
	if dec, err := url.PathUnescape(h); err == nil {
		return dec
	}
	return h
}

// isAggregate 兼容旧接口：project=* / all 表示「根项目 + 含子项目」。
func isAggregate(pid string) bool {
	return pid == "*" || pid == "all"
}

// reqInclude 判断读请求是否要包含子项目（项目树聚合视图，如“全部任务”）。
// 显式 include=children（查询参数或请求头），或兼容旧聚合 id "*"/"all"。
func (s *Server) reqInclude(r *http.Request) bool {
	if strings.Contains(r.URL.Query().Get("include"), "children") {
		return true
	}
	if strings.Contains(r.Header.Get("X-WB-Include"), "children") {
		return true
	}
	return isAggregate(s.explicitProject(r))
}

// isMulti 返回当前仓库是否处于项目集（多项目）模式。
func (s *Server) isMulti() bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.cfg.Workspace.Mode == "multi"
}

// RootPID 是项目树根项目的保留 id，映射到仓库根目录（可与 projects/ 下的子项目并存）。
const RootPID = "~"

// resolveProjectDir 把项目 id 映射到磁盘目录：根项目 "~"/空 → 仓库根。
func resolveProjectDir(repoRoot, pid string) (string, error) {
	if pid == "" || pid == RootPID {
		return repoRoot, nil
	}
	dir := filepath.Join(repoRoot, "projects", pid)
	if st, err := os.Stat(dir); err != nil || !st.IsDir() {
		return "", i18n.New(i18n.ProjectNotFound, pid)
	}
	return dir, nil
}

// configPid 把根项目映射为空 id，使配置继承从仓库根 workbench.yaml 起。
func configPid(pid string) string {
	if pid == RootPID {
		return ""
	}
	return pid
}

// fillRootMeta 为根项目补上项目元信息（仓库级未写 project 段时用工作台名）。
func fillRootMeta(cfg *model.Config, pid string) {
	if pid != RootPID {
		return
	}
	if cfg.Project.Name == "" {
		cfg.Project = model.ProjectMeta{ID: RootPID, Name: cfg.Workspace.Name}
	} else if cfg.Project.ID == "" {
		cfg.Project.ID = RootPID
	}
}

// normPID 归一化项目 id：空取服务端当前项目，single 模式与 "*"/"all" 回落根项目。
// 第二个返回值表示该 id 原本是聚合语义（读请求据此展开子项目）。
func (s *Server) normPID(pid string) (string, bool) {
	pid = strings.TrimSpace(pid)
	agg := isAggregate(pid)
	s.mu.RLock()
	cur, mode := s.projectID, s.cfg.Workspace.Mode
	s.mu.RUnlock()
	if mode != "multi" {
		return RootPID, agg
	}
	if pid == "" {
		if cur != "" {
			return cur, false
		}
		return RootPID, false
	}
	if agg {
		return RootPID, true
	}
	return pid, false
}

// projectScope 返回请求项目对应的 issues 根目录、生效配置与 git 仓库。
func (s *Server) projectScope(r *http.Request) (string, model.Config, *gitrepo.Repo, error) {
	return s.scopeFor(s.reqProject(r))
}

// scopeFor 按项目 id 返回 issues 根目录、生效配置与 git 仓库（不依赖请求对象，MCP 也用它）。
// 根项目落在仓库根；子项目落在 projects/<id>。single 模式恒为根项目。
func (s *Server) scopeFor(pid string) (string, model.Config, *gitrepo.Repo, error) {
	s.mu.RLock()
	repoRoot, repo, mode := s.repoRoot, s.repo, s.cfg.Workspace.Mode
	s.mu.RUnlock()
	if repoRoot == "" {
		return "", model.Config{}, nil, i18n.New(i18n.NoRepo)
	}
	if mode != "multi" || pid == "" {
		pid = RootPID
	}
	root, err := resolveProjectDir(repoRoot, pid)
	if err != nil {
		return "", model.Config{}, nil, err
	}
	cfg, err := config.LoadFor(repoRoot, configPid(pid))
	if err != nil {
		return "", model.Config{}, nil, err
	}
	fillRootMeta(&cfg, pid)
	return root, cfg, repo, nil
}

// storeFor 构造请求项目对应的 store（不改变服务端全局状态）。
func (s *Server) storeFor(r *http.Request) (*store.Store, model.Config, error) {
	root, cfg, repo, err := s.projectScope(r)
	if err != nil {
		return nil, cfg, err
	}
	return store.New(root, cfg.IDPrefix, repo, s.opts.Push), cfg, nil
}

// cfgFor 只取请求项目的生效配置（schema、配置中心用）。
func (s *Server) cfgFor(r *http.Request) (model.Config, error) {
	_, cfg, _, err := s.projectScope(r)
	return cfg, err
}

// issuesFor 返回请求作用域下的任务列表与生效配置。
func (s *Server) issuesFor(r *http.Request) ([]model.Issue, model.Config, error) {
	return s.issuesForPID(s.reqProject(r), s.reqInclude(r))
}

// issuesForPID 返回指定项目作用域下的任务列表与生效配置。
// include 为真时（且多项目模式）聚合根项目及其子项目，并回填每条任务的 Project。
func (s *Server) issuesForPID(pid string, include bool) ([]model.Issue, model.Config, error) {
	s.mu.RLock()
	repoRoot, mode := s.repoRoot, s.cfg.Workspace.Mode
	s.mu.RUnlock()
	if repoRoot == "" {
		return nil, model.Config{}, i18n.New(i18n.NoRepo)
	}
	if include && mode == "multi" {
		return s.collectIssues(pid)
	}
	root, cfg, repo2, err := s.scopeFor(pid)
	if err != nil {
		return nil, cfg, err
	}
	st := store.New(root, cfg.IDPrefix, repo2, s.opts.Push)
	issues, err := st.ListIssues()
	return issues, cfg, err
}

// collectIssues 收集项目及（根项目时）其子项目的任务，并回填 Project 字段。
func (s *Server) collectIssues(pid string) ([]model.Issue, model.Config, error) {
	s.mu.RLock()
	repoRoot, repo := s.repoRoot, s.repo
	s.mu.RUnlock()
	cfg, err := config.LoadFor(repoRoot, configPid(pid))
	if err != nil {
		return nil, cfg, err
	}
	fillRootMeta(&cfg, pid)
	ids := []string{pid}
	if pid == RootPID {
		ents, err := os.ReadDir(filepath.Join(repoRoot, "projects"))
		if err == nil {
			var children []string
			for _, e := range ents {
				if e.IsDir() {
					children = append(children, e.Name())
				}
			}
			sort.Strings(children)
			ids = append(ids, children...)
		}
	}
	out := []model.Issue{}
	for _, id := range ids {
		dir, err := resolveProjectDir(repoRoot, id)
		if err != nil {
			continue
		}
		if id != RootPID {
			if _, err := os.Stat(filepath.Join(dir, ".archived")); err == nil {
				continue // 归档项目不参与聚合
			}
		}
		pcfg, err := config.LoadFor(repoRoot, configPid(id))
		if err != nil {
			continue
		}
		st := store.New(dir, pcfg.IDPrefix, repo, false)
		issues, err := st.ListIssues()
		if err != nil {
			continue
		}
		for i := range issues {
			issues[i].Project = id
		}
		out = append(out, issues...)
	}
	return out, cfg, nil
}

func (s *Server) projectsMeta() []model.ProjectMeta {
	s.mu.RLock()
	repoRoot := s.repoRoot
	s.mu.RUnlock()
	dir := filepath.Join(repoRoot, "projects")
	ents, err := os.ReadDir(dir)
	if err != nil {
		return []model.ProjectMeta{}
	}
	out := make([]model.ProjectMeta, 0, len(ents))
	for _, e := range ents {
		if !e.IsDir() {
			continue
		}
		if _, err := os.Stat(filepath.Join(dir, e.Name(), ".archived")); err == nil {
			continue // 归档项目不在切换器中显示
		}
		meta := model.ProjectMeta{ID: e.Name(), Name: e.Name()}
		if c, err := config.Load(filepath.Join(dir, e.Name())); err == nil && c.Project.Name != "" {
			meta = c.Project
			meta.ID = e.Name()
		}
		out = append(out, meta)
	}
	po := loadProjectOrder(repoRoot)
	sortProjects(out, po)
	return out
}

// projectOrder 是项目集里项目的自定义顺序与收藏（置顶）列表，
// 持久化在 projects/.order.json（隐藏文件，目录扫描时会跳过）。
type projectOrder struct {
	Pinned []string `json:"pinned"`
	Order  []string `json:"order"`
}

func loadProjectOrder(repoRoot string) projectOrder {
	var po projectOrder
	if repoRoot == "" {
		return po
	}
	b, err := os.ReadFile(filepath.Join(repoRoot, "projects", ".order.json"))
	if err == nil {
		_ = json.Unmarshal(b, &po)
	}
	return po
}

func saveProjectOrder(repoRoot string, po projectOrder) error {
	dir := filepath.Join(repoRoot, "projects")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	b, err := json.MarshalIndent(po, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(dir, ".order.json"), b, 0o644)
}

func projectRanks(po projectOrder) (pinRank, ordRank map[string]int) {
	pinRank = make(map[string]int, len(po.Pinned))
	for i, id := range po.Pinned {
		pinRank[id] = i
	}
	ordRank = make(map[string]int, len(po.Order))
	for i, id := range po.Order {
		ordRank[id] = i
	}
	return
}

// projectLess 排序规则：收藏优先 → 自定义顺序 → 未列出的排后 → 名称。
func projectLess(a, b string, pinRank, ordRank map[string]int) bool {
	pa, ap := pinRank[a]
	pb, bp := pinRank[b]
	if ap != bp {
		return ap
	}
	if ap && bp && pa != pb {
		return pa < pb
	}
	ra, aok := ordRank[a]
	rb, bok := ordRank[b]
	if aok != bok {
		return aok
	}
	if aok && bok && ra != rb {
		return ra < rb
	}
	return a < b
}

func sortProjects(out []model.ProjectMeta, po projectOrder) {
	pinRank, ordRank := projectRanks(po)
	sort.SliceStable(out, func(i, j int) bool {
		return projectLess(out[i].ID, out[j].ID, pinRank, ordRank)
	})
}

// fire 异步投递 webhook（尽力而为）。
func (s *Server) fire(event string, payload map[string]any) {
	s.mu.RLock()
	url := s.projCfg.Webhook.URL
	if s.opts.WebhookURL != "" {
		url = s.opts.WebhookURL
	}
	events := s.projCfg.Webhook.Events
	proj := s.projectID
	s.mu.RUnlock()
	if url == "" {
		return
	}
	if len(events) > 0 && !containsStr(events, event) && !containsStr(events, "*") {
		return
	}
	body, _ := json.Marshal(map[string]any{
		"event":   event,
		"project": proj,
		"at":      time.Now().Format(time.RFC3339),
		"data":    payload,
	})
	go func() {
		req, err := http.NewRequest("POST", url, bytes.NewReader(body))
		if err != nil {
			return
		}
		req.Header.Set("Content-Type", "application/json")
		resp, err := (&http.Client{Timeout: 5 * time.Second}).Do(req)
		if err == nil {
			_ = resp.Body.Close()
		}
	}()
}

func containsStr(list []string, v string) bool {
	for _, x := range list {
		if x == v {
			return true
		}
	}
	return false
}

// ---------- handlers ----------

func (s *Server) handleRepo(w http.ResponseWriter, r *http.Request) {
	s.mu.RLock()
	loaded := s.repoRoot != ""
	ws := s.cfg.Workspace
	meta := s.projCfg.Project
	pid := s.projectID
	root := s.root
	repo := s.repo
	s.mu.RUnlock()

	resp := map[string]any{"loaded": loaded}
	if loaded {
		resp["root"] = root
		resp["repoRoot"] = s.snapshotRoot()
		resp["project"] = ws
		resp["mode"] = ws.Mode
		resp["currentProject"] = pid
		resp["projectMeta"] = meta
		if repo != nil {
			rem := repo.Remote()
			resp["remote"] = rem
			resp["hasRemote"] = rem != ""
			resp["head"] = repo.Head()
		}
		if ws.Mode == "multi" {
			resp["projects"] = s.projectsMeta()
			resp["pinned"] = loadProjectOrder(s.snapshotRoot()).Pinned
		}
	}
	writeJSON(w, resp)
}

func (s *Server) snapshotRoot() string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.repoRoot
}

func (s *Server) handleOpen(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Repo string `json:"repo"`
	}
	if err := readJSON(r, &in); err != nil {
		s.errOf(w, r, 400, err)
		return
	}
	if strings.TrimSpace(in.Repo) == "" {
		s.err(w, r, 400, i18n.RepoURLRequired)
		return
	}
	if err := s.Open(in.Repo); err != nil {
		s.errOf(w, r, 400, err)
		return
	}
	cfg, _, _ := s.snapshot()
	writeJSON(w, map[string]any{"ok": true, "schema": cfg})
}

// handleCreateWorkspace 从零创建一个本地工作台（可选关联远程）。
func (s *Server) handleCreateWorkspace(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Name   string `json:"name"`
		Dir    string `json:"dir"`
		Remote string `json:"remote"`
		Prefix string `json:"prefix"`
		Mode   string `json:"mode"`
	}
	if err := readJSON(r, &in); err != nil {
		s.errOf(w, r, 400, err)
		return
	}
	name := strings.TrimSpace(in.Name)
	if name == "" {
		name = "我的工作台"
	}
	mode := in.Mode
	if mode != "multi" {
		mode = "single"
	}

	dir := strings.TrimSpace(in.Dir)
	if dir == "" {
		dir = uniqueDir(filepath.Join(s.opts.ProjectsDir, slug(name)))
	}
	abs, err := filepath.Abs(dir)
	if err != nil {
		s.errOf(w, r, 400, err)
		return
	}
	if err := os.MkdirAll(abs, 0o755); err != nil {
		s.errOf(w, r, 500, err)
		return
	}
	rp, err := gitrepo.EnsureLocal(abs)
	if err != nil {
		s.errOf(w, r, 500, err)
		return
	}
	if err := config.Init(abs, name, strings.TrimSpace(in.Prefix), mode); err != nil {
		s.errOf(w, r, 500, err)
		return
	}
	_ = rp.CommitAll("init workspace")

	pushErr := ""
	if remote := strings.TrimSpace(in.Remote); remote != "" {
		if err := rp.SetRemote(remote); err != nil {
			pushErr = err.Error()
		} else if err := rp.Push(); err != nil {
			pushErr = err.Error()
		}
	}
	if err := s.Open(abs); err != nil {
		s.errOf(w, r, 500, err)
		return
	}
	cfg, _, _ := s.snapshot()
	writeJSON(w, map[string]any{"ok": true, "schema": cfg, "root": abs, "pushError": pushErr})
}

// handleSetRemote 为当前工作台设置远程仓库并尝试推送（本地实验后再备份到远端）。
func (s *Server) handleSetRemote(w http.ResponseWriter, r *http.Request) {
	s.mu.RLock()
	repo, root := s.repo, s.repoRoot
	s.mu.RUnlock()
	if root == "" || repo == nil {
		s.err(w, r, 400, i18n.NoWorkspace)
		return
	}
	var in struct {
		URL string `json:"url"`
	}
	if err := readJSON(r, &in); err != nil {
		s.errOf(w, r, 400, err)
		return
	}
	url := strings.TrimSpace(in.URL)
	if url == "" {
		s.err(w, r, 400, i18n.RepoURLRequired)
		return
	}
	if err := repo.SetRemote(url); err != nil {
		s.errOf(w, r, 500, err)
		return
	}
	pushErr := ""
	if err := repo.Push(); err != nil {
		pushErr = err.Error()
	}
	writeJSON(w, map[string]any{"ok": true, "remote": url, "pushError": pushErr})
}

func (s *Server) handleSync(w http.ResponseWriter, r *http.Request) {
	s.mu.RLock()
	repo := s.repo
	s.mu.RUnlock()
	if repo == nil {
		s.err(w, r, 400, i18n.NoRepo)
		return
	}
	if err := repo.Pull(); err != nil {
		s.errOf(w, r, 500, err)
		return
	}
	s.reload()
	writeJSON(w, map[string]any{"ok": true})
}

func (s *Server) handleSchema(w http.ResponseWriter, r *http.Request) {
	cfg, err := s.cfgFor(r)
	if err != nil {
		s.errOf(w, r, 400, err)
		return
	}
	writeJSON(w, cfg)
}

// handleOverview 汇总首页所需的统计、需关注任务与最近动态。
func (s *Server) handleOverview(w http.ResponseWriter, r *http.Request) {
	issues, cfg, err := s.issuesFor(r)
	if err != nil {
		s.errOf(w, r, 400, err)
		return
	}
	st, _, err := s.storeFor(r)
	if err != nil {
		s.errOf(w, r, 400, err)
		return
	}
	recent, _ := st.RecentActivity(8)

	cat := func(sid string) string {
		for _, sc := range cfg.Statuses {
			if sc.ID == sid {
				return sc.Category
			}
		}
		return ""
	}
	prioRank := map[string]int{}
	for i, p := range cfg.Priorities {
		prioRank[p.ID] = i
	}

	weekAgo := time.Now().AddDate(0, 0, -7)
	counts := map[string]int{"total": len(issues), "todo": 0, "active": 0, "done": 0}
	byStatus := make([]map[string]any, 0, len(cfg.Statuses))
	for _, sc := range cfg.Statuses {
		n := 0
		for _, iss := range issues {
			if iss.Status == sc.ID {
				n++
			}
		}
		byStatus = append(byStatus, map[string]any{"id": sc.ID, "name": sc.Name, "color": sc.Color, "category": sc.Category, "count": n})
	}
	byPriority := make([]map[string]any, 0, len(cfg.Priorities))
	for _, p := range cfg.Priorities {
		n := 0
		for _, iss := range issues {
			if iss.Priority == p.ID {
				n++
			}
		}
		byPriority = append(byPriority, map[string]any{"id": p.ID, "name": p.Name, "color": p.Color, "count": n})
	}

	focus := make([]model.Issue, 0)
	active := make([]model.Issue, 0)
	stale := make([]model.Issue, 0)
	assignees := map[string]int{}
	weekCreated, weekDone := 0, 0
	for _, iss := range issues {
		c := cat(iss.Status)
		if c == "done" {
			counts["done"]++
			if t, err := time.Parse(time.RFC3339, iss.Updated); err == nil && t.After(weekAgo) {
				weekDone++
			}
		} else if c == "active" {
			counts["active"]++
			active = append(active, iss)
		} else {
			counts["todo"]++
		}
		if t, err := time.Parse(time.RFC3339, iss.Created); err == nil && t.After(weekAgo) {
			weekCreated++
		}
		if c != "done" {
			r := prioRank[iss.Priority]
			if iss.Priority == "urgent" || (iss.Priority != "" && r <= 1) {
				focus = append(focus, iss)
			}
			if iss.Assignee != "" {
				assignees[iss.Assignee]++
			}
			if t, err := time.Parse(time.RFC3339, iss.Updated); err == nil && t.Before(time.Now().AddDate(0, 0, -7)) {
				stale = append(stale, iss)
			}
		}
	}
	sortIssues(focus, "priority", "asc", prioRank)
	sortIssues(active, "updated", "desc", prioRank)
	sortIssues(stale, "updated", "asc", prioRank)
	if len(focus) > 6 {
		focus = focus[:6]
	}
	if len(active) > 6 {
		active = active[:6]
	}
	if len(stale) > 5 {
		stale = stale[:5]
	}

	type msStat struct {
		ID    string `json:"id"`
		Name  string `json:"name"`
		Total int    `json:"total"`
		Done  int    `json:"done"`
	}
	milestones := make([]msStat, 0, len(cfg.Milestones))
	for _, m := range cfg.Milestones {
		stat := msStat{ID: m.ID, Name: m.Name}
		for _, iss := range issues {
			if iss.Milestone == m.ID {
				stat.Total++
				if cat(iss.Status) == "done" {
					stat.Done++
				}
			}
		}
		milestones = append(milestones, stat)
	}

	writeJSON(w, map[string]any{
		"counts":      counts,
		"byStatus":    byStatus,
		"byPriority":  byPriority,
		"focus":       focus,
		"active":      active,
		"stale":       stale,
		"assignees":   assignees,
		"weekCreated": weekCreated,
		"weekDone":    weekDone,
		"milestones":  milestones,
		"recent":      recent,
	})
}

func (s *Server) handleProjects(w http.ResponseWriter, r *http.Request) {
	s.mu.RLock()
	cur := s.projectID
	loaded := s.repoRoot != ""
	s.mu.RUnlock()
	if !loaded {
		s.err(w, r, 400, i18n.NoRepo)
		return
	}
	writeJSON(w, map[string]any{"projects": s.projectsMeta(), "current": cur})
}

// handleRepos 返回已知仓库列表与当前活动仓库。
func (s *Server) handleRepos(w http.ResponseWriter, r *http.Request) {
	s.mu.RLock()
	cur := s.repoRoot
	s.mu.RUnlock()
	s.reposMu.Lock()
	list := make([]repoEntry, len(s.repos))
	copy(list, s.repos)
	s.reposMu.Unlock()
	sort.SliceStable(list, func(i, j int) bool { return list[i].LastOpened > list[j].LastOpened })
	writeJSON(w, map[string]any{"repos": list, "current": cur})
}

func (s *Server) handleCreateProject(w http.ResponseWriter, r *http.Request) {
	var in struct {
		ID          string `json:"id"`
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
	if s.repoRoot == "" {
		s.mu.Unlock()
		s.err(w, r, 400, i18n.NoRepo)
		return
	}
	if s.cfg.Workspace.Mode != "multi" {
		s.mu.Unlock()
		s.err(w, r, 400, i18n.SingleModeOnly)
		return
	}
	err := error(nil)
	newID := ""
	newID, err = s.createProjectLocked(in.ID, in.Name, in.Description)
	if err == nil {
		err = s.setProjectLocked(newID)
	}
	s.mu.Unlock()
	if err != nil {
		s.errOf(w, r, 500, err)
		return
	}
	s.fire("project.create", map[string]any{"project": in.Name})
	writeJSON(w, map[string]any{"ok": true, "projects": s.projectsMeta()})
}

func (s *Server) handleSelectProject(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Project string `json:"project"`
	}
	if err := readJSON(r, &in); err != nil {
		s.errOf(w, r, 400, err)
		return
	}
	s.mu.Lock()
	if s.repoRoot == "" {
		s.mu.Unlock()
		s.err(w, r, 400, i18n.NoRepo)
		return
	}
	err := s.setProjectLocked(in.Project)
	s.mu.Unlock()
	if err != nil {
		s.errOf(w, r, 400, err)
		return
	}
	writeJSON(w, map[string]any{"ok": true})
}

func (s *Server) handleList(w http.ResponseWriter, r *http.Request) {
	issues, cfg, err := s.issuesFor(r)
	if err != nil {
		s.errOf(w, r, 400, err)
		return
	}
	prioRank := map[string]int{}
	for i, p := range cfg.Priorities {
		prioRank[p.ID] = i
	}

	q := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("q")))
	status := r.URL.Query().Get("status")
	priority := r.URL.Query().Get("priority")
	typ := r.URL.Query().Get("type")
	assignee := r.URL.Query().Get("assignee")
	label := r.URL.Query().Get("label")
	milestone := r.URL.Query().Get("milestone")
	by := r.URL.Query().Get("sort")
	order := r.URL.Query().Get("order")

	out := make([]model.Issue, 0, len(issues))
	for _, iss := range issues {
		if status != "" && iss.Status != status {
			continue
		}
		if priority != "" && iss.Priority != priority {
			continue
		}
		if typ != "" && iss.Type != typ {
			continue
		}
		if assignee != "" && iss.Assignee != assignee {
			continue
		}
		if milestone != "" && iss.Milestone != milestone {
			continue
		}
		if label != "" && !containsStr(iss.Labels, label) {
			continue
		}
		if q != "" && !strings.Contains(strings.ToLower(iss.ID+" "+iss.Title+" "+iss.Body+" "+strings.Join(iss.Labels, " ")), q) {
			continue
		}
		out = append(out, iss)
	}
	sortIssues(out, by, order, prioRank)
	writeJSON(w, map[string]any{"issues": out})
}

func sortIssues(list []model.Issue, by, order string, prioRank map[string]int) {
	dir := order
	if dir == "" {
		if by == "title" || by == "priority" {
			dir = "asc"
		} else {
			dir = "desc"
		}
	}
	sort.SliceStable(list, func(i, j int) bool {
		a, b := list[i], list[j]
		switch by {
		case "priority":
			ra, rb := prioRank[a.Priority], prioRank[b.Priority]
			if ra != rb {
				if dir == "desc" {
					return ra > rb
				}
				return ra < rb
			}
			return a.Updated > b.Updated
		case "title":
			if dir == "desc" {
				return a.Title > b.Title
			}
			return a.Title < b.Title
		case "created":
			if dir == "asc" {
				return a.Created < b.Created
			}
			return a.Created > b.Created
		default:
			if dir == "asc" {
				return a.Updated < b.Updated
			}
			return a.Updated > b.Updated
		}
	})
}

func (s *Server) handleSearch(w http.ResponseWriter, r *http.Request) {
	hits, err := s.searchHitsFor(s.reqProject(r), s.reqInclude(r), r.URL.Query().Get("q"))
	if err != nil {
		s.errOf(w, r, 400, err)
		return
	}
	writeJSON(w, map[string]any{"hits": hits})
}

// searchHitsFor 在指定项目作用域检索任务；根项目 + include 时聚合未归档的子项目。
func (s *Server) searchHitsFor(pid string, include bool, q string) ([]store.SearchHit, error) {
	s.mu.RLock()
	repoRoot, repo, mode := s.repoRoot, s.repo, s.cfg.Workspace.Mode
	s.mu.RUnlock()
	if repoRoot == "" {
		return nil, i18n.New(i18n.NoRepo)
	}
	if !(include && mode == "multi" && pid == RootPID) {
		root, cfg, pRepo, err := s.scopeFor(pid)
		if err != nil {
			return nil, err
		}
		return store.New(root, cfg.IDPrefix, pRepo, s.opts.Push).Search(q)
	}
	out := []store.SearchHit{}
	ids := []string{RootPID}
	ents, err := os.ReadDir(filepath.Join(repoRoot, "projects"))
	if err == nil {
		for _, e := range ents {
			if e.IsDir() {
				ids = append(ids, e.Name())
			}
		}
	}
	for _, id := range ids {
		pdir, err := resolveProjectDir(repoRoot, id)
		if err != nil {
			continue
		}
		if id != RootPID {
			if _, err := os.Stat(filepath.Join(pdir, ".archived")); err == nil {
				continue
			}
		}
		pcfg, err := config.LoadFor(repoRoot, configPid(id))
		if err != nil {
			continue
		}
		hits, err := store.New(pdir, pcfg.IDPrefix, repo, false).Search(q)
		if err != nil {
			continue
		}
		for i := range hits {
			hits[i].Issue.Project = id
		}
		out = append(out, hits...)
	}
	return out, nil
}

func (s *Server) handleCreate(w http.ResponseWriter, r *http.Request) {
	st, cfg, err := s.storeFor(r)
	if err != nil {
		s.errOf(w, r, 400, err)
		return
	}
	_ = cfg
	var in struct {
		Title     string            `json:"title"`
		Body      string            `json:"body"`
		Status    string            `json:"status"`
		Priority  string            `json:"priority"`
		Type      string            `json:"type"`
		Assignee  string            `json:"assignee"`
		Labels    []string          `json:"labels"`
		Milestone string            `json:"milestone"`
		Parent    string            `json:"parent"`
		Fields    map[string]string `json:"fields"`
		Start     string            `json:"start"`
		Due       string            `json:"due"`
	}
	if err := readJSON(r, &in); err != nil {
		s.errOf(w, r, 400, err)
		return
	}
	if strings.TrimSpace(in.Title) == "" {
		s.err(w, r, 400, i18n.TitleRequired)
		return
	}
	iss, err := st.CreateIssue(model.Issue{
		Title: in.Title, Body: in.Body, Status: in.Status,
		Priority: in.Priority, Type: in.Type, Assignee: in.Assignee,
		Labels: in.Labels, Milestone: in.Milestone, Parent: in.Parent, Fields: in.Fields,
		Start: in.Start, Due: in.Due,
	})
	if err != nil {
		s.errOf(w, r, 500, err)
		return
	}
	s.fire("issue.create", map[string]any{"issue": iss})
	writeJSON(w, map[string]any{"issue": iss})
}

func (s *Server) handleGet(w http.ResponseWriter, r *http.Request) {
	st, _, err := s.storeFor(r)
	if err != nil {
		s.errOf(w, r, 400, err)
		return
	}
	iss, entries, err := st.ReadIssue(r.PathValue("id"))
	if err != nil {
		s.errOf(w, r, 404, err)
		return
	}
	writeJSON(w, map[string]any{"issue": iss, "entries": entries})
}

func (s *Server) handlePatch(w http.ResponseWriter, r *http.Request) {
	st, _, err := s.storeFor(r)
	if err != nil {
		s.errOf(w, r, 400, err)
		return
	}
	var patch map[string]any
	if err := readJSON(r, &patch); err != nil {
		s.errOf(w, r, 400, err)
		return
	}
	iss, err := st.UpdateIssue(r.PathValue("id"), patch)
	if err != nil {
		s.errOf(w, r, 500, err)
		return
	}
	s.fire("issue.update", map[string]any{"issue": iss, "patch": patch})
	writeJSON(w, map[string]any{"issue": iss})
}

func (s *Server) handleDelete(w http.ResponseWriter, r *http.Request) {
	st, _, err := s.storeFor(r)
	if err != nil {
		s.errOf(w, r, 400, err)
		return
	}
	id := r.PathValue("id")
	if err := st.DeleteIssue(id); err != nil {
		s.errOf(w, r, 500, err)
		return
	}
	s.fire("issue.delete", map[string]any{"id": id})
	writeJSON(w, map[string]any{"ok": true})
}

func (s *Server) handleAddEntry(w http.ResponseWriter, r *http.Request) {
	st, _, err := s.storeFor(r)
	if err != nil {
		s.errOf(w, r, 400, err)
		return
	}
	var in struct {
		Body   string `json:"body"`
		Type   string `json:"type"`
		Author string `json:"author"`
	}
	if err := readJSON(r, &in); err != nil {
		s.errOf(w, r, 400, err)
		return
	}
	en, err := st.AddEntry(r.PathValue("id"), model.Entry{Body: in.Body, Type: in.Type, Author: in.Author})
	if err != nil {
		s.errOf(w, r, 500, err)
		return
	}
	s.fire("entry.create", map[string]any{"id": r.PathValue("id"), "entry": en})
	writeJSON(w, map[string]any{"entry": en})
}

func (s *Server) handleUpload(w http.ResponseWriter, r *http.Request) {
	st, _, err := s.storeFor(r)
	if err != nil {
		s.errOf(w, r, 400, err)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, int64(s.opts.MaxUploadMB)<<20)
	if err := r.ParseMultipartForm(8 << 20); err != nil {
		s.err(w, r, 400, i18n.UploadFailed, err.Error())
		return
	}
	file, hdr, err := r.FormFile("file")
	if err != nil {
		s.err(w, r, 400, i18n.MissingFile)
		return
	}
	defer file.Close()
	data, err := io.ReadAll(file)
	if err != nil {
		s.errOf(w, r, 400, err)
		return
	}
	rel, url, err := st.SaveFile(r.PathValue("id"), hdr.Filename, data)
	if err != nil {
		s.errOf(w, r, 500, err)
		return
	}
	s.fire("file.upload", map[string]any{"id": r.PathValue("id"), "path": rel, "name": hdr.Filename})
	writeJSON(w, map[string]any{"path": rel, "url": url, "name": hdr.Filename})
}

func (s *Server) handleFile(w http.ResponseWriter, r *http.Request) {
	st, _, err := s.storeFor(r)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	abs, data, err := st.ReadFile(r.PathValue("id"), r.PathValue("path"))
	if err != nil {
		http.NotFound(w, r)
		return
	}
	http.ServeContent(w, r, filepath.Base(abs), time.Time{}, bytes.NewReader(data))
}

// ---------- helpers ----------

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	_ = json.NewEncoder(w).Encode(v)
}

// ---------- 提示语与语言 ----------

// langOf 解析请求语言：前端语言开关 X-WB-Lang 优先，其次浏览器的 Accept-Language，
// 都没有时回落到仓库 workbench.yaml 的 language 字段（默认 zh）。
// 内部会加读锁，调用处不得再持有 s.mu。
func (s *Server) langOf(r *http.Request) string {
	if r != nil {
		if l := i18n.FromRequest(r); l != "" {
			return l
		}
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	if l := i18n.Normalize(s.projCfg.Language); l != "" {
		return l
	}
	return i18n.Zh
}

// err 按请求语言渲染词条后写回。
func (s *Server) err(w http.ResponseWriter, r *http.Request, code int, key string, args ...any) {
	writeErr(w, code, i18n.T(s.langOf(r), key, args...))
}

// errOf 把任意 error 按请求语言写回；非 i18n 错误（如 JSON 解析、git 输出）原样透出。
func (s *Server) errOf(w http.ResponseWriter, r *http.Request, code int, e error) {
	writeErr(w, code, i18n.Msg(s.langOf(r), e))
}

func writeErr(w http.ResponseWriter, code int, msg string) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": msg})
}

func readJSON(r *http.Request, v any) error {
	defer r.Body.Close()
	dec := json.NewDecoder(io.LimitReader(r.Body, 8<<20))
	return dec.Decode(v)
}

func isURL(s string) bool {
	return strings.Contains(s, "://") || strings.HasPrefix(s, "git@") || strings.HasPrefix(s, "ssh:")
}

func slug(s string) string {
	s = strings.TrimSpace(s)
	var b strings.Builder
	dash := false
	for _, r := range s {
		if r >= 'A' && r <= 'Z' {
			r += 'a' - 'A' // 仅折叠 ASCII 大写，避免 CJK 被错误 case-fold
		}
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9', r == '-', r == '_':
			b.WriteRune(r)
			dash = false
		case unicode.IsLetter(r) || unicode.IsDigit(r):
			b.WriteRune(r) // 保留 CJK 等非 ASCII 字母数字
			dash = false
		case r == ' ' || r == '.' || r == '/':
			if !dash && b.Len() > 0 {
				b.WriteByte('-')
				dash = true
			}
		}
	}
	out := strings.Trim(b.String(), "-")
	if out == "" {
		return "workspace"
	}
	return out
}

func uniqueDir(base string) string {
	if _, err := os.Stat(base); os.IsNotExist(err) {
		return base
	}
	for i := 2; i < 1000; i++ {
		p := fmt.Sprintf("%s-%d", base, i)
		if _, err := os.Stat(p); os.IsNotExist(err) {
			return p
		}
	}
	return base
}

func sanitizeRepoName(s string) string {
	s = strings.TrimSuffix(s, ".git")
	s = strings.TrimRight(s, "/")
	if i := strings.LastIndexAny(s, "/:"); i >= 0 {
		s = s[i+1:]
	}
	var b strings.Builder
	for _, r := range s {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9', r == '-', r == '_', r == '.':
			b.WriteRune(r)
		}
	}
	if b.Len() == 0 {
		return "repo"
	}
	return b.String()
}
