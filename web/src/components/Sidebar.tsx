import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
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
  PushpinFilled,
  PushpinOutlined,
  RightOutlined,
  SearchOutlined,
  UnorderedListOutlined,
} from '@ant-design/icons'

import { api } from '../api'
import { useApp } from '../context'
import { t } from '../i18n'
import { ROOT_PID, projectAggPath, projectPath } from '../nav'
import type { ProjectMeta, ProjectStat } from '../types'
import NewProjectModal from './NewProjectModal'

const MEM_KEY = 'wb.projectViewMem'
const COLLAPSE_KEY = 'wb.sidebarCollapsed'
const VISIT_KEY = 'wb.projectVisits'
// 只记忆“视图级”路径；任务详情/新建等回落到任务列表，避免切项目打开不存在的详情。
const VIEW_PATHS = new Set(['/', '/issues', '/board', '/gantt', '/docs', '/search', '/settings'])
// “最近”区最多显示几个项目。
const RECENT_LIMIT = 4

function loadJSON<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) || '') as T
  } catch {
    return fallback
  }
}

function saveJSON(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* ignore */
  }
}

interface ViewDef {
  to: string
  label: string
  icon: ReactNode
  end?: boolean
  show?: boolean
}

type ProjGroup = 'pinned' | 'plain'

