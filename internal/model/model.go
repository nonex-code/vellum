package model

// Workspace 是仓库（项目集）级信息。
type Workspace struct {
	Name string `yaml:"name" json:"name"`
	Mode string `yaml:"mode" json:"mode"` // single | multi
}

// ProjectMeta 是项目的元信息。
type ProjectMeta struct {
	ID          string `yaml:"id" json:"id"`
	Name        string `yaml:"name" json:"name"`
	Description string `yaml:"description,omitempty" json:"description,omitempty"`
}

// Status 任务状态。category 固定语义：todo | active | done
type Status struct {
	ID       string `yaml:"id" json:"id"`
	Name     string `yaml:"name" json:"name"`
	Category string `yaml:"category" json:"category"`
	Color    string `yaml:"color,omitempty" json:"color,omitempty"`
	WIP      int    `yaml:"wip,omitempty" json:"wip,omitempty"`
}

// Option 通用选项（优先级、类型、里程碑）。里程碑可选 start/end 日期（YYYY-MM-DD）。
type Option struct {
	ID    string `yaml:"id" json:"id"`
	Name  string `yaml:"name" json:"name"`
	Color string `yaml:"color,omitempty" json:"color,omitempty"`
	Order int    `yaml:"order,omitempty" json:"order,omitempty"`
	Start string `yaml:"start,omitempty" json:"start,omitempty"`
	End   string `yaml:"end,omitempty" json:"end,omitempty"`
}

// Label 标签。
type Label struct {
	ID    string `yaml:"id" json:"id"`
	Name  string `yaml:"name" json:"name"`
	Color string `yaml:"color,omitempty" json:"color,omitempty"`
}

// Field 自定义字段。type: text | number | date | select
type Field struct {
	ID      string   `yaml:"id" json:"id"`
	Name    string   `yaml:"name" json:"name"`
	Type    string   `yaml:"type" json:"type"`
	Options []string `yaml:"options,omitempty" json:"options,omitempty"`
}

// Template 新建任务模板。
type Template struct {
	ID       string   `yaml:"id" json:"id"`
	Name     string   `yaml:"name" json:"name"`
	Title    string   `yaml:"title,omitempty" json:"title,omitempty"`
	Body     string   `yaml:"body,omitempty" json:"body,omitempty"`
	Type     string   `yaml:"type,omitempty" json:"type,omitempty"`
	Priority string   `yaml:"priority,omitempty" json:"priority,omitempty"`
	Labels   []string `yaml:"labels,omitempty" json:"labels,omitempty"`
}

// Webhook 事件回调。
type Webhook struct {
	URL    string   `yaml:"url,omitempty" json:"url,omitempty"`
	Events []string `yaml:"events,omitempty" json:"events,omitempty"`
}

// Modules 功能模块开关。
type Modules struct {
	Milestones  bool   `yaml:"milestones" json:"milestones"`
	Subtasks    string `yaml:"subtasks" json:"subtasks"` // off|checklist|issue|both
	Attachments bool   `yaml:"attachments" json:"attachments"`
	Board       bool   `yaml:"board" json:"board"`
	Gantt       bool   `yaml:"gantt" json:"gantt"`
	Calendar    bool   `yaml:"calendar" json:"calendar"`
	Docs        bool   `yaml:"docs" json:"docs"`
	Tree        bool   `yaml:"tree" json:"tree"`
	Search      bool   `yaml:"search" json:"search"`
}

// Views 默认视图与导航。
type Views struct {
	Default string   `yaml:"default" json:"default"`
	Nav     []string `yaml:"nav" json:"nav"`
}

// Config 是 workbench.yaml 的完整结构（含内置默认）。
type Config struct {
	Workspace  Workspace   `yaml:"workspace" json:"workspace"`
	Project    ProjectMeta `yaml:"project,omitempty" json:"project"`
	Language   string      `yaml:"language,omitempty" json:"language"` // zh | en，界面与提示语的默认语言
	IDPrefix   string      `yaml:"idPrefix" json:"idPrefix"`
	Statuses   []Status    `yaml:"statuses" json:"statuses"`
	Priorities []Option    `yaml:"priorities" json:"priorities"`
	Labels     []Label     `yaml:"labels" json:"labels"`
	Milestones []Option    `yaml:"milestones,omitempty" json:"milestones"`
	Types      []Option    `yaml:"types" json:"types"`
	Fields     []Field     `yaml:"fields" json:"fields"`
	Templates  []Template  `yaml:"templates,omitempty" json:"templates"`
	Webhook    Webhook     `yaml:"webhook,omitempty" json:"webhook"`
	Modules    Modules     `yaml:"modules" json:"modules"`
	Views      Views       `yaml:"views" json:"views"`
}

// Issue 是任务，对应 issue.md 的 frontmatter + 正文。
type Issue struct {
	ID        string            `yaml:"id" json:"id"`
	Title     string            `yaml:"title" json:"title"`
	Status    string            `yaml:"status" json:"status"`
	Priority  string            `yaml:"priority,omitempty" json:"priority,omitempty"`
	Type      string            `yaml:"type,omitempty" json:"type,omitempty"`
	Assignee  string            `yaml:"assignee,omitempty" json:"assignee,omitempty"`
	Labels    []string          `yaml:"labels,omitempty" json:"labels,omitempty"`
	Milestone string            `yaml:"milestone,omitempty" json:"milestone,omitempty"`
	Parent    string            `yaml:"parent,omitempty" json:"parent,omitempty"`
	Fields    map[string]string `yaml:"fields,omitempty" json:"fields,omitempty"`
	Start     string            `yaml:"start,omitempty" json:"start,omitempty"`
	Due       string            `yaml:"due,omitempty" json:"due,omitempty"`
	Created   string            `yaml:"created" json:"created"`
	Updated   string            `yaml:"updated" json:"updated"`
	Body      string            `yaml:"-" json:"body"`
	Project   string            `yaml:"-" json:"project,omitempty"` // 跨项目聚合时回填，不入盘
}

// Doc 是一篇文档（wiki），对应 docs/ 下 Markdown 的 frontmatter + 正文。
type Doc struct {
	Title   string   `yaml:"title" json:"title"`
	Tags    []string `yaml:"tags,omitempty" json:"tags,omitempty"`
	Pinned  bool     `yaml:"pinned,omitempty" json:"pinned,omitempty"`
	Created string   `yaml:"created" json:"created"`
	Updated string   `yaml:"updated" json:"updated"`
	Path    string   `yaml:"-" json:"path"`
	Body    string   `yaml:"-" json:"body"`
}

// Entry 是时间线条目（跟进/状态变更/附件）。
// 条目现在内联存储在 issue.md 的同名文档里，ID 为条目在本文件中的稳定标识
// （迁移自旧 entries/*.md 时沿用原文件名，新条目为 e-<unix nano>）。
type Entry struct {
	ID      string `yaml:"id,omitempty" json:"id"`
	Author  string `yaml:"author" json:"author"`
	Created string `yaml:"created" json:"created"`
	Type    string `yaml:"type" json:"type"` // comment | status | attachment
	From    string `yaml:"from,omitempty" json:"from,omitempty"`
	To      string `yaml:"to,omitempty" json:"to,omitempty"`
	Edited  bool   `yaml:"edited,omitempty" json:"edited,omitempty"`
	Body    string `yaml:"-" json:"body"`
	// File 是条目标识的旧称（= ID），仅为兼容前端与旧 API 保留。
	File string `yaml:"-" json:"file"`
}
