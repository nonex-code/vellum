package config

import (
	"bytes"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"github.com/nonex-code/vellum/internal/i18n"

	"gopkg.in/yaml.v3"

	"github.com/nonex-code/vellum/internal/model"
)

// MergeYAMLKeys 把 incoming 合并进 existing：owned 列出的顶层键由 incoming 负责
// （incoming 里没有就删除），其余键按原位置保留。
//
// 目的是让程序写回配置时不会静默删掉用户手写在 YAML 里的段落（如 webhook）——
// 配置跟着仓库走，脱离平台也要能直接读、直接改。
func MergeYAMLKeys(existing []byte, incoming string, owned []string) (string, error) {
	base, err := mapNode(existing)
	if err != nil {
		return "", i18n.New(i18n.ConfigUnparsable, err)
	}
	inc, err := mapNode([]byte(incoming))
	if err != nil {
		return "", err
	}
	isOwned := make(map[string]bool, len(owned))
	for _, k := range owned {
		isOwned[k] = true
	}
	incVal := map[string]*yaml.Node{}
	for i := 0; i+1 < len(inc.Content); i += 2 {
		incVal[inc.Content[i].Value] = inc.Content[i+1]
	}

	out := []*yaml.Node{}
	for i := 0; i+1 < len(base.Content); i += 2 {
		key, val := base.Content[i], base.Content[i+1]
		if !isOwned[key.Value] {
			out = append(out, key, val)
			continue
		}
		if v, ok := incVal[key.Value]; ok {
			out = append(out, key, v)
			delete(incVal, key.Value)
		}
	}
	for i := 0; i+1 < len(inc.Content); i += 2 {
		key := inc.Content[i].Value
		if !isOwned[key] {
			continue // incoming 里的非托管键不参与本次合并
		}
		if v, ok := incVal[key]; ok {
			out = append(out, inc.Content[i], v)
		}
	}

	return encodeMapping(out)
}

// PruneInherited 剔除项目级配置里与仓库生效配置取值相同的托管键，
// 让 projects/<id>/workbench.yaml 只留下真正的项目级覆盖——
// 否则每次表单保存都会把整份生效配置抄进项目文件，继承关系既读不懂也改不动。
// workspace 是仓库级概念，项目级不写；project 段是项目身份，始终保留。
func PruneInherited(data string, repoCfg model.Config, owned []string) (string, error) {
	repoYAML, err := yaml.Marshal(repoCfg)
	if err != nil {
		return "", err
	}
	base := map[string]any{}
	if err := yaml.Unmarshal(repoYAML, &base); err != nil {
		return "", err
	}
	node, err := mapNode([]byte(data))
	if err != nil {
		return "", err
	}
	isOwned := make(map[string]bool, len(owned))
	for _, k := range owned {
		isOwned[k] = true
	}

	out := []*yaml.Node{}
	for i := 0; i+1 < len(node.Content); i += 2 {
		key, val := node.Content[i], node.Content[i+1]
		if !isOwned[key.Value] || key.Value == "project" {
			out = append(out, key, val)
			continue
		}
		if key.Value == "workspace" {
			continue
		}
		var v any
		if err := val.Decode(&v); err != nil {
			return "", err
		}
		if reflect.DeepEqual(base[key.Value], v) {
			continue
		}
		out = append(out, key, val)
	}
	if len(out) == 0 {
		return "# 该项目无配置覆盖，全部沿用仓库 workbench.yaml。\n", nil
	}
	return encodeMapping(out)
}

// encodeMapping 把键值节点序列化为 2 空格缩进的 YAML。
func encodeMapping(pairs []*yaml.Node) (string, error) {
	var buf bytes.Buffer
	enc := yaml.NewEncoder(&buf)
	enc.SetIndent(2)
	if err := enc.Encode(&yaml.Node{
		Kind: yaml.DocumentNode,
		Content: []*yaml.Node{{
			Kind: yaml.MappingNode, Tag: "!!map", Content: pairs,
		}},
	}); err != nil {
		return "", err
	}
	if err := enc.Close(); err != nil {
		return "", err
	}
	return buf.String(), nil
}

// mapNode 解析成顶层映射节点；空内容返回空映射。
func mapNode(data []byte) (*yaml.Node, error) {
	if len(strings.TrimSpace(string(data))) == 0 {
		return &yaml.Node{Kind: yaml.MappingNode, Tag: "!!map"}, nil
	}
	var n yaml.Node
	if err := yaml.Unmarshal(data, &n); err != nil {
		return nil, err
	}
	m := &n
	if n.Kind == yaml.DocumentNode {
		if len(n.Content) == 0 {
			return &yaml.Node{Kind: yaml.MappingNode, Tag: "!!map"}, nil
		}
		m = n.Content[0]
	}
	if m.Kind != yaml.MappingNode {
		return nil, i18n.New(i18n.ConfigNotMapping)
	}
	return m, nil
}

// writeMerged 把 obj 序列化为 YAML 并与 dir/workbench.yaml 按 owned 键合并后写回。
func writeMerged(dir string, obj map[string]any, owned []string) error {
	data, err := yaml.Marshal(obj)
	if err != nil {
		return err
	}
	p := filepath.Join(dir, "workbench.yaml")
	existing, _ := os.ReadFile(p)
	merged, err := MergeYAMLKeys(existing, string(data), owned)
	if err != nil {
		// 现有文件解析不了时退回整份覆盖，保证写入不被坏配置卡住。
		merged = string(data)
	}
	return os.WriteFile(p, []byte(merged), 0o644)
}
