import { useCallback, useEffect, useRef, useState } from 'react'
import { Spin } from 'antd'
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'

import { api, setApiScope } from './api'
import { Ctx, useApp } from './context'
import { PALETTE_EVENT } from './bus'
import { applyRepoDefault } from './i18n'
import { ROOT_PID, parseProjectId, projectAggPath, projectPath } from './nav'
import type { ProjectMeta, RepoInfo, Schema } from './types'
import TopBar from './components/TopBar'
import Sidebar from './components/Sidebar'
import Breadcrumb from './components/Breadcrumb'
import ViewNav from './components/ViewNav'
import CommandPalette from './components/CommandPalette'
import Welcome from './onboarding/Welcome'
import Home from './pages/Home'
import IssueList from './pages/IssueList'
import Board from './pages/Board'
import Search from './pages/Search'
import IssueNew from './pages/IssueNew'
import IssueDetail from './pages/IssueDetail'
import Projects from './pages/Projects'
import Gantt from './pages/Gantt'
import Calendar from './pages/Calendar'
import Docs from './pages/Docs'
import Settings from './pages/Settings'

function isTyping(el: EventTarget | null): boolean {
  const t = el as HTMLElement | null
  if (!t) return false
  const tag = t.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable
}

// 旧的 /programs 子视图名，迁到根项目时要带上 include=children 才是聚合视图。
const AGG_VIEWS = new Set(['issues', 'board', 'gantt', 'calendar', 'docs', 'search'])

