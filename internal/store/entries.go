package store

import (
	"fmt"
	"sort"
	"strings"
	"time"

	"gopkg.in/yaml.v3"

	"github.com/nonex-code/vellum/internal/model"
)

// 时间线内联在 issue.md 正文中，每条目由「可见标题行 + 隐藏元数据」组成：
//
//	任务描述……
//
//	<!-- vellum:entries -->
//
//	#### 2025-10-22 10:15 · me
//	<!-- vellum:meta id=0001-20251022T101500-me type=comment -->
//	跟进正文……
//
// 设计要点：
//   - 标题行是普通 Markdown，渲染后能看到时间、作者、状态变更文字；
//   - 元数据藏在紧跟标题行的注释里，只给程序读，不污染渲染；
//   - 标题行在解析时会被剥掉，不会重复进入条目正文。
const (
	entriesMarker = "<!-- vellum:entries -->"
	// 兼容旧格式（元数据写在条目开头的注释里，无可见标题行）。
	entryOpen  = "<!-- vellum:entry"
	entryClose = "-->"
	// 新格式：可见标题行 + 紧凑的单行元数据注释。
	metaOpen  = "<!-- vellum:meta "
	metaClose = " -->"
	// entryHeaderPrefix 用于识别并剥掉可见标题行（固定四级标题，避免与正文混淆）。
	entryHeaderPrefix = "#### "
)

// entryHeader 生成条目的可见标题行。
// 状态变更写成「状态变更：A → B」，其它写成「作者」。
func entryHeader(en model.Entry) string {
	var b strings.Builder
	b.WriteString(entryHeaderPrefix)
	b.WriteString(headTime(en.Created))
	if en.Type == "status" {
		b.WriteString(" · ")
		b.WriteString(statusText(en.From, en.To))
	} else if en.Author != "" {
		b.WriteString(" · ")
		b.WriteString(en.Author)
	}
	if en.Edited {
		b.WriteString(" · 已编辑")
	}
	b.WriteString("\n")
	return b.String()
}

// headTime 把 RFC3339 时间裁剪成「YYYY-MM-DD HH:MM」的可读形式；
// 解析不了就原样返回，绝不能因为时间格式怪异而丢掉信息。
func headTime(s string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return "（无时间）"
	}
	for _, layout := range []string{
		"2006-01-02T15:04:05Z07:00",
		"2006-01-02T15:04:05Z",
		"2006-01-02 15:04:05",
	} {
		if tm, err := time.Parse(layout, s); err == nil {
			return tm.Local().Format("2006-01-02 15:04")
		}
	}
	return s
}

// statusText 生成状态变更的可读文字。
func statusText(from, to string) string {
	f, t := optionLabel(from), optionLabel(to)
	switch {
	case f == "" && t == "":
		return "状态变更"
	case f == "":
		return "状态变更 → " + t
	case t == "":
		return "状态变更：" + f
	default:
		return "状态变更：" + f + " → " + t
	}
}

// optionLabel 把内部状态 id 转成中文名（与内建状态表一致）；未知 id 原样返回。
func optionLabel(id string) string {
	switch id {
	case "todo":
		return "待办"
	case "doing":
		return "进行中"
	case "done":
		return "已完成"
	case "blocked":
		return "阻塞"
	case "":
		return ""
	default:
		return id
	}
}

// metaComment 生成隐藏的元数据注释（单行，便于人工阅读与 diff）。
func metaComment(en model.Entry) string {
	var b strings.Builder
	b.WriteString(metaOpen)
	b.WriteString("id=" + en.ID)
	b.WriteString(" author=" + quoteMeta(en.Author))
	b.WriteString(" type=" + en.Type)
	b.WriteString(" created=" + quoteMeta(en.Created))
	if en.From != "" {
		b.WriteString(" from=" + quoteMeta(en.From))
	}
	if en.To != "" {
		b.WriteString(" to=" + quoteMeta(en.To))
	}
	if en.Edited {
		b.WriteString(" edited=true")
	}
	b.WriteString(metaClose)
	return b.String()
}

// quoteMeta 给含空白的值加双引号，否则原样输出。
func quoteMeta(s string) string {
	if s == "" {
		return "\"\""
	}
	if strings.ContainsAny(s, " \t\"") {
		return "\"" + strings.ReplaceAll(s, "\"", "'") + "\""
	}
	return s
}

