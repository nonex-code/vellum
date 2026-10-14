// Package version 保存编译期注入的版本信息。
//
// 版本号由构建命令通过 -ldflags 注入，例如：
//
//	go build -ldflags "-X github.com/nonex-code/vellum/internal/version.Version=v1.2.3" .
//
// 未注入时（本地 go run / go build）保持 "dev"，自更新会把 "dev" 视为落后于任何发行版。
package version

var (
	// Version 是发布标签（形如 v1.2.3），由 -ldflags 注入。
	Version = "dev"
	// Commit 是构建时的提交号（可选）。
	Commit = ""
	// Date 是构建时间（可选）。
	Date = ""
)

// Current 返回当前版本号，空值时回落到 "dev"。
func Current() string {
	if Version == "" {
		return "dev"
	}
	return Version
}
