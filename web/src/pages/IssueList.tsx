import { useEffect, useMemo, useState } from 'react'
import { App as AntApp, Button, Dropdown, Empty, Input, Select, Space, Switch, Table, Tag } from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import { useSearchParams } from 'react-router-dom'

import { api } from '../api'
import { useApp } from '../context'
import { t } from '../i18n'
import { isProgramScope, projectPath, useGo } from '../nav'
import type { Issue, IssueNode } from '../types'
import { fromNow } from '../util'
import { PriorityText, StatusTag } from '../components/tags'

function toTree(issues: Issue[]): IssueNode[] {
  const map = new Map<string, IssueNode>()
  issues.forEach((i) => map.set(i.id, { ...i, children: [] }))
  const roots: IssueNode[] = []
  map.forEach((n) => {
    if (n.parent && map.has(n.parent)) map.get(n.parent)!.children!.push(n)
    else roots.push(n)
  })
  const strip = (n: IssueNode): IssueNode => ({
    ...n,
    children: n.children && n.children.length ? n.children.map(strip) : undefined,
  })
  return roots.map(strip)
}

export default function IssueList() {
  const { schema, projects, projectId } = useApp()
  const nav = useGo()
  const program = isProgramScope(projectId)
  const { message } = AntApp.useApp()
  const [data, setData] = useState<Issue[]>([])
  const [loading, setLoading] = useState(false)
  const [searchParams, setSearchParams] = useSearchParams()
  const [q, setQ] = useState(searchParams.get('q') || '')
  const [status, setStatus] = useState(searchParams.get('status') || '')
  const [priority, setPriority] = useState(searchParams.get('priority') || '')
  const [type, setType] = useState(searchParams.get('type') || '')
  const [label, setLabel] = useState(searchParams.get('label') || '')
  const [milestone, setMilestone] = useState(searchParams.get('milestone') || '')
  const [sort, setSort] = useState(searchParams.get('sort') || 'updated')
  const [tree, setTree] = useState(searchParams.get('tree') === '1')

  const params = useMemo(() => {
    const p: Record<string, string> = {}
    if (q) p.q = q
    if (status) p.status = status
    if (priority) p.priority = priority
    if (type) p.type = type
    if (label) p.label = label
    if (milestone) p.milestone = milestone
    if (sort) p.sort = sort
    if (tree) p.tree = '1'
    return p
  }, [q, status, priority, type, label, milestone, sort, tree])

  useEffect(() => {
    const next = new URLSearchParams(params).toString()
    if (next !== searchParams.toString()) setSearchParams(params, { replace: true })
  }, [params, searchParams, setSearchParams])

  useEffect(() => {
    let alive = true
    setLoading(true)
    api
      .listIssues(params)
      .then((d) => alive && setData(d.issues || []))
      .catch((e) => message.error((e as Error).message))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [params, message])

  const columns: ColumnsType<IssueNode> = [
    ...(program
      ? [
          {
            title: t('项目'),
            dataIndex: 'project',
            width: 130,
            render: (v: string) => <Tag className="project-tag">{v}</Tag>,
          } as ColumnsType<IssueNode>[number],
        ]
      : []),
    { title: t('编号'), dataIndex: 'id', width: 118, render: (v) => <span className="stamp">{v}</span> },
    { title: t('标题'), dataIndex: 'title', render: (v) => <span style={{ fontWeight: 500 }}>{v}</span> },
    { title: t('状态'), dataIndex: 'status', width: 118, render: (v) => <StatusTag id={v} /> },
    { title: t('优先级'), dataIndex: 'priority', width: 92, render: (v) => <PriorityText id={v} /> },
    {
      title: t('类型'),
      dataIndex: 'type',
      width: 88,
      render: (v) => (v ? <span>{schema.types.find((x) => x.id === v)?.name || v}</span> : <span style={{ color: 'var(--ink-faint)' }}>—</span>),
    },
    {
      title: t('标签'),
      dataIndex: 'labels',
      width: 150,
      render: (v: string[]) =>
        (v || []).slice(0, 2).map((l) => (
          <Tag key={l} color={schema.labels.find((x) => x.id === l)?.color}>
            {schema.labels.find((x) => x.id === l)?.name || l}
          </Tag>
        )),
    },
    {
      title: t('负责人'),
      dataIndex: 'assignee',
      width: 100,
      render: (v) => (v ? <span>@{v}</span> : <span style={{ color: 'var(--ink-faint)' }}>—</span>),
    },
    { title: t('更新'), dataIndex: 'updated', width: 100, render: (v) => <span className="mono">{fromNow(v)}</span> },
  ]

  const filtered = Object.keys(params).length > 0
  const source = tree && !program ? toTree(data) : data
  const openIssue = (r: Issue) =>
    program ? nav(projectPath(r.project || '', `/issue/${r.id}`)) : nav(`/issue/${r.id}`)

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-kicker">
            {loading ? t('载入中…') : t('{count} 个任务', { count: data.length })}
            {program && ` · ${t('全部项目')}`}
          </div>
          <h1 className="page-title">{program ? t('全部任务') : t('任务')}</h1>
        </div>
        {program ? (
          <Dropdown
            menu={{
              items: projects.map((p) => ({ key: p.id, label: p.name })),
              onClick: ({ key }) => nav(projectPath(key, '/new')),
            }}
          >
            <Button type="primary" icon={<PlusOutlined />} disabled={projects.length === 0}>
              {t('新建任务')}
            </Button>
          </Dropdown>
        ) : (
          <Button type="primary" icon={<PlusOutlined />} onClick={() => nav('/new')}>
            {t('新建任务')}
          </Button>
        )}
      </div>

      <div className="filter-bar">
        <Input.Search
          placeholder={t('搜索标题或正文')}
          allowClear
          style={{ width: 240 }}
          onSearch={(v) => setQ(v)}
        />
        <Select
          placeholder={t('全部状态')}
          allowClear
          style={{ width: 128 }}
          value={status || undefined}
          onChange={(v) => setStatus(v || '')}
          options={schema.statuses.map((s) => ({ value: s.id, label: s.name }))}
        />
        <Select
          placeholder={t('全部优先级')}
          allowClear
          style={{ width: 128 }}
          value={priority || undefined}
          onChange={(v) => setPriority(v || '')}
          options={schema.priorities.map((p) => ({ value: p.id, label: p.name }))}
        />
        <Select
          placeholder={t('全部类型')}
          allowClear
          style={{ width: 118 }}
          value={type || undefined}
          onChange={(v) => setType(v || '')}
          options={schema.types.map((x) => ({ value: x.id, label: x.name }))}
        />
        <Select
          placeholder={t('全部标签')}
          allowClear
          style={{ width: 128 }}
          value={label || undefined}
          onChange={(v) => setLabel(v || '')}
          options={schema.labels.map((l) => ({ value: l.id, label: l.name }))}
        />
        {schema.modules.milestones && (
          <Select
            placeholder={t('全部里程碑')}
            allowClear
            style={{ width: 140 }}
            value={milestone || undefined}
            onChange={(v) => setMilestone(v || '')}
            options={(schema.milestones || []).map((m) => ({ value: m.id, label: m.name }))}
          />
        )}
        <Select
          style={{ width: 128 }}
          value={sort}
          onChange={setSort}
          options={[
            { value: 'updated', label: t('按更新') },
            { value: 'created', label: t('按创建') },
            { value: 'priority', label: t('按优先级') },
            { value: 'title', label: t('按标题') },
          ]}
        />
        {schema.modules.tree && !program && (
          <span className="tree-toggle">
            <Switch size="small" checked={tree} onChange={setTree} /> {t('树形')}
          </span>
        )}
      </div>

      <Table
        className="ledger"
        rowKey={(r) => (program ? `${r.project}-${r.id}` : r.id)}
        size="middle"
        columns={columns}
        dataSource={source}
        loading={loading}
        indentSize={18}
        onRow={(r) => ({
          onClick: () => openIssue(r),
          style: { cursor: 'pointer' },
        })}
        pagination={{ pageSize: 25, hideOnSinglePage: true }}
        locale={{
          emptyText: (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={filtered ? t('没有匹配的任务') : t('还没有任务')}
            >
              {!filtered && !program && (
                <Button type="primary" icon={<PlusOutlined />} onClick={() => nav('/new')}>
                  {t('创建第一个任务')}
                </Button>
              )}
            </Empty>
          ),
        }}
      />
    </>
  )
}