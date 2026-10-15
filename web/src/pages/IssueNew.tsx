import { App as AntApp, Button, Card, DatePicker, Form, Input, InputNumber, Select, Space } from 'antd'
import dayjs from 'dayjs'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { api } from '../api'
import { useApp } from '../context'
import { t } from '../i18n'
import { useGo } from '../nav'
import MarkdownEditor from '../components/MarkdownEditor'
import type { Issue } from '../types'

interface Values {
  title: string
  status: string
  priority?: string
  type?: string
  assignee?: string
  labels?: string[]
  milestone?: string
  parent?: string
  start?: dayjs.Dayjs
  due?: dayjs.Dayjs
  body?: string
  fields?: Record<string, unknown>
}

export default function IssueNew() {
  const { schema } = useApp()
  const nav = useGo()
  const [searchParams] = useSearchParams()
  const { message } = AntApp.useApp()
  const [form] = Form.useForm<Values>()
  const [loading, setLoading] = useState(false)
  const [issues, setIssues] = useState<Issue[]>([])

  useEffect(() => {
    api.listIssues().then((d) => setIssues(d.issues || [])).catch(() => {})
  }, [])

  useEffect(() => {
    const p = searchParams.get('parent')
    if (p) form.setFieldValue('parent', p)
    const s = searchParams.get('status')
    if (s) form.setFieldValue('status', s)
  }, [searchParams, form])

  function applyTemplate(id: string) {
    const tpl = (schema.templates || []).find((x) => x.id === id)
    if (!tpl) return
    form.setFieldsValue({
      title: tpl.title || form.getFieldValue('title'),
      body: tpl.body || '',
      type: tpl.type || form.getFieldValue('type'),
      priority: tpl.priority || form.getFieldValue('priority'),
      labels: tpl.labels || [],
    })
  }

  async function submit(v: Values) {
    const fields: Record<string, string> = {}
    for (const f of schema.fields || []) {
      const raw = v.fields?.[f.id]
      if (raw === undefined || raw === null || raw === '') continue
      fields[f.id] = f.type === 'date' && dayjs.isDayjs(raw) ? raw.format('YYYY-MM-DD') : String(raw)
    }
    setLoading(true)
    try {
      const { start, due, ...rest } = v
      const d = await api.createIssue({
        ...rest,
        body: v.body ?? '',
        fields,
        start: dayjs.isDayjs(start) ? start.format('YYYY-MM-DD') : undefined,
        due: dayjs.isDayjs(due) ? due.format('YYYY-MM-DD') : undefined,
      })
      message.success(t('已创建 {id}', { id: d.issue.id }))
      nav(`/issue/${d.issue.id}`)
    } catch (e) {
      message.error((e as Error).message)
      setLoading(false)
    }
  }

  const templates = schema.templates || []

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-kicker">{t('新任务')}</div>
          <h1 className="page-title">{t('新建任务')}</h1>
        </div>
      </div>
      <Card>
        <Form
          form={form}
          layout="vertical"
          onFinish={submit}
          initialValues={{ status: schema.statuses[0]?.id, type: schema.types[0]?.id }}
        >
          {templates.length > 0 && (
            <Form.Item label={t('从模板开始')}>
              <Space wrap>
                {templates.map((tpl) => (
                  <Button key={tpl.id} size="small" onClick={() => applyTemplate(tpl.id)}>
                    {tpl.name}
                  </Button>
                ))}
              </Space>
            </Form.Item>
          )}
          <Form.Item name="title" label={t('标题')} rules={[{ required: true, message: t('请输入标题') }]}>
            <Input size="large" placeholder={t('一句话描述这个任务')} />
          </Form.Item>
          <Space size="large" wrap>
            <Form.Item name="status" label={t('状态')} style={{ minWidth: 150 }}>
              <Select options={schema.statuses.map((s) => ({ value: s.id, label: s.name }))} />
            </Form.Item>
            <Form.Item name="priority" label={t('优先级')} style={{ minWidth: 130 }}>
              <Select allowClear placeholder="—" options={schema.priorities.map((p) => ({ value: p.id, label: p.name }))} />
            </Form.Item>
            <Form.Item name="type" label={t('类型')} style={{ minWidth: 130 }}>
              <Select allowClear options={schema.types.map((x) => ({ value: x.id, label: x.name }))} />
            </Form.Item>
            <Form.Item name="assignee" label={t('负责人')} style={{ minWidth: 160 }}>
              <Input placeholder={t('留空表示未指派')} />
            </Form.Item>
          </Space>
          <Space size="large" wrap>
            <Form.Item name="labels" label={t('标签')} style={{ minWidth: 260 }}>
              <Select
                mode="tags"
                placeholder={t('选择或输入标签')}
                options={schema.labels.map((l) => ({ value: l.id, label: l.name }))}
              />
            </Form.Item>
            {schema.modules.milestones && (
              <Form.Item name="milestone" label={t('里程碑')} style={{ minWidth: 180 }}>
                <Select
                  allowClear
                  showSearch
                  placeholder="—"
                  options={(schema.milestones || []).map((m) => ({ value: m.id, label: m.name }))}
                />
              </Form.Item>
            )}
          </Space>
          <Space size="large" wrap>
            <Form.Item name="start" label={t('开始日期')} style={{ minWidth: 170 }}>
              <DatePicker placeholder="—" style={{ width: 170 }} />
            </Form.Item>
            <Form.Item name="due" label={t('截止日期')} style={{ minWidth: 170 }}>
              <DatePicker placeholder="—" style={{ width: 170 }} />
            </Form.Item>
          </Space>
          {schema.modules.tree && (
            <Form.Item name="parent" label={t('父任务')}>
              <Select
                allowClear
                showSearch
                optionFilterProp="label"
                placeholder={t('无（作为顶层任务）')}
                style={{ maxWidth: 460 }}
                options={issues.map((i) => ({ value: i.id, label: `${i.id} ${i.title}` }))}
              />
            </Form.Item>
          )}
          <Form.Item name="body" label={t('描述（支持 Markdown）')}>
            <MarkdownEditor minRows={8} placeholder={t('背景、复现步骤、验收标准…')} />
          </Form.Item>
          {(schema.fields || []).length > 0 && (
            <>
              <div className="form-section">{t('自定义字段')}</div>
              <Space size="large" wrap>
                {schema.fields.map((f) => (
                  <Form.Item key={f.id} name={['fields', f.id]} label={f.name} style={{ minWidth: 200 }}>
                    {f.type === 'number' ? (
                      <InputNumber style={{ width: '100%' }} />
                    ) : f.type === 'date' ? (
                      <DatePicker style={{ width: '100%' }} />
                    ) : f.type === 'select' ? (
                      <Select allowClear options={(f.options || []).map((o) => ({ value: o, label: o }))} />
                    ) : (
                      <Input />
                    )}
                  </Form.Item>
                ))}
              </Space>
            </>
          )}
          <Space>
            <Button type="primary" htmlType="submit" loading={loading}>
              {t('创建')}
            </Button>
            <Button onClick={() => nav('/issues')}>{t('取消')}</Button>
          </Space>
        </Form>
      </Card>
    </>
  )
}