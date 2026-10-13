import { ColorPicker, DatePicker, Input, InputNumber, Select } from 'antd'
import dayjs from 'dayjs'

import { t } from '../i18n'
import type { Field, Option, Schema } from '../types'
import { ItemToolbar, AddButton, SaveBar, SubTitle, rowStyle } from './SettingsCommon'
import { moveItem, removeAt, updateAt, problemIds } from './SettingsShared'

interface Props {
  draft: Schema
  onChange: (next: Schema) => void
  saving: boolean
  onSave: () => void
}

function fieldTypes() {
  return [
    { value: 'text', label: t('文本 text') },
    { value: 'number', label: t('数字 number') },
    { value: 'date', label: t('日期 date') },
    { value: 'select', label: t('单选 select') },
  ]
}

// antd DatePicker.onChange 的 dateString 类型是 string | string[]；这里取单个日期串。
function oneDate(ds: string | string[]): string | undefined {
  const v = Array.isArray(ds) ? ds[0] : ds
  return v || undefined
}

export default function SettingsFieldsTab({ draft, onChange, saving, onSave }: Props) {
  const milestones = draft.milestones || []
  const fields = draft.fields || []

  const msBad = problemIds(milestones)
  const fdBad = problemIds(fields)

  const setMs = (arr: Option[]) => onChange({ ...draft, milestones: arr })
  const setFd = (arr: Field[]) => onChange({ ...draft, fields: arr })

  return (
    <div>
      {/* 里程碑 */}
      <SubTitle hint={t('start / end 为甘特图的时间区间（可选，格式 YYYY-MM-DD）；order 控制排序')}>
        {t('里程碑')} · {milestones.length}
      </SubTitle>
      {milestones.map((m: Option, i) => (
        <div style={rowStyle} key={i}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <Input
              style={{ width: 140 }}
              placeholder="id"
              status={msBad.has((m.id || '').trim()) ? 'error' : undefined}
              value={m.id}
              onChange={(e) => setMs(updateAt(milestones, i, { id: e.target.value }))}
            />
            <Input
              style={{ flex: 1, minWidth: 120 }}
              placeholder={t('名称')}
              value={m.name}
              onChange={(e) => setMs(updateAt(milestones, i, { name: e.target.value }))}
            />
            <ColorPicker
              size="small"
              showText
              value={m.color}
              onChange={(v) => setMs(updateAt(milestones, i, { color: v.toHexString() }))}
            />
            <InputNumber
              style={{ width: 80 }}
              placeholder={t('顺序')}
              value={m.order}
              onChange={(v) =>
                setMs(updateAt(milestones, i, { order: v == null ? undefined : Number(v) }))
              }
            />
            <DatePicker
              format="YYYY-MM-DD"
              placeholder={t('开始')}
              style={{ width: 150 }}
              value={m.start ? dayjs(m.start) : null}
              onChange={(_, ds) => setMs(updateAt(milestones, i, { start: oneDate(ds) }))}
            />
            <DatePicker
              format="YYYY-MM-DD"
              placeholder={t('结束')}
              style={{ width: 150 }}
              value={m.end ? dayjs(m.end) : null}
              onChange={(_, ds) => setMs(updateAt(milestones, i, { end: oneDate(ds) }))}
            />
            <span style={{ flex: 1 }} />
            <ItemToolbar
              index={i}
              length={milestones.length}
              onMove={(to) => setMs(moveItem(milestones, i, to))}
              onRemove={() => setMs(removeAt(milestones, i))}
            />
          </div>
        </div>
      ))}
      <AddButton onClick={() => setMs([...milestones, { id: '', name: '' } as Option])}>
        {t('新增里程碑')}
      </AddButton>

      {/* 字段 */}
      <div style={{ marginTop: 26 }}>
        <SubTitle hint={t('type = select 时可填写「选项」（回车分隔）')}>{t('自定义字段')} · {fields.length}</SubTitle>
        {fields.map((f: Field, i) => (
          <div style={rowStyle} key={i}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <Input
                style={{ width: 140 }}
                placeholder="id"
                status={fdBad.has((f.id || '').trim()) ? 'error' : undefined}
                value={f.id}
                onChange={(e) => setFd(updateAt(fields, i, { id: e.target.value }))}
              />
              <Input
                style={{ flex: 1, minWidth: 120 }}
                placeholder={t('名称')}
                value={f.name}
                onChange={(e) => setFd(updateAt(fields, i, { name: e.target.value }))}
              />
              <Select
                style={{ width: 140 }}
                value={f.type}
                options={fieldTypes()}
                onChange={(v: string) =>
                  setFd(updateAt(fields, i, { type: v, options: v === 'select' ? f.options || [] : undefined }))
                }
              />
              {f.type === 'select' && (
                <Select
                  mode="tags"
                  style={{ minWidth: 220, flex: 2 }}
                  placeholder={t('选项，回车添加')}
                  value={f.options || []}
                  onChange={(v: string[]) => setFd(updateAt(fields, i, { options: v }))}
                  tokenSeparators={[',', ' ']}
                />
              )}
              <span style={{ flex: 1 }} />
              <ItemToolbar
                index={i}
                length={fields.length}
                onMove={(to) => setFd(moveItem(fields, i, to))}
                onRemove={() => setFd(removeAt(fields, i))}
              />
            </div>
          </div>
        ))}
        <AddButton onClick={() => setFd([...fields, { id: '', name: '', type: 'text' } as Field])}>
          {t('新增字段')}
        </AddButton>
      </div>

      <SaveBar saving={saving} onSave={onSave} note={t('里程碑/字段为空时不会写入 yaml')} />
    </div>
  )
}