// splitBodyEntries 把 issue.md 的正文拆成「描述」与「时间线」两部分。
// 旧数据没有时间线标记时，整个正文都算描述。
func splitBodyEntries(body string) (string, string) {
	s := strings.ReplaceAll(body, "\r\n", "\n")
	// 标记必须独占一行；优先取最后一段，避免正文里引用示例时误判。
	idx := strings.LastIndex(s, "\n"+entriesMarker)
	if idx < 0 {
		if strings.HasPrefix(s, entriesMarker) {
			return "", strings.TrimLeft(s[len(entriesMarker):], "\n")
		}
		return s, ""
	}
	desc := s[:idx]
	tail := s[idx+1+len(entriesMarker):]
	return strings.TrimRight(desc, "\n"), strings.TrimLeft(tail, "\n")
}

// joinBodyEntries 把描述与时间线重新拼成 issue.md 正文。
func joinBodyEntries(desc, timeline string) string {
	desc = strings.TrimRight(strings.ReplaceAll(desc, "\r\n", "\n"), "\n")
	timeline = strings.TrimSpace(strings.ReplaceAll(timeline, "\r\n", "\n"))
	if timeline == "" {
		return desc
	}
	if desc == "" {
		return entriesMarker + "\n\n" + timeline
	}
	return desc + "\n\n" + entriesMarker + "\n\n" + timeline
}

// parseEntries 解析时间线区块里的所有条目（按文件中出现的顺序）。
//
// 同时支持两种书写：
//   - 新：`#### 时间 · 作者` + `<!-- vellum:meta ... -->` + 正文
//   - 旧：`<!-- vellum:entry` + YAML frontmatter + `-->` + 正文
//
// 两种都按「段落块」切分：一个块从某条目标记开始，到下一个条目标记前结束。
func parseEntries(timeline string) []model.Entry {
	var out []model.Entry
	s := strings.ReplaceAll(timeline, "\r\n", "\n")

	// 逐块向前扫描：每次定位最近的条目标记（新格式的 meta 或旧格式的 entry 头）。
	for {
		metaAt := strings.Index(s, metaOpen)
		legacyAt := strings.Index(s, entryOpen+"\n")
		if metaAt < 0 && legacyAt < 0 {
			break
		}
		// 取两者中较早出现的那个作为当前块开头。
		useMeta := metaAt >= 0 && (legacyAt < 0 || metaAt < legacyAt)

		var en model.Entry
		var rest string

		if useMeta {
			end := strings.Index(s[metaAt:], metaClose)
			if end < 0 {
				break
			}
			raw := s[metaAt+len(metaOpen) : metaAt+end]
			en = parseMetaKV(raw)
			rest = s[metaAt+end+len(metaClose):]
		} else {
			head := s[legacyAt+len(entryOpen):]
			end := strings.Index(head, entryClose)
			if end < 0 {
				break
			}
			if err := yaml.Unmarshal([]byte(strings.TrimSpace(head[:end])), &en); err != nil {
				en = model.Entry{}
			}
			rest = head[end+len(entryClose):]
		}

		// 本块正文：到下一个条目标记（新或旧）为止。
		// 注意：新格式的可见标题行位于 meta 注释之前，所以切分点要提前到
		// 「标题行 + 注释」这一整体，否则上一条会把下一条的标题吞进来。
		nextMeta := strings.Index(rest, metaOpen)
		nextLegacy := strings.Index(rest, entryOpen+"\n")
		nb := len(rest)
		if nextMeta >= 0 && nextMeta < nb {
			nb = headerStartBefore(rest, nextMeta)
		}
		if nextLegacy >= 0 && nextLegacy < nb {
			nb = nextLegacy
		}
		rawBody := rest[:nb]
		s = rest[nb:]

		en.Body = stripEntryHeader(rawBody)
		if en.ID == "" {
			en.ID = fmt.Sprintf("e-%s", en.Created)
		}
		en.File = en.ID
		out = append(out, en)
	}
	return out
}

