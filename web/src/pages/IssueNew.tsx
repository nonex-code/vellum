import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import dayjs from 'dayjs'

import { api } from '../api'
import { useApp } from '../context'
import { t } from '../i18n'
import IssueForm, { serializeFields, type IssueFormValues } from '../components/IssueForm'
import type { Issue } from '../types'
import { useGo } from '../nav'

export default function IssueNew() {
  const { schema } = useApp()
  const nav = useGo()
  const [searchParams] = useSearchParams()
  const [loading, setLoading] = useState(false)
  const [issues, setIssues] = useState<Issue[]>([])

  useEffect(() => {
    api.listIssues().then((d) => setIssues(d.issues || [])).catch(() => {})
  }, [])

  // 从 URL 预填父任务 / 状态（如从某任务详情点「添加子任务」跳转而来）。
  const presetParent = searchParams.get('parent') || undefined
  const presetStatus = searchParams.get('status') || undefined

  async function handleSubmit(v: IssueFormValues) {
    const { start, due, ...rest } = v
    setLoading(true)
    try {
      const d = await api.createIssue({
        ...rest,
        status: v.status || schema.statuses[0]?.id || '',
        body: v.body ?? '',
        fields: serializeFields(schema, v.fields),
        start: dayjs.isDayjs(start) ? start.format('YYYY-MM-DD') : undefined,
        due: dayjs.isDayjs(due) ? due.format('YYYY-MM-DD') : undefined,
        parent: presetParent ?? v.parent ?? '',
      })
      nav(`/issue/${d.issue.id}`)
      // 不在此设 loading=false：跳转后本组件卸载，避免无效状态更新。
    } catch (e) {
      // createIssue 内部已 toast，这里仅复位按钮。
      setLoading(false)
      void e
    }
  }

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-kicker">{t('新任务')}</div>
          <h1 className="page-title">{t('新建任务')}</h1>
        </div>
      </div>
      <IssueForm
        schema={schema}
        issues={issues}
        preset={{ parent: presetParent, status: presetStatus }}
        showTemplates
        submitting={loading}
        onSubmit={handleSubmit}
        onCancel={() => nav('/issues')}
      />
    </>
  )
}
