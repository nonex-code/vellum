import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { App as AntApp, Button, Empty, Segmented, Skeleton, Tooltip } from 'antd'
import { AimOutlined, ReloadOutlined } from '@ant-design/icons'
import { useGo } from '../nav'
import dayjs from 'dayjs'

import { api } from '../api'
import { useApp } from '../context'
import { intlLocale, t } from '../i18n'
import { ROOT_PID, projectPath } from '../nav'
import type { GanttGroup, GanttItem } from '../types'

type Zoom = 'week' | 'month'

const LEFT_W = 280 // 左侧固定列宽
const ROW_H = 34 // 行高
const HEAD_H = 52 // 表头高（月 26 + 周 26）
const DAY_W: Record<Zoom, number> = { week: 34, month: 9 } // 每天像素宽

const isUnscheduled = (g: GanttGroup) => g.id === '' || g.name === '未排期'
const gkey = (g: GanttGroup) => g.id || g.name

function pd(s?: string): dayjs.Dayjs | null {
  if (!s) return null
  const d = dayjs(s)
  return d.isValid() ? d.startOf('day') : null
}

const mondayOf = (d: dayjs.Dayjs) => d.subtract((d.day() + 6) % 7, 'day')

// 月轴标签：中文是「2026年10月 / 10月」，英文交给 Intl 取缩写月名。
function monthLabel(d: dayjs.Dayjs, withYear: boolean): string {
  return new Intl.DateTimeFormat(
    intlLocale(),
    withYear ? { year: 'numeric', month: 'short' } : { month: 'short' },
  ).format(d.toDate())
}

const CSS = `
.wb-g-card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); box-shadow: var(--shadow-sm); overflow: hidden; }
.wb-g-scroll { overflow: auto; max-height: calc(100vh - 300px); min-height: 300px; }
.wb-g-scroll::-webkit-scrollbar { height: 10px; width: 10px; }
.wb-g-scroll::-webkit-scrollbar-thumb { background: var(--border-strong); border-radius: 6px; }
.wb-g-scroll::-webkit-scrollbar-track { background: transparent; }
.wb-g-head { position: sticky; top: 0; z-index: 5; display: flex; background: var(--surface-2); border-bottom: 1px solid var(--border-strong); }
.wb-g-corner { flex: none; width: ${LEFT_W}px; position: sticky; left: 0; z-index: 6; background: var(--surface-2); border-right: 1px solid var(--border-strong); display: flex; align-items: flex-end; padding: 0 12px 6px; font-family: 'IBM Plex Mono', monospace; font-size: 11px; color: var(--ink-faint); }
.wb-g-hcol { flex: none; }
.wb-g-hrow { display: flex; height: 26px; }
.wb-g-hcell { flex: none; display: flex; align-items: center; padding: 0 8px; font-family: 'IBM Plex Mono', monospace; font-size: 11px; color: var(--ink-soft); border-left: 1px solid var(--rule); overflow: hidden; white-space: nowrap; }
.wb-g-hcell.month { color: var(--ink); font-weight: 600; }
.wb-g-row { display: flex; height: ${ROW_H}px; border-bottom: 1px solid var(--rule); }
.wb-g-left { flex: none; width: ${LEFT_W}px; position: sticky; left: 0; z-index: 4; background: var(--surface); border-right: 1px solid var(--border); display: flex; align-items: center; gap: 8px; padding: 0 12px; }
.wb-g-track { flex: none; position: relative; }
.wb-g-row:hover .wb-g-left { background: var(--surface-2); }
.wb-g-ghead .wb-g-left { background: var(--rail-bg); }
.wb-g-ghead:hover .wb-g-left { background: var(--surface-3); }
.wb-g-hover { position: absolute; left: ${LEFT_W}px; background: color-mix(in srgb, var(--ink) 5%, transparent); pointer-events: none; z-index: 0; }
.wb-g-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; cursor: pointer; }
.wb-g-title:hover { color: var(--primary-ink); text-decoration: underline; }
.wb-g-title.is-done { color: var(--ink-faint); text-decoration: line-through; }
.wb-g-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13.5px; font-weight: 600; }
.wb-g-chev { border: none; background: none; cursor: pointer; color: var(--ink-faint); font-size: 10px; padding: 2px 4px; line-height: 1; }
.wb-g-chev:hover { color: var(--ink); }
.wb-g-dot { width: 8px; height: 8px; border-radius: 50%; flex: none; display: inline-block; }
.wb-g-bar { position: absolute; top: 9px; height: 16px; border-radius: 5px; display: flex; align-items: center; overflow: hidden; cursor: pointer; transition: box-shadow .12s, filter .12s; }
.wb-g-bar:hover { filter: brightness(1.06); box-shadow: var(--shadow-md); }
.wb-g-bar-label { color: rgba(255, 255, 255, .95); font-family: 'IBM Plex Mono', monospace; font-size: 10px; padding: 0 6px; white-space: nowrap; text-shadow: 0 0 3px rgba(0, 0, 0, .35); }
.wb-g-dia { position: absolute; width: 11px; height: 11px; transform: rotate(45deg); border-radius: 2px; top: 11px; cursor: pointer; border: 1px solid var(--surface); }
.wb-g-dia:hover { filter: brightness(1.12); }
.wb-g-gbar { position: absolute; top: 12px; height: 10px; border-radius: 5px; cursor: pointer; }
.wb-g-gbar:hover { filter: brightness(1.1); box-shadow: var(--shadow-sm); }
.wb-g-ghost { position: absolute; left: 10px; top: 0; height: 100%; display: flex; align-items: center; font-family: 'IBM Plex Mono', monospace; font-size: 11px; color: var(--ink-faint); }
.wb-g-grid { position: absolute; top: 0; bottom: 0; left: ${LEFT_W}px; right: 0; z-index: 0; pointer-events: none; }
.wb-g-vline { position: absolute; top: 0; bottom: 0; width: 1px; background: var(--rule); }
.wb-g-vline.m { background: var(--border-strong); }
.wb-g-today { position: absolute; top: ${HEAD_H - 6}px; bottom: 0; width: 2px; margin-left: -1px; background: var(--accent); z-index: 0; pointer-events: none; }
.wb-g-legend { display: flex; flex-wrap: wrap; gap: 14px; align-items: center; font-size: 12px; color: var(--ink-faint); margin: 10px 2px 12px; }
.wb-g-hint { background: var(--primary-weak); border: 1px solid var(--border); color: var(--ink-soft); padding: 10px 14px; border-radius: var(--radius-sm); font-size: 13px; margin-bottom: 14px; }
.wb-g-tip { font-size: 12px; line-height: 1.8; min-width: 170px; }
`

