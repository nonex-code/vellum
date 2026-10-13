import { Input, Select } from 'antd'

import { t } from '../i18n'
import type { Schema, Template } from '../types'
import { ItemToolbar, AddButton, SaveBar, SubTitle, rowStyle } from './SettingsCommon'
import { moveItem, removeAt, updateAt, problemIds } from './SettingsShared'

interface Props {
  draft: Schema
  onChange: (next: Schema) => void
  saving: boolean
  onSave: () => void
}

export default function SettingsTemplatesTab({ draft, onChange, saving, onSave }: Props) {
  const templates = draft.templates || []
  const tpBad = problemIds(templates)

  const set = (arr: Template[]) => onChange({ ...draft, templates: arr })

  const typeOptions = (draft.types || []).map((x) => ({ value: x.id, label: x.name }))
  const prioOptions = (draft.priorities || []).map((p) => ({ value: p.id, label: p.name }))
  const labelOptions = (draft.labels || []).map((l) => ({ value: l.id, label: l.name }))

  return (
    <div>
      <SubTitle hint={t('模板用于「新建任务」快速填充：标题 / 正文 / 类型 / 优先级 / 标签')}>
        {t('新建模板')} · {templates.length}
      </SubTitle>

      {templates.map((tp: Template, i) => (
        <div style={rowStyle} key={i}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 8 }}>
            <Input
              style={{ width: 140 }}
              placeholder="id"
              status={tpBad.has((tp.id || '').trim()) ? 'error' : undefined}
              value={tp.id}
              onChange={(e) => set(updateAt(templates, i, { id: e.target.value }))}
            />
            <Input
              style={{ flex: 1, minWidth: 140 }}
              placeholder={t('模板名称')}
              value={tp.name}
              onChange={(e) => set(updateAt(templates, i, { name: e.target.value }))}
            />
            <span style={{ flex: 1 }} />
            <ItemToolbar
              index={i}
              length={templates.length}
              onMove={(to) => set(moveItem(templates, i, to))}
              onRemove={() => set(removeAt(templates, i))}
            />
          </div>

          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
            <Input
              style={{ flex: '1 1 220px', minWidth: 200 }}
              placeholder={t('默认标题')}
              value={tp.title}
              onChange={(e) => set(updateAt(templates, i, { title: e.target.value }))}
            />
            <Select
              style={{ width: 140 }}
              allowClear
              placeholder={t('类型')}
              value={tp.type}
              options={typeOptions}
              onChange={(v?: string) => set(updateAt(templates, i, { type: v }))}
            />
            <Select
              style={{ width: 140 }}
              allowClear
              placeholder={t('优先级')}
              value={tp.priority}
              options={prioOptions}
              onChange={(v?: string) => set(updateAt(templates, i, { priority: v }))}
            />
            <Select
              mode="multiple"
              style={{ flex: '1 1 200px', minWidth: 180 }}
              allowClear
              placeholder={t('标签')}
              value={tp.labels || []}
              options={labelOptions}
              onChange={(v: string[]) => set(updateAt(templates, i, { labels: v }))}
            />
          </div>

          <Input.TextArea
            placeholder={t('模板正文（支持 Markdown）')}
            autoSize={{ minRows: 3, maxRows: 12 }}
            value={tp.body}
            onChange={(e) => set(updateAt(templates, i, { body: e.target.value }))}
          />
        </div>
      ))}

      <AddButton onClick={() => set([...templates, { id: '', name: '' } as Template])}>
        {t('新增模板')}
      </AddButton>

      <SaveBar saving={saving} onSave={onSave} note={t('模板为空时不会写入 yaml')} />
    </div>
  )
}
