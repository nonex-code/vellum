package server

import (
	"log"
	"net"
	"net/http"
	"os"
	"time"

	"github.com/nonex-code/vellum/internal/i18n"
	"github.com/nonex-code/vellum/internal/update"
)

// handleVersion 返回当前版本与构建形态，供前端「关于」页展示。
func (s *Server) handleVersion(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, map[string]any{
		"version":   s.version(),
		"mode":      update.Mode,
		"repo":      s.updateRepo(),
		"updatable": s.updater != nil,
	})
}

// handleUpdateCheck 查询 GitHub Releases 是否有更新。
func (s *Server) handleUpdateCheck(w http.ResponseWriter, r *http.Request) {
	info, err := s.updater.Check(s.version())
	if err != nil {
		s.err(w, r, http.StatusBadGateway, i18n.UpdateCheckFailed, err)
		return
	}
	writeJSON(w, info)
}

// handleUpdateApply 下载并原子替换当前二进制，然后重启进程。
// 响应先写回前端，随后在后台启动新版本并退出旧进程。
func (s *Server) handleUpdateApply(w http.ResponseWriter, r *http.Request) {
	if !s.opts.UpdateAllowRemote && s.opts.AuthUser == "" && !isLoopback(r) {
		s.err(w, r, http.StatusForbidden, i18n.UpdateRemoteDenied)
		return
	}

	info, err := s.updater.Check(s.version())
	if err != nil {
		s.err(w, r, http.StatusBadGateway, i18n.UpdateCheckFailed, err)
		return
	}
	if info.Asset == "" {
		s.err(w, r, http.StatusConflict, i18n.UpdateNoAsset)
		return
	}
	if !info.Available {
		s.err(w, r, http.StatusConflict, i18n.UpdateAlreadyLatest)
		return
	}

	restart, err := s.updater.Apply(info)
	if err != nil {
		s.err(w, r, http.StatusInternalServerError, i18n.UpdateApplyFailed, err)
		return
	}

	writeJSON(w, map[string]any{"ok": true, "version": info.Latest})
	if f, ok := w.(http.Flusher); ok {
		f.Flush()
	}

	// 留一点时间把响应发出去，再启动新进程并退出旧进程。
	go func() {
		time.Sleep(700 * time.Millisecond)
		if err := restart(); err != nil {
			log.Printf("update: 重启失败: %v", err)
			return
		}
		log.Printf("update: 已切换到 %s，旧进程退出", info.Latest)
		os.Exit(0)
	}()
}

func (s *Server) version() string {
	if s.opts.Version == "" {
		return "dev"
	}
	return s.opts.Version
}

func (s *Server) updateRepo() string {
	if s.updater != nil {
		return s.updater.Repo()
	}
	return s.opts.UpdateRepo
}

// isLoopback 判断请求是否来自本机，用于限制自更新的触发来源。
func isLoopback(r *http.Request) bool {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}
