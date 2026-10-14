// Package i18n 存放后端提示语的中英词条，并定义可翻译的错误类型。
//
// 词条以中文为源语言：zh 模板与仓库里既有的中文提示完全一致，日志和默认输出不变；
// 只有在请求声明英文时才渲染 en 模板。数据本身（任务标题、状态名、文档正文）
// 不属于这里——它们是仓库里的纯文本，跟着用户写什么就是什么。
package i18n

import (
	"fmt"
	"net/http"
	"strings"
)

const (
	Zh = "zh"
	En = "en"
)

// 词条 key。中英文模板必须使用同样的占位符与顺序。
const (
	NoRepo                     = "no_repo"
	NoWorkspace                = "no_workspace"
	RepoURLRequired            = "repo_url_required"
	ProjectNameRequired        = "project_name_required"
	ProjectNotFound            = "project_not_found"
	MissingArchived            = "missing_archived"
	CannotArchiveActive        = "cannot_archive_active"
	BadMode                    = "bad_mode"
	YamlInvalid                = "yaml_invalid"
	YamlEmpty                  = "yaml_empty"
	ProjectIDMismatch          = "project_id_mismatch"
	SingleModeOnly             = "single_mode_only"
	TitleRequired              = "title_required"
	UploadFailed               = "upload_failed"
	MissingFile                = "missing_file"
	PathNotFound               = "path_not_found"
	NotADir                    = "not_a_dir"
	TargetExists               = "target_exists"
	ArchivedProjectHasIssues   = "archived_project_has_issues"
	TooManyLiveProjects        = "too_many_live_projects"
	BadScope                   = "bad_scope"
	DocPathEmpty               = "doc_path_empty"
	DocPathInvalid             = "doc_path_invalid"
	PathSegInvalid             = "path_seg_invalid"
	DocExists                  = "doc_exists"
	DocNotFound                = "doc_not_found"
	IssueNotFound              = "issue_not_found"
	IllegalPath                = "illegal_path"
	ConfigUnparsable           = "config_unparsable"
	ConfigNotMapping           = "config_not_mapping"
	Unscheduled                = "unscheduled"
	UpdateCheckFailed          = "update_check_failed"
	UpdateApplyFailed          = "update_apply_failed"
	UpdateAlreadyLatest        = "update_already_latest"
	UpdateNoAsset              = "update_no_asset"
	UpdateRemoteDenied         = "update_remote_denied"
)

