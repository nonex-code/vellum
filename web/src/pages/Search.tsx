import { useEffect, useRef, useState } from 'react'
import { App as AntApp, Empty, Input, List, Space, Tag } from 'antd'

import { api } from '../api'
import { useApp } from '../context'
import { t } from '../i18n'
import { ROOT_PID, projectPath, useGo } from '../nav'
import type { SearchHit } from '../types'
import { fromNow } from '../util'
import { PriorityText, StatusTag } from '../components/tags'

function escapeReg(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function highlight(text: string, q: string) {
  const terms = q.trim().split(/\s+/).filter(Boolean).map(escapeReg)
  if (terms.length === 0) return text
  const re = new RegExp(`(${terms.join('|')})`, 'gi')
  const parts = text.split(re)
  return parts.map((part, i) =>
    re.test(part) ? (
      <mark key={i} className="hl">
        {part}
      </mark>
    ) : (
      <span key={i}>{part}</span>
    ),
  )
}

export default function Search() {
  const nav = useGo()
  const { schema, aggregate: program } = useApp()
  const { message } = AntApp.useApp()
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  const timer = useRef<number | undefined>(undefined)

  function run(value: string, immediate = false) {
    if (timer.current) window.clearTimeout(timer.current)
    const go = async () => {
      const v = value.trim()
      if (!v) {
        setHits([])
        setDone(false)
        setLoading(false)
        return
      }
      setLoading(true)
      try {
        const d = await api.search(v)
        setHits(d.hits || [])
        setDone(true)
      } catch (e) {
        message.error((e as Error).message)
      } finally {
        setLoading(false)
      }
    }
    if (immediate) go()
    else timer.current = window.setTimeout(go, 220)
  }

  useEffect(() => {
    run(q)
    return () => {
      if (timer.current) window.clearTimeout(timer.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q])

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-kicker">
            {t('全文检索')}
            {program && ` · ${t('全部项目')}`}
          </div>
          <h1 className="page-title">{t('搜索')}</h1>
        </div>
      </div>

      <Input.Search
        size="large"
        allowClear
        autoFocus
        value={q}
        placeholder={t('搜索标题、正文、标签、编号与跟进内容')}
        onChange={(e) => setQ(e.target.value)}
        onSearch={(v) => run(v, true)}
        style={{ marginBottom: 16 }}
      />

      {done && !loading && (
        <div className="search-count">
          {hits.length > 0 ? (
            <>
              {t('找到')} <b>{hits.length}</b> {t('条与「{query}」相关的结果', { query: q.trim() })}
            </>
          ) : (
            <>{t('没有与「{query}」匹配的内容', { query: q.trim() })}</>
          )}
        </div>
      )}

      <List
        loading={loading}
        dataSource={hits}
        locale={{
          emptyText: (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={done ? t('换个关键词试试') : t('输入关键词开始检索')}
            />
          ),
        }}
        renderItem={(h) => (
          <List.Item
            className="search-item"
            style={{ cursor: 'pointer', alignItems: 'flex-start' }}
            onClick={() =>
              program
                ? nav(projectPath(h.issue.project || ROOT_PID, `/issue/${h.issue.id}`))
                : nav(`/issue/${h.issue.id}`)
            }
          >
            <div style={{ width: '100%' }}>
              <Space size={12} wrap style={{ marginBottom: 4 }}>
                {program && <Tag className="project-tag">{h.issue.project}</Tag>}
                <span className="stamp">{h.issue.id}</span>
                <StatusTag id={h.issue.status} />
                <PriorityText id={h.issue.priority} />
                <span className="mono">{fromNow(h.issue.updated)}</span>
                {(h.issue.labels || []).slice(0, 3).map((l) => {
                  const def = schema.labels.find((x) => x.id === l)
                  return (
                    <Tag key={l} color={def?.color}>
                      {def?.name || l}
                    </Tag>
                  )
                })}
              </Space>
              <div className="search-title">{highlight(h.issue.title, q)}</div>
              {h.snippet && <div className="search-snippet">{highlight(h.snippet, q)}</div>}
            </div>
          </List.Item>
        )}
      />
    </>
  )
}
