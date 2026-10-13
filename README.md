# Vellum

浏览器/桌面双形态的工作台：issue 式任务跟进，所有数据都是仓库里的 **Markdown + git 纯文本**。
Go 单体服务 + React/Ant Design 前端，前端产物 `go:embed` 进单个二进制。


Data lives in the repository as plain text — see the English section below.

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
- 任务：`issues/<ID>/{issue.md, entries/, files/}`。
- 跟进：`entries/<序号>-<时间>-<作者>.md`，文件名排序即时间序。
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

```bash
make desktop        # go build -tags "desktop,production" -ldflags "-H=windowsgui" -o vellum-desktop.exe
./vellum-desktop.exe
```

`-tags "desktop,production"` 是 Wails 脱离 CLI 手工构建的硬性要求（少了 `production` 只会弹提示框）；
`-H=windowsgui` 隐藏控制台窗口。桌面版需要系统的 WebView2 运行时（Win10/11 随 Edge 自带）。

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
- 桌面壳（Wails）只在 windows runner 上构建 `vellum-<版本>-desktop-windows-amd64.zip`：其他平台需要
  GTK/WebKit 原生依赖，交叉编译不成立；运行还需要系统 WebView2 运行时。
- 手动触发（Actions → Release → Run workflow）只构建、不发版，用于自检；非 `v` 开头的标签不会发版。

## 界面语言（中 / EN）

- **中文是源语言**：界面文案与后端提示语都以中文原文为 key，缺译文时原样回落，漏译只会露出中文，不会露出占位符。
- 后端提示语在 `internal/i18n`，按请求语言渲染；优先级 `X-WB-Lang` > `Accept-Language` > 仓库 `language` > `zh`。
- 前端字典在 `web/src/i18n/en/*.ts`（按模块分文件），顶栏「中/EN」即时切换。
- 语言偏好分两层：仓库默认写在 `workbench.yaml` 的 `language: zh|en`（纯文本，跟着仓库走）；
  本机顶栏切换记在 localStorage，优先级更高。清掉 localStorage 即回到仓库默认。
- 数据本身不翻译：任务标题、状态名、项目名、文档正文是用户写的文本，界面切换不影响它们。

## 功能

- **首页**：待办/进行中/已完成统计与分布条、本周新增/完成、「进行中」「需关注」、里程碑进度、最近动态、停滞任务、负责人负载；点数字直接跳到对应筛选。
- **命令面板**：`Ctrl/Cmd + K`，搜索任务或执行跳转；`n` 新建任务。
- **列表**：按状态/优先级/类型/标签/里程碑筛选，按更新/创建/优先级/标题排序，可切树形（父子嵌套）；筛选条件写入 URL，可直接分享。
- **看板**：按状态分列，拖拽卡片即改状态（自动记时间线）。
- **详情**：Markdown 描述（复选框可直接勾选回写）、跟进时间线、附件上传、子任务、自定义字段、一键编辑/删除。
- **搜索**：标题/正文/标签/编号/跟进内容全文检索，带片段。
- **项目集**：`multi` 模式下「项目集」页可切换/新建/重命名/归档项目，`single` 与 `multi` 一键互转（数据自动迁移）。
- **甘特图**：任务 `start`/`due` 与里程碑 `start`/`end` 渲染为时间轴，按里程碑分组，支持周/月缩放。
- **文档中心**：`docs/` 目录树导航、编辑、置顶、标签筛选与全文搜索。
- **配置中心**：表单化编辑状态/标签/里程碑/字段/模板/模块开关，也可直接改 `workbench.yaml`；仓库级与项目级两层继承，全部存在仓库内。
- **模板**：新建任务时一键预填。

已实现：仓库加载/创建/切换 · 项目集管理 · 首页概览 · 命令面板与快捷键 · 列表筛选排序树形 · 看板拖拽 · 甘特图 ·
任务增删改查 · 跟进 · 附件 · 状态切换历史 · 全文搜索（任务+文档）· 文档中心 · 配置中心（表单+YAML）· 子任务 ·
自定义字段 · 里程碑 · 模板 · Webhook · Basic 认证 · git 提交与手动同步 · 中英双语界面。

后续可做：自定义字段筛选、增量全文索引、多用户与权限、通知集成。

## 许可

MIT，见 [`LICENSE`](LICENSE)。Copyright (c) 2026 nonex-code。


## 技术栈

