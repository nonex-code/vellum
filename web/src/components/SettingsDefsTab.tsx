import { ColorPicker, Input, InputNumber, Select } from 'antd'

import { t } from '../i18n'
import type { Label, Option, Schema, Status } from '../types'
import { ItemToolbar, AddButton, SaveBar, SubTitle, rowStyle } from './SettingsCommon'
import { moveItem, removeAt, updateAt, problemIds } from './SettingsShared'

interface Props {
  draft: Schema
  onChange: (next: Schema) => void
  saving: boolean
  onSave: () => void
}

function categoryOptions() {
  return [
    { value: 'todo', label: t('待办 todo') },
    { value: 'active', label: t('进行中 active') },
    { value: 'done', label: t('已完成 done') },
  ]
}

export default function SettingsDefsTab({ draft, onChange, saving, onSave }: Props) {
  const statuses = draft.statuses || []
  const labels = draft.labels || []
  const priorities = draft.priorities || []
  const types = draft.types || []

  const stBad = problemIds(statuses)
  const lbBad = problemIds(labels)
  const prBad = problemIds(priorities)
  const tpBad = problemIds(types)

  const set = <K extends 'statuses' | 'labels' | 'priorities' | 'types'>(key: K, value: Schema[K]) =>
    onChange({ ...draft, [key]: value } as Schema)

  const idStyle = { width: 150 }
  const nameStyle = { flex: 1, minWidth: 120 }

  return (
    <div>
      {/* 状态 */}
      <SubTitle hint={t('category 决定看板/甘特的分组：todo / active / done；wip 限制在制品数量（留空不限）')}>
        {t('状态')} · {statuses.length}
      </SubTitle>
      {statuses.map((s: Status, i) => (
        <div style={rowStyle} key={i}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <Input
              style={idStyle}
              placeholder="id"
              status={stBad.has((s.id || '').trim()) ? 'error' : undefined}
              value={s.id}
              onChange={(e) => set('statuses', updateAt(statuses, i, { id: e.target.value }))}
            />
            <Input
              style={nameStyle}
              placeholder={t('名称')}
              value={s.name}
              onChange={(e) => set('statuses', updateAt(statuses, i, { name: e.target.value }))}
            />
            <Select
              style={{ width: 140 }}
              value={s.category}
              options={categoryOptions()}
              onChange={(v: string) => set('statuses', updateAt(statuses, i, { category: v }))}
            />
            <ColorPicker
              size="small"
              showText
              value={s.color}
              onChange={(v) => set('statuses', updateAt(statuses, i, { color: v.toHexString() }))}
            />
            <InputNumber
              style={{ width: 90 }}
              min={0}
              placeholder="WIP"
              value={s.wip}
              onChange={(v) =>
                set('statuses', updateAt(statuses, i, { wip: v == null ? undefined : Number(v) }))
              }
            />
            <span style={{ flex: 1 }} />
            <ItemToolbar
              index={i}
              length={statuses.length}
              onMove={(to) => set('statuses', moveItem(statuses, i, to))}
              onRemove={() => set('statuses', removeAt(statuses, i))}
            />
          </div>
        </div>
      ))}
      <AddButton
        onClick={() =>
          set('statuses', [...statuses, { id: '', name: '', category: 'active' } as Status])
        }
      >
        {t('新增状态')}
      </AddButton>

      {/* 标签 */}
      <div style={{ marginTop: 26 }}>
        <SubTitle>{t('标签')} · {labels.length}</SubTitle>
        {labels.map((l: Label, i) => (
          <div style={rowStyle} key={i}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <Input
                style={idStyle}
                placeholder="id"
                status={lbBad.has((l.id || '').trim()) ? 'error' : undefined}
                value={l.id}
                onChange={(e) => set('labels', updateAt(labels, i, { id: e.target.value }))}
              />
              <Input
                style={nameStyle}
                placeholder={t('名称')}
                value={l.name}
                onChange={(e) => set('labels', updateAt(labels, i, { name: e.target.value }))}
              />
              <ColorPicker
                size="small"
                showText
                value={l.color}
                onChange={(v) => set('labels', updateAt(labels, i, { color: v.toHexString() }))}
              />
              <span style={{ flex: 1 }} />
              <ItemToolbar
                index={i}
                length={labels.length}
                onMove={(to) => set('labels', moveItem(labels, i, to))}
                onRemove={() => set('labels', removeAt(labels, i))}
              />
            </div>
          </div>
        ))}
        <AddButton onClick={() => set('labels', [...labels, { id: '', name: '' } as Label])}>
          {t('新增标签')}
        </AddButton>
      </div>

      {/* 优先级 */}
      <div style={{ marginTop: 26 }}>
        <SubTitle>{t('优先级')} · {priorities.length}</SubTitle>
        {priorities.map((p: Option, i) => (
          <div style={rowStyle} key={i}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <Input
                style={idStyle}
                placeholder="id"
                status={prBad.has((p.id || '').trim()) ? 'error' : undefined}
                value={p.id}
                onChange={(e) => set('priorities', updateAt(priorities, i, { id: e.target.value }))}
              />
              <Input
                style={nameStyle}
                placeholder={t('名称')}
                value={p.name}
                onChange={(e) => set('priorities', updateAt(priorities, i, { name: e.target.value }))}
              />
              <ColorPicker
                size="small"
                showText
                value={p.color}
                onChange={(v) => set('priorities', updateAt(priorities, i, { color: v.toHexString() }))}
              />
              <span style={{ flex: 1 }} />
              <ItemToolbar
                index={i}
                length={priorities.length}
                onMove={(to) => set('priorities', moveItem(priorities, i, to))}
                onRemove={() => set('priorities', removeAt(priorities, i))}
              />
            </div>
          </div>
        ))}
        <AddButton onClick={() => set('priorities', [...priorities, { id: '', name: '' } as Option])}>
          {t('新增优先级')}
        </AddButton>
      </div>

      {/* 类型 */}
      <div style={{ marginTop: 26 }}>
        <SubTitle>{t('类型')} · {types.length}</SubTitle>
        {types.map((tp: Option, i) => (
          <div style={rowStyle} key={i}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <Input
                style={idStyle}
                placeholder="id"
                status={tpBad.has((tp.id || '').trim()) ? 'error' : undefined}
                value={tp.id}
                onChange={(e) => set('types', updateAt(types, i, { id: e.target.value }))}
              />
              <Input
                style={nameStyle}
                placeholder={t('名称')}
                value={tp.name}
                onChange={(e) => set('types', updateAt(types, i, { name: e.target.value }))}
              />
              <span style={{ flex: 1 }} />
              <ItemToolbar
                index={i}
                length={types.length}
                onMove={(to) => set('types', moveItem(types, i, to))}
                onRemove={() => set('types', removeAt(types, i))}
              />
            </div>
          </div>
        ))}
        <AddButton onClick={() => set('types', [...types, { id: '', name: '' } as Option])}>
          {t('新增类型')}
        </AddButton>
      </div>

      <SaveBar saving={saving} onSave={onSave} note={t('ID 必须唯一且非空')} />
    </div>
  )
}
