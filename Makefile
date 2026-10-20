# Vellum 构建
# 需要：Go 1.27+、Node 20+（仅构建前端时需要）

# Windows 上用 GnuWin32 等原生 make 时，默认找不到 POSIX shell，
# 导致 $(shell ...) 与含 && 的配方 CreateProcess 失败；显式指定 shell。
# 非 Windows 平台保持默认（/bin/sh 或 bash），不受影响。
ifeq ($(OS),Windows_NT)
# 用 Git 自带的 bash 作 shell：既支持 POSIX 的 && 链，也支持配方里的行内环境变量
# 赋值（如 GOFLAGS=... go build）。短路径避免 “Program Files” 里的空格。
SHELL := C:\PROGRA~1\Git\usr\bin\bash.exe
endif

.PHONY: all web build desktop desktop-unix run run-desktop dev clean

# 版本号：优先取最近标签，退回提交号；自更新会读取该值。
VERSION ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo dev)
LDFLAGS = -X github.com/nonex-code/vellum/internal/version.Version=$(VERSION)

# 当前平台探测：clone 到哪就在哪出本机包，不写死 Windows。
# 取 GOOS/GOARCH（交叉编译时以 GOOS/GOARCH 为准），无则退回 uname。
GOOS   ?= $(shell uname -s 2>/dev/null | tr '[:upper:]' '[:lower:]' | sed 's/darwin/darwin/;s/linux/linux/;s/mingw.*/windows/;s/msys.*/windows/;s/cygwin.*/windows/')
GOARCH ?= $(shell uname -m 2>/dev/null | sed 's/x86_64/amd64/;s/aarch64/arm64/;s/arm64/arm64/')
# Windows 下用 .exe 后缀；其余平台无后缀。
ifeq ($(GOOS),windows)
EXT = .exe
else
EXT =
endif
# 单二进制产物名：vellum-<os>-<arch>（Mac/Linux/Windows 一致，便于 clone 后本地打包）。
BIN = vellum-$(GOOS)-$(GOARCH)$(EXT)

# 完整构建：前端产物 -> Go 单二进制（当前平台）
all: build

# 安装前端依赖并构建到 web/dist
web:
	cd web && npm install && npm run build

# 构建 Go 单二进制（依赖 web/dist）。纯 Go、CGO 关闭即可跨平台交叉编译，
# 但本目标只出“当前平台”（clone 到哪就在哪出包）。
build: web
	GOOS=$(GOOS) GOARCH=$(GOARCH) CGO_ENABLED=0 GOFLAGS=-mod=mod GOPROXY=off GOSUMDB=off \
		go build -trimpath -ldflags "$(LDFLAGS)" -o $(BIN) .

# Wails CLI：本地若已安装二进制可直接用 `make WAILS=wails ...`；
# 否则用 `go run` 按需拉取（首次需联网补全 wails CLI 依赖）。版本锁定在 go.mod。
WAILS ?= go run github.com/wailsapp/wails/v2/cmd/wails@v2.16.0

# 桌面壳（Wails）：同一套前后端，只是入口不同（desktop.go）。
# 走 `wails build`：自动从 build/appicon.png 生成各平台图标（含 Windows .syso），
# 并以 build/bin/vellum-desktop[.exe] 输出。-s 跳过前端构建（前端已由 make web 产出 web/dist）。
# -skipbindings：前端为手写 React，不使用 wailsjs 绑定。
# 按当前平台自动选 -platform / 构建标签 / 链接与 GUI 标志（见下方 DESKTOP_* 变量）：
# Wails 需要 CGO + 原生 WebView，无法交叉编译，所以只出“当前平台”的包——
# clone 到 Windows 出 .exe，clone 到 macOS 出 darwin 二进制，clone 到 Linux 出 linux 二进制。
UNAME_S := $(shell uname -s 2>/dev/null)
ifeq ($(UNAME_S),Darwin)
DESKTOP_PLATFORM    = darwin/$(shell uname -m 2>/dev/null | sed 's/x86_64/amd64/;s/arm64/arm64/')
DESKTOP_TAGS        = desktop,production
DESKTOP_CGO_LDFLAGS = -framework UniformTypeIdentifiers
DESKTOP_GUI_LDFLAGS =
DESKTOP_PACKAGE     = -nopackage
else ifeq ($(OS),Windows_NT)
DESKTOP_PLATFORM    = windows/amd64
DESKTOP_TAGS        = desktop,production
DESKTOP_CGO_LDFLAGS =
DESKTOP_GUI_LDFLAGS = -H=windowsgui
DESKTOP_PACKAGE     =
else
DESKTOP_PLATFORM    = linux/amd64
DESKTOP_TAGS        = desktop,production,webkit2_41
DESKTOP_CGO_LDFLAGS =
DESKTOP_GUI_LDFLAGS =
DESKTOP_PACKAGE     = -nopackage
endif

desktop: web
	CGO_ENABLED=1 CGO_LDFLAGS="$(DESKTOP_CGO_LDFLAGS)" $(WAILS) build \
		-platform $(DESKTOP_PLATFORM) -s -skipbindings $(DESKTOP_PACKAGE) \
		-tags "$(DESKTOP_TAGS)" -ldflags "$(DESKTOP_GUI_LDFLAGS) $(LDFLAGS)"

# 非 Windows 桌面壳：同 desktop，但 -nopackage 只产出原生二进制（不打包 .app / deb）。
# 保留为显式别名；日常用 desktop 即可。
desktop-unix: desktop

# 本地运行（当前平台产物）
run:
	./$(BIN)

run-desktop:
	./build/bin/vellum-desktop$(EXT)

# 前端热更新开发（代理 /api 到 8420）
dev:
	cd web && npm run dev

clean:
	rm -rf web/dist vellum vellum.exe $(BIN) vellum-desktop vellum-desktop.exe build/bin \
		build/windows/icon.ico build/darwin/iconfile.icns build/darwin/Info.plist build/linux *-res.syso