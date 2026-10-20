import { useCallback, useEffect, useState } from 'react'
import {
  App as AntApp,
  Button,
  Card,
  DatePicker,
  Descriptions,
  Input,
  Popconfirm,
  Select,
  Skeleton,
  Space,
  Tag,
  Upload,
} from 'antd'
import {
  ArrowLeftOutlined,
  DeleteOutlined,
  EditOutlined,
  PaperClipOutlined,
  PlusOutlined,
  SendOutlined,
} from '@ant-design/icons'
import { useParams } from 'react-router-dom'
import dayjs from 'dayjs'

import { api } from '../api'
import { useApp } from '../context'
import { t } from '../i18n'
import type { Entry, Issue } from '../types'
import { fmtTime, fromNow, toggleCheckbox } from '../util'
import { useGo } from '../nav'
import Markdown from '../components/Markdown'
import MarkdownEditor from '../components/MarkdownEditor'
import IssueForm, { serializeFields, type IssueFormValues } from '../components/IssueForm'
import { StatusTag } from '../components/tags'

export default function IssueDetail() {
  const { id = '' } = useParams()
  const { schema } = useApp()
  const nav = useGo()
  const { message } = AntApp.useApp()
  const [issue, setIssue] = useState<Issue | null>(null)
  const [entries, setEntries] = useState<Entry[]>([])
  const [all, setAll] = useState<Issue[]>([])
  const [loading, setLoading] = useState(true)
  const [reply, setReply] = useState('')
  const [sending, setSending] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editSaving, setEditSaving] = useState(false)
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')
  const [addingSub, setAddingSub] = useState(false)
  const [subTitle, setSubTitle] = useState('')
  const [subPri, setSubPri] = useState<string | undefined>()
  const [subSaving, setSubSaving] = useState(false)

  // 原地编辑：复用 IssueForm（与新建共用一套代码），编辑整页字段后回写。
  async function handleEditSubmit(v: IssueFormValues) {
    setEditSaving(true)
    try {
      const { start, due, ...rest } = v
      const d = await api.patchIssue(id, {
        ...rest,
        body: v.body ?? '',
        fields: serializeFields(schema, v.fields),
        start: dayjs.isDayjs(start) ? start.format('YYYY-MM-DD') : '',
        due: dayjs.isDayjs(due) ? due.format('YYYY-MM-DD') : '',
      })
      setIssue(d.issue)
      setEditing(false)
      message.success(t('已保存'))
      await load()
    } catch (e) {
      // patchIssue 内部已 toast 错误。
      void e
    } finally {
      setEditSaving(false)
    }
  }

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [d, list] = await Promise.all([api.getIssue(id), api.listIssues()])
      setIssue(d.issue)
      setTitleDraft(d.issue.title)
      setEntries(d.entries || [])
      setAll(list.issues || [])
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [id, message])

  useEffect(() => {
    load()
  }, [load])

  async function patch(body: Record<string, unknown>, silent = false) {
    try {
      const d = await api.patchIssue(id, body)
      setIssue(d.issue)
      await load()
      if (!silent) message.success(t('已更新'))
    } catch (e) {
      message.error((e as Error).message)
    }
  }

  async function send() {
    if (!reply.trim()) {
      message.warning(t('内容不能为空'))
      return
    }
    setSending(true)
    try {
      await api.addEntry(id, { body: reply, type: 'comment' })
      setReply('')
      await load()
      message.success(t('已提交'))
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setSending(false)
    }
  }

  async function remove() {
    try {
      await api.deleteIssue(id)
      message.success(t('已删除'))
      nav('/issues')
    } catch (e) {
      message.error((e as Error).message)
    }
  }

  async function createSub() {
    const trimmed = subTitle.trim()
    if (!trimmed) return
    setSubSaving(true)
    try {
      const body: Partial<Issue> = {
        title: trimmed,
        parent: issue!.id,
        status: schema.statuses[0]?.id,
      }
      if (subPri) body.priority = subPri
      await api.createIssue(body)
      setSubTitle('')
      setSubPri(undefined)
      setAddingSub(false)
      await load()
      message.success(t('已添加子任务'))
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setSubSaving(false)
    }
  }

  const doneStatusId = schema.statuses.find((s) => s.category === 'done')?.id
  const openStatusId =
    schema.statuses.find((s) => s.category !== 'done')?.id || schema.statuses[0]?.id

  async function toggleSubDone(c: Issue) {
    const next = doneCategory(c.status) ? openStatusId : doneStatusId
    if (!next) return
    try {
      await api.patchIssue(c.id, { status: next })
      await load()
    } catch (e) {
      message.error((e as Error).message)
    }
  }

  async function beforeUpload(file: File) {
    try {
      const d = await api.upload(id, file)
      const isImg = /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(file.name)
      const snippet = isImg ? `![${file.name}](${d.path})` : `[${file.name}](${d.path})`
      setReply((v) => (v ? `${v}\n${snippet}` : snippet))
      message.success(t('已上传附件'))
    } catch (e) {
      message.error((e as Error).message)
    }
    return false
  }

  if (loading)
    return (
      <div className="detail-skel fade">
        <div>
          <Skeleton active paragraph={{ rows: 5 }} />
        </div>
        <div>
          <Skeleton active title={false} paragraph={{ rows: 8 }} />
        </div>
      </div>
    )
  if (!issue) return <Card>{t('任务不存在')}</Card>

  async function saveTitle() {
    const trimmed = titleDraft.trim()
    setEditingTitle(false)
    if (!trimmed || trimmed === issue?.title) return
    try {
      const d = await api.patchIssue(id, { title: trimmed })
      setIssue(d.issue)
      message.success(t('标题已更新'))
    } catch (e) {
      message.error((e as Error).message)
    }
  }

  const children = all.filter((i) => i.parent === issue.id)
  const parent = issue.parent ? all.find((i) => i.id === issue.parent) : undefined
  const doneCategory = (sid: string) => schema.statuses.find((s) => s.id === sid)?.category === 'done'
  const doneCount = children.filter((c) => doneCategory(c.status)).length

  const labels = (issue.labels || []).map((l) => {
    const def = schema.labels.find((x) => x.id === l)
    return (
      <Tag key={l} color={def?.color} style={{ marginInlineEnd: 4 }}>
        {def?.name || l}
      </Tag>
    )
  })

  const milestone = (schema.milestones || []).find((m) => m.id === issue.milestone)

  const dv = (s?: string) => {
    const d = s ? dayjs(s) : null
    return d && d.isValid() ? d : null
  }

  return (
    <>
      <div style={{ marginBottom: 22 }}>
        <Button type="text" icon={<ArrowLeftOutlined />} onClick={() => nav('/issues')} style={{ paddingLeft: 0 }}>
          {t('返回列表')}
        </Button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8 }}>
          <span className="stamp">{issue.id}</span>
          <span className="mono">{t('{time} 更新', { time: fromNow(issue.updated) })}</span>
          <span style={{ flex: 1 }} />
          {editing ? (
            <Button onClick={() => setEditing(false)}>{t('取消')}</Button>
          ) : (
            <Button icon={<EditOutlined />} onClick={() => setEditing(true)}>
              {t('编辑')}
            </Button>
          )}
          <Popconfirm
            title={t('删除这个任务？')}
            description={t('会连同其跟进与附件一起从仓库删除，且不可撤销。')}
            okText={t('删除')}
            okButtonProps={{ danger: true }}
            cancelText={t('取消')}
            onConfirm={remove}
          >
            <Button danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </div>
        {editingTitle ? (
          <Input
            size="large"
            autoFocus
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onPressEnter={saveTitle}
            onBlur={saveTitle}
            style={{ marginTop: 10, fontSize: 22, fontWeight: 600 }}
          />
        ) : (
          <h1
            className="page-title title-edit"
            style={{ marginTop: 10, fontSize: 26 }}
            title={t('点击编辑标题')}
            onClick={() => {
              setTitleDraft(issue.title)
              setEditingTitle(true)
            }}
          >
            {issue.title}
          </h1>
        )}
        {parent && (
          <div className="mono" style={{ marginTop: 8 }}>
            {t('属于')}{' '}
            <a onClick={() => nav(`/issue/${parent.id}`)} style={{ cursor: 'pointer' }}>
              {parent.id} {parent.title}
            </a>
          </div>
        )}
      </div>

      <div className="issue-layout">
        {editing ? (
          <IssueForm
            key={issue.id}
            schema={schema}
            issues={all}
            initial={issue}
            selfId={issue.id}
            submitting={editSaving}
            onSubmit={handleEditSubmit}
            onCancel={() => setEditing(false)}
          />
        ) : (
        <>
        <div>
          <div className="section-label">{t('描述')}</div>
          <div style={{ marginBottom: 4 }}>
            {issue.body ? (
              <Markdown
                issueId={issue.id}
                onToggleCheckbox={(idx) => patch({ body: toggleCheckbox(issue.body, idx) }, true)}
              >
                {issue.body}
              </Markdown>
            ) : (
              <span style={{ color: 'var(--ink-faint)' }}>{t('（无描述）')}</span>
            )}
          </div>

          {schema.modules.subtasks !== 'off' && (
            <>
              <hr className="hrule" />
              <div className="section-label">
                {t('子任务')} {children.length > 0 && `· ${doneCount}/${children.length}`}
              </div>
              <div className="subtasks">
                {children.length === 0 && !addingSub && (
                  <div style={{ color: 'var(--ink-faint)', marginBottom: 10 }}>{t('还没有子任务。')}</div>
                )}
                {children.map((c) => (
                  <div
                    key={c.id}
                    className={`subtask${doneCategory(c.status) ? ' is-done' : ''}`}
                    onClick={() => nav(`/issue/${c.id}`)}
                  >
                    <span
                      className={`subtask-check${doneCategory(c.status) ? ' on' : ''}`}
                      role="checkbox"
                      aria-checked={doneCategory(c.status)}
                      title={doneCategory(c.status) ? t('标记为未完成') : t('标记为已完成')}
                      onClick={(e) => {
                        e.stopPropagation()
                        toggleSubDone(c)
                      }}
                    />
                    <span className="stamp">{c.id}</span>
                    <span className="subtask-title">{c.title}</span>
                    <span className="subtask-status">
                      <StatusTag id={c.status} />
                    </span>
                  </div>
                ))}
                {addingSub ? (
                  <div className="subtask-add">
                    <Input
                      autoFocus
                      size="small"
                      placeholder={t('子任务标题，回车创建')}
                      value={subTitle}
                      onChange={(e) => setSubTitle(e.target.value)}
                      onPressEnter={createSub}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') {
                          setAddingSub(false)
                          setSubTitle('')
                          setSubPri(undefined)
                        }
                      }}
                    />
                    <Space size={6} style={{ marginTop: 8 }}>
                      <Select
                        size="small"
                        allowClear
                        placeholder={t('优先级')}
                        style={{ width: 112 }}
                        value={subPri}
                        onChange={setSubPri}
                        options={schema.priorities.map((p) => ({ value: p.id, label: p.name }))}
                      />
                      <Button size="small" type="primary" loading={subSaving} onClick={createSub}>
                        {t('添加')}
                      </Button>
                      <Button
                        size="small"
                        onClick={() => {
                          setAddingSub(false)
                          setSubTitle('')
                          setSubPri(undefined)
                        }}
                      >
                        {t('取消')}
                      </Button>
                    </Space>
                  </div>
                ) : (
                  <Button
                    size="small"
                    icon={<PlusOutlined />}
                    onClick={() => setAddingSub(true)}
                    style={{ marginTop: 6 }}
                  >
                    {t('添加子任务')}
                  </Button>
                )}
              </div>
            </>
          )}

          <hr className="hrule" />

          <div className="section-label">{t('跟进')} · {entries.length}</div>
          <div className="timeline">
            {entries.length === 0 && <div style={{ color: 'var(--ink-faint)' }}>{t('还没有跟进。')}</div>}
            {entries.map((e, i) => (
              <div key={i} className={`timeline-entry${e.type === 'status' ? ' is-status' : ''}`}>
                <div className="timeline-head">
                  {fmtTime(e.created)}
                  {e.type === 'status' ? ` · ${t('状态变更')}` : ` · ${e.author || 'me'}`}
                </div>
                {e.type === 'status' ? (
                  <div>
                    <Space size={6}>
                      <StatusTag id={e.from} /> <span style={{ color: 'var(--ink-faint)' }}>→</span>{' '}
                      <StatusTag id={e.to} />
                    </Space>
                    {e.body && (
                      <div className="timeline-body" style={{ marginTop: 6 }}>
                        {e.body}
                      </div>
                    )}
                  </div>
                ) : (
                  <Markdown issueId={issue.id}>{e.body}</Markdown>
                )}
              </div>
            ))}
          </div>

          <hr className="hrule" />

          <div className="section-label">{t('添加跟进')}</div>
          <MarkdownEditor
            value={reply}
            onChange={setReply}
            minRows={4}
            issueId={issue.id}
            placeholder={t('写一条跟进，可粘贴/选择图片…')}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 10 }}>
            <Upload beforeUpload={beforeUpload} showUploadList={false}>
              <Button icon={<PaperClipOutlined />}>{t('附件')}</Button>
            </Upload>
            <span style={{ flex: 1 }} />
            <Button type="primary" icon={<SendOutlined />} loading={sending} onClick={send}>
              {t('提交跟进')}
            </Button>
          </div>
        </div>

        <aside className="issue-rail">
          <div className="rail-row">
            <div className="rail-key">{t('状态')}</div>
            <Select
              variant="borderless"
              value={issue.status}
              style={{ width: '100%', paddingLeft: 0 }}
              onChange={(v) => patch({ status: v })}
              options={schema.statuses.map((s) => ({ value: s.id, label: s.name }))}
            />
          </div>
          <div className="rail-row">
            <div className="rail-key">{t('优先级')}</div>
            <Select
              variant="borderless"
              style={{ width: '100%', paddingLeft: 0 }}
              allowClear
              placeholder="—"
              value={issue.priority || undefined}
              onChange={(v) => patch({ priority: v || '' })}
              options={schema.priorities.map((p) => ({ value: p.id, label: p.name }))}
            />
          </div>
          <div className="rail-row">
            <div className="rail-key">{t('类型')}</div>
            <span>{schema.types.find((x) => x.id === issue.type)?.name || '—'}</span>
          </div>
          <div className="rail-row">
            <div className="rail-key">{t('负责人')}</div>
            <span>{issue.assignee ? `@${issue.assignee}` : '—'}</span>
          </div>
          <div className="rail-row">
            <div className="rail-key">{t('开始日期')}</div>
            <DatePicker
              variant="borderless"
              allowClear
              placeholder={t('未设置')}
              style={{ width: '100%', paddingLeft: 0 }}
              value={dv(issue.start)}
              onChange={(d) => patch({ start: d ? d.format('YYYY-MM-DD') : '' })}
            />
          </div>
          <div className="rail-row">
            <div className="rail-key">{t('截止日期')}</div>
            <DatePicker
              variant="borderless"
              allowClear
              placeholder={t('未设置')}
              style={{ width: '100%', paddingLeft: 0 }}
              value={dv(issue.due)}
              onChange={(d) => patch({ due: d ? d.format('YYYY-MM-DD') : '' })}
            />
          </div>
          {schema.modules.milestones && milestone && (
            <div className="rail-row">
              <div className="rail-key">{t('里程碑')}</div>
              <span>{milestone.name}</span>
            </div>
          )}

          <hr className="hrule" style={{ margin: '16px 0' }} />

          <div className="rail-row">
            <div className="rail-key">{t('创建')}</div>
            <span className="mono" style={{ color: 'var(--ink-soft)' }}>
              {fmtTime(issue.created)}
            </span>
          </div>
          <div className="rail-row">
            <div className="rail-key">{t('更新')}</div>
            <span className="mono" style={{ color: 'var(--ink-soft)' }}>
              {fmtTime(issue.updated)}
            </span>
          </div>
          {labels.length > 0 && (
            <div className="rail-row">
              <div className="rail-key">{t('标签')}</div>
              {labels}
            </div>
          )}

          {(schema.fields || []).length > 0 && Object.keys(issue.fields || {}).length > 0 && (
            <>
              <hr className="hrule" style={{ margin: '16px 0' }} />
              <Descriptions column={1} size="small" colon={false}>
                {schema.fields.map((f) => {
                  const v = issue.fields?.[f.id]
                  if (!v) return null
                  return (
                    <Descriptions.Item key={f.id} label={<span className="rail-key">{f.name}</span>}>
                      {v}
                    </Descriptions.Item>
                  )
                })}
              </Descriptions>
            </>
          )}
        </aside>
        </>
        )}
      </div>
    </>
  )
}