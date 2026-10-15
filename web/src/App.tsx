import { useCallback, useEffect, useRef, useState } from 'react'
import { Spin } from 'antd'
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'

import { api, setApiProject } from './api'
import { Ctx, useApp } from './context'
import { PALETTE_EVENT } from './bus'
import { applyRepoDefault } from './i18n'
import { SINGLE_PID, PROGRAM_PID, isProgramScope, parseProjectId, projectPath } from './nav'
import type { ProjectMeta, RepoInfo, Schema } from './types'
import TopBar from './components/TopBar'
import Sidebar from './components/Sidebar'
import Breadcrumb from './components/Breadcrumb'
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
import Docs from './pages/Docs'
import Settings from './pages/Settings'

function isTyping(el: EventTarget | null): boolean {
  const t = el as HTMLElement | null
  if (!t) return false
  const tag = t.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable
}

export default function App() {
  const [repo, setRepo] = useState<RepoInfo | null>(null)
  const [schema, setSchema] = useState<Schema | null>(null)
  const [loading, setLoading] = useState(true)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const loc = useLocation()
  const nav = useNavigate()

  const multi = repo?.mode === 'multi'
  const defaultPid = multi
    ? repo?.currentProject || repo?.projects?.[0]?.id || 'main'
    : SINGLE_PID

  // URL 是项目上下文的唯一真相；programs/* 恒为项目集作用域。
  const parsed = parseProjectId(loc.pathname)
  const projectId = parsed === PROGRAM_PID ? PROGRAM_PID : multi ? parsed ?? defaultPid : SINGLE_PID
  // 渲染期同步 API 项目头，保证子页面首次请求就落在正确项目上。
  setApiProject(multi ? projectId : '')

  // 旧的无项目前缀链接（#/issues、#/issue/WB-1 …）重定向到当前项目的同名页面。
  const legacy = !loc.pathname.startsWith('/p/') && !loc.pathname.startsWith('/programs')

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
        // 项目集作用域没有「项目」可写，跳到全部任务页由用户选项目新建。
        nav(isProgramScope(projectId) ? '/programs/issues' : projectPath(projectId, '/new'))
      }
    }
    const onOpen = () => setPaletteOpen(true)
    window.addEventListener('keydown', onKey)
    window.addEventListener(PALETTE_EVENT, onOpen)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener(PALETTE_EVENT, onOpen)
    }
  }, [nav, paletteOpen, projectId])

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
    // 旧的「项目集/组织形式」入口迁到新的项目集总览。
    if (loc.pathname === '/projects') return <Navigate to="/programs" replace />
    return <Navigate to={projectPath(defaultPid, loc.pathname) + loc.search} replace />
  }

  const projects: ProjectMeta[] = repo.projects || []
  const project = multi ? projects.find((p) => p.id === projectId) : repo.projectMeta

  return (
    <Ctx.Provider value={{ schema, repo, reload, projectId, project, projects }}>
      <div className="app-shell">
        <TopBar />
        <div className="app-body">
          <Sidebar onOpenPalette={() => setPaletteOpen(true)} />
          <main className="app-main">
            <Breadcrumb />
            <div className="page" key={loc.pathname + loc.search}>
              <Routes>
                <Route path="/programs" element={<Projects />} />
                <Route path="/programs/issues" element={<IssueList />} />
                {schema.modules.board && <Route path="/programs/board" element={<Board />} />}
                {schema.modules.gantt && <Route path="/programs/gantt" element={<Gantt />} />}
                {schema.modules.search && <Route path="/programs/search" element={<Search />} />}
                <Route path="/programs/settings" element={<Settings />} />
                <Route path="/p/:pid/*" element={<ProjectRoutes />} />
                <Route path="*" element={<Navigate to={projectPath(defaultPid, '/')} replace />} />
              </Routes>
            </div>
          </main>
        </div>
      </div>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </Ctx.Provider>
  )
}

// ProjectRoutes 是项目工作台内的视图；项目 id 由 App 从 URL 统一解析。
function ProjectRoutes() {
  const { schema } = useApp()
  return (
    <Routes>
      <Route index element={<Home />} />
      <Route path="issues" element={<IssueList />} />
      {schema.modules.board && <Route path="board" element={<Board />} />}
      {schema.modules.search && <Route path="search" element={<Search />} />}
      <Route path="new" element={<IssueNew />} />
      <Route path="issue/:id" element={<IssueDetail />} />
      {schema.modules.gantt && <Route path="gantt" element={<Gantt />} />}
      {schema.modules.docs && <Route path="docs" element={<Docs />} />}
      <Route path="settings" element={<Settings />} />
      <Route path="*" element={<Navigate to="." replace />} />
    </Routes>
  )
}