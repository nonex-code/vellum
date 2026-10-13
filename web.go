//go:build !desktop

package main

import (
	"log"
	"net/http"
)

// web 模式：默认构建，监听 WB_HTTP_ADDR 提供页面与 API，用浏览器访问。
// 默认端口避开 8080（太容易被其它本地服务占用）。
func main() {
	addr := env("WB_HTTP_ADDR", ":8420")
	srv := newServer()
	log.Printf("vellum listening on %s", addr)
	log.Fatal(http.ListenAndServe(addr, srv))
}
