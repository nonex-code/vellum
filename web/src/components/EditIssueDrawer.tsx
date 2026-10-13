import { App as AntApp, Button, DatePicker, Drawer, Form, Input, InputNumber, Select, Space } from 'antd'
import dayjs from 'dayjs'
import { useEffect, useState } from 'react'

import { api } from '../api'
import { useApp } from '../context'
import { t } from '../i18n'
import type { Issue } from '../types'

interface Props {
  issue: Issue | null
  open: boolean
  onClose: () => void
  onSaved: (issue: Issue) => void
}

export default function EditIssueDrawer({ issue, open, onClose, onSaved }: Props) {
  const { schema } = useApp()
  const { message } = AntApp.useApp()
  const [form] = Form.useForm()
  const [issues, setIssues] = useState<Issue[]>([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) {
      api.listIssues().then((d) => setIssues(d.issues || [])).catch(() => {})
    }
  }, [open])

  useEffect(() => {
    if (open && issue) {
      const fields: Record<string, unknown> = {}
      for (const f of schema.fields || []) {
        const v = issue.fields?.[f.id]
        if (f.type === 'date' && v) fields[f.id] = dayjs(v)
        else if (f.type === 'number' && v) fields[f.id] = Number(v)
        else fields[f.id] = v
      }
      form.setFieldsValue({
        title: issue.title,
        body: issue.body,
        status: issue.status,
        priority: issue.priority || undefined,
        type: issue.type || undefined,
        assignee: issue.assignee || undefined,
        labels: issue.labels || [],
        milestone: issue.milestone || undefined,
        parent: issue.parent || undefined,
        start: issue.start ? dayjs(issue.start) : undefined,
        due: issue.due ? dayjs(issue.due) : undefined,
        fields,
      })
    }
  }, [open, issue, schema.fields, form])

  async function submit() {
    if (!issue) return
    const v = await form.validateFields()
    const fields: Record<string, string> = {}
    for (const f of schema.fields || []) {
      const raw = v.fields?.[f.id]
      if (raw === undefined || raw === null || raw === '') continue
      fields[f.id] = f.type === 'date' && dayjs.isDayjs(raw) ? raw.format('YYYY-MM-DD') : String(raw)
    }
    setSaving(true)
    try {
      const d = await api.patchIssue(issue.id, {
        title: v.title,
        body: v.body ?? '',
        status: v.status,
        priority: v.priority || '',
        type: v.type || '',
        assignee: v.assignee || '',
        labels: v.labels || [],
        milestone: v.milestone || '',
        parent: v.parent || '',
        start: dayjs.isDayjs(v.start) ? v.start.format('YYYY-MM-DD') : '',
        due: dayjs.isDayjs(v.due) ? v.due.format('YYYY-MM-DD') : '',
        fields,
      })
      message.success(t('已保存'))
      onSaved(d.issue)
      onClose()
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Drawer
      title={issue ? t('编辑 {id}', { id: issue.id }) : t('编辑')}
      width={520}
      open={open}
      onClose={onClose}
      destroyOnClose
      footer={
        <div style={{ textAlign: 'right' }}>
          <Space>
            <Button onClick={onClose}>{t('取消')}</Button>
            <Button type="primary" loading={saving} onClick={submit}>
              {t('保存')}
            </Button>
          </Space>
        </div>
      }
    >
      <Form form={form} layout="vertical">
        <Form.Item name="title" label={t('标题')} rules={[{ required: true, message: t('请输入标题') }]}>
          <Input.TextArea rows={2} autoSize />
        </Form.Item>
        <Form.Item name="body" label={t('描述（Markdown）')}>
          <Input.TextArea rows={10} placeholder={t('背景、复现步骤、验收标准…')} />
        </Form.Item>
        <Space size="large" wrap>
          <Form.Item name="status" label={t('状态')} style={{ minWidth: 150 }}>
            <Select options={schema.statuses.map((s) => ({ value: s.id, label: s.name }))} />
          </Form.Item>
          <Form.Item name="priority" label={t('优先级')} style={{ minWidth: 130 }}>
            <Select
              allowClear
              placeholder="—"
              options={schema.priorities.map((p) => ({ value: p.id, label: p.name }))}
            />
          </Form.Item>
          <Form.Item name="type" label={t('类型')} style={{ minWidth: 130 }}>
            <Select allowClear placeholder="—" options={schema.types.map((x) => ({ value: x.id, label: x.name }))} />
          </Form.Item>
        </Space>
        <Space size="large" wrap>
          <Form.Item name="assignee" label={t('负责人')} style={{ minWidth: 180 }}>
            <Input placeholder={t('留空表示未指派')} />
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
          <Form.Item name="start" label={t('开始日期')} style={{ minWidth: 180 }}>
            <DatePicker placeholder="—" style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="due" label={t('截止日期')} style={{ minWidth: 180 }}>
            <DatePicker placeholder="—" style={{ width: '100%' }} />
          </Form.Item>
        </Space>
        <Form.Item name="labels" label={t('标签')}>
          <Select
            mode="tags"
            placeholder={t('选择或输入标签')}
            options={schema.labels.map((l) => ({ value: l.id, label: l.name }))}
          />
        </Form.Item>
        {schema.modules.tree && (
          <Form.Item name="parent" label={t('父任务')}>
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder={t('无（作为顶层任务）')}
              options={issues
                .filter((i) => i.id !== issue?.id)
                .map((i) => ({ value: i.id, label: `${i.id} ${i.title}` }))}
            />
          </Form.Item>
        )}
        {(schema.fields || []).length > 0 && (
          <>
            <div className="form-section">{t('自定义字段')}</div>
            {schema.fields.map((f) => (
              <Form.Item key={f.id} name={['fields', f.id]} label={f.name}>
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
          </>
        )}
      </Form>
    </Drawer>
  )
}