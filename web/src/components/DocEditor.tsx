import { useState } from 'react'
import { Button, Input, Select } from 'antd'

import { t } from '../i18n'
import MarkdownEditor from './MarkdownEditor'

export interface DocDraft {
  title: string
  tags: string[]
  body: string
}

interface Props {
  isNew: boolean
  initialTitle: string
  initialTags: string[]
  initialBody: string
  tagOptions: string[]
  saving: boolean
  onSave: (draft: DocDraft) => void
  onCancel: () => void
}

// 文档编辑态表单：标题 + 标签 + 正文（复用只读的 MarkdownEditor，不修改它）。
export default function DocEditor({
  isNew,
  initialTitle,
  initialTags,
  initialBody,
  tagOptions,
  saving,
  onSave,
  onCancel,
}: Props) {
  const [title, setTitle] = useState(initialTitle)
  const [tags, setTags] = useState<string[]>(initialTags)
  const [body, setBody] = useState(initialBody)

  function submit() {
    const trimmed = title.trim()
    if (!trimmed) return
    onSave({ title: trimmed, tags, body })
  }

  return (
    <div>
      <Input
        size="large"
        placeholder={t('文档标题')}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        autoFocus
        style={{ fontSize: 20, fontWeight: 600, marginBottom: 12 }}
      />
      <Select
        mode="tags"
        allowClear
        placeholder={t('标签（回车添加）')}
        value={tags}
        onChange={(v) => setTags(v as string[])}
        tokenSeparators={[',']}
        style={{ width: '100%', marginBottom: 14 }}
        options={Array.from(new Set([...tagOptions, ...tags])).map((tag) => ({ value: tag, label: tag }))}
      />
      <MarkdownEditor
        value={body}
        onChange={setBody}
        minRows={16}
        placeholder={t('支持 Markdown：# 标题、**粗体**、- 列表、- [ ] 待办…')}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 16 }}>
        <Button type="primary" loading={saving} onClick={submit}>
          {t('保存')}
        </Button>
        <Button onClick={onCancel}>{t('取消')}</Button>
        <span style={{ flex: 1 }} />
        <span className="mono">{isNew ? t('将创建新文档') : t('编辑现有文档')}</span>
      </div>
    </div>
  )
}
