import type { CSSProperties, ReactNode } from 'react'
import { Button, Space } from 'antd'
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  DeleteOutlined,
  PlusOutlined,
} from '@ant-design/icons'

import { t } from '../i18n'

// 可编辑列表里每一条的外层卡片样式
export const rowStyle: CSSProperties = {
  border: '1px solid var(--border)',
  borderRadius: 10,
  padding: '12px 14px',
  marginBottom: 10,
  background: 'var(--surface)',
}

export function ItemToolbar({
  index,
  length,
  onMove,
  onRemove,
}: {
  index: number
  length: number
  onMove: (to: number) => void
  onRemove: () => void
}) {
  return (
    <Space size={2}>
      <Button
        size="small"
        type="text"
        icon={<ArrowUpOutlined />}
        disabled={index === 0}
        onClick={() => onMove(index - 1)}
        title={t('上移')}
      />
      <Button
        size="small"
        type="text"
        icon={<ArrowDownOutlined />}
        disabled={index === length - 1}
        onClick={() => onMove(index + 1)}
        title={t('下移')}
      />
      <Button
        size="small"
        type="text"
        danger
        icon={<DeleteOutlined />}
        onClick={onRemove}
        title={t('删除')}
      />
    </Space>
  )
}

export function AddButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <Button type="dashed" block icon={<PlusOutlined />} onClick={onClick} style={{ marginTop: 4 }}>
      {children}
    </Button>
  )
}

export function SaveBar({
  saving,
  onSave,
  note,
}: {
  saving: boolean
  onSave: () => void
  note?: ReactNode
}) {
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 18 }}>
      <Button type="primary" loading={saving} onClick={onSave}>
        {t('保存配置')}
      </Button>
      {note && <span style={{ color: 'var(--ink-faint)', fontSize: 12 }}>{note}</span>}
    </div>
  )
}

export function SubTitle({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  return (
    <div style={{ margin: '6px 0 10px' }}>
      <div className="section-label" style={{ margin: 0 }}>
        {children}
      </div>
      {hint && (
        <div style={{ color: 'var(--ink-faint)', fontSize: 12, marginTop: 2 }}>{hint}</div>
      )}
    </div>
  )
}
