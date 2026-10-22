package config

import (
	"os"
	"path/filepath"

	"gopkg.in/yaml.v3"

	"github.com/nonex-code/vellum/internal/i18n"
	"github.com/nonex-code/vellum/internal/model"
)

// Default 返回内置默认配置：空仓库零配置即可运行。
func Default() model.Config {
	return model.Config{
		Workspace: model.Workspace{Name: "Vellum", Mode: "single"},
		Language:  "zh",
		IDPrefix:  "WB",
		Statuses: []model.Status{
			{ID: "todo", Name: "待办", Category: "todo", Color: "#60a5fa"},
			{ID: "doing", Name: "进行中", Category: "active", Color: "#f59e0b"},
			{ID: "blocked", Name: "阻塞", Category: "active", Color: "#ef4444"},
			{ID: "review", Name: "待验收", Category: "active", Color: "#a855f7"},
			{ID: "done", Name: "已完成", Category: "done", Color: "#22c55e"},
			{ID: "cancelled", Name: "已取消", Category: "done", Color: "#6b7280"},
		},
		Priorities: []model.Option{
			{ID: "urgent", Name: "紧急", Color: "#ef4444", Order: 0},
			{ID: "high", Name: "高", Color: "#f97316", Order: 1},
			{ID: "medium", Name: "中", Color: "#eab308", Order: 2},
			{ID: "low", Name: "低", Color: "#64748b", Order: 3},
		},
		Labels: []model.Label{
			{ID: "bug", Name: "缺陷", Color: "#B3402B"},
			{ID: "feature", Name: "功能", Color: "#2A4C8F"},
			{ID: "docs", Name: "文档", Color: "#6B6F76"},
			{ID: "question", Name: "疑问", Color: "#B07D1E"},
		},
		Milestones: []model.Option{},
		Types: []model.Option{
			{ID: "task", Name: "任务"},
			{ID: "bug", Name: "缺陷"},
		},
		Fields: []model.Field{},
		Templates: []model.Template{
			{
				ID: "bug", Name: "缺陷报告", Type: "bug", Priority: "high",
				Labels: []string{"bug"},
				Body:   "## 现象\n\n\n## 复现\n\n1. \n\n## 期望\n\n",
			},
			{
				ID: "feature", Name: "功能需求", Type: "task",
				Labels: []string{"feature"},
				Body:   "## 背景\n\n\n## 验收标准\n\n- [ ] \n",
			},
		},
		Modules: model.Modules{
			Milestones: true, Subtasks: "both", Attachments: true,
			Board: true, Gantt: true, Calendar: true, Docs: true, Tree: true, Search: true,
		},
		Views: model.Views{Default: "list", Nav: []string{"issues", "search", "settings"}},
	}
}

// Init 在 root 写入最小 workbench.yaml（工作台名称、模式与 ID 前缀）。
func Init(root, name, prefix, mode string) error {
	if name == "" {
		name = "Vellum"
	}
	if prefix == "" {
		prefix = "WB"
	}
	if mode != "multi" {
		mode = "single"
	}
	obj := map[string]any{
		"workspace": map[string]any{"name": name, "mode": mode},
		"idPrefix":  prefix,
	}
	// 合并写入：只覆盖自己拥有的键，保留用户在这个 yaml 里手写的其他配置。
	return writeMerged(root, obj, []string{"workspace", "idPrefix"})
}

// InitProject 在项目目录写入项目元信息（projects/<id>/workbench.yaml）。
func InitProject(dir, id, name, desc string) error {
	if name == "" {
		name = id
	}
	obj := map[string]any{
		"project": map[string]any{"id": id, "name": name, "description": desc},
	}
	// 重命名/改简介只动 project 段，项目级覆盖（idPrefix、labels、modules…）要留着。
	return writeMerged(dir, obj, []string{"project"})
}

// Load 从 root 读取 workbench.yaml/.yml（可缺省），在默认值之上覆盖。
// 保持旧语义：root 下的 yaml 直接覆盖默认（仓库根即项目时可用）。
func Load(root string) (model.Config, error) {
	cfg := Default()
	if err := applyFile(&cfg, root); err != nil {
		return cfg, err
	}
	normalize(&cfg)
	return cfg, nil
}

// LoadFor 加载三层合并配置：内置默认 → 仓库根 workbench.yaml → 项目 workbench.yaml。
// projectID 为空（single 模式）时只合并前两层。
func LoadFor(root, projectID string) (model.Config, error) {
	cfg := Default()
	if err := applyFile(&cfg, root); err != nil {
		return cfg, err
	}
	// 仓库级配置里的 project 元信息保留（single 模式下即项目本身）。
	repoProject := cfg.Project
	if projectID != "" {
		if err := applyFile(&cfg, filepath.Join(root, "projects", projectID)); err != nil {
			return cfg, err
		}
		if cfg.Project.Name == "" && cfg.Project.ID == "" {
			cfg.Project = repoProject
		}
	}
	normalize(&cfg)
	return cfg, nil
}

// applyFile 把 dir/workbench.yaml(.yml) 覆盖到 cfg 上；文件不存在时跳过。
func applyFile(cfg *model.Config, dir string) error {
	for _, name := range []string{"workbench.yaml", "workbench.yml"} {
		data, err := os.ReadFile(filepath.Join(dir, name))
		if err != nil {
			continue
		}
		return yaml.Unmarshal(data, cfg)
	}
	return nil
}

func normalize(cfg *model.Config) {
	if cfg.IDPrefix == "" {
		cfg.IDPrefix = "WB"
	}
	if cfg.Workspace.Mode == "" {
		cfg.Workspace.Mode = "single"
	}
	if l := i18n.Normalize(cfg.Language); l != "" {
		cfg.Language = l
	} else {
		cfg.Language = i18n.Zh
	}
}
