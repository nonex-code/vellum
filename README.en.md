# Vellum

![Vellum logo](web/public/logo.png)

A task workspace that runs both in the browser and as a desktop app: issue-style tracking where every piece of
data is **Markdown and git plain text** inside the repository. A single Go binary serves the API and the
React/Ant Design frontend, which is baked in with `go:embed`.

中文版本：[README.md](README.md)

---

## Core principle

**The data stays readable and editable without this platform.** Issues, follow-ups, attachments, documents and
configuration are plain-text files in the repository — any editor or `git` can read and change them. Switching
tools, machines or people requires no export. The app is just one view over those texts and keeps no private store.

Configuration follows the repository as well: `workbench.yaml` lives in the repo (and per project) directory —
never in a database or a user home directory.

---

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

The desktop build uses **`wails build`** (configured by `wails.json`), which automatically generates the
per-platform icons from [`build/appicon.png`](build/appicon.png) (1024×1024, square, logo centered) and links
the Windows resource (`.syso`) into the `.exe`:

```bash
make desktop        # Windows: wails build -platform windows/amd64 -> build/bin/vellum-desktop.exe
make desktop-unix   # macOS/Linux: wails build -> build/bin/vellum-desktop
./build/bin/vellum-desktop      # or vellum-desktop.exe on Windows
```

`-tags "desktop,production"` is mandatory when building Wails by hand (without `production` it only shows a
message box) and is recorded in `wails.json`'s `build:tags`. Windows uses `-H=windowsgui` to hide the console
and needs the WebView2 runtime (bundled with Edge on Windows 10/11). macOS/Linux use CGO and need native deps:
macOS needs the Xcode toolchain (plus linking the `UniformTypeIdentifiers` framework, wired into
`make desktop-unix`), and Linux needs GTK3 + WebKit2GTK (Ubuntu 24.04 ships `libwebkit2gtk-4.1-dev`, which
requires the `webkit2_41` build tag).

The Wails CLI is pulled via `go run github.com/wailsapp/wails/v2/cmd/wails@v2.16.0` by default (needs network
the first time to fetch CLI deps); if `wails` is installed locally, use `make WAILS=wails desktop`. After
changing [`web/public/logo.png`](web/public/logo.png), run `go run ./scripts/genicon` to regenerate
`build/appicon.png`, then `make desktop` to refresh the desktop icon.

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
- The desktop shell (Wails) is built per platform: Windows `vellum-<version>-desktop-windows-amd64.zip` (no CGO,
  needs the WebView2 runtime), macOS `vellum-<version>-desktop-darwin-amd64|arm64.tar.gz`, and Linux
  `vellum-<version>-desktop-linux-amd64.tar.gz`. macOS/Linux need native GTK/WebKit libraries and can only be
  built on their own runners (cross-compiling is not viable); macOS also needs the Xcode toolchain and links the
  `UniformTypeIdentifiers` framework. Self-update selects this platform's artifact by `desktop-<os>-<arch>`.
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

## Tech stack

Go 1.27 single service (`net/http`, no framework) · `go:embed` single binary · Wails v2 (desktop window shell only).
Frontend: Vite + React 18 + TypeScript + Ant Design 5 (IBM Plex Sans/Mono embedded at build time), hash routing,
`react-markdown` rendering with in-repo attachment link rewriting and interactive checkboxes.
Visual design follows the frontend-design skill from [anthropics/skills](https://github.com/anthropics/skills) (its LICENSE is included).

## License

MIT, see [`LICENSE`](LICENSE). Copyright (c) 2026 nonex-code.
