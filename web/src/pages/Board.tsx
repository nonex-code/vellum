import { useCallback, useEffect, useState } from 'react'
import { App as AntApp, Button, Input, Skeleton, Space, Tag } from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'

import { api } from '../api'
import { useApp } from '../context'
import { t } from '../i18n'
import type { Issue } from '../types'
import { fromNow } from '../util'
import { PriorityText, StatusTag } from '../components/tags'

export default function Board() {
  const { schema } = useApp()
  const nav = useNavigate()
  const { message } = AntApp.useApp()
  const [issues, setIssues] = useState<Issue[]>([])
  const [loading, setLoading] = useState(true)
  const [dragId, setDragId] = useState<string | null>(null)
  const [over, setOver] = useState<string | null>(null)
  const [addCol, setAddCol] = useState<string | null>(null)
  const [addTitle, setAddTitle] = useState('')
  const [addSaving, setAddSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const d = await api.listIssues()
      setIssues(d.issues || [])
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [message])

  useEffect(() => {
    load()
  }, [load])

  async function drop(status: string) {
    const id = dragId
    setDragId(null)
    setOver(null)
    if (!id) return
    const cur = issues.find((i) => i.id === id)
    if (!cur || cur.status === status) return
    setIssues((list) => list.map((i) => (i.id === id ? { ...i, status } : i)))
    try {
      await api.patchIssue(id, { status })
    } catch (e) {
      message.error((e as Error).message)
      load()
    }
  }

  async function createInCol(colId: string) {
    const trimmed = addTitle.trim()
    if (!trimmed) {
      setAddCol(null)
      return
    }
    setAddSaving(true)
    try {
      await api.createIssue({ title: trimmed, status: colId })
      setAddTitle('')
      setAddCol(null)
      await load()
      message.success(t('已创建任务'))
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setAddSaving(false)
    }
  }

  const labelDef = (id: string) => schema.labels.find((l) => l.id === id)

  if (loading) {
    return (
      <div className="fade">
        <div className="page-header">
          <div>
            <div className="page-kicker">{t('载入中…')}</div>
            <h1 className="page-title">{t('看板')}</h1>
          </div>
        </div>
        <div className="board">
          {schema.statuses.slice(0, 4).map((c) => (
            <div className="board-col" key={c.id}>
              <Skeleton active paragraph={{ rows: 4 }} />
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-kicker">{loading ? t('载入中…') : t('{count} 个任务', { count: issues.length })}</div>
          <h1 className="page-title">{t('看板')}</h1>
        </div>
      </div>

      <div className="board">
        {schema.statuses.map((col) => {
          const items = issues.filter((i) => i.status === col.id)
          return (
            <div
              key={col.id}
              className={`board-col${over === col.id ? ' is-over' : ''}`}
              onDragOver={(e) => {
                e.preventDefault()
                if (over !== col.id) setOver(col.id)
              }}
              onDragLeave={() => setOver((o) => (o === col.id ? null : o))}
              onDrop={() => drop(col.id)}
            >
              <div className="board-col-head">
                <StatusTag id={col.id} />
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span className="mono">{items.length}</span>
                  <Button
                    type="text"
                    size="small"
                    icon={<PlusOutlined />}
                    onClick={() => {
                      setAddTitle('')
                      setAddCol((c) => (c === col.id ? null : col.id))
                    }}
                    title={t('在「{name}」快速添加', { name: col.name })}
                  />
                </span>
              </div>
              <div className="board-col-body">
                {addCol === col.id && (
                  <div className="board-add">
                    <Input
                      autoFocus
                      size="small"
                      placeholder={t('任务标题，回车创建')}
                      value={addTitle}
                      onChange={(e) => setAddTitle(e.target.value)}
                      onPressEnter={() => createInCol(col.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') {
                          setAddCol(null)
                          setAddTitle('')
                        }
                      }}
                    />
                    <Space size={6} style={{ marginTop: 6 }}>
                      <Button
                        size="small"
                        type="primary"
                        loading={addSaving}
                        onClick={() => createInCol(col.id)}
                      >
                        {t('添加')}
                      </Button>
                      <Button
                        size="small"
                        onClick={() => {
                          setAddCol(null)
                          setAddTitle('')
                        }}
                      >
                        {t('取消')}
                      </Button>
                    </Space>
                  </div>
                )}
                {items.length === 0 && addCol !== col.id && (
                  <div className="board-empty" style={{ color: 'var(--ink-faint)', fontSize: 13 }}>
                    {t('拖任务到这里')}
                  </div>
                )}
                {items.map((i) => (
                  <article
                    key={i.id}
                    className={`board-card${dragId === i.id ? ' is-drag' : ''}`}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData('text/plain', i.id)
                      e.dataTransfer.effectAllowed = 'move'
                      setDragId(i.id)
                    }}
                    onDragEnd={() => {
                      setDragId(null)
                      setOver(null)
                    }}
                    onClick={() => nav(`/issue/${i.id}`)}
                  >
                    <div className="board-card-top">
                      <span className="stamp">{i.id}</span>
                      <PriorityText id={i.priority} />
                    </div>
                    <div className="board-card-title">{i.title}</div>
                    <div className="board-card-foot">
                      <span>
                        {(i.labels || []).slice(0, 3).map((l) => (
                          <Tag key={l} color={labelDef(l)?.color} style={{ marginInlineEnd: 4 }}>
                            {labelDef(l)?.name || l}
                          </Tag>
                        ))}
                      </span>
                      <span className="mono">{fromNow(i.updated)}</span>
                    </div>
                    {i.assignee && <div className="board-card-assignee">@{i.assignee}</div>}
                  </article>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}