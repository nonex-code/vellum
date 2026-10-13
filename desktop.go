//go:build desktop

package main

import (
	"fmt"
	"log"
	"net"
	"net/http"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
)

// 桌面模式：go build -tags "desktop,production"。
// Wails 只当壳子——本地随机端口起同一套 HTTP 服务，窗口首帧直接跳转到
// http://127.0.0.1:<port>/，前后端逻辑与 web 模式完全一致，不走 Wails 绑定。
// 随机端口是为了让桌面版和已在跑的 web 版共存。
func main() {
	srv := newServer()

	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		log.Fatal(err)
	}
	origin := fmt.Sprintf("http://127.0.0.1:%d/", ln.Addr().(*net.TCPAddr).Port)
	go func() {
		log.Printf("vellum listening on %s", origin)
		if err := http.Serve(ln, srv); err != nil {
			log.Fatal(err)
		}
	}()

	// 资产服务只承载首帧跳转页，真正的界面从 origin 加载。
	shell := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		fmt.Fprintf(w, `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Vellum</title></head><body><script>window.location.replace(%q);</script></body></html>`, origin)
	})

	if err := wails.Run(&options.App{
		Title:     "Vellum 工作台",
		Width:     1440,
		Height:    900,
		MinWidth:  900,
		MinHeight: 600,
		AssetServer: &assetserver.Options{
			Handler: shell,
		},
	}); err != nil {
		log.Fatal(err)
	}
}
