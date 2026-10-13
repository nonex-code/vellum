import { useApp } from '../context'

export function StatusTag({ id }: { id?: string }) {
  const { schema } = useApp()
  const s = schema.statuses.find((x) => x.id === id)
  if (!s) return <span className="mono">{id || '—'}</span>
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: s.color,
          display: 'inline-block',
        }}
      />
      <span>{s.name}</span>
    </span>
  )
}

export function PriorityText({ id }: { id?: string }) {
  const { schema } = useApp()
  const p = schema.priorities.find((x) => x.id === id)
  if (!p) return <span style={{ color: 'var(--ink-faint)' }}>—</span>
  return (
    <span
      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: p.color, fontWeight: 500 }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: p.color,
          display: 'inline-block',
        }}
      />
      {p.name}
    </span>
  )
}