package main

import (
	"embed"
	"io/fs"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/nonex-code/vellum/internal/server"
	"github.com/nonex-code/vellum/internal/update"
	"github.com/nonex-code/vellum/internal/version"
)

//go:embed all:web/dist
var webFS embed.FS

func env(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

// defaultDataDir 返回公共数据目录（repos.json、克隆的仓库都在这里）。
// 默认锚定在可执行文件所在目录下的 data/，与当前工作目录无关——
// 这样即使用户 cd 进某个 git 仓库再启动程序，也不会把公共数据写进仓库里。
func defaultDataDir() string {
	if exe, err := os.Executable(); err == nil {
		if exe, err = filepath.EvalSymlinks(exe); err == nil {
			return filepath.Join(filepath.Dir(exe), "data")
		}
	}
	return "data"
}

// newServer 装配 HTTP 服务：web 模式与桌面壳共用同一份装配逻辑，
// 桌面模式只是给同一个服务换了个入口（见 desktop.go）。
func newServer() http.Handler {
	update.CleanupOld() // 清理上次自更新遗留的 .old 备份

	sub, err := fs.Sub(webFS, "web/dist")
	if err != nil {
		log.Fatal(err)
	}

	maxMB, _ := strconv.Atoi(env("WB_UPLOAD_MAX_MB", "20"))
	authUser, authPass := "", ""
	if a := os.Getenv("WB_AUTH"); a != "" {
		if i := strings.IndexByte(a, ':'); i >= 0 {
			authUser, authPass = a[:i], a[i+1:]
		} else {
			authUser, authPass = a, ""
		}
	}
	srv := server.New(server.Options{
		ProjectsDir: env("WB_PROJECTS_DIR", defaultDataDir()),
		Push:        env("WB_PUSH", "true") != "false",
		Web:         sub,
		MaxUploadMB: maxMB,
		AuthUser:    authUser,
		AuthPass:    authPass,
		WebhookURL:  os.Getenv("WB_WEBHOOK"),

		Version:           version.Current(),
		UpdateRepo:        env("WB_UPDATE_REPO", "nonex-code/vellum"),
		UpdateEnabled:     env("WB_UPDATE", "true") != "false",
		UpdateAllowRemote: env("WB_UPDATE_REMOTE", "false") == "true",
	})

	if repo := os.Getenv("WB_REPO"); repo != "" {
		if err := srv.Open(repo); err != nil {
			log.Printf("warn: 自动加载 %s 失败: %v", repo, err)
		} else {
			log.Printf("已加载仓库: %s", repo)
		}
	}

	return srv
}