// Sidebar 是常驻的层级导航：项目树（根项目 → 子项目 → 视图）。
// 根项目展开为聚合层（总览/全部任务…）；子项目展开为自身视图。
// 子项目可分「收藏 / 全部项目」，支持拖拽排序与置顶；行尾徽标显示进行中/逾期数量。
export default function Sidebar({ onOpenPalette }: { onOpenPalette: () => void }) {
  const { schema, repo, reload, projectId, projects } = useApp()
  const loc = useLocation()
  const nav = useNavigate()
  const multi = repo.mode === 'multi'
  const atRoot = projectId === ROOT_PID

  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSE_KEY) === '1')
  const [creating, setCreating] = useState(false)
  const [stats, setStats] = useState<Record<string, ProjectStat>>({})
  const [pinned, setPinned] = useState<string[]>(() => repo.pinned || [])
  const [order, setOrder] = useState<string[]>(() => (projects || []).map((p) => p.id))
  const [visits, setVisits] = useState<Record<string, number>>(() =>
    loadJSON<Record<string, number>>(VISIT_KEY, {}),
  )
  const [dragId, setDragId] = useState<string | null>(null)
  const [overId, setOverId] = useState<string | null>(null)
  const mem = useRef<Record<string, string>>(loadJSON<Record<string, string>>(MEM_KEY, {}))

  const workspaceName = repo.project?.name || schema.workspace?.name || 'Vellum'
  const projKey = (projects || []).map((p) => p.id).join(',')
  const pinKey = (repo.pinned || []).join(',')

  // 后端顺序/收藏变化时同步到本地状态。
  useEffect(() => {
    setOrder((projects || []).map((p) => p.id))
  }, [projKey])
  useEffect(() => {
    setPinned(repo.pinned || [])
  }, [pinKey])

  // 记录每个项目当前停留的视图，以及最近访问时间。
  useEffect(() => {
    const m = loc.pathname.match(/^\/p\/([^/]+)(\/.*)?$/)
    if (!m) return
    const id = decodeURIComponent(m[1])
    let rest = m[2] || '/'
    if (!VIEW_PATHS.has(rest)) rest = '/issues'
    mem.current[id] = rest
    saveJSON(MEM_KEY, mem.current)
    setVisits((v) => {
      const now = Date.now()
      if (v[id] && now - v[id] < 60_000) return v
      const next = { ...v, [id]: now }
      saveJSON(VISIT_KEY, next)
      return next
    })
  }, [loc.pathname])

  // 各项目进行中/逾期数量，作为侧栏徽标。
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

  function projectViews(id: string): ViewDef[] {
    const all: ViewDef[] = [
      { to: projectPath(id, '/issues'), label: t('任务'), icon: <UnorderedListOutlined /> },
      { to: projectPath(id, '/board'), label: t('看板'), icon: <ProjectOutlined />, show: schema.modules.board },
      { to: projectPath(id, '/gantt'), label: t('甘特'), icon: <BarsOutlined />, show: schema.modules.gantt },
      { to: projectPath(id, '/docs'), label: t('文档'), icon: <BookOutlined />, show: schema.modules.docs },
      { to: projectPath(id, '/search'), label: t('搜索'), icon: <SearchOutlined />, show: schema.modules.search },
    ]
    return all.filter((v) => v.show !== false)
  }

  // 根项目的展开视图：multi 下是聚合层，single 下就是自身的普通视图。
  const rootViews: ViewDef[] = multi
    ? [
        { to: projectPath(ROOT_PID, '/'), label: t('总览'), icon: <ApartmentOutlined />, end: true },
        { to: projectAggPath(ROOT_PID, '/issues'), label: t('全部任务'), icon: <UnorderedListOutlined /> },
        { to: projectAggPath(ROOT_PID, '/board'), label: t('全部看板'), icon: <ProjectOutlined />, show: schema.modules.board },
        { to: projectAggPath(ROOT_PID, '/gantt'), label: t('全部甘特'), icon: <BarsOutlined />, show: schema.modules.gantt },
        { to: projectAggPath(ROOT_PID, '/search'), label: t('全部搜索'), icon: <SearchOutlined />, show: schema.modules.search },
      ]
    : [
        { to: projectPath(ROOT_PID, '/'), label: t('首页'), icon: <HomeOutlined />, end: true },
        ...projectViews(ROOT_PID),
      ]

  const cls =
    (base: string) =>
    ({ isActive }: { isActive: boolean }) =>
      base + (isActive ? ' active' : '')

  // ---- 项目分组：收藏 / 全部项目 ----
  const byId = useMemo(() => {
    const m = new Map<string, ProjectMeta>()
    for (const p of projects || []) m.set(p.id, p)
    return m
  }, [projKey])

  const orderedIds = (order.length ? order : (projects || []).map((p) => p.id)).filter((id) => byId.has(id))
  const pinnedSet = new Set(pinned)
  const pinnedList = orderedIds.filter((id) => pinnedSet.has(id)).map((id) => byId.get(id)!)
  const restList = orderedIds.filter((id) => !pinnedSet.has(id)).map((id) => byId.get(id)!)
  // “最近访问”只做行内标记，不再把项目搬位置，保持列表顺序稳定。
  const recentSet = new Set(
    restList
      .filter((p) => visits[p.id])
      .sort((a, b) => visits[b.id] - visits[a.id])
      .slice(0, RECENT_LIMIT)
      .map((p) => p.id),
  )

  async function persist(nextPinned: string[], nextOrder: string[]) {
    try {
      await api.saveProjectOrder(nextPinned, nextOrder)
      await reload()
    } catch {
      /* 忽略：留待下次刷新回滚 */
    }
  }

  function togglePin(id: string) {
    const next = pinnedSet.has(id) ? pinned.filter((x) => x !== id) : [...pinned, id]
    setPinned(next)
    persist(next, orderedIds)
  }

  function dropOn(targetId: string, group: 'pinned' | 'plain') {
    const from = dragId
    setDragId(null)
    setOverId(null)
    if (!from || from === targetId) return
    const fromGroup: 'pinned' | 'plain' = pinnedSet.has(from) ? 'pinned' : 'plain'
    if (fromGroup !== group) return
    const next = orderedIds.slice()
    const fi = next.indexOf(from)
    const ti = next.indexOf(targetId)
    if (fi < 0 || ti < 0) return
    next.splice(fi, 1)
    next.splice(ti, 0, from)
    setOrder(next)
    persist(pinned, next)
  }

  function renderProject(p: ProjectMeta, group: ProjGroup) {
    const active = p.id === projectId
    const st = stats[p.id]
    const doing = st?.doing ?? 0
    const overdue = st?.overdue ?? 0
    const isPinned = pinnedSet.has(p.id)
    const dragOver = overId === p.id && dragId && dragId !== p.id
    return (
      <div key={p.id} className={'sb-proj' + (active ? ' active' : '') + (dragOver ? ' drag-over' : '')}>
        <div
          className="sb-proj-top"
          draggable
          onDragStart={(e) => {
            setDragId(p.id)
            e.dataTransfer.effectAllowed = 'move'
          }}
          onDragOver={(e) => {
            if (dragId && dragId !== p.id) {
              e.preventDefault()
              e.dataTransfer.dropEffect = 'move'
              setOverId(p.id)
            }
          }}
          onDragLeave={() => setOverId((v) => (v === p.id ? null : v))}
          onDrop={(e) => {
            e.preventDefault()
            dropOn(p.id, isPinned ? 'pinned' : 'plain')
          }}
          onDragEnd={() => {
            setDragId(null)
            setOverId(null)
          }}
        >
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
          </Link>
          {!isPinned && recentSet.has(p.id) && <span className="sb-recent-dot" title={t('最近')} />}
          {st && overdue > 0 ? (
            <span className="sb-badge overdue sb-text" title={`${t('逾期')} ${overdue}`}>
              {overdue}
            </span>
          ) : st && doing > 0 ? (
            <span className="sb-badge sb-text" title={`${t('进行中')} ${doing}`}>
              {doing}
            </span>
          ) : null}
          <button
            className={'sb-pin' + (isPinned ? ' on' : '')}
            title={isPinned ? t('取消置顶') : t('置顶')}
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              togglePin(p.id)
            }}
          >
            {isPinned ? <PushpinFilled /> : <PushpinOutlined />}
          </button>
        </div>
        {active && (
          <div className="sb-sub">
            {projectViews(p.id).map((v) => (
              <NavLink key={v.to} to={v.to} end={v.end} title={v.label} className={cls('sb-item')}>
                <span className="sb-ico">{v.icon}</span>
                <span className="sb-text">{v.label}</span>
              </NavLink>
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <>
      <aside className={'sidebar' + (collapsed ? ' collapsed' : '')}>
        <div className="sb-scroll">
          {/* 项目树根节点：仓库本身，也是聚合层的入口 */}
          <NavLink
            to={projectPath(ROOT_PID, '/')}
            end
            title={workspaceName}
            className={cls('sb-program') + (atRoot ? ' active' : '')}
          >
            <span className="sb-logo">
              <img src="/logo.png" alt="Vellum" className="sb-logo-img" />
            </span>
            <span className="sb-text sb-program-name">{workspaceName}</span>
          </NavLink>

          {/* 根项目视图：multi 下为聚合层（全部任务…），single 下为自身的普通视图 */}
          <div className="sb-views">
            {rootViews
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

          {multi && (
            <>
              {pinnedList.length > 0 && (
                <>
                  <div className="sb-sep">
                    <span className="sb-text">{t('收藏')}</span>
                  </div>
                  <div className="sb-projects">{pinnedList.map((p) => renderProject(p, 'pinned'))}</div>
                </>
              )}
              {restList.length > 0 && (
                <>
                  <div className="sb-sep">
                    <span className="sb-text">{pinnedList.length ? t('全部项目') : t('项目')}</span>
                  </div>
                  <div className="sb-projects">{restList.map((p) => renderProject(p, 'plain'))}</div>
                </>
              )}
              <button className="sb-add" onClick={() => setCreating(true)} title={t('新建项目')}>
                <PlusOutlined /> <span className="sb-text">{t('新建项目')}</span>
              </button>
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