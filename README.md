# Vellum

![Vellum logo](web/public/logo.png)

浏览器/桌面双形态的工作台：issue 式任务跟进，所有数据都是仓库里的 **Markdown + git 纯文本**。
Go 单体服务 + React/Ant Design 前端，前端产物 `go:embed` 进单个二进制。

English: [README.en.md](README.en.md)

---

## 核心原则

**脱离这个平台，数据依然可读可改。** 任务、跟进、附件、文档、配置全部是仓库内的纯文本文件，
用编辑器或 `git` 就能直接读写；换工具、换机器、换人都不需要导出。平台只是这些文本的一个视图，
不持有私有存储。

配置同样跟着仓库走：`workbench.yaml` 存在于仓库（和项目）目录里，不写数据库、不写用户主目录。

---

## 数据约定（零配置即可用）

- 仓库根即工作台；配置文件 `workbench.yaml` 可缺省（内置默认值生效）。
- 层级：**项目集（仓库）→ 项目 → 任务（issue）**。`single` 模式一个仓库即一个项目；
  `multi` 模式仓库为项目集，`projects/<id>/` 下每个项目各自有 `issues/`、`meta/`、`docs/` 与 `workbench.yaml`。
- 任务：`issues/<ID>/{issue.md, files/}`。
- 跟进：内联在 `issue.md` 的 `<!-- vellum:entries -->` 区块之后；每条先是一行可读标题（`#### 时间 · 作者 · 变更`，渲染后可见），紧跟一行 `<!-- vellum:meta ... -->` 单行 KV 注释供程序解析。一个任务的全部内容都在同一个 markdown 里。
- 迁移：旧版 `entries/*.md` 会在启动时自动合并进 `issue.md` 并删除该目录（可重复执行、幂等）。
- 附件：`files/<sha256前2>/<sha256次2>/<sha256>.<ext>`，直接入 git。
- 文档：`docs/**/*.md`（目录层级即组织方式，frontmatter 含 title/tags/pinned）。
- ID：`<前缀>-<4位序号>`，默认前缀 `WB`，计数存 `meta/seq`。
- 配置继承：内置默认 → 仓库 `workbench.yaml` → 项目 `workbench.yaml`，逐层覆盖。
  项目文件只写真正的覆盖项，与仓库生效值相同的键不会重复落盘。

## 构建与运行

前端源码在 `web/`，构建产物 `web/dist` 由 `go:embed` 嵌入。**先构建前端，再构建 Go**
（`web/dist` 不进版本库：全新克隆必须先跑 `make web`，否则 `go build` 会因为找不到 embed 目录而失败）：

```bash
make build          # = make web（npm install && npm run build）+ go build -o vellum.exe
./vellum.exe        # 打开 http://localhost:8420
```

手工等价命令：

```bash
cd web && npm install && npm run build && cd ..
GOFLAGS=-mod=mod GOPROXY=off GOSUMDB=off go build -o vellum.exe .
```

前端热更新开发（`/api` 代理到 8420）：

```bash
make dev            # 等价于 cd web && npm run dev，页面在 http://localhost:5173
```

首次进入是「欢迎」页，两条路径：

- **新建工作台**：在本地建一个 git 仓库并立即开始；需要备份或换设备时点顶栏「关联远程」。
- **连接已有仓库**：克隆远程仓库，或打开一个已存在的本地目录（非 git 目录会自动 `git init`）。

工作台 = 一个 git 仓库。未配置远程时纯本地可用，顶栏显示「仅本地」。

### 桌面版（Wails 壳）

web 服务与桌面程序同源共存：`main.go` 里 `newServer()` 一份装配，`web.go`（默认构建）监听
`WB_HTTP_ADDR`，`desktop.go`（`-tags desktop`）在 `127.0.0.1` 的随机端口起同一个服务，窗口首帧跳转到该地址。
Wails 只当窗口壳子，不引入绑定层，所以 API 与数据格式和 web 版完全一致，两者可同时运行（随机端口，不与 8420 冲突）。

桌面构建走 **`wails build`**（由 `wails.json` 配置），它会自动从 [`build/appicon.png`](build/appicon.png)
（1024×1024 方形、logo 居中）生成各平台图标，并把 Windows 资源（`.syso`）链接进 `.exe`：

```bash
make desktop        # Windows：wails build -platform windows/amd64 -> build/bin/vellum-desktop.exe
make desktop-unix   # macOS/Linux：wails build -> build/bin/vellum-desktop
./build/bin/vellum-desktop      # 或 vellum-desktop.exe（Windows）
```