export default function App() {
  const [repo, setRepo] = useState<RepoInfo | null>(null)
  const [schema, setSchema] = useState<Schema | null>(null)
  const [loading, setLoading] = useState(true)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const loc = useLocation()
  const nav = useNavigate()

  const multi = repo?.mode === 'multi'
  const parsed = parseProjectId(loc.pathname)
  // URL 是项目上下文的唯一真相；项目树根项目为 ROOT_PID，single 模式恒为根项目。
  const projectId = multi ? parsed ?? ROOT_PID : ROOT_PID
  // 聚合视图 = 根项目 + include=children（“全部任务/看板/甘特/搜索”）。
  const includeChildren = new URLSearchParams(loc.search).get('include') === 'children'
  const aggregate = multi && projectId === ROOT_PID && includeChildren

  // 渲染期同步 API 作用域头，保证子页面首次请求就落在正确项目上。
  setApiScope(multi ? projectId : '', aggregate)

  // 旧的无项目前缀链接（#/issues、#/issue/WB-1、#/programs…）重定向到项目树路径。
  const legacy = !loc.pathname.startsWith('/p/')

  const applySchema = useCallback((sc: Schema) => {
    setSchema(sc)
    applyRepoDefault(sc.language)
  }, [])

  const reload = useCallback(async () => {
    const r = await api.repo()
    setRepo(r)
    if (r.loaded) {
      applySchema(await api.schema())
    } else {
      setSchema(null)
    }
  }, [applySchema])

  useEffect(() => {
    reload().finally(() => setLoading(false))
  }, [reload])

  // 项目变化时刷新生效 schema（配置继承可能因项目而异）。
  const firstRun = useRef(true)
  useEffect(() => {
    if (!repo?.loaded) return
    if (firstRun.current) {
      firstRun.current = false
      return
    }
    let alive = true
    api
      .schema()
      .then((sc) => alive && applySchema(sc))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [projectId, repo?.loaded, applySchema])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen((v) => !v)
        return
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (isTyping(e.target) || paletteOpen) return
      if (e.key === 'n') {
        e.preventDefault()
        // 聚合视图没有单一项目可写，跳到全部任务页由用户选项目新建。
        nav(aggregate ? projectAggPath(projectId, '/issues') : projectPath(projectId, '/new'))
      }
    }
    const onOpen = () => setPaletteOpen(true)
    window.addEventListener('keydown', onKey)
    window.addEventListener(PALETTE_EVENT, onOpen)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener(PALETTE_EVENT, onOpen)
    }
  }, [nav, paletteOpen, projectId, aggregate])

  if (loading) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', height: '100%' }}>
        <Spin size="large" />
      </div>
    )
  }

  if (!repo?.loaded || !schema) {
    return <Welcome onLoaded={reload} />
  }

  if (legacy) {
    // 旧「项目集」入口迁到项目树根项目；其余旧链接归到当前项目。
    const legacyPid = multi ? repo.currentProject || ROOT_PID : ROOT_PID
    let to: string
    if (loc.pathname === '/projects' || loc.pathname === '/programs') {
      to = projectPath(ROOT_PID, '/')
    } else if (loc.pathname.startsWith('/programs/')) {
      const rest = loc.pathname.slice('/programs'.length)
      const seg = rest.replace(/^\//, '')
      to = AGG_VIEWS.has(seg) ? projectAggPath(ROOT_PID, rest) : projectPath(ROOT_PID, rest)
    } else {
      to = projectPath(legacyPid, loc.pathname)
    }
    return <Navigate to={to + loc.search} replace />
  }

  const projects: ProjectMeta[] = repo.projects || []
  // 未知项目（失效书签/手输 id）不要落到幽灵目录；直接回项目集总览。
  if (multi && projectId !== ROOT_PID && !projects.some((p) => p.id === projectId)) {
    return <Navigate to={projectPath(ROOT_PID, '/')} replace />
  }
  const project = multi ? projects.find((p) => p.id === projectId) : repo.projectMeta
  // 统一的项目名回显：根项目显示工作台名，未知 id 回退为 id 本身。
  const projectName = (id?: string) => {
    if (!id) return ''
    if (id === ROOT_PID) return repo.project?.name || schema.workspace?.name || ''
    return projects.find((p) => p.id === id)?.name || id
  }

  // 页面重挂载使用的 key：项目 + 项目内路径 + 查询。
  // 设置页签也走 URL，但折叠成 /settings，这样切换页签不会重挂载整个页面
  // （保留未保存的草稿），其它导航仍照旧重挂载以重置局部状态。
  const pathRest = loc.pathname.replace(/^\/p\/[^/]+/, '')
  const viewKey = pathRest.replace(/^\/settings(?:\/.*)?$/, '/settings')
  const pageKey = `${projectId}|${viewKey}|${loc.search}`

  return (
    <Ctx.Provider value={{ schema, repo, reload, projectId, project, projects, aggregate, projectName }}>
      <div className="app-shell">
        <TopBar />
        <div className="app-body">
          <Sidebar onOpenPalette={() => setPaletteOpen(true)} />
          <main className="app-main">
            <ViewNav />
            <Breadcrumb />
            <div className="page" key={pageKey}>
              <Routes>
                <Route path="/p/:pid/*" element={<ProjectRoutes />} />
                <Route path="*" element={<Navigate to={projectPath(ROOT_PID, '/')} replace />} />
              </Routes>
            </div>
          </main>
        </div>
      </div>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </Ctx.Provider>
  )
}

// ProjectRoutes 是项目树节点内的视图；根项目在 multi 模式下首屏是项目集总览。
function ProjectRoutes() {
  const { schema, repo, projectId } = useApp()
  const rootOverview = projectId === ROOT_PID && repo.mode === 'multi'
  return (
    <Routes>
      <Route index element={rootOverview ? <Projects /> : <Home />} />
      <Route path="issues" element={<IssueList />} />
      {schema.modules.board && <Route path="board" element={<Board />} />}
      {schema.modules.search && <Route path="search" element={<Search />} />}
      <Route path="new" element={<IssueNew />} />
      <Route path="issue/:id" element={<IssueDetail />} />
      {schema.modules.gantt && <Route path="gantt" element={<Gantt />} />}
      {schema.modules.calendar && <Route path="calendar" element={<Calendar />} />}
      {schema.modules.docs && <Route path="docs" element={<Docs />} />}
      <Route path="settings/*" element={<Settings />} />
      <Route path="*" element={<Navigate to="." replace />} />
    </Routes>
  )
}