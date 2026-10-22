import { useCallback, useEffect, useMemo, useState } from 'react'
import { App as AntApp, Button, Empty, Segmented, Skeleton, Tooltip } from 'antd'
import { LeftOutlined, ReloadOutlined, RightOutlined } from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'

import { api } from '../api'
import { useApp } from '../context'
import { intlLocale, t } from '../i18n'
import { useGo } from '../nav'
import { projectPath } from '../nav'
import type { GanttGroup, GanttItem } from '../types'

type Mode = 'month' | 'agenda'

const WEEK_ROWS = 6 // 月视图固定 6 行，避免切换月份时高度跳动

// 日历上的一条事件：来自任务的开始日 / 截止日。
interface CalEvent {
  item: GanttItem
  kind: 'start' | 'due'
  date: Dayjs
  group: GanttGroup
}

const pd = (s?: string): Dayjs | null => {
  if (!s) return null
  const d = dayjs(s)
  return d.isValid() ? d.startOf('day') : null
}

// 周一为一周之首（与甘特图一致）。
const weekStart = (d: Dayjs) => d.subtract((d.day() + 6) % 7, 'day')

// 月份标题：中文「2026年10月」，英文交给 Intl。
function monthTitle(d: Dayjs): string {
  return new Intl.DateTimeFormat(intlLocale(), { year: 'numeric', month: 'long' }).format(d.toDate())
}

// 星期表头：中文单字，英文用 Intl 缩写。
function weekdayLabels(): string[] {
  const out: string[] = []
  const base = weekStart(dayjs())
  for (let i = 0; i < 7; i++) {
    if (intlLocale().startsWith('en')) {
      out.push(new Intl.DateTimeFormat(intlLocale(), { weekday: 'short' }).format(base.add(i, 'day').toDate()))
    } else {
      out.push(['一', '二', '三', '四', '五', '六', '日'][i])
    }
  }
  return out
}

const CSS = `
.wb-cal-toolbar { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; flex-wrap: wrap; }
.wb-cal-title { font-size: 16px; font-weight: 600; min-width: 150px; }
.wb-cal-card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); box-shadow: var(--shadow-sm); overflow: hidden; }
.wb-cal-week { display: grid; grid-template-columns: repeat(7, 1fr); background: var(--surface-2); border-bottom: 1px solid var(--border-strong); }
.wb-cal-wd { padding: 8px 10px; font-family: 'IBM Plex Mono', monospace; font-size: 11px; color: var(--ink-soft); letter-spacing: .04em; }
.wb-cal-wd.is-weekend { color: var(--ink-faint); }
.wb-cal-grid { display: grid; grid-template-columns: repeat(7, 1fr); }
.wb-cal-cell { min-height: 104px; border-right: 1px solid var(--rule); border-bottom: 1px solid var(--rule); padding: 6px 6px 8px; display: flex; flex-direction: column; gap: 4px; position: relative; }
.wb-cal-cell:nth-child(7n) { border-right: none; }
.wb-cal-cell.is-out { background: var(--rail-bg); }
.wb-cal-cell.is-out .wb-cal-num { color: var(--ink-faint); opacity: .6; }
.wb-cal-cell.is-today { background: var(--primary-weak); }
.wb-cal-num { font-family: 'IBM Plex Mono', monospace; font-size: 12px; color: var(--ink-soft); align-self: flex-start; padding: 1px 5px; border-radius: 4px; line-height: 1.4; }
.wb-cal-cell.is-today .wb-cal-num { background: var(--primary); color: #fff; font-weight: 600; }
.wb-cal-cell.is-weekend .wb-cal-num { color: var(--ink-faint); }
.wb-cal-events { display: flex; flex-direction: column; gap: 3px; min-height: 0; }
.wb-cal-ev { display: flex; align-items: center; gap: 5px; font-size: 12px; line-height: 1.45; padding: 2px 6px; border-radius: 5px; cursor: pointer; background: var(--surface-2); border-left: 3px solid var(--border-strong); overflow: hidden; }
.wb-cal-ev:hover { background: var(--surface-3); }
.wb-cal-ev-dot { width: 6px; height: 6px; border-radius: 50%; flex: none; }
.wb-cal-ev-text { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wb-cal-ev.is-done { opacity: .55; }
.wb-cal-ev.is-done .wb-cal-ev-text { text-decoration: line-through; }
.wb-cal-more { font-size: 11px; color: var(--ink-faint); padding-left: 6px; cursor: pointer; }
.wb-cal-more:hover { color: var(--primary-ink); }
.wb-cal-agenda { padding: 4px 0; }
.wb-cal-ag-day { padding: 10px 16px; border-bottom: 1px solid var(--rule); display: flex; gap: 14px; align-items: flex-start; }
.wb-cal-ag-day:last-child { border-bottom: none; }
.wb-cal-ag-date { flex: none; width: 96px; font-family: 'IBM Plex Mono', monospace; font-size: 12px; color: var(--ink-soft); padding-top: 2px; }
.wb-cal-ag-date.is-today { color: var(--primary-ink); font-weight: 600; }
.wb-cal-ag-list { flex: 1; display: flex; flex-direction: column; gap: 5px; min-width: 0; }
.wb-cal-ag-empty { color: var(--ink-faint); font-size: 12px; }
.wb-cal-hint { background: var(--primary-weak); border: 1px solid var(--border); color: var(--ink-soft); padding: 10px 14px; border-radius: var(--radius-sm); font-size: 13px; margin-bottom: 14px; }
.wb-cal-tip { font-size: 12px; line-height: 1.8; min-width: 180px; }
@media (max-width: 760px) {
  .wb-cal-cell { min-height: 72px; }
  .wb-cal-ag-date { width: 70px; }
}
`

