# Vellum 构建
# 需要：Go 1.27+、Node 20+（仅构建前端时需要）

.PHONY: all web build desktop desktop-unix run run-desktop dev clean

# 版本号：优先取最近标签，退回提交号；自更新会读取该值。
VERSION ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo dev)
LDFLAGS = -X github.com/nonex-code/vellum/internal/version.Version=$(VERSION)

# 完整构建：前端产物 -> Go 二进制
all: build

# 安装前端依赖并构建到 web/dist
web:
	cd web && npm install && npm run build

# 构建 Go 单二进制（依赖 web/dist）
build: web
	GOFLAGS=-mod=mod GOPROXY=off GOSUMDB=off go build -ldflags "$(LDFLAGS)" -o vellum.exe .

# 桌面壳（Wails）：同一套前后端，只是入口不同（desktop.go）。
# Wails 要求 -tags "desktop,production"；-H=windowsgui 去掉控制台窗口。
desktop: web
	GOFLAGS=-mod=mod GOPROXY=off GOSUMDB=off go build -tags "desktop,production" -ldflags "-H=windowsgui $(LDFLAGS)" -o vellum-desktop.exe .

# 非 Windows 桌面壳（macOS/Linux）：Wails 需要 CGO 与原生 WebView 依赖。
# Linux 用 webkit2gtk-4.1 时需 webkit2_41 标签；macOS 忽略该标签，但需链接 UniformTypeIdentifiers 框架。
UNAME_S := $(shell uname -s 2>/dev/null)
ifeq ($(UNAME_S),Darwin)
DESKTOP_UNIX_TAGS = desktop,production
DESKTOP_UNIX_CGO_LDFLAGS = -framework UniformTypeIdentifiers
else
DESKTOP_UNIX_TAGS = desktop,production,webkit2_41
DESKTOP_UNIX_CGO_LDFLAGS =
endif

desktop-unix: web
	GOFLAGS=-mod=mod GOPROXY=off GOSUMDB=off CGO_ENABLED=1 CGO_LDFLAGS="$(DESKTOP_UNIX_CGO_LDFLAGS)" go build -tags "$(DESKTOP_UNIX_TAGS)" -ldflags "$(LDFLAGS)" -o vellum-desktop .

# 本地运行
run:
	./vellum.exe

run-desktop:
	./vellum-desktop.exe

# 前端热更新开发（代理 /api 到 8420）
dev:
	cd web && npm run dev

clean:
	rm -rf web/dist vellum vellum.exe vellum-desktop vellum-desktop.exe