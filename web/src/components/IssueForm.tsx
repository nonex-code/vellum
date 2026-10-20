import { App as AntApp, Button, Card, DatePicker, Form, Input, InputNumber, Select, Space } from 'antd'
import dayjs from 'dayjs'
import { useEffect } from 'react'

import { t } from '../i18n'
import type { Issue, Schema, Template } from '../types'
import MarkdownEditor from './MarkdownEditor'

// IssueForm 是「新建 / 编辑」共用的任务表单：抽出原本散落在 IssueNew 与
// 编辑抽屉里的重复字段定义与序列化逻辑，编辑与新建复用同一套代码。
// 编辑模式下 body 用 MarkdownEditor（替代抽屉里只支持纯文本的 TextArea），功能更完整。

export interface IssueFormValues {
  title: string
  body?: string
  status?: string
  priority?: string
  type?: string
  assignee?: string
  labels?: string[]
  milestone?: string
  parent?: string
  start?: dayjs.Dayjs
  due?: dayjs.Dayjs
  fields?: Record<string, any>
}

interface Props {
  schema: Schema
  issues: Issue[]
  /** 编辑时回填的任务；不传则为新建（用 schema 默认值 + preset）。 */
  initial?: Issue
  /** 新建模式下的预填值（如从 URL 带过来的 parent/status），仅在 initial 缺省时生效。 */
  preset?: Partial<IssueFormValues>
  /** 自身 id：编辑时从父任务候选里排除自己。 */
  selfId?: string
  /** 是否展示「从模板开始」（仅新建需要）。 */
  showTemplates?: boolean
  submitting?: boolean
  onSubmit: (values: IssueFormValues) => void | Promise<void>
  onCancel?: () => void
}

// serializeFields 把表单里的自定义字段整形为后端期望的字符串映射：
// 日期格式化为 YYYY-MM-DD，数字转字符串，空值跳过。
export function serializeFields(schema: Schema, raw?: Record<string, any>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const f of schema.fields || []) {
    const v = raw?.[f.id]
    if (v === undefined || v === null || v === '') continue
    out[f.id] = f.type === 'date' && dayjs.isDayjs(v) ? v.format('YYYY-MM-DD') : String(v)
  }
  return out
}

// toInitialFields 把任务里的自定义字段转成表单初始值（日期→dayjs，数字→Number）。
export function toInitialFields(schema: Schema, issue?: Issue): Record<string, any> {
  const out: Record<string, unknown> = {}
  for (const f of schema.fields || []) {
    const v = issue?.fields?.[f.id]
    if (f.type === 'date' && v) out[f.id] = dayjs(v)
    else if (f.type === 'number' && v) out[f.id] = Number(v)
    else out[f.id] = v
  }
  return out
}

export default function IssueForm({
  schema,
  issues,
  initial,
  preset,
  selfId,
  showTemplates,
  submitting,
  onSubmit,
  onCancel,
}: Props) {
  const { message } = AntApp.useApp()
  const [form] = Form.useForm<IssueFormValues>()

  useEffect(() => {
    const base: IssueFormValues = {
      title: initial?.title ?? preset?.title ?? '',
      body: initial?.body ?? preset?.body ?? '',
      status: initial?.status ?? preset?.status ?? schema.statuses[0]?.id,
      priority: initial?.priority ?? preset?.priority ?? undefined,
      type: initial?.type ?? preset?.type ?? undefined,
      assignee: initial?.assignee ?? preset?.assignee ?? undefined,
      labels: initial?.labels ?? preset?.labels ?? [],
      milestone: initial?.milestone ?? preset?.milestone ?? undefined,
      parent: initial?.parent ?? preset?.parent ?? undefined,
      start: initial?.start ? dayjs(initial.start) : preset?.start,
      due: initial?.due ? dayjs(initial.due) : preset?.due,
      fields: toInitialFields(schema, initial),
    }
    form.setFieldsValue(base)
  }, [initial, preset, schema, form])

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

  async function submit() {
    let v: IssueFormValues
    try {
      v = await form.validateFields()
    } catch {
      message.error(t('请填写必填项'))
      return
    }
    await onSubmit(v)
  }

  const templates = showTemplates ? schema.templates || [] : []
  const parentOptions = issues
    .filter((i) => i.id !== selfId)
    .map((i) => ({ value: i.id, label: `${i.id} ${i.title}` }))

  return (
    <Card>
      <Form form={form} layout="vertical">
        {templates.length > 0 && (
          <Form.Item label={t('从模板开始')}>
            <Space wrap>
              {templates.map((tpl: Template) => (
                <Button key={tpl.id} size="small" onClick={() => applyTemplate(tpl.id)}>
                  {tpl.name}
                </Button>
              ))}
            </Space>
          </Form.Item>
        )}
        <Form.Item
          name="title"
          label={t('标题')}
          rules={[{ required: true, message: t('请输入标题') }]}
        >
          <Input size="large" placeholder={t('一句话描述这个任务')} />
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
              options={parentOptions}
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
          <Button type="primary" loading={submitting} onClick={submit}>
            {t('保存')}
          </Button>
          {onCancel && (
            <Button onClick={onCancel}>{t('取消')}</Button>
          )}
        </Space>
      </Form>
    </Card>
  )
}
