# Vellum 构建
# 需要：Go 1.27+、Node 20+（仅构建前端时需要）

.PHONY: all web build desktop run run-desktop dev clean

# 完整构建：前端产物 -> Go 二进制
all: build

# 安装前端依赖并构建到 web/dist
web:
	cd web && npm install && npm run build

# 构建 Go 单二进制（依赖 web/dist）
build: web
	GOFLAGS=-mod=mod GOPROXY=off GOSUMDB=off go build -o vellum.exe .

# 桌面壳（Wails）：同一套前后端，只是入口不同（desktop.go）。
# Wails 要求 -tags "desktop,production"；-H=windowsgui 去掉控制台窗口。
desktop: web
	GOFLAGS=-mod=mod GOPROXY=off GOSUMDB=off go build -tags "desktop,production" -ldflags "-H=windowsgui" -o vellum-desktop.exe .

# 本地运行
run:
	./vellum.exe

run-desktop:
	./vellum-desktop.exe

# 前端热更新开发（代理 /api 到 8420）
dev:
	cd web && npm run dev

clean:
	rm -rf web/dist vellum vellum.exe vellum-desktop.exe