`-tags "desktop,production"` 是 Wails 脱离 CLI 手工构建的硬性要求（少了 `production` 只会弹提示框），已写在
`wails.json` 的 `build:tags` 里。Windows 用 `-H=windowsgui` 隐藏控制台，且需要系统的 WebView2 运行时（Win10/11
随 Edge 自带）。macOS/Linux 走 CGO，需要原生依赖：macOS 需 Xcode 工具链（并链接 `UniformTypeIdentifiers` 框架，
`make desktop-unix` 已内置），Linux 需 GTK3 + WebKit2GTK（Ubuntu 24.04 对应 `libwebkit2gtk-4.1-dev`，
构建标签加 `webkit2_41`）。

Wails CLI 默认用 `go run github.com/wailsapp/wails/v2/cmd/wails@v2.16.0` 拉取（首次需联网补全 CLI 依赖）；
若本机已装 `wails` 二进制，可 `make WAILS=wails desktop` 直接调用。本地改了 [`web/public/logo.png`](web/public/logo.png)
后，用 `go run ./scripts/genicon` 重新生成 `build/appicon.png`，再 `make desktop` 即可更新桌面图标。

### 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `WB_HTTP_ADDR` | `:8420` | 监听地址（默认端口避开常被占用的 8080） |
| `WB_PROJECTS_DIR` | `<程序目录>/data` | 公共数据目录：已知仓库列表 `repos.json` 与克隆的仓库都放这里。默认锚定可执行文件所在目录（与启动工作目录无关，避免写进用户仓库）；留空或相对路径时按给定路径解析 |
| `WB_REPO` | 空 | 启动即加载的仓库（URL 或路径） |
| `WB_PUSH` | `true` | 提交后是否 push |
| `WB_UPLOAD_MAX_MB` | `20` | 附件大小上限 |
| `WB_AUTH` | 空 | 可选 HTTP Basic 认证，格式 `用户名:密码`（设置后访问需登录） |
| `WB_WEBHOOK` | 空 | 覆盖 `workbench.yaml` 中的 webhook 地址 |
| `WB_MCP` | `true` | 是否暴露 MCP 端点 `/mcp`（设为 `false` 关闭） |
| `WB_MCP_TOKEN` | 空 | 可选 MCP 访问令牌，设置后 `/mcp` 需 `Authorization: Bearer <token>` |

### 离线构建

Go 依赖 `gopkg.in/yaml.v3` 与桌面壳 `github.com/wailsapp/wails/v2`（均已在本地模块缓存）。无网络时：

```bash
GOFLAGS=-mod=mod GOPROXY=off GOSUMDB=off go build -o vellum.exe .
```

首次拉取依赖若连不上 `proxy.golang.org`，换国内镜像（一次性写入 `go env`）：

```bash
go env -w GOPROXY=https://goproxy.cn,direct
```

前端依赖由 `web/package-lock.json` 锁定；离线时可用 npm 缓存安装（`npm ci --offline`）。

## 发版（推送标签即自动发布）

`.github/workflows/release.yml` 在推送 `v*` 标签时构建并发布 GitHub Release：

```bash
git tag v0.1.0
git push origin v0.1.0
```

- 服务端二进制纯 Go（`CGO_ENABLED=0`），交叉编译 5 个平台：linux/amd64、linux/arm64、darwin/amd64、
  darwin/arm64、windows/amd64；产物 `vellum-<版本>-<os>-<arch>.tar.gz|.zip`，随附 `checksums.txt`。
- 桌面壳（Wails）按平台构建：Windows `vellum-<版本>-desktop-windows-amd64.zip`（无需 CGO，需系统 WebView2
  运行时）、macOS `vellum-<版本>-desktop-darwin-amd64|arm64.tar.gz`、Linux `vellum-<版本>-desktop-linux-amd64.tar.gz`。
  macOS/Linux 依赖 GTK/WebKit 原生库，只能在对应 runner 上构建（不可交叉编译）；macOS 还需 Xcode 工具链并
  链接 `UniformTypeIdentifiers` 框架。自更新会按 `desktop-<os>-<arch>` 选中本平台产物。
- 手动触发（Actions → Release → Run workflow）只构建、不发版，用于自检；非 `v` 开头的标签不会发版。

## 界面语言（中 / EN）

- **中文是源语言**：界面文案与后端提示语都以中文原文为 key，缺译文时原样回落，漏译只会露出中文，不会露出占位符。
- 后端提示语在 `internal/i18n`，按请求语言渲染；优先级 `X-WB-Lang` > `Accept-Language` > 仓库 `language` > `zh`。
- 前端字典在 `web/src/i18n/en/*.ts`（按模块分文件），顶栏「中/EN」即时切换。
- 语言偏好分两层：仓库默认写在 `workbench.yaml` 的 `language: zh|en`（纯文本，跟着仓库走）；
  本机顶栏切换记在 localStorage，优先级更高。清掉 localStorage 即回到仓库默认。
- 数据本身不翻译：任务标题、状态名、项目名、文档正文是用户写的文本，界面切换不影响它们。

