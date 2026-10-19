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

# Wails CLI：本地若已安装二进制可直接用 `make WAILS=wails ...`；
# 否则用 `go run` 按需拉取（首次需联网补全 wails CLI 依赖）。版本锁定在 go.mod。
WAILS ?= go run github.com/wailsapp/wails/v2/cmd/wails@v2.16.0

# 桌面壳（Wails）：同一套前后端，只是入口不同（desktop.go）。
# 走 `wails build`：自动从 build/appicon.png 生成各平台图标（含 Windows .syso），
# 并以 build/bin/vellum-desktop[.exe] 输出。-s 跳过前端构建（前端已由 make web 产出 web/dist）。
# -skipbindings：前端为手写 React，不使用 wailsjs 绑定。
desktop: web
	$(WAILS) build -platform windows/amd64 -s -skipbindings \
		-tags "desktop,production" -ldflags "-H=windowsgui $(LDFLAGS)"

# 非 Windows 桌面壳（macOS/Linux）：Wails 需要 CGO 与原生 WebView 依赖。
# Linux 用 webkit2gtk-4.1 时需 webkit2_41 标签；macOS 忽略该标签，但需链接 UniformTypeIdentifiers 框架。
# -nopackage：只产出原生二进制（不打包 .app / deb），与旧发布结构一致。
UNAME_S := $(shell uname -s 2>/dev/null)
ifeq ($(UNAME_S),Darwin)
DESKTOP_UNIX_PLATFORM = darwin/$(shell uname -m 2>/dev/null | sed 's/x86_64/amd64/;s/arm64/arm64/')
DESKTOP_UNIX_TAGS = desktop,production
DESKTOP_UNIX_CGO_LDFLAGS = -framework UniformTypeIdentifiers
else
DESKTOP_UNIX_PLATFORM = linux/amd64
DESKTOP_UNIX_TAGS = desktop,production,webkit2_41
DESKTOP_UNIX_CGO_LDFLAGS =
endif

desktop-unix: web
	CGO_ENABLED=1 CGO_LDFLAGS="$(DESKTOP_UNIX_CGO_LDFLAGS)" $(WAILS) build \
		-platform "$(DESKTOP_UNIX_PLATFORM)" -s -skipbindings -nopackage \
		-tags "$(DESKTOP_UNIX_TAGS)" -ldflags "$(LDFLAGS)"

# 本地运行
run:
	./vellum.exe

run-desktop:
	./build/bin/vellum-desktop$(if $(filter Windows_NT,$(OS)),.exe,)

# 前端热更新开发（代理 /api 到 8420）
dev:
	cd web && npm run dev

clean:
	rm -rf web/dist vellum vellum.exe vellum-desktop vellum-desktop.exe build/bin build/windows/icon.ico build/darwin/iconfile.icns build/darwin/Info.plist build/linux *-res.syso