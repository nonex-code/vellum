import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import {
  ApartmentOutlined,
  BarsOutlined,
  BookOutlined,
  HomeOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  PlusOutlined,
  ProjectOutlined,
  RightOutlined,
  SearchOutlined,
  SettingOutlined,
  UnorderedListOutlined,
} from '@ant-design/icons'

import { api } from '../api'
import { useApp } from '../context'
import { t } from '../i18n'
import { isProgramScope, projectPath } from '../nav'
import type { ProjectStat } from '../types'
import NewProjectModal from './NewProjectModal'

const MEM_KEY = 'wb.projectViewMem'
const COLLAPSE_KEY = 'wb.sidebarCollapsed'
// 只记忆“视图级”路径；任务详情/新建等回落到任务列表，避免切项目打开不存在的详情。
const VIEW_PATHS = new Set(['/', '/issues', '/board', '/gantt', '/docs', '/search', '/settings'])

function loadMem(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(MEM_KEY) || '{}')
  } catch {
    return {}
  }
}

interface ViewDef {
  to: string
  label: string
  icon: ReactNode
  end?: boolean
  show?: boolean
}

// Sidebar 是常驻的层级导航：项目集（聚合层）→ 项目 → 视图。
// “向上”只发生在点项目集节点；切项目是一步操作，且回到各项目上次停留的视图。
export default function Sidebar({ onOpenPalette }: { onOpenPalette: () => void }) {
  const { schema, repo, reload, projectId, projects } = useApp()
  const loc = useLocation()
  const nav = useNavigate()
  const multi = repo.mode === 'multi'
  const program = isProgramScope(projectId)

  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSE_KEY) === '1')
  const [creating, setCreating] = useState(false)
  const [stats, setStats] = useState<Record<string, ProjectStat>>({})
  const mem = useRef<Record<string, string>>(loadMem())

  const workspaceName = repo.project?.name || schema.workspace?.name || 'Vellum'

  // 记录每个项目当前停留的视图。
  useEffect(() => {
    const m = loc.pathname.match(/^\/p\/([^/]+)(\/.*)?$/)
    if (!m) return
    const id = decodeURIComponent(m[1])
    let rest = m[2] || '/'
    if (!VIEW_PATHS.has(rest)) rest = '/issues'
    mem.current[id] = rest
    try {
      localStorage.setItem(MEM_KEY, JSON.stringify(mem.current))
    } catch {
      /* ignore */
    }
  }, [loc.pathname])

  // 各项目进行中数量，作为侧栏徽标。
  useEffect(() => {
    if (!multi) return
    let alive = true
    api
      .projectStats()
      .then((d) => {
        if (!alive) return
        const map: Record<string, ProjectStat> = {}
        for (const p of d.projects || []) map[p.id] = p
        setStats(map)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [multi, repo.root, projects.length])

  function toggleCollapsed() {
    setCollapsed((v) => {
      const next = !v
      try {
        localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0')
      } catch {
        /* ignore */
      }
      return next
    })
  }

  const programViews: ViewDef[] = [
    { to: '/programs', label: t('总览'), icon: <ApartmentOutlined />, end: true },
    { to: '/programs/issues', label: t('全部任务'), icon: <UnorderedListOutlined /> },
    { to: '/programs/board', label: t('全部看板'), icon: <ProjectOutlined />, show: schema.modules.board },
    { to: '/programs/gantt', label: t('全部甘特'), icon: <BarsOutlined />, show: schema.modules.gantt },
    { to: '/programs/search', label: t('全部搜索'), icon: <SearchOutlined />, show: schema.modules.search },
  ]

  function projectViews(id: string): ViewDef[] {
    const all: ViewDef[] = [
      { to: projectPath(id, '/issues'), label: t('任务'), icon: <UnorderedListOutlined /> },
      { to: projectPath(id, '/board'), label: t('看板'), icon: <ProjectOutlined />, show: schema.modules.board },
      { to: projectPath(id, '/gantt'), label: t('甘特'), icon: <BarsOutlined />, show: schema.modules.gantt },
      { to: projectPath(id, '/docs'), label: t('文档'), icon: <BookOutlined />, show: schema.modules.docs },
      { to: projectPath(id, '/search'), label: t('搜索'), icon: <SearchOutlined />, show: schema.modules.search },
      { to: projectPath(id, '/settings'), label: t('设置'), icon: <SettingOutlined /> },
    ]
    return all.filter((v) => v.show !== false)
  }

  const cls =
    (base: string) =>
    ({ isActive }: { isActive: boolean }) =>
      base + (isActive ? ' active' : '')

  return (
    <>
      <aside className={'sidebar' + (collapsed ? ' collapsed' : '')}>
        <div className="sb-scroll">
          {/* 项目集节点：点它就是“回上一层” */}
          <NavLink to="/programs" end title={workspaceName} className={cls('sb-program')}>
            <span className="sb-logo">
              <ApartmentOutlined />
            </span>
            <span className="sb-text sb-program-name">{workspaceName}</span>
          </NavLink>

          {/* 聚合层：跨项目视图 */}
          <div className="sb-views">
            {programViews
              .filter((v) => v.show !== false)
              .map((v) => (
                <NavLink
                  key={v.to}
                  to={v.to}
                  end={v.end}
                  title={v.label}
                  className={cls('sb-item sb-program-item')}
                >
                  <span className="sb-ico">{v.icon}</span>
                  <span className="sb-text">{v.label}</span>
                </NavLink>
              ))}
          </div>

          {multi ? (
            <>
              <div className="sb-sep">
                <span className="sb-text">{t('项目')}</span>
              </div>
              <div className="sb-projects">
                {projects.map((p) => {
                  const active = !program && p.id === projectId
                  const st = stats[p.id]
                  const open = st ? Math.max(0, st.total - st.done) : 0
                  return (
                    <div key={p.id} className={'sb-proj' + (active ? ' active' : '')}>
                      <Link
                        to={projectPath(p.id, mem.current[p.id] || '/')}
                        title={p.name}
                        className={'sb-proj-head' + (active ? ' active' : '')}
                      >
                        <span className="sb-proj-caret">
                          <RightOutlined />
                        </span>
                        <span className="sb-proj-avatar">{p.name.slice(0, 1)}</span>
                        <span className="sb-text sb-proj-name">{p.name}</span>
                        {open > 0 && <span className="sb-badge sb-text">{open}</span>}
                      </Link>
                      {active && (
                        <div className="sb-sub">
                          {projectViews(p.id).map((v) => (
                            <NavLink
                              key={v.to}
                              to={v.to}
                              end={v.end}
                              title={v.label}
                              className={cls('sb-item')}
                            >
                              <span className="sb-ico">{v.icon}</span>
                              <span className="sb-text">{v.label}</span>
                            </NavLink>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
              <button className="sb-add" onClick={() => setCreating(true)} title={t('新建项目')}>
                <PlusOutlined /> <span className="sb-text">{t('新建项目')}</span>
              </button>
            </>
          ) : (
            <>
              <div className="sb-sep" />
              <div className="sb-views">
                <NavLink to={projectPath(projectId, '/')} end title={t('首页')} className={cls('sb-item')}>
                  <span className="sb-ico">
                    <HomeOutlined />
                  </span>
                  <span className="sb-text">{t('首页')}</span>
                </NavLink>
                {projectViews(projectId).map((v) => (
                  <NavLink key={v.to} to={v.to} end={v.end} title={v.label} className={cls('sb-item')}>
                    <span className="sb-ico">{v.icon}</span>
                    <span className="sb-text">{v.label}</span>
                  </NavLink>
                ))}
                <NavLink to="/programs" title={t('转为项目集')} className={cls('sb-item')}>
                  <span className="sb-ico">
                    <ApartmentOutlined />
                  </span>
                  <span className="sb-text">{t('转为项目集')}</span>
                </NavLink>
              </div>
            </>
          )}
        </div>

        <div className="sb-foot">
          <button className="sb-foot-btn" onClick={onOpenPalette} title={t('快速跳转')}>
            <SearchOutlined />
            <span className="sb-text">{t('快速跳转')}</span>
            <span className="kbd sb-text">Ctrl K</span>
          </button>
          <button
            className="sb-foot-btn"
            onClick={toggleCollapsed}
            title={collapsed ? t('展开侧栏') : t('收起侧栏')}
          >
            {collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            <span className="sb-text">{collapsed ? t('展开侧栏') : t('收起侧栏')}</span>
          </button>
        </div>
      </aside>

      <NewProjectModal
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={async (id) => {
          await reload()
          if (id) nav(projectPath(id, '/'))
        }}
      />
    </>
  )
}