// entries: key -> {中文, English}
var entries = map[string][2]string{
	NoRepo:                     {"尚未加载仓库", "No repository is loaded yet"},
	NoWorkspace:                {"尚未加载工作台", "No workspace is loaded yet"},
	RepoURLRequired:            {"仓库地址不能为空", "Repository address is required"},
	ProjectNameRequired:        {"项目名称不能为空", "Project name is required"},
	ProjectNotFound:            {"项目不存在: %s", "Project not found: %s"},
	MissingArchived:            {"缺少 archived 字段", `Missing the "archived" field`},
	CannotArchiveActive:        {"不能归档当前活动项目，请先切换到其他项目", "Cannot archive the active project — switch to another project first"},
	BadMode:                    {"mode 只能是 single 或 multi", `mode must be "single" or "multi"`},
	YamlInvalid:                {"YAML 校验失败: %s", "YAML validation failed: %s"},
	YamlEmpty:                  {"YAML 内容为空", "YAML content is empty"},
	ProjectIDMismatch:          {"配置里的 project.id（%s）和当前项目（%s）不一致", "project.id in the config (%s) does not match the current project (%s)"},
	SingleModeOnly:             {"当前工作台为 single 模式，不支持多项目", "This workspace runs in single mode and does not support multiple projects"},
	TitleRequired:              {"标题不能为空", "Title is required"},
	UploadFailed:               {"上传失败: %s", "Upload failed: %s"},
	MissingFile:                {"缺少文件字段", "Missing file field"},
	PathNotFound:               {"路径不存在: %s", "Path does not exist: %s"},
	NotADir:                    {"不是目录: %s", "Not a directory: %s"},
	TargetExists:               {"目标已存在: %s", "Target already exists: %s"},
	ArchivedProjectHasIssues:   {"归档项目 %s 中仍有 %d 个任务，请先恢复并迁移或删除", "Archived project %s still has %d issues — restore, move or delete them first"},
	TooManyLiveProjects:        {"存在 %d 个未归档项目，无法合并回 single 模式（仅允许 1 个）", "There are %d unarchived projects; cannot merge back into single mode (only 1 allowed)"},
	BadScope:                   {"scope 只能是 repo 或 project", `scope must be "repo" or "project"`},
	DocPathEmpty:               {"文档路径为空", "Document path is empty"},
	DocPathInvalid:             {"非法文档路径: %s", "Invalid document path: %s"},
	PathSegInvalid:             {"路径名含非法字符: %s", "Path segment contains illegal characters: %s"},
	DocExists:                  {"文档已存在: %s", "Document already exists: %s"},
	DocNotFound:                {"文档不存在: %s", "Document not found: %s"},
	IssueNotFound:              {"任务不存在: %s", "Issue not found: %s"},
	IllegalPath:                {"非法路径", "Illegal path"},
	ConfigUnparsable:           {"现有配置无法解析: %v", "Existing configuration cannot be parsed: %v"},
	ConfigNotMapping:           {"配置顶层必须是键值映射", "The top level of the configuration must be a key-value mapping"},
	Unscheduled:                {"未排期", "Unscheduled"},
	UpdateCheckFailed:          {"检查更新失败: %v", "Update check failed: %v"},
	UpdateApplyFailed:          {"应用更新失败: %v", "Failed to apply the update: %v"},
	UpdateAlreadyLatest:        {"当前已是最新版本", "Already on the latest version"},
	UpdateNoAsset:              {"该发行版没有适用于当前平台的安装包", "This release has no package for the current platform"},
	UpdateRemoteDenied:         {"出于安全考虑，更新默认只允许本机发起（可设 WB_UPDATE_REMOTE=true 放开，或配置 WB_AUTH）", "For safety, updates may only be triggered from the local machine (set WB_UPDATE_REMOTE=true or configure WB_AUTH to allow remote)"},
}

// Normalize 把任意语言标记收敛成 zh/en，识别不了就返回空串交给上层回退。
func Normalize(tag string) string {
	t := strings.ToLower(strings.TrimSpace(tag))
	switch {
	case t == "":
		return ""
	case strings.HasPrefix(t, "zh"):
		return Zh
	case strings.HasPrefix(t, "en"):
		return En
	default:
		return ""
	}
}

// FromRequest 取请求声明的语言：X-WB-Lang（前端语言开关）优先，其次 Accept-Language。
// 返回空串表示请求没表态，由调用方用仓库默认语言兜底。
func FromRequest(r *http.Request) string {
	if l := Normalize(r.Header.Get("X-WB-Lang")); l != "" {
		return l
	}
	for _, tag := range strings.Split(r.Header.Get("Accept-Language"), ",") {
		if strings.TrimSpace(tag) == "" {
			continue
		}
		if l := Normalize(strings.TrimSpace(tag)); l != "" {
			return l
		}
	}
	return ""
}

// T 按语言渲染词条；未知 key 原样返回，便于临时消息直接穿过。
func T(lang, key string, args ...any) string {
	pair, ok := entries[key]
	tpl := key
	if ok {
		tpl = pair[0]
		if lang == En {
			tpl = pair[1]
		}
	}
	if len(args) == 0 {
		return tpl
	}
	return fmt.Sprintf(tpl, args...)
}

// Err 是带词条 key 的错误：Error() 始终渲染中文（日志与磁盘上的语义不变），
// 到了 HTTP 边界再按请求语言重新渲染。包装底层错误时把它当参数传，
// 模板里的 %v 负责输出，翻译时参数原样保留。
type Err struct {
	Key  string
	Args []any
}

func New(key string, args ...any) *Err {
	return &Err{Key: key, Args: args}
}

func (e *Err) Error() string {
	return T(Zh, e.Key, e.Args...)
}

// Msg 把任意错误渲染成指定语言；非 i18n 错误原样返回。
func Msg(lang string, err error) string {
	if err == nil {
		return ""
	}
	if e, ok := err.(*Err); ok {
		return T(lang, e.Key, e.Args...)
	}
	return err.Error()
}