## MCP（给 AI 助手用）

服务内置一个 MCP（Model Context Protocol）端点 `POST /mcp`，Claude Desktop、Cursor、Codex 等客户端可以直接读写
这个工作台：

```json
{
  "mcpServers": {
    "vellum": { "type": "http", "url": "http://localhost:8420/mcp" }
  }
}
```

桌面版端口是随机的，实际地址见「设置 → MCP」，或启动日志里的 `MCP: http://127.0.0.1:<port>/mcp`。

- **传输**：Streamable HTTP（POST JSON-RPC，无会话、无服务端推送流），协议版本 `2025-06-18`，兼容
  `2025-03-26` / `2024-11-05`。不引第三方 SDK，纯标准库实现，离线构建不受影响。
- **工具**：`get_workspace`（schema 与统计）· `list_issues` · `get_issue` · `create_issue` · `update_issue` ·
  `add_comment` · `delete_issue` · `search` · `list_docs` · `read_doc` · `write_doc` · `delete_doc`。
- **资源**：`vellum://issues/<id>` 与 `vellum://docs/<path>`。
- **行为**：和界面共用 store 层，写入直接落到仓库里的 Markdown 并自动 `git commit`；删除类工具必须显式
  `confirm=true`；未知的状态/标签/字段 id 只在 `warnings` 里提示，不会拒绝写入。
- **多项目**：工具都带可选的 `project` 参数，缺省作用于当前项目；`project="~"` 是项目集根，
  `include_children=true` 时聚合子项目。
- **开关与鉴权**：`WB_MCP=false` 关闭端点；`WB_MCP_TOKEN` 设置后要求 `Authorization: Bearer <token>`，
  与 `WB_AUTH` 的 Basic 认证叠加生效。

手工验证（curl）：

```bash
curl -s -X POST http://localhost:8420/mcp -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call",
       "params":{"name":"create_issue","arguments":{"title":"来自助手","body":"正文"}}}'
```

## 功能

- **首页**：待办/进行中/已完成统计与分布条、本周新增/完成、「进行中」「需关注」、里程碑进度、最近动态、停滞任务、负责人负载；点数字直接跳到对应筛选。
- **命令面板**：`Ctrl/Cmd + K`，搜索任务或执行跳转；`n` 新建任务。
- **列表**：按状态/优先级/类型/标签/里程碑筛选，按更新/创建/优先级/标题排序，可切树形（父子嵌套）；筛选条件写入 URL，可直接分享。
- **看板**：按状态分列，拖拽卡片即改状态（自动记时间线）。
- **详情**：Markdown 描述（复选框可直接勾选回写）、跟进时间线、附件上传、子任务、自定义字段、一键编辑/删除。
- **搜索**：标题/正文/标签/编号/跟进内容全文检索，带片段。
- **项目集**：`multi` 模式下「项目集」页可切换/新建/重命名/归档项目，`single` 与 `multi` 一键互转（数据自动迁移）。
- **甘特图**：任务 `start`/`due` 与里程碑 `start`/`end` 渲染为时间轴，按里程碑分组，支持周/月缩放。
- **日历**：按任务的 `start`/`due` 在月视图与列表视图里排布，可直接跳到任务详情。
- **文档中心**：`docs/` 目录树导航、编辑、置顶、标签筛选与全文搜索。
- **配置中心**：表单化编辑状态/标签/里程碑/字段/模板/模块开关，也可直接改 `workbench.yaml`；仓库级与项目级两层继承，全部存在仓库内。
- **模板**：新建任务时一键预填。

已实现：仓库加载/创建/切换 · 项目集管理 · 首页概览 · 命令面板与快捷键 · 列表筛选排序树形 · 看板拖拽 · 甘特图 · 日历 ·
任务增删改查 · 跟进 · 附件 · 状态切换历史 · 全文搜索（任务+文档）· 文档中心 · 配置中心（表单+YAML）· 子任务 ·
自定义字段 · 里程碑 · 模板 · Webhook · Basic 认证 · git 提交与手动同步 · MCP 端点（AI 助手读写）· 中英双语界面。

后续可做：自定义字段筛选、增量全文索引、多用户与权限、通知集成。

## 技术栈

Go 1.27 单体服务（`net/http`，无框架）· `go:embed` 单二进制 · Wails v2（仅桌面窗口壳）。
前端 Vite + React 18 + TypeScript + Ant Design 5（IBM Plex Sans/Mono 字体随包嵌入）、Hash 路由、
`react-markdown` 渲染（仓库内附件引用改写、交互式复选框）。
界面设计遵循 [anthropics/skills](https://github.com/anthropics/skills) 里的 frontend-design 规范（附带其 LICENSE）。

## 许可

MIT，见 [`LICENSE`](LICENSE)。Copyright (c) 2026 nonex-code。