// headerStartBefore 从 meta 注释位置往前退到可见标题行开头。
// 当前块与 meta 注释之间只应有空行；若不相邻则不动（说明没有标题行）。
func headerStartBefore(s string, metaAt int) int {
	p := metaAt
	// 向前跳空白与换行
	for p > 0 && (s[p-1] == '\n' || s[p-1] == ' ' || s[p-1] == '\t' || s[p-1] == '\r') {
		p--
	}
	// 此时 p 是标题行末尾之后的位置；找这一行的开头
	lineStart := strings.LastIndexByte(s[:p], '\n') + 1
	if strings.HasPrefix(s[lineStart:], entryHeaderPrefix) {
		return lineStart
	}
	return metaAt
}

// parseMetaKV 解析 `id=x author="a b" type=comment` 形式的键值对。
func parseMetaKV(s string) model.Entry {
	en := model.Entry{}
	for k, v := range splitMetaKV(s) {
		switch k {
		case "id":
			en.ID = v
		case "author":
			en.Author = v
		case "type":
			en.Type = v
		case "created":
			en.Created = v
		case "from":
			en.From = v
		case "to":
			en.To = v
		case "edited":
			en.Edited = v == "true"
		}
	}
	return en
}

// splitMetaKV 拆键值对，支持值用双引号包裹（允许内含空格）。
func splitMetaKV(s string) map[string]string {
	out := map[string]string{}
	i := 0
	for i < len(s) {
		// 跳空白
		for i < len(s) && (s[i] == ' ' || s[i] == '\t' || s[i] == '\n') {
			i++
		}
		start := i
		for i < len(s) && s[i] != '=' && s[i] != ' ' && s[i] != '\t' && s[i] != '\n' {
			i++
		}
		if i >= len(s) || s[i] != '=' {
			break
		}
		key := strings.TrimSpace(s[start:i])
		i++ // 跳过 =
		if i < len(s) && s[i] == '"' {
			i++
			vstart := i
			for i < len(s) && s[i] != '"' {
				i++
			}
			out[key] = s[vstart:i]
			if i < len(s) {
				i++ // 收尾引号
			}
		} else {
			vstart := i
			for i < len(s) && s[i] != ' ' && s[i] != '\t' && s[i] != '\n' {
				i++
			}
			out[key] = s[vstart:i]
		}
	}
	return out
}

// stripEntryHeader 剥掉块首的可见标题行（`#### ...`）与其后的空行，
// 让 Body 只留下真正的正文；旧格式没有标题行，原样返回。
func stripEntryHeader(s string) string {
	s = strings.TrimLeft(s, "\n")
	if !strings.HasPrefix(s, entryHeaderPrefix) {
		return strings.TrimSpace(s)
	}
	if i := strings.IndexByte(s, '\n'); i >= 0 {
		s = s[i+1:]
	} else {
		return ""
	}
	return strings.TrimSpace(strings.TrimLeft(s, "\n"))
}

// formatEntries 把条目序列化成时间线区块文本（可见标题行 + 隐藏元数据）。
func formatEntries(entries []model.Entry) string {
	var b strings.Builder
	for i, en := range entries {
		if i > 0 {
			b.WriteString("\n")
		}
		out := en
		out.Body = ""
		if out.ID == "" {
			out.ID = en.File
		}
		if out.ID == "" {
			out.ID = fmt.Sprintf("e-%s", out.Created)
		}
		// 可见标题行：渲染后能看到时间、作者、状态变更。
		b.WriteString(entryHeader(out))
		// 隐藏元数据：只给程序读。
		b.WriteString(metaComment(out))
		b.WriteString("\n")
		if body := strings.TrimSpace(en.Body); body != "" {
			b.WriteString(body)
			b.WriteString("\n")
		}
	}
	return strings.TrimSpace(b.String())
}

// legacyEntry 是旧 entries/*.md 的读取结果，迁移时使用。
// sortEntriesByCreated 按时间排序，缺 created 的条目保持在原位。
//
// 关键点：不能用空串直接比（空串字典序最小，会把无时间的旧条目倒到最前），
// 而是只对有时间的条目做稳定排序，无时间条目视为“时间未知”不参与位移。
func sortEntriesByCreated(ents []model.Entry) {
	// 收集有时间的条目下标，对它们的值做稳定排序后回填到这些位置上。
	var idxs []int
	var vals []model.Entry
	for i, en := range ents {
		if en.Created != "" {
			idxs = append(idxs, i)
			vals = append(vals, en)
		}
	}
	sort.SliceStable(vals, func(i, j int) bool { return vals[i].Created < vals[j].Created })
	for k, i := range idxs {
		ents[i] = vals[k]
	}
}