export default function Gantt() {
  const { schema, aggregate: program } = useApp()
  const nav = useGo()
  const { message } = AntApp.useApp()
  const [groups, setGroups] = useState<GanttGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [zoom, setZoom] = useState<Zoom>('week')
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set(['未排期']))
  const [hover, setHover] = useState<number | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const d = await api.gantt()
      const gs = d.groups || []
      setGroups(gs)
      setCollapsed((prev) =>
        prev.size === 1 && prev.has('未排期') ? new Set(gs.filter(isUnscheduled).map(gkey)) : prev
      )
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [message])

  useEffect(() => {
    load()
  }, [load])

  // 「未排期」组单独放最后，其余保持后端顺序
  const ordered = useMemo(
    () => [...groups.filter((g) => !isUnscheduled(g)), ...groups.filter(isUnscheduled)],
    [groups]
  )
  const totalItems = useMemo(() => groups.reduce((n, g) => n + g.items.length, 0), [groups])

  const today = useMemo(() => dayjs().startOf('day'), [])
  const dw = DAY_W[zoom]

  // 时间范围：覆盖所有日期 + 今天，向两端各留若干周
  const range = useMemo(() => {
    const ds: dayjs.Dayjs[] = [today]
    let hasAny = false
    for (const g of ordered) {
      const a = pd(g.start)
      const b = pd(g.end)
      if (a) {
        ds.push(a)
        hasAny = true
      }
      if (b) {
        ds.push(b)
        hasAny = true
      }
      for (const it of g.items) {
        const s = pd(it.start)
        const d = pd(it.due)
        if (s) {
          ds.push(s)
          hasAny = true
        }
        if (d) {
          ds.push(d)
          hasAny = true
        }
      }
    }
    let min = ds[0]
    let max = ds[0]
    for (const d of ds) {
      if (d.isBefore(min)) min = d
      if (d.isAfter(max)) max = d
    }
    const padW = zoom === 'week' ? 1 : 2
    const start = mondayOf(min).subtract(padW, 'week')
    const end = mondayOf(max).add(6, 'day').add(padW, 'week')
    return { start, end, days: end.diff(start, 'day') + 1, hasAny }
  }, [ordered, today, zoom])

  const bodyW = range.days * dw
  const xOf = (d: dayjs.Dayjs) => d.diff(range.start, 'day') * dw

  const weekTicks = useMemo(() => {
    const out: { left: number; width: number; label: string }[] = []
    for (let i = 0; i * 7 < range.days; i++) {
      const s = range.start.add(i * 7, 'day')
      const days = Math.min(7, range.days - i * 7)
      out.push({ left: i * 7 * dw, width: days * dw, label: s.format('M.D') })
    }
    return out
  }, [range, dw])

  // 按天序号切片，避免 dayjs 的时分秒在 diff 截断时少算一天。
  const monthTicks = useMemo(() => {
    const out: { left: number; width: number; label: string }[] = []
    let day = 0
    while (day < range.days) {
      const cur = range.start.add(day, 'day')
      const span = Math.min(cur.daysInMonth() - cur.date() + 1, range.days - day)
      const label = monthLabel(cur, cur.month() === 0 || day === 0)
      out.push({ left: day * dw, width: span * dw, label })
      day += span
    }
    return out
  }, [range, dw])

  const statusColor = (id: string) =>
    schema.statuses.find((s) => s.id === id)?.color || '#9aa0a6'
  const statusName = (id: string) => schema.statuses.find((s) => s.id === id)?.name || id

  const clampBar = (left: number, width: number) => {
    const l = Math.max(0, Math.min(left, Math.max(0, bodyW - 2)))
    const w = Math.max(Math.min(dw, 6), Math.min(width, bodyW - l))
    return { l, w }
  }

  function itemTip(it: GanttItem): ReactNode {
    return (
      <div className="wb-g-tip">
        <div className="mono" style={{ color: 'inherit' }}>{it.id}</div>
        <div style={{ fontWeight: 600, marginBottom: 2 }}>{it.title}</div>
        <div>{t('状态：{status}', { status: statusName(it.status) })}</div>
        <div>{t('负责人：{assignee}', { assignee: it.assignee ? `@${it.assignee}` : '—' })}</div>
        <div>{t('起止：{start} → {due}', { start: it.start || '—', due: it.due || '—' })}</div>
      </div>
    )
  }

  function goIssue(it: GanttItem) {
    if (program) nav(projectPath(it.project || ROOT_PID, `/issue/${it.id}`))
    else nav(`/issue/${it.id}`)
  }

  function renderItemBar(it: GanttItem): ReactNode {
    const color = statusColor(it.status)
    const op = it.done ? 0.45 : 1
    const s = pd(it.start)
    const d = pd(it.due)
    const overdue = !!d && d.isBefore(today) && !it.done

    if (s && d) {
      const { l, w } = clampBar(xOf(s), (d.diff(s, 'day') + 1) * dw)
      return (
        <Tooltip title={itemTip(it)} mouseEnterDelay={0.1}>
          <div
            className="wb-g-bar"
            style={{
              left: l,
              width: w,
              background: color,
              opacity: op,
              boxShadow: overdue ? '0 0 0 2px var(--accent)' : undefined,
            }}
            onClick={() => goIssue(it)}
          >
            {w >= 92 && (
              <span className="wb-g-bar-label">
                {s.format('M.D')}–{d.format('M.D')}
              </span>
            )}
          </div>
        </Tooltip>
      )
    }
    if (d) {
      // 只有截止日：菱形标记
      const x = Math.max(2, Math.min(xOf(d) + dw / 2 - 6, bodyW - 14))
      return (
        <Tooltip title={itemTip(it)} mouseEnterDelay={0.1}>
          <div
            className="wb-g-dia"
            style={{
              left: x,
              background: color,
              opacity: op,
              boxShadow: overdue ? '0 0 0 2px var(--accent)' : undefined,
            }}
            onClick={() => goIssue(it)}
          />
        </Tooltip>
      )
    }
    if (s) {
      // 只有开始日：从 start 画到今天（未来开始则画起点短条）
      const end = s.isAfter(today) ? s : today
      const { l, w } = clampBar(xOf(s), (end.diff(s, 'day') + 1) * dw)
      return (
        <Tooltip title={itemTip(it)} mouseEnterDelay={0.1}>
          <div
            className="wb-g-bar"
            style={{
              left: l,
              width: w,
              background: color,
              opacity: op,
              border: '1.5px dashed color-mix(in srgb, var(--surface) 72%, transparent)',
            }}
            onClick={() => goIssue(it)}
          >
            {w >= 92 && <span className="wb-g-bar-label">{t('{date} 起', { date: s.format('M.D') })}</span>}
          </div>
        </Tooltip>
      )
    }
    return <div className="wb-g-ghost">{t('未排期')}</div>
  }

  function toggleGroup(key: string) {
    setCollapsed((prev) => {
      const n = new Set(prev)
      if (n.has(key)) n.delete(key)
      else n.add(key)
      return n
    })
  }

  function scrollToToday(smooth: boolean) {
    const el = scrollRef.current
    if (!el) return
    const target = LEFT_W + xOf(today) + dw / 2 - el.clientWidth / 2
    el.scrollTo({ left: Math.max(0, target), behavior: smooth ? 'smooth' : 'auto' })
  }

  useEffect(() => {
    if (!loading && totalItems > 0) scrollToToday(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, zoom])

  if (loading) {
    return (
      <div className="fade">
        <style>{CSS}</style>
        <div className="page-header">
          <div>
            <div className="page-kicker">{t('载入中…')}</div>
            <h1 className="page-title">{t('甘特图')}</h1>
          </div>
        </div>
        <div className="wb-g-card" style={{ padding: 20 }}>
          <Skeleton active paragraph={{ rows: 8 }} />
        </div>
      </div>
    )
  }

  const legend = (
    <div className="wb-g-legend">
      {schema.statuses.map((s) => (
        <span key={s.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span className="wb-g-dot" style={{ background: s.color || '#9aa0a6' }} />
          {s.name}
        </span>
      ))}
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <span
          className="wb-g-dot"
          style={{ width: 8, height: 8, borderRadius: 2, transform: 'rotate(45deg)', background: 'var(--ink-soft)' }}
        />
        {t('仅截止日')}
      </span>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <span style={{ width: 14, height: 2, background: 'var(--accent)', display: 'inline-block' }} />
        {t('今天')}
      </span>
      <span>{t('已完成任务半透明显示')}</span>
    </div>
  )

  return (
    <>
      <style>{CSS}</style>
      <div className="page-header">
        <div>
          <div className="page-kicker">
            {t('{groups} 个分组 · {items} 个任务', { groups: ordered.length, items: totalItems })}
            {program && ` · ${t('全部项目')}`}
          </div>
          <h1 className="page-title">{program ? t('全部任务甘特图') : t('甘特图')}</h1>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Segmented
            value={zoom}
            onChange={(v) => setZoom(v as Zoom)}
            options={[
              { label: t('按周'), value: 'week' },
              { label: t('按月'), value: 'month' },
            ]}
          />
          <Button icon={<AimOutlined />} onClick={() => scrollToToday(true)}>
            {t('回到今天')}
          </Button>
          <Button icon={<ReloadOutlined />} onClick={load} title={t('刷新')} />
        </div>
      </div>

      {totalItems === 0 ? (
        <>
          {legend}
          <div className="wb-g-card" style={{ padding: '56px 24px' }}>
            <Empty
              description={
                <div style={{ color: 'var(--ink-soft)', lineHeight: 1.9 }}>
                  {t('还没有任务。')}
                  <br />
                  {t('创建任务并在任务详情中设置「开始日期 / 截止日期」后，这里会展示时间轴。')}
                </div>
              }
            >
              <Button type="primary" onClick={() => nav('/new')}>
                {t('新建任务')}
              </Button>
            </Empty>
          </div>
        </>
      ) : (
        <>
          {!range.hasAny && (
            <div className="wb-g-hint">
              {t('还没有带日期的任务：在任务详情页或编辑抽屉中设置「开始日期 / 截止日期」后，这里会出现时间条。')}
              <a
                style={{ marginLeft: 8, color: 'var(--primary)', cursor: 'pointer' }}
                onClick={() => nav('/issues')}
              >
                {t('去设置 →')}
              </a>
            </div>
          )}
          <div className="wb-g-card">
            <div ref={scrollRef} className="wb-g-scroll" onMouseLeave={() => setHover(null)}>
              <div style={{ width: LEFT_W + bodyW, position: 'relative' }}>
                {/* 表头：月 + 周 */}
                <div className="wb-g-head">
                  <div className="wb-g-corner">{range.start.format('YYYY-MM')} — {range.end.format('YYYY-MM')}</div>
                  <div className="wb-g-hcol" style={{ width: bodyW }}>
                    <div className="wb-g-hrow">
                      {monthTicks.map((m, i) => (
                        <div key={i} className="wb-g-hcell month" style={{ width: m.width }}>
                          {m.width >= 40 ? m.label : ''}
                        </div>
                      ))}
                    </div>
                    <div className="wb-g-hrow">
                      {weekTicks.map((w, i) => (
                        <div key={i} className="wb-g-hcell" style={{ width: w.width }}>
                          {w.width >= 40 ? w.label : ''}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* 纵向网格线 */}
                <div className="wb-g-grid">
                  {weekTicks.map((w, i) =>
                    i === 0 ? null : (
                      <div key={`w${i}`} className="wb-g-vline" style={{ left: w.left }} />
                    )
                  )}
                  {monthTicks.map((m, i) =>
                    i === 0 ? null : (
                      <div key={`m${i}`} className="wb-g-vline m" style={{ left: m.left }} />
                    )
                  )}
                </div>

                {/* 今天红竖线 */}
                <div className="wb-g-today" style={{ left: LEFT_W + xOf(today) + dw / 2 }} />

                {/* 行 */}
                {(() => {
                  const rows: ReactNode[] = []
                  let idx = 0
                  for (const g of ordered) {
                    const key = gkey(g)
                    const gi = idx++
                    const col = collapsed.has(key)
                    const gc = g.color || 'var(--ink-faint)'
                    const gs = pd(g.start)
                    const ge = pd(g.end)
                    rows.push(
                      <div
                        key={`g-${key}`}
                        className="wb-g-row wb-g-ghead"
                        onMouseEnter={() => setHover(gi)}
                      >
                        <div className="wb-g-left">
                          <button className="wb-g-chev" onClick={() => toggleGroup(key)} title={col ? t('展开') : t('折叠')}>
                            {col ? '▸' : '▾'}
                          </button>
                          <span className="wb-g-dot" style={{ background: gc }} />
                          <span className="wb-g-name">{g.name}</span>
                          {gs && ge && (
                            <span className="mono" style={{ whiteSpace: 'nowrap' }}>
                              {gs.format('YYYY-MM-DD')} → {ge.format(gs.year() === ge.year() ? 'MM-DD' : 'YYYY-MM-DD')}
                            </span>
                          )}
                          <span className="mono">{g.items.length}</span>
                        </div>
                        <div className="wb-g-track" style={{ width: bodyW }}>
                          {gs &&
                            ge &&
                            (() => {
                              const { l, w } = clampBar(xOf(gs), (ge.diff(gs, 'day') + 1) * dw)
                              return (
                                <Tooltip
                                  title={
                                    <div className="wb-g-tip">
                                      <div style={{ fontWeight: 600 }}>{g.name}</div>
                                      <div>
                                        {t('里程碑区间：{start} → {end}', {
                                          start: gs.format('YYYY-MM-DD'),
                                          end: ge.format('YYYY-MM-DD'),
                                        })}
                                      </div>
                                      <div>{t('任务：{count}', { count: g.items.length })}</div>
                                    </div>
                                  }
                                  mouseEnterDelay={0.1}
                                >
                                  <div
                                    className="wb-g-gbar"
                                    style={{ left: l, width: w, background: gc, opacity: 0.8 }}
                                  />
                                </Tooltip>
                              )
                            })()}
                        </div>
                      </div>
                    )
                    if (!col) {
                      for (const it of g.items) {
                        const ii = idx++
                        rows.push(
                          <div key={`i-${it.project || ''}:${it.id}`} className="wb-g-row" onMouseEnter={() => setHover(ii)}>
                            <div className="wb-g-left">
                              {program && <span className="wb-g-dot" style={{ background: 'var(--border-strong)' }} />}
                              <span className="stamp" style={{ cursor: 'pointer' }} onClick={() => goIssue(it)}>
                                {it.id}
                              </span>
                              <span
                                className={`wb-g-title${it.done ? ' is-done' : ''}`}
                                onClick={() => goIssue(it)}
                              >
                                {program && <span className="mono">{it.project} · </span>}
                                {it.title}
                              </span>
                            </div>
                            <div className="wb-g-track" style={{ width: bodyW }}>
                              {renderItemBar(it)}
                            </div>
                          </div>
                        )
                      }
                    }
                  }
                  return rows
                })()}

                {/* 行悬浮高亮 */}
                {hover !== null && (
                  <div
                    className="wb-g-hover"
                    style={{ top: HEAD_H + hover * ROW_H, width: bodyW, height: ROW_H }}
                  />
                )}
              </div>
            </div>
          </div>
          {legend}
        </>
      )}
    </>
  )
}
