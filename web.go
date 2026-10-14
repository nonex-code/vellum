//go:build !desktop

package main

import (
	"log"
	"net"
	"net/http"
	"time"
)

// web 模式：默认构建，监听 WB_HTTP_ADDR 提供页面与 API，用浏览器访问。
// 默认端口避开 8080（太容易被其它本地服务占用）。
func main() {
	addr := env("WB_HTTP_ADDR", ":8420")
	srv := newServer()

	// 自更新重启时旧进程可能仍短暂占用端口：重试若干秒，避免“地址被占用”启动失败。
	var (
		ln  net.Listener
		err error
	)
	deadline := time.Now().Add(10 * time.Second)
	for {
		ln, err = net.Listen("tcp", addr)
		if err == nil {
			break
		}
		if time.Now().After(deadline) {
			log.Fatal(err)
		}
		time.Sleep(200 * time.Millisecond)
	}

	log.Printf("vellum listening on %s", addr)
	log.Fatal(http.Serve(ln, srv))
}