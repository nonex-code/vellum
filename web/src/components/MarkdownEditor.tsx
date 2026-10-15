import { useRef, useState } from 'react'
import { Button, Segmented, Tooltip } from 'antd'
import {
  BoldOutlined,
  CheckSquareOutlined,
  CodeOutlined,
  FileImageOutlined,
  ItalicOutlined,
  LinkOutlined,
  NodeIndexOutlined,
  OrderedListOutlined,
  UnorderedListOutlined,
} from '@ant-design/icons'

import { t } from '../i18n'
import Markdown from './Markdown'

interface Props {
  value?: string
  onChange?: (v: string) => void
  placeholder?: string
  minRows?: number
  issueId?: string
  autoFocus?: boolean
}

type Tab = 'write' | 'preview' | 'split'

export default function MarkdownEditor({
  value = '',
  onChange,
  placeholder,
  minRows = 8,
  issueId,
  autoFocus,
}: Props) {
  const [tab, setTab] = useState<Tab>('write')
  const ref = useRef<HTMLTextAreaElement>(null)

  function emit(next: string) {
    onChange?.(next)
  }

  // 在光标处包裹 / 替换选区。
  function surround(before: string, after = before, placeholderText = '') {
    const el = ref.current
    if (!el) {
      emit(value + before + placeholderText + after)
      return
    }
    const start = el.selectionStart
    const end = el.selectionEnd
    const sel = value.slice(start, end) || placeholderText
    const next = value.slice(0, start) + before + sel + after + value.slice(end)
    emit(next)
    requestAnimationFrame(() => {
      el.focus()
      const caret = start + before.length
      el.setSelectionRange(caret, caret + sel.length)
    })
  }

  // 在行首插入前缀（标题 / 列表 / 引用 / 待办）。
  function prefixLines(make: (i: number) => string, placeholderText = t('内容')) {
    const el = ref.current
    if (!el) {
      emit(make(0) + placeholderText + '\n')
      return
    }
    const start = el.selectionStart
    const end = el.selectionEnd
    const lineStart = value.lastIndexOf('\n', start - 1) + 1
    const block = value.slice(lineStart, end)
    const lines = block.split('\n')
    const replaced = lines.map((l, i) => make(i) + l).join('\n')
    const next = value.slice(0, lineStart) + replaced + value.slice(end)
    emit(next)
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(lineStart, lineStart + replaced.length)
    })
  }

  // 在光标处插入一整块文本（代码块/图表），必要时前面补空行。
  function insertBlock(text: string) {
    const el = ref.current
    if (!el) {
      emit(value + (value && !value.endsWith('\n') ? '\n\n' : '') + text)
      return
    }
    const start = el.selectionStart
    const end = el.selectionEnd
    const before = value.slice(0, start)
    const after = value.slice(end)
    const pad = before && !before.endsWith('\n') ? '\n\n' : ''
    const insert = pad + text
    emit(before + insert + after)
    requestAnimationFrame(() => {
      el.focus()
      const caret = (before + insert).length
      el.setSelectionRange(caret, caret)
    })
  }

  // title 是工具栏提示；placeholderText 是点按钮时插入的占位样例，跟随界面语言（用户会覆写它）。
  const tools: { key: string; title: string; icon: React.ReactNode; run: () => void }[] = [
    { key: 'h1', title: t('一级标题'), icon: 'H1', run: () => prefixLines(() => '# ') },
    { key: 'h2', title: t('二级标题'), icon: 'H2', run: () => prefixLines(() => '## ') },
    { key: 'bold', title: t('粗体'), icon: <BoldOutlined />, run: () => surround('**', '**', t('粗体')) },
    { key: 'italic', title: t('斜体'), icon: <ItalicOutlined />, run: () => surround('*', '*', t('斜体')) },
    { key: 'ul', title: t('无序列表'), icon: <UnorderedListOutlined />, run: () => prefixLines(() => '- ', t('列表项')) },
    { key: 'ol', title: t('有序列表'), icon: <OrderedListOutlined />, run: () => prefixLines((i) => `${i + 1}. `, t('列表项')) },
    {
      key: 'todo',
      title: t('待办清单'),
      icon: <CheckSquareOutlined />,
      run: () => prefixLines(() => '- [ ] ', t('待办')),
    },
    { key: 'quote', title: t('引用'), icon: '❝', run: () => prefixLines(() => '> ') },
    { key: 'code', title: t('行内代码'), icon: <CodeOutlined />, run: () => surround('`', '`', 'code') },
    {
      key: 'link',
      title: t('链接'),
      icon: <LinkOutlined />,
      run: () => surround('[', '](https://)', t('链接文字')),
    },
    {
      key: 'img',
      title: t('图片'),
      icon: <FileImageOutlined />,
      run: () => surround('![', t('](图片URL)'), t('描述')),
    },
    {
      key: 'mermaid',
      title: t('Mermaid 图表'),
      icon: <NodeIndexOutlined />,
      run: () => insertBlock(t('```mermaid\ngraph TD\n  A[开始] --> B[结束]\n```\n')),
    },
  ]

  return (
    <div className="md-editor">
      <div className="md-toolbar">
        <div className="md-tools">
          {tools.map((tool) => (
            <Tooltip key={tool.key} title={tool.title}>
              <button
                type="button"
                className="md-tool"
                disabled={tab === 'preview'}
                onMouseDown={(e) => e.preventDefault()}
                onClick={tool.run}
              >
                {tool.icon}
              </button>
            </Tooltip>
          ))}
        </div>
        <Segmented
          size="small"
          value={tab}
          onChange={(v) => setTab(v as Tab)}
          options={[
            { label: t('编写'), value: 'write' },
            { label: t('分屏'), value: 'split' },
            { label: t('预览'), value: 'preview' },
          ]}
        />
      </div>

      <div className={`md-editor-body tab-${tab}`}>
        {tab !== 'preview' && (
          <textarea
            ref={ref}
            className="md-input"
            value={value}
            autoFocus={autoFocus}
            placeholder={placeholder || t('支持 Markdown：# 标题、**粗体**、- 列表、- [ ] 待办…')}
            onChange={(e) => emit(e.target.value)}
            rows={minRows}
            spellCheck={false}
          />
        )}
        {tab !== 'write' && (
          <div className="md-preview">
            {value.trim() ? (
              <Markdown issueId={issueId}>{value}</Markdown>
            ) : (
              <span className="md-empty">{t('暂无内容可预览')}</span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
