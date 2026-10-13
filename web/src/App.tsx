import { useCallback, useEffect, useState } from 'react'
import { Layout, Spin } from 'antd'
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'

import { api } from './api'
import { Ctx } from './context'
import { PALETTE_EVENT } from './bus'
import { applyRepoDefault } from './i18n'
import type { RepoInfo, Schema } from './types'
import TopBar from './components/TopBar'
import Nav from './components/Nav'
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

  const reload = useCallback(async () => {
    const r = await api.repo()
    setRepo(r)
    if (r.loaded) {
      const sc = await api.schema()
      setSchema(sc)
      // 本机没手动切换过语言时，跟随仓库 workbench.yaml 里的 language。
      applyRepoDefault(sc.language)
    } else {
      setSchema(null)
    }
  }, [])

  useEffect(() => {
    reload().finally(() => setLoading(false))
  }, [reload])

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
        nav('/new')
      }
    }
    const onOpen = () => setPaletteOpen(true)
    window.addEventListener('keydown', onKey)
    window.addEventListener(PALETTE_EVENT, onOpen)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener(PALETTE_EVENT, onOpen)
    }
  }, [nav, paletteOpen])

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

  return (
    <Ctx.Provider value={{ schema, repo, reload }}>
      <Layout style={{ minHeight: '100%' }}>
        <TopBar />
        <Nav onOpenPalette={() => setPaletteOpen(true)} />
        <Layout.Content>
          <div className="page" key={loc.pathname + loc.search}>
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/issues" element={<IssueList />} />
              {schema.modules.board && <Route path="/board" element={<Board />} />}
              {schema.modules.search && <Route path="/search" element={<Search />} />}
              <Route path="/new" element={<IssueNew />} />
              <Route path="/issue/:id" element={<IssueDetail />} />
              <Route path="/projects" element={<Projects />} />
              {schema.modules.gantt && <Route path="/gantt" element={<Gantt />} />}
              {schema.modules.docs && <Route path="/docs" element={<Docs />} />}
              <Route path="/settings" element={<Settings />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </div>
        </Layout.Content>
      </Layout>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </Ctx.Provider>
  )
}