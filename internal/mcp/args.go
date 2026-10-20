package mcp

import (
	"strconv"
	"strings"
)

// ---------- 参数读取 ----------

// ArgString 读取字符串参数；缺失或类型不符时返回空串。
func ArgString(args map[string]any, key string) string {
	v, ok := args[key]
	if !ok || v == nil {
		return ""
	}
	switch t := v.(type) {
	case string:
		return t
	case bool:
		if t {
			return "true"
		}
		return "false"
	case float64:
		return strconv.FormatFloat(t, 'f', -1, 64)
	default:
		return ""
	}
}

// ArgTrim 读取并 trim 字符串参数。
func ArgTrim(args map[string]any, key string) string {
	return strings.TrimSpace(ArgString(args, key))
}

// Has 判断参数是否显式给出（用于「留空即清空」的字段更新）。
func Has(args map[string]any, key string) bool {
	_, ok := args[key]
	return ok
}

// ArgBool 读取布尔参数，缺失时返回 def。兼容 "true"/"1" 这类字符串写法。
func ArgBool(args map[string]any, key string, def bool) bool {
	v, ok := args[key]
	if !ok || v == nil {
		return def
	}
	switch t := v.(type) {
	case bool:
		return t
	case string:
		switch strings.ToLower(strings.TrimSpace(t)) {
		case "true", "1", "yes", "y":
			return true
		case "false", "0", "no", "n":
			return false
		}
	case float64:
		return t != 0
	}
	return def
}

// ArgInt 读取整数参数，缺失或非法时返回 def。
func ArgInt(args map[string]any, key string, def int) int {
	v, ok := args[key]
	if !ok || v == nil {
		return def
	}
	switch t := v.(type) {
	case float64:
		return int(t)
	case int:
		return t
	case string:
		if n, err := strconv.Atoi(strings.TrimSpace(t)); err == nil {
			return n
		}
	}
	return def
}

// ArgStrings 读取字符串数组参数；也接受单个字符串（按逗号切分）。
func ArgStrings(args map[string]any, key string) []string {
	v, ok := args[key]
	if !ok || v == nil {
		return nil
	}
	switch t := v.(type) {
	case []string:
		return t
	case []any:
		out := make([]string, 0, len(t))
		for _, x := range t {
			if s, ok := x.(string); ok {
				if s = strings.TrimSpace(s); s != "" {
					out = append(out, s)
				}
			}
		}
		return out
	case string:
		var out []string
		for _, seg := range strings.Split(t, ",") {
			if seg = strings.TrimSpace(seg); seg != "" {
				out = append(out, seg)
			}
		}
		return out
	}
	return nil
}

// ArgMap 读取键值对参数（自定义字段用）。
func ArgMap(args map[string]any, key string) map[string]string {
	v, ok := args[key]
	if !ok || v == nil {
		return nil
	}
	out := map[string]string{}
	switch t := v.(type) {
	case map[string]string:
		for k, val := range t {
			out[k] = val
		}
	case map[string]any:
		for k, val := range t {
			if s, ok := val.(string); ok {
				out[k] = s
			}
		}
	}
	return out
}

// ---------- JSON Schema 构造 ----------

// Object 组装一个 object 类型的入参 schema。
func Object(props map[string]any, required ...string) map[string]any {
	m := map[string]any{"type": "object", "properties": props}
	if len(required) > 0 {
		m["required"] = required
	}
	return m
}

// Str 声明字符串字段。
func Str(desc string) map[string]any {
	return map[string]any{"type": "string", "description": desc}
}

// StrEnum 声明枚举字符串字段。
func StrEnum(desc string, values ...string) map[string]any {
	return map[string]any{"type": "string", "description": desc, "enum": values}
}

// Bool 声明布尔字段。
func Bool(desc string) map[string]any {
	return map[string]any{"type": "boolean", "description": desc}
}

// Int 声明整数字段。
func Int(desc string, def int) map[string]any {
	return map[string]any{"type": "integer", "description": desc, "default": def}
}

// StrArray 声明字符串数组字段。
func StrArray(desc string) map[string]any {
	return map[string]any{"type": "array", "items": map[string]any{"type": "string"}, "description": desc}
}

// StrMap 声明键值对字段。
func StrMap(desc string) map[string]any {
	return map[string]any{"type": "object", "additionalProperties": map[string]any{"type": "string"}, "description": desc}
}