Go 1.27 单体服务（`net/http`，无框架）· `go:embed` 单二进制 · Wails v2（仅桌面窗口壳）。
前端 Vite + React 18 + TypeScript + Ant Design 5（IBM Plex Sans/Mono 字体随包嵌入）、Hash 路由、
`react-markdown` 渲染（仓库内附件引用改写、交互式复选框）。
界面设计遵循 [anthropics/skills](https://github.com/anthropics/skills) 里的 frontend-design 规范（附带其 LICENSE）。

---

# English

Vellum is a task workspace that runs both in the browser and as a desktop app: issue-style tracking where
every piece of data is **Markdown and git plain text** inside the repository. A single Go binary serves the API and
serves the React/Ant Design frontend, which is baked in with `go:embed`.


## Core principle

**The data stays readable and editable without this platform.** Issues, follow-ups, attachments, documents and
configuration are plain-text files in the repository — any editor or `git` can read and change them. Switching
tools, machines or people requires no export. The app is just one view over those texts and keeps no private store.

Configuration follows the repository as well: `workbench.yaml` lives in the repo (and per project) directory —
never in a database or a user home directory.

## Data layout (works with zero configuration)

- The repository root *is* the workbench; `workbench.yaml` is optional (built-in defaults apply).
- Hierarchy: **portfolio (repository) → project → issue**. In `single` mode one repository is one project;
  in `multi` mode the repository is a portfolio and `projects/<id>/` holds each project's own `issues/`,
  `meta/`, `docs/` and `workbench.yaml`.
- Issue: `issues/<ID>/{issue.md, entries/, files/}`.
- Follow-ups: `entries/<sequence>-<timestamp>-<author>.md`; filename order is chronological.
- Attachments: `files/<sha256[0:2]>/<sha256[2:4]>/<sha256>.<ext>`, committed to git directly.
- Documents: `docs/**/*.md` (the folder tree is the organization; frontmatter carries title/tags/pinned).
- IDs: `<prefix>-<4-digit seq>`, default prefix `WB`, counter in `meta/seq`.
- Config inheritance: built-in defaults → repository `workbench.yaml` → project `workbench.yaml`.
  Project files persist only genuine overrides — keys equal to the effective repo value are not duplicated.

## Build and run

Frontend sources live in `web/`; the built output `web/dist` is embedded via `go:embed`. **Build the frontend
first, then the Go binary** (`web/dist` is not versioned, so on a fresh clone a missing embed directory will make
`go build` fail until `make web` has run):

```bash
make build          # = make web (npm install && npm run build) + go build -o vellum.exe
./vellum.exe        # then open http://localhost:8420
```

The explicit equivalents:

```bash
cd web && npm install && npm run build && cd ..
GOFLAGS=-mod=mod GOPROXY=off GOSUMDB=off go build -o vellum.exe .
```

Frontend dev server with hot reload (proxies `/api` to 8420):

```bash
make dev            # cd web && npm run dev — page at http://localhost:5173
```

The first screen is the welcome page, with two paths:

- **New workspace**: create a local git repository and start immediately; use "Attach remote" in the top bar
  when you want a backup or another device.
- **Open an existing repository**: clone from a URL or point at an existing local directory
  (a non-git folder is initialized with `git init`).

A workspace *is* a git repository. With no remote configured it works fully offline and the top bar shows
"Local only".

### Desktop build (Wails shell)

The web server and the desktop app share one codebase and coexist: `newServer()` in `main.go` assembles the
handler once, `web.go` (default build) listens on `WB_HTTP_ADDR`, and `desktop.go` (`-tags desktop`) starts the
same server on a random `127.0.0.1` port and redirects the window's first frame to it. Wails is only a window
shell — no binding layer — so the API and data format are identical to the web build, and both can run at the
same time (random port, never conflicting with 8420).

```bash
make desktop        # go build -tags "desktop,production" -ldflags "-H=windowsgui" -o vellum-desktop.exe
./vellum-desktop.exe
```

`-tags "desktop,production"` is mandatory when building Wails by hand (without `production` it only shows a
message box); `-H=windowsgui` hides the console. The desktop build needs the WebView2 runtime (bundled with
Edge on Windows 10/11).

### Environment variables

| Variable | Default | Meaning |
|---|---|---|
| `WB_HTTP_ADDR` | `:8420` | Listen address (chosen to dodge the crowded 8080) |
| `WB_PROJECTS_DIR` | `<binary dir>/data` | Shared data directory: the known-repo list `repos.json` and cloned repositories land here. Anchored to the executable by default so nothing is written into a user repository; relative or empty values resolve as given |
| `WB_REPO` | empty | Repository (URL or path) to load at startup |
| `WB_PUSH` | `true` | Whether to push after committing |
| `WB_UPLOAD_MAX_MB` | `20` | Attachment size limit |
| `WB_AUTH` | empty | Optional HTTP Basic auth, format `user:password` |
| `WB_WEBHOOK` | empty | Overrides the webhook URL in `workbench.yaml` |

### Offline builds

Go dependencies are `gopkg.in/yaml.v3` and the desktop shell `github.com/wailsapp/wails/v2` (both in the local
module cache). Without network access:

```bash
GOFLAGS=-mod=mod GOPROXY=off GOSUMDB=off go build -o vellum.exe .
```

If the first fetch cannot reach `proxy.golang.org`, switch to a mirror once:

```bash
go env -w GOPROXY=https://goproxy.cn,direct
```

Frontend dependencies are pinned in `web/package-lock.json`; offline installs can use `npm ci --offline`.

## Releasing (pushing a tag publishes it)

`.github/workflows/release.yml` builds and publishes a GitHub Release when a `v*` tag is pushed:

```bash
git tag v0.1.0
git push origin v0.1.0
```

- The server binary is pure Go (`CGO_ENABLED=0`), cross-compiled for 5 platforms: linux/amd64, linux/arm64,
  darwin/amd64, darwin/arm64, windows/amd64, published as `vellum-<version>-<os>-<arch>.tar.gz|.zip` plus
  `checksums.txt`.
- The desktop shell (Wails) builds only on a windows runner as `vellum-<version>-desktop-windows-amd64.zip`:
  other platforms need native GTK/WebKit dependencies, so cross-compiling it is not viable, and running it needs
  the system WebView2 runtime.
- A manual run (Actions → Release → Run workflow) builds without publishing, for self-checks; tags that do not
  start with `v` never publish.

## Interface language (中 / EN)

- **Chinese is the source language.** UI strings and backend messages are keyed by their Chinese source text;
  missing translations fall back to Chinese rather than exposing placeholder keys.
- Backend catalog lives in `internal/i18n` and renders per request.
  Priority: `X-WB-Lang` > `Accept-Language` > repository `language` > `zh`.
- Frontend dictionaries live in `web/src/i18n/en/*.ts`, split by module; the top-bar "中/EN" button switches
  instantly.
- The preference is layered: the repository default is plain text in `workbench.yaml` (`language: zh|en`, it
  travels with the repo), while a local switch is stored in `localStorage` and takes precedence. Clear
  `localStorage` to follow the repository again.
- Data is never translated: issue titles, status names, project names and document bodies are your own text and
  are unaffected by switching the interface language.

## Features

- **Home**: to-do / in-progress / done counts with a distribution bar, created and completed this week,
  "In progress" and "Needs attention" lists, milestone progress, recent activity, stalled tasks, workload per
  assignee — every number links to the matching filter.
- **Command palette**: `Ctrl/Cmd + K` to search issues or jump around; `n` creates an issue.
- **List**: filter by status / priority / type / tag / milestone, sort by updated / created / priority / title,
  optional tree view (parent-child nesting); filters are written to the URL so a view is shareable.
- **Board**: columns per status; dragging a card changes its status and records the timeline.
- **Detail**: Markdown description (checkboxes toggle back into the file), follow-up timeline, attachments,
  subtasks, custom fields, inline rename, delete.
- **Search**: full-text over titles, bodies, tags, IDs and follow-ups, with snippets.
- **Portfolio**: in `multi` mode the projects page can switch, create, rename and archive projects; `single`
  and `multi` convert with one click (data migrates automatically).
- **Gantt**: task `start`/`due` dates and milestone `start`/`end` ranges on a timeline, grouped by milestone,
  zoomable per week/month.
- **Docs**: tree navigation, editing, pinning, tag filtering and full-text search over `docs/`.
- **Settings**: form-based editing of statuses, tags, milestones, fields, templates and module switches, or edit
  `workbench.yaml` directly; repo-level and project-level inheritance, everything stored inside the repository.
- **Templates**: prefill the new-issue form in one click.

Implemented: repository load/create/switch · portfolio management · home overview · command palette and shortcuts ·
list filtering, sorting and tree view · board drag & drop · Gantt · issue CRUD · follow-ups · attachments ·
status history · full-text search (issues + docs) · documentation center · settings (form + YAML) · subtasks ·
custom fields · milestones · templates · webhook · Basic auth · git commits and manual sync · bilingual interface.

Plausible next steps: filtering by custom fields, incremental full-text indexing, multi-user permissions,
notification integrations.

## License

MIT, see [`LICENSE`](LICENSE). Copyright (c) 2026 nonex-code.


## Tech stack

Go 1.27 single service (`net/http`, no framework) · `go:embed` single binary · Wails v2 (desktop window shell only).
Frontend: Vite + React 18 + TypeScript + Ant Design 5 (IBM Plex Sans/Mono embedded at build time), hash routing,
`react-markdown` rendering with in-repo attachment link rewriting and interactive checkboxes.
Visual design follows the frontend-design skill from [anthropics/skills](https://github.com/anthropics/skills) (its LICENSE is included).
