import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Input, Modal } from 'antd'
import {
  HomeOutlined,
  PlusOutlined,
  ProjectOutlined,
  SearchOutlined,
  SyncOutlined,
  UnorderedListOutlined,
} from '@ant-design/icons'

import { api } from '../api'
import { useApp } from '../context'
import { t } from '../i18n'
import { ROOT_PID, projectPath, useGo } from '../nav'
import { openPalette } from '../bus'
import type { Issue, SearchHit } from '../types'
import { StatusTag } from './tags'

interface Item {
  key: string
  kind: 'action' | 'issue'
  icon?: React.ReactNode
  label: string
  hint?: string
  onRun: () => void
}

export default function CommandPalette({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const { schema, repo, aggregate: program } = useApp()
  const nav = useGo()
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [sel, setSel] = useState(0)
  const [busy, setBusy] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open) {
      setQ('')
      setHits([])
      setSel(0)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const term = q.trim()
    if (!term) {
      setHits([])
      return
    }
    let alive = true
    setBusy(true)
    const id = setTimeout(() => {
      api
        .search(term)
        .then((d) => alive && setHits((d.hits || []).slice(0, 8)))
        .catch(() => {})
        .finally(() => alive && setBusy(false))
    }, 140)
    return () => {
      alive = false
      clearTimeout(id)
    }
  }, [q, open])

  const actions: Item[] = useMemo(() => {
    const go = (to: string) => () => {
      onClose()
      nav(to)
    }
    const list: Item[] = []
    // 项目集作用域下没有可写的项目：新建/文档/设置仍属具体项目，不在此列出。
    if (!program)
      list.push({ key: 'new', kind: 'action', icon: <PlusOutlined />, label: t('新建任务'), hint: 'N', onRun: go('/new') })
    list.push({ key: 'home', kind: 'action', icon: <HomeOutlined />, label: t('前往首页'), onRun: go('/') })
    list.push({ key: 'issues', kind: 'action', icon: <UnorderedListOutlined />, label: t('任务列表'), onRun: go('/issues') })
    if (schema.modules.board) list.push({ key: 'board', kind: 'action', icon: <ProjectOutlined />, label: t('看板'), onRun: go('/board') })
    if (schema.modules.gantt) list.push({ key: 'gantt', kind: 'action', icon: <ProjectOutlined />, label: t('甘特图'), onRun: go('/gantt') })
    if (schema.modules.docs && !program) list.push({ key: 'docs', kind: 'action', icon: <SearchOutlined />, label: t('文档'), onRun: go('/docs') })
    list.push({ key: 'projects', kind: 'action', icon: <HomeOutlined />, label: repo.mode === 'multi' ? t('项目集总览') : t('转为项目集'), onRun: go(projectPath(ROOT_PID, '/')) })
    if (!program) list.push({ key: 'settings', kind: 'action', icon: <UnorderedListOutlined />, label: t('设置'), onRun: go('/settings') })
    if (schema.modules.search) list.push({ key: 'search', kind: 'action', icon: <SearchOutlined />, label: t('搜索'), onRun: go('/search') })
    if (repo.hasRemote)
      list.push({
        key: 'sync',
        kind: 'action',
        icon: <SyncOutlined />,
        label: t('同步仓库'),
        onRun: async () => {
          onClose()
          try {
            await api.sync()
          } catch {
            /* ignore */
          }
          location.reload()
        },
      })
    return list
  }, [schema.modules, repo.hasRemote, repo.mode, program, nav, onClose])

  const filteredActions = useMemo(() => {
    const term = q.trim().toLowerCase()
    if (!term) return actions
    return actions.filter((a) => a.label.toLowerCase().includes(term))
  }, [actions, q])

  const issueItems: Item[] = hits.map((h) => ({
    key: `i:${h.issue.project || ''}:${h.issue.id}`,
    kind: 'issue',
    label: h.issue.title,
    hint: program && h.issue.project ? `${h.issue.project} · ${h.issue.id}` : h.issue.id,
    onRun: () => {
      onClose()
      if (program) nav(projectPath(h.issue.project || ROOT_PID, `/issue/${h.issue.id}`))
      else nav(`/issue/${h.issue.id}`)
    },
  }))

  const items = [...filteredActions, ...issueItems]

  useEffect(() => setSel(0), [q])

  const run = useCallback(
    (i: number) => {
      const it = items[i]
      if (it) it.onRun()
    },
    [items],
  )

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSel((s) => Math.min(s + 1, items.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSel((s) => Math.max(s - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      run(sel)
    }
  }

  useEffect(() => {
    const el = listRef.current?.querySelector('.palette-item.sel')
    el?.scrollIntoView({ block: 'nearest' })
  }, [sel])

  let idx = -1

  return (
    <Modal
      className="palette"
      open={open}
      onCancel={onClose}
      footer={null}
      closable={false}
      width={560}
      styles={{ body: { padding: 0 } }}
      destroyOnClose
    >
      <Input
        className="palette-input"
        autoFocus
        variant="borderless"
        placeholder={t('搜索任务，或输入命令…')}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={onKeyDown}
        suffix={<span className="kbd">Esc</span>}
      />
      <div className="palette-list" ref={listRef}>
        {filteredActions.length > 0 && (
          <>
            <div className="palette-group">{t('操作')}</div>
            {filteredActions.map((it) => {
              idx++
              const i = idx
              return (
                <div
                  key={it.key}
                  className={`palette-item${sel === i ? ' sel' : ''}`}
                  onMouseEnter={() => setSel(i)}
                  onClick={() => run(i)}
                >
                  <span style={{ width: 18, textAlign: 'center', color: 'var(--ink-soft)' }}>{it.icon}</span>
                  <span className="pi-title">{it.label}</span>
                  {it.hint && <span className="kbd">{it.hint}</span>}
                </div>
              )
            })}
          </>
        )}
        {issueItems.length > 0 && (
          <>
            <div className="palette-group">{t('任务')}</div>
            {issueItems.map((it) => {
              idx++
              const i = idx
              const issue = hits[i - filteredActions.length]?.issue as Issue
              return (
                <div
                  key={it.key}
                  className={`palette-item${sel === i ? ' sel' : ''}`}
                  onMouseEnter={() => setSel(i)}
                  onClick={() => run(i)}
                >
                  <span className="stamp">{issue?.id}</span>
                  <span className="pi-title">{it.label}</span>
                  <StatusTag id={issue?.status} />
                </div>
              )
            })}
          </>
        )}
        {items.length === 0 && (
          <div className="palette-empty">
            {busy ? t('检索中…') : q ? t('没有匹配结果') : t('输入以搜索任务')}
          </div>
        )}
      </div>
    </Modal>
  )
}

// 供 Nav 上的按钮复用
export { openPalette }