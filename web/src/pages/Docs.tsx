import { useEffect, useMemo, useRef, useState } from 'react'
import { App as AntApp, Button, Empty, Input, List, Modal, Popconfirm, Select, Skeleton, Space, Tag, Tooltip, Tree } from 'antd'
import type { TreeDataNode } from 'antd'
import {
  DeleteOutlined,
  EditOutlined,
  FileMarkdownOutlined,
  FolderOpenOutlined,
  FolderOutlined,
  PlusOutlined,
  PushpinFilled,
  PushpinOutlined,
  ReloadOutlined,
  SearchOutlined,
  SwapOutlined,
} from '@ant-design/icons'
import { useSearchParams } from 'react-router-dom'

import { api } from '../api'
import { t } from '../i18n'
import type { Doc, DocHit } from '../types'
import { fromNow } from '../util'
import Markdown from '../components/Markdown'
import DocEditor, { type DocDraft } from '../components/DocEditor'

const ROOT = 'docs/'

function stripRoot(p: string): string {
  return p.startsWith(ROOT) ? p.slice(ROOT.length) : p
}

function displayName(d: Doc): string {
  if (d.title && d.title.trim()) return d.title
  const base = stripRoot(d.path).split('/').pop() || d.path
  return base.replace(/\.md$/i, '')
}

// 与后端 store.Slug 大致一致：保留字母数字/CJK/_，其余转 -。
function docSlug(title: string): string {
  let out = title
    .trim()
    .replace(/[\\/:*?"<>|.]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '')
  if (!out) out = 'doc'
  return out.slice(0, 60)
}

interface Folder {
  key: string
  name: string
  folders: Map<string, Folder>
  docs: Doc[]
}

function makeFolder(key: string, name: string): Folder {
  return { key, name, folders: new Map(), docs: [] }
}

function sortDocs(a: Doc, b: Doc): number {
  return (b.updated || '').localeCompare(a.updated || '')
}

function folderNode(f: Folder): TreeDataNode {
  const children: TreeDataNode[] = []
  const subs = [...f.folders.values()].sort((a, b) => a.name.localeCompare(b.name, 'zh'))
  for (const s of subs) children.push(folderNode(s))
  for (const d of [...f.docs].sort(sortDocs)) {
    children.push({
      key: 'doc:' + d.path,
      title: (
        <span title={d.path} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, maxWidth: '100%' }}>
          <FileMarkdownOutlined style={{ color: 'var(--ink-faint)', flex: '0 0 auto' }} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{displayName(d)}</span>
        </span>
      ),
    })
  }
  return {
    key: f.key,
    selectable: false,
    title: (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 500 }}>
        <FolderOutlined style={{ color: 'var(--ink-faint)' }} />
        {f.name}
      </span>
    ),
    children,
  }
}

function collectFolderKeys(nodes: TreeDataNode[], acc: string[] = []): string[] {
  for (const n of nodes) {
    if (n.children && n.children.length) {
      acc.push(n.key as string)
      collectFolderKeys(n.children, acc)
    }
  }
  return acc
}

function buildTree(docs: Doc[]): TreeDataNode[] {
  const pinned = docs.filter((d) => d.pinned)
  const rest = docs.filter((d) => !d.pinned)

  const root = makeFolder('dir:', '')
  for (const d of rest) {
    const segs = stripRoot(d.path).split('/')
    let cur = root
    for (let i = 0; i < segs.length - 1; i++) {
      const name = segs[i]
      const key = 'dir:' + segs.slice(0, i + 1).join('/')
      let next = cur.folders.get(name)
      if (!next) {
        next = makeFolder(key, name)
        cur.folders.set(name, next)
      }
      cur = next
    }
    cur.docs.push(d)
  }

  const out: TreeDataNode[] = [...root.folders.values()].sort((a, b) => a.name.localeCompare(b.name, 'zh')).map(folderNode)
  for (const d of [...root.docs].sort(sortDocs)) {
    out.push({
      key: 'doc:' + d.path,
      title: (
        <span title={d.path} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, maxWidth: '100%' }}>
          <FileMarkdownOutlined style={{ color: 'var(--ink-faint)', flex: '0 0 auto' }} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{displayName(d)}</span>
        </span>
      ),
    })
  }

  if (pinned.length) {
    out.unshift({
      key: 'dir:__pinned',
      selectable: false,
      title: (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 600 }}>
          <PushpinFilled style={{ color: 'var(--accent)' }} />
          {t('置顶')}
        </span>
      ),
      children: [...pinned]
        .sort(sortDocs)
        .map((d) => ({
          key: 'doc:' + d.path,
          title: (
            <span title={d.path} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, maxWidth: '100%' }}>
              <PushpinFilled style={{ color: 'var(--accent)', flex: '0 0 auto', fontSize: 11 }} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{displayName(d)}</span>
            </span>
          ),
        })),
    })
  }

  return out
}

export default function Docs() {
  const { message } = AntApp.useApp()
  const [params, setParams] = useSearchParams()
  const activePath = params.get('path') || ''

  const [docs, setDocs] = useState<Doc[]>([])
  const [loadingList, setLoadingList] = useState(true)
  const [current, setCurrent] = useState<Doc | null>(null)
  const [loadingDoc, setLoadingDoc] = useState(false)

  const [searchQ, setSearchQ] = useState('')
  const [hits, setHits] = useState<DocHit[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [tagFilter, setTagFilter] = useState<string[]>([])

  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [newDoc, setNewDoc] = useState<{ title: string; dir: string } | null>(null)

  const [renameOpen, setRenameOpen] = useState(false)
  const [renameVal, setRenameVal] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [createTitle, setCreateTitle] = useState('')
  const [createDir, setCreateDir] = useState('')

  const searchTimer = useRef<number | undefined>(undefined)

  const loadDocs = async () => {
    try {
      const d = await api.listDocs()
      setDocs(d.docs || [])
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setLoadingList(false)
    }
  }

  useEffect(() => {
    loadDocs()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // URL hash(path) → 拉取正文，作为唯一事实来源。
  useEffect(() => {
    if (!activePath) {
      setCurrent(null)
      setEditing(false)
      setNewDoc(null)
      return
    }
    let cancelled = false
    setLoadingDoc(true)
    setEditing(false)
    setNewDoc(null)
    api
      .getDoc(activePath)
      .then((d) => {
        if (!cancelled) setCurrent(d.doc)
      })
      .catch((e) => {
        if (!cancelled) {
          message.error((e as Error).message)
          setCurrent(null)
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingDoc(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePath])

  // 搜索防抖
  useEffect(() => {
    if (searchTimer.current) window.clearTimeout(searchTimer.current)
    const q = searchQ.trim()
    if (!q) {
      setHits(null)
      setSearching(false)
      return
    }
    setSearching(true)
    searchTimer.current = window.setTimeout(async () => {
      try {
        const d = await api.searchDocs(q)
        setHits(d.hits || [])
      } catch (e) {
        message.error((e as Error).message)
        setHits([])
      } finally {
        setSearching(false)
      }
    }, 260)
    return () => {
      if (searchTimer.current) window.clearTimeout(searchTimer.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQ])

  const tagOptions = useMemo(() => {
    const s = new Set<string>()
    for (const d of docs) (d.tags || []).forEach((tag) => s.add(tag))
    return [...s].sort((a, b) => a.localeCompare(b, 'zh'))
  }, [docs])

  const filteredDocs = useMemo(() => {
    if (tagFilter.length === 0) return docs
    return docs.filter((d) => (d.tags || []).some((tag) => tagFilter.includes(tag)))
  }, [docs, tagFilter])

  const treeData = useMemo(() => buildTree(filteredDocs), [filteredDocs])
  const expandedSignature = useMemo(
    () => treeData.map((n) => n.key).join('|') + '#' + tagFilter.join(',') + '#' + docs.length,
    [treeData, tagFilter, docs.length],
  )
  const [expandedKeys, setExpandedKeys] = useState<React.Key[]>([])

  useEffect(() => {
    setExpandedKeys(collectFolderKeys(treeData))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expandedSignature])

  function select(path: string) {
    setParams((prev) => {
      const p = new URLSearchParams(prev)
      p.set('path', path)
      return p
    })
  }

  function deselect() {
    setParams((prev) => {
      const p = new URLSearchParams(prev)
      p.delete('path')
      return p
    })
  }

  async function togglePin(d: Doc) {
    try {
      const r = await api.updateDoc(d.path, { pinned: !d.pinned })
      setCurrent(r.doc)
      await loadDocs()
      message.success(r.doc.pinned ? t('已置顶') : t('已取消置顶'))
    } catch (e) {
      message.error((e as Error).message)
    }
  }

  async function removeDoc(d: Doc) {
    try {
      await api.deleteDoc(d.path)
      message.success(t('已删除'))
      if (activePath === d.path) deselect()
      await loadDocs()
    } catch (e) {
      message.error((e as Error).message)
    }
  }

  function openRename() {
    if (!current) return
    setRenameVal(stripRoot(current.path))
    setRenameOpen(true)
  }

  async function doRename() {
    if (!current) return
    const v = renameVal.trim().replace(/^\/+|\.md$/gi, '')
    if (!v) {
      message.warning(t('请输入新路径'))
      return
    }
    try {
      const r = await api.updateDoc(current.path, { path: v })
      setRenameOpen(false)
      message.success(t('已重命名/移动'))
      await loadDocs()
      select(r.doc.path)
    } catch (e) {
      message.error((e as Error).message)
    }
  }

  async function saveDoc(draft: DocDraft) {
    setSaving(true)
    try {
      if (newDoc) {
        const parts = [newDoc.dir.trim().replace(/^\/+|\/+$/g, ''), docSlug(draft.title)].filter(Boolean)
        const r = await api.createDoc({ title: draft.title, path: parts.join('/'), tags: draft.tags, body: draft.body })
        setNewDoc(null)
        message.success(t('已创建'))
        await loadDocs()
        select(r.doc.path)
      } else if (current) {
        const r = await api.updateDoc(current.path, { title: draft.title, tags: draft.tags, body: draft.body })
        setCurrent(r.doc)
        setEditing(false)
        message.success(t('已保存'))
        await loadDocs()
      }
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  async function createFromModal() {
    const title = createTitle.trim()
    if (!title) {
      message.warning(t('请输入标题'))
      return
    }
    setSaving(true)
    try {
      const parts = [createDir.trim().replace(/^\/+|\/+$/g, ''), docSlug(title)].filter(Boolean)
      const r = await api.createDoc({ title, path: parts.join('/') || undefined })
      setCreateOpen(false)
      setCreateTitle('')
      setCreateDir('')
      message.success(t('已创建，开始编写'))
      await loadDocs()
      select(r.doc.path)
      setEditing(true)
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const recent = useMemo(() => [...docs].sort(sortDocs).slice(0, 8), [docs])
  const isSearching = hits !== null

  // ---------- 左栏 ----------
  const left = (
    <aside
      style={{
        width: 264,
        flex: '0 0 264px',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        height: 'calc(100vh - 210px)',
        minHeight: 360,
      }}
    >
      <Input
        allowClear
        prefix={<SearchOutlined style={{ color: 'var(--ink-faint)' }} />}
        placeholder={t('搜索文档…')}
        value={searchQ}
        onChange={(e) => setSearchQ(e.target.value)}
      />
      <Select
        mode="multiple"
        allowClear
        placeholder={t('按标签筛选')}
        value={tagFilter}
        onChange={(v) => setTagFilter(v as string[])}
        options={tagOptions.map((tag) => ({ value: tag, label: tag }))}
        style={{ width: '100%' }}
        maxTagCount="responsive"
      />

      <div
        style={{
          flex: 1,
          overflow: 'auto',
          border: '1px solid var(--rule)',
          borderRadius: 'var(--radius, 10px)',
          padding: '10px 8px',
          background: 'var(--surface)',
        }}
      >
        {isSearching ? (
          <List
            size="small"
            split={false}
            loading={searching}
            dataSource={hits || []}
            locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('没有匹配的文档')} /> }}
            renderItem={(h) => (
              <List.Item
                onClick={() => select(h.doc.path)}
                style={{ cursor: 'pointer', alignItems: 'flex-start', padding: '8px 6px', borderRadius: 8 }}
              >
                <div style={{ width: '100%' }}>
                  <div style={{ fontWeight: 600, marginBottom: 2 }}>{displayName(h.doc)}</div>
                  {h.snippet && (
                    <div className="mono" style={{ whiteSpace: 'normal', lineHeight: 1.5 }}>
                      {h.snippet}
                    </div>
                  )}
                  <div className="mono" style={{ marginTop: 2 }}>{stripRoot(h.doc.path)}</div>
                </div>
              </List.Item>
            )}
          />
        ) : loadingList ? (
          <Skeleton active paragraph={{ rows: 6 }} />
        ) : (
          <Tree
            blockNode
            treeData={treeData}
            expandedKeys={expandedKeys}
            onExpand={(keys) => setExpandedKeys(keys)}
            selectedKeys={activePath ? ['doc:' + activePath] : []}
            onSelect={(keys, info) => {
              const k = String(info.node.key ?? '')
              if (k.startsWith('doc:')) select(k.slice(4))
            }}
          />
        )}
        {!isSearching && !loadingList && filteredDocs.length === 0 && (
          <div className="mono" style={{ textAlign: 'center', padding: '24px 0' }}>
            {docs.length === 0 ? t('还没有文档') : t('没有符合筛选的文档')}
          </div>
        )}
      </div>
    </aside>
  )

  // ---------- 右栏 ----------
  function renderView() {
    if (editing && newDoc) {
      return (
        <DocEditor
          isNew
          initialTitle={newDoc.title}
          initialTags={[]}
          initialBody=""
          tagOptions={tagOptions}
          saving={saving}
          onSave={saveDoc}
          onCancel={() => {
            setNewDoc(null)
            setEditing(false)
          }}
        />
      )
    }

    if (editing && current) {
      return (
        <DocEditor
          isNew={false}
          initialTitle={current.title}
          initialTags={current.tags || []}
          initialBody={current.body || ''}
          tagOptions={tagOptions}
          saving={saving}
          onSave={saveDoc}
          onCancel={() => setEditing(false)}
        />
      )
    }

    if (loadingDoc) return <Skeleton active paragraph={{ rows: 10 }} />

    if (!current) {
      return (
        <div>
          <div className="page-kicker">{t('文档中心')}</div>
          <h1 className="page-title" style={{ marginBottom: 8 }}>
            {t('仓库里的 Markdown 文档')}
          </h1>
          <p style={{ color: 'var(--ink-faint)', maxWidth: 640, lineHeight: 1.7 }}>
            {t('从左侧目录树选择一篇文档，或用')} <SearchOutlined /> {t('搜索、')}
            <PushpinFilled /> {t('置顶常用文档。文档以纯文本存于仓库')}
            <span className="mono" style={{ margin: '0 4px' }}>
              {ROOT}
            </span>
            {t('下，脱离本工具也能直接阅读。')}
          </p>
          <hr className="hrule" style={{ margin: '24px 0' }} />
          <div className="section-label">{t('最近文档')}</div>
          {recent.length === 0 ? (
            <div style={{ color: 'var(--ink-faint)', marginTop: 8 }}>{t('还没有任何文档。')}</div>
          ) : (
            <List
              size="small"
              split={false}
              dataSource={recent}
              renderItem={(d) => (
                <List.Item
                  onClick={() => select(d.path)}
                  style={{ cursor: 'pointer', padding: '8px 6px', borderRadius: 8 }}
                >
                  <Space size={10} wrap style={{ width: '100%' }}>
                    {d.pinned && <PushpinFilled style={{ color: 'var(--accent)' }} />}
                    <span style={{ fontWeight: 600 }}>{displayName(d)}</span>
                    <span className="mono">{fromNow(d.updated)}</span>
                    <span className="mono">{stripRoot(d.path)}</span>
                  </Space>
                </List.Item>
              )}
            />
          )}
        </div>
      )
    }

    const tags = (current.tags || []).map((tag) => (
      <Tag key={tag} style={{ marginInlineEnd: 4 }}>
        {tag}
      </Tag>
    ))

    return (
      <article>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 8 }}>
          <h1 className="page-title" style={{ flex: 1, fontSize: 26 }}>
            {current.pinned && <PushpinFilled style={{ color: 'var(--accent)', marginRight: 8 }} />}
            {displayName(current)}
          </h1>
          <Space size={8} wrap style={{ justifyContent: 'flex-end' }}>
            <Button type="primary" icon={<EditOutlined />} onClick={() => setEditing(true)}>
              {t('编辑')}
            </Button>
            <Tooltip title={current.pinned ? t('取消置顶') : t('置顶')}>
              <Button icon={current.pinned ? <PushpinFilled /> : <PushpinOutlined />} onClick={() => togglePin(current)} />
            </Tooltip>
            <Tooltip title={t('重命名 / 移动')}>
              <Button icon={<SwapOutlined />} onClick={openRename} />
            </Tooltip>
            <Tooltip title={t('重新加载')}>
              <Button icon={<ReloadOutlined />} onClick={() => select(current.path)} />
            </Tooltip>
            <Popconfirm
              title={t('删除这篇文档？')}
              description={t('会从仓库移除且不可撤销。')}
              okText={t('删除')}
              okButtonProps={{ danger: true }}
              cancelText={t('取消')}
              onConfirm={() => removeDoc(current)}
            >
              <Button danger icon={<DeleteOutlined />} />
            </Popconfirm>
          </Space>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 4 }}>
          <span className="stamp">{t('{time} 更新', { time: fromNow(current.updated) })}</span>
          <span className="mono">{stripRoot(current.path)}</span>
        </div>
        {tags.length > 0 && <div style={{ margin: '6px 0 4px' }}>{tags}</div>}

        <hr className="hrule" style={{ margin: '18px 0' }} />

        {current.body && current.body.trim() ? (
          <Markdown>{current.body}</Markdown>
        ) : (
          <div style={{ color: 'var(--ink-faint)' }}>
            {t('（这篇文档还没有正文，点击「编辑」开始撰写。）')}
          </div>
        )}
      </article>
    )
  }

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-kicker">{t('文档中心')}</div>
          <h1 className="page-title">{t('文档')}</h1>
        </div>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          disabled={!!newDoc}
          onClick={() => {
            setCreateTitle('')
            setCreateDir('')
            setCreateOpen(true)
          }}
        >
          {t('新建文档')}
        </Button>
      </div>

      <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start' }}>
        {left}
        <main
          style={{
            flex: 1,
            minWidth: 0,
            height: 'calc(100vh - 210px)',
            minHeight: 360,
            overflow: 'auto',
            borderLeft: '1px solid var(--rule)',
            paddingLeft: 28,
          }}
        >
          {renderView()}
        </main>
      </div>

      <Modal
        title={t('新建文档')}
        open={createOpen}
        onOk={createFromModal}
        confirmLoading={saving}
        okText={t('创建并编写')}
        cancelText={t('取消')}
        onCancel={() => setCreateOpen(false)}
      >
        <Input
          size="large"
          placeholder={t('文档标题')}
          value={createTitle}
          onChange={(e) => setCreateTitle(e.target.value)}
          onPressEnter={createFromModal}
          autoFocus
          style={{ marginBottom: 12 }}
        />
        <Input
          addonBefore={<FolderOpenOutlined />}
          placeholder={t('子目录（可选，如 架构）')}
          value={createDir}
          onChange={(e) => setCreateDir(e.target.value)}
          onPressEnter={createFromModal}
        />
        <div className="mono" style={{ marginTop: 10 }}>
          {t('留空子目录将直接放在')} {ROOT} {t('根下；文件名由标题自动生成。')}
        </div>
      </Modal>

      <Modal
        title={t('重命名 / 移动')}
        open={renameOpen}
        onOk={doRename}
        okText={t('保存')}
        cancelText={t('取消')}
        onCancel={() => setRenameOpen(false)}
      >
        <Input
          value={renameVal}
          onChange={(e) => setRenameVal(e.target.value)}
          onPressEnter={doRename}
          autoFocus
          addonBefore={ROOT}
          placeholder={t('架构/设计')}
        />
        <div className="mono" style={{ marginTop: 10 }}>
          {t('相对仓库的路径片段（不含')} {ROOT} {t('前缀），扩展名 .md 可省略。')}
        </div>
      </Modal>
    </>
  )
}