const KIND_LABEL = () => ({ start: t('开始'), due: t('截止') })

export default function Calendar() {
  const { schema, aggregate, projectName } = useApp()
  const go = useGo()
  const { message } = AntApp.useApp()
  const [groups, setGroups] = useState<GanttGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [mode, setMode] = useState<Mode>('month')
  const [cursor, setCursor] = useState<Dayjs>(() => dayjs().startOf('month'))

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const d = await api.gantt()
      setGroups(d.groups || [])
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [message])

  useEffect(() => {
    load()
  }, [load])

  // 展开成事件列表：每个任务的开始日与截止日各算一条。
  const events = useMemo<CalEvent[]>(() => {
    const out: CalEvent[] = []
    for (const g of groups) {
      for (const it of g.items) {
        const s = pd(it.start)
        const d = pd(it.due)
        if (s) out.push({ item: it, kind: 'start', date: s, group: g })
        // 起止同一天时只显示一条，避免重影。
        if (d && (!s || !d.isSame(s, 'day'))) out.push({ item: it, kind: 'due', date: d, group: g })
      }
    }
    out.sort((a, b) => a.date.valueOf() - b.date.valueOf())
    return out
  }, [groups])

  const undated = useMemo(
    () => groups.reduce((n, g) => n + g.items.filter((i) => !i.start && !i.due).length, 0),
    [groups]
  )

  // 按日期归组，供月视图与列表视图共用。
  const byDay = useMemo(() => {
    const m = new Map<string, CalEvent[]>()
    for (const ev of events) {
      const k = ev.date.format('YYYY-MM-DD')
      const arr = m.get(k)
      if (arr) arr.push(ev)
      else m.set(k, [ev])
    }
    return m
  }, [events])

  const statusColor = (id: string) => schema.statuses.find((s) => s.id === id)?.color || '#9aa0a6'
  const statusName = (id: string) => schema.statuses.find((s) => s.id === id)?.name || id
  const canAggregate = aggregate

  // 月视图的 42 格（6 周 × 7 天）
  const cells = useMemo(() => {
    const first = weekStart(cursor.startOf('month'))
    return Array.from({ length: WEEK_ROWS * 7 }, (_, i) => first.add(i, 'day'))
  }, [cursor])

  const today = dayjs().startOf('day')
  const wdNames = useMemo(() => weekdayLabels(), [])

  const openIssue = (it: GanttItem) => {
    // 聚合视图下任务可能来自子项目，必须用绝对路径指向它真正所在的项目；
    // 单项目视图交给 useGo 自动拼当前项目。
    if (canAggregate && it.project) {
      go(projectPath(it.project, `/issue/${it.id}`))
      return
    }
    go(`/issue/${it.id}`)
  }

  const evTip = (ev: CalEvent) => (
    <div className="wb-cal-tip">
      <div style={{ fontWeight: 600, marginBottom: 2 }}>{ev.item.title}</div>
      <div>
        {t('状态：{status}', { status: statusName(ev.item.status) })}
        {ev.item.assignee ? ` · ${t('负责人：{assignee}', { assignee: ev.item.assignee })}` : ''}
      </div>
      <div>
        {KIND_LABEL()[ev.kind]} · {ev.date.format('YYYY-MM-DD')}
      </div>
      {canAggregate && ev.item.project && <div>{t('项目：{name}', { name: projectName(ev.item.project) })}</div>}
    </div>
  )

  const renderEv = (ev: CalEvent, i: number) => (
    <Tooltip key={`${ev.item.id}-${ev.kind}-${i}`} title={evTip(ev)} mouseEnterDelay={0.3}>
      <div
        className={`wb-cal-ev${ev.item.done ? ' is-done' : ''}`}
        style={{ borderLeftColor: statusColor(ev.item.status) }}
        onClick={() => openIssue(ev.item)}
      >
        <span className="wb-cal-ev-dot" style={{ background: statusColor(ev.item.status) }} />
        <span className="wb-cal-ev-text">{ev.item.title}</span>
      </div>
    </Tooltip>
  )

  const MAX_PER_CELL = 3

  const monthView = (
    <div className="wb-cal-card">
      <div className="wb-cal-week">
        {wdNames.map((n, i) => (
          <div key={n} className={`wb-cal-wd${i >= 5 ? ' is-weekend' : ''}`}>
            {n}
          </div>
        ))}
      </div>
      <div className="wb-cal-grid">
        {cells.map((d) => {
          const key = d.format('YYYY-MM-DD')
          const evs = byDay.get(key) || []
          const out = d.month() !== cursor.month()
          const isToday = d.isSame(today, 'day')
          const weekend = d.day() === 0 || d.day() === 6
          const shown = evs.slice(0, MAX_PER_CELL)
          const rest = evs.length - shown.length
          return (
            <div
              key={key}
              className={`wb-cal-cell${out ? ' is-out' : ''}${isToday ? ' is-today' : ''}${weekend ? ' is-weekend' : ''}`}
            >
              <span className="wb-cal-num">{d.date()}</span>
              <div className="wb-cal-events">
                {shown.map(renderEv)}
                {rest > 0 && (
                  <span
                    className="wb-cal-more"
                    onClick={() => {
                      setCursor(d.startOf('month'))
                      setMode('agenda')
                    }}
                  >
                    {t('还有 {n} 项', { n: rest })}
                  </span>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )

  // 列表视图：当前月内有事件的日期逐日列出。
  const agendaDays = useMemo(() => {
    const out: { date: Dayjs; evs: CalEvent[] }[] = []
    const days = cursor.daysInMonth()
    for (let i = 0; i < days; i++) {
      const d = cursor.date(i + 1)
      const evs = byDay.get(d.format('YYYY-MM-DD'))
      if (evs && evs.length > 0) out.push({ date: d, evs })
    }
    return out
  }, [cursor, byDay])

  const agendaView = (
    <div className="wb-cal-card wb-cal-agenda">
      {agendaDays.length === 0 ? (
        <div style={{ padding: '28px 16px' }}>
          <Empty description={t('本月没有带日期的任务。')} image={Empty.PRESENTED_IMAGE_SIMPLE} />
        </div>
      ) : (
        agendaDays.map(({ date, evs }) => (
          <div key={date.format('YYYY-MM-DD')} className="wb-cal-ag-day">
            <div className={`wb-cal-ag-date${date.isSame(today, 'day') ? ' is-today' : ''}`}>
              {date.format('MM-DD')} {wdNames[(date.day() + 6) % 7]}
            </div>
            <div className="wb-cal-ag-list">{evs.map(renderEv)}</div>
          </div>
        ))
      )}
    </div>
  )

  if (loading) {
    return (
      <>
        <style>{CSS}</style>
        <Skeleton active paragraph={{ rows: 8 }} />
      </>
    )
  }

  if (events.length === 0) {
    return (
      <>
        <style>{CSS}</style>
        <div className="wb-cal-hint">
          {undated > 0
            ? t('当前有 {n} 个任务但都没有设置日期：在任务详情里填写「开始日期 / 截止日期」后，这里就会显示。', { n: undated })
            : t('还没有任务：创建任务并设置「开始日期 / 截止日期」后，日历会显示在这里。')}
        </div>
        <Empty
          description={t('日历暂无内容')}
          image={Empty.PRESENTED_IMAGE_SIMPLE}
        >
          <Button type="primary" onClick={() => go('/new')}>
            {t('新建任务')}
          </Button>
        </Empty>
      </>
    )
  }

  return (
    <>
      <style>{CSS}</style>
      <div className="wb-cal-toolbar">
        <Button icon={<LeftOutlined />} onClick={() => setCursor(cursor.subtract(1, 'month'))} />
        <span className="wb-cal-title">{monthTitle(cursor)}</span>
        <Button icon={<RightOutlined />} onClick={() => setCursor(cursor.add(1, 'month'))} />
        <Button
          onClick={() => {
            const now = dayjs()
            setCursor(now.startOf('month'))
          }}
        >
          {t('今天')}
        </Button>
        <span style={{ flex: 1 }} />
        <Segmented
          value={mode}
          onChange={(v) => setMode(v as Mode)}
          options={[
            { label: t('月'), value: 'month' },
            { label: t('列表'), value: 'agenda' },
          ]}
        />
        <Tooltip title={t('刷新')}>
          <Button icon={<ReloadOutlined />} onClick={load} />
        </Tooltip>
      </div>
      {mode === 'month' ? monthView : agendaView}
      <div style={{ marginTop: 10, fontSize: 12, color: 'var(--ink-faint)' }}>
        {t('共 {n} 个日程', { n: events.length })}
        {undated > 0 ? ` · ${t('另有 {n} 个任务未设置日期', { n: undated })}` : ''}
      </div>
    </>
  )
}
