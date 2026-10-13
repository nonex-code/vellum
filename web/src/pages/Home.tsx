import { useCallback, useEffect, useState } from 'react'
import { App as AntApp, Select, Skeleton } from 'antd'
import {
  ClockCircleOutlined,
  FireOutlined,
  PlusOutlined,
  ProjectOutlined,
  SearchOutlined,
  UnorderedListOutlined,
} from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'

import { api } from '../api'
import { useApp } from '../context'
import { intlLocale, t } from '../i18n'
import type { Overview } from '../types'
import { fromNow } from '../util'
import { StatusTag } from '../components/tags'

function greeting() {
  const h = new Date().getHours()
  if (h < 6) return t('凌晨好')
  if (h < 12) return t('早上好')
  if (h < 14) return t('中午好')
  if (h < 18) return t('下午好')
  return t('晚上好')
}

export default function Home() {
  const { schema, repo } = useApp()
  const nav = useNavigate()
  const { message } = AntApp.useApp()
  const [ov, setOv] = useState<Overview | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      setOv(await api.overview())
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [message])

  useEffect(() => {
    load()
  }, [load])

  async function quickStatus(id: string, status: string) {
    try {
      await api.patchIssue(id, { status })
      message.success(t('已更新状态'))
      load()
    } catch (e) {
      message.error((e as Error).message)
    }
  }

  if (loading) return <HomeSkeleton />
  if (!ov) return null

  const total = ov.counts.total || 0
  const colorOf = (id: string) => schema.statuses.find((s) => s.id === id)?.color || '#9aa0a6'
  const projectName = repo.projectMeta?.name
  const title = schema.workspace?.mode === 'multi' && projectName ? projectName : schema.workspace?.name

  const statusSegs = ov.byStatus.filter((s) => s.count > 0)
  const maxStatus = Math.max(total, 1)

  const mini = (i: (typeof ov.active)[number], showSelect = false) => (
    <div key={i.id} className="mini-issue" onClick={() => nav(`/issue/${i.id}`)}>
      <span className="stamp">{i.id}</span>
      <span className="mi-title">{i.title}</span>
      {showSelect ? (
        <span onClick={(e) => e.stopPropagation()}>
          <Select
            size="small"
            variant="borderless"
            value={i.status}
            style={{ width: 96 }}
            onChange={(v) => quickStatus(i.id, v)}
            options={schema.statuses.map((s) => ({ value: s.id, label: s.name }))}
          />
        </span>
      ) : (
        <StatusTag id={i.status} />
      )}
      <span className="mi-meta">{fromNow(i.updated)}</span>
    </div>
  )

  return (
    <>
      <div className="home-head rise">
        <div className="home-hello">
          {greeting()} ·{' '}
          {new Date().toLocaleDateString(intlLocale(), { month: 'long', day: 'numeric', weekday: 'long' })}
        </div>
        <h1 className="home-title">{title}</h1>
        <p className="home-sub">
          {t('共 {total} 个任务，{active} 个进行中；本周新增 {created} 个、完成 {done} 个。', {
            total,
            active: ov.counts.active,
            created: ov.weekCreated,
            done: ov.weekDone,
          })}
        </p>
      </div>

      <div className="quick-row rise" style={{ animationDelay: '40ms' }}>
        <div className="quick" onClick={() => nav('/new')}>
          <PlusOutlined className="q-ico" /> {t('新建任务')}
        </div>
        <div className="quick" onClick={() => nav('/issues')}>
          <UnorderedListOutlined className="q-ico" /> {t('全部任务')}
        </div>
        {schema.modules.board && (
          <div className="quick" onClick={() => nav('/board')}>
            <ProjectOutlined className="q-ico" /> {t('打开看板')}
          </div>
        )}
        {schema.modules.search && (
          <div className="quick" onClick={() => nav('/search')}>
            <SearchOutlined className="q-ico" /> {t('搜索')}
          </div>
        )}
      </div>

      <div className="stat-grid rise" style={{ animationDelay: '80ms' }}>
        <Stat
          n={ov.counts.todo}
          label={t('待办')}
          color={colorOf('todo')}
          onClick={() => nav('/issues?status=todo')}
        />
        <Stat
          n={ov.counts.active}
          label={t('进行中')}
          color={colorOf('doing')}
          onClick={() => nav('/issues?status=doing')}
        />
        <Stat
          n={ov.counts.done}
          label={t('已完成')}
          color={colorOf('done')}
          onClick={() => nav('/issues?status=done')}
        />
        <Stat n={ov.weekDone} label={t('本周完成')} color="var(--ok)" />
      </div>

      {statusSegs.length > 0 && (
        <div className="distbar rise" style={{ animationDelay: '120ms' }}>
          {statusSegs.map((s) => (
            <span
              key={s.id}
              title={`${s.name} ${s.count}`}
              style={{ width: `${(s.count / maxStatus) * 100}%`, background: s.color || '#9aa0a6' }}
            />
          ))}
        </div>
      )}

      <div className="home-grid">
        <div className="rise" style={{ animationDelay: '160ms' }}>
          <div className="panel-block">
            <div className="block-head">
              <span className="block-title">{t('进行中')}</span>
              <span className="block-count">{ov.active.length}</span>
            </div>
            {ov.active.length === 0 ? (
              <Empty text={t('现在没有进行中的任务')} />
            ) : (
              ov.active.map((i) => mini(i, true))
            )}
          </div>

          <div className="panel-block">
            <div className="block-head">
              <span className="block-title">
                <FireOutlined style={{ color: 'var(--accent)', marginRight: 6 }} />
                {t('需关注')}
              </span>
              <span className="block-count">{ov.focus.length}</span>
            </div>
            {ov.focus.length === 0 ? (
              <Empty text={t('没有高优先级或紧急的未完成任务')} />
            ) : (
              ov.focus.map((i) => mini(i))
            )}
          </div>

          {schema.modules.milestones && ov.milestones.length > 0 && (
            <div className="panel-block">
              <div className="block-head">
                <span className="block-title">{t('里程碑')}</span>
              </div>
              {ov.milestones.map((m) => (
                <div className="ms-row" key={m.id}>
                  <div className="ms-head">
                    <span>{m.name}</span>
                    <span className="mono" style={{ color: 'var(--ink-faint)' }}>
                      {m.done}/{m.total}
                    </span>
                  </div>
                  <div className="ms-track">
                    <div
                      className="ms-fill"
                      style={{ width: `${m.total ? (m.done / m.total) * 100 : 0}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rise" style={{ animationDelay: '200ms' }}>
          <div className="panel-block">
            <div className="block-head">
              <span className="block-title">
                <ClockCircleOutlined style={{ marginRight: 6 }} />
                {t('最近动态')}
              </span>
            </div>
            {ov.recent.length === 0 ? (
              <Empty text={t('还没有任何跟进')} />
            ) : (
              ov.recent.map((a, i) => (
                <div className="act-item" key={`${a.issueId}-${i}`}>
                  <span className="act-dot" style={{ background: colorOf(a.status) }} />
                  <div className="act-body">
                    <div className="act-head">
                      {a.entry.type === 'status'
                        ? `${t('状态变更')} · `
                        : a.entry.type === 'attachment'
                          ? `${t('附件')} · `
                          : a.entry.type === 'create'
                            ? t('创建 · ')
                            : ''}
                      <span className="act-target" onClick={() => nav(`/issue/${a.issueId}`)}>
                        {a.issueId}
                      </span>{' '}
                      {a.title}
                    </div>
                    <div className="act-text">
                      {a.entry.type === 'status'
                        ? `${schema.statuses.find((s) => s.id === a.entry.from)?.name || a.entry.from} → ${
                            schema.statuses.find((s) => s.id === a.entry.to)?.name || a.entry.to
                          }`
                        : a.entry.body}
                    </div>
                  </div>
                  <span className="act-time">{fromNow(a.entry.created)}</span>
                </div>
              ))
            )}
          </div>

          {ov.stale.length > 0 && (
            <div className="panel-block">
              <div className="block-head">
                <span className="block-title">{t('停滞超过一周')}</span>
                <span className="block-count">{ov.stale.length}</span>
              </div>
              {ov.stale.map((i) => mini(i))}
            </div>
          )}

          {Object.keys(ov.assignees).length > 0 && (
            <div className="panel-block">
              <div className="block-head">
                <span className="block-title">{t('负责人负载（未完成）')}</span>
              </div>
              {Object.entries(ov.assignees).map(([a, n]) => (
                <div className="ms-row" key={a}>
                  <div className="ms-head">
                    <span>@{a}</span>
                    <span className="mono" style={{ color: 'var(--ink-faint)' }}>
                      {n}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  )
}

function Stat({ n, label, color, onClick }: { n: number; label: string; color: string; onClick?: () => void }) {
  return (
    <div className={`stat${onClick ? ' clickable' : ''}`} onClick={onClick}>
      <div className="stat-num" style={{ color }}>
        {n}
      </div>
      <div className="stat-label">
        <span className="stat-dot" style={{ background: color }} />
        {label}
      </div>
    </div>
  )
}

function Empty({ text }: { text: string }) {
  return <div style={{ padding: '10px 2px 12px', color: 'var(--ink-faint)', fontSize: 13.5 }}>{text}</div>
}

function HomeSkeleton() {
  return (
    <div className="fade">
      <Skeleton.Input active style={{ width: 160, height: 14 }} />
      <Skeleton.Input active style={{ width: 320, height: 32, marginTop: 14, display: 'block' }} />
      <div className="stat-grid" style={{ marginTop: 26 }}>
        {[0, 1, 2, 3].map((i) => (
          <div className="stat" key={i}>
            <Skeleton active paragraph={{ rows: 1, width: '60%' }} title={{ width: '40%' }} />
          </div>
        ))}
      </div>
      <div className="home-grid">
        <div className="panel-block">
          <Skeleton active paragraph={{ rows: 5 }} />
        </div>
        <div className="panel-block">
          <Skeleton active paragraph={{ rows: 5 }} />
        </div>
      </div>
    </div>
  )
}