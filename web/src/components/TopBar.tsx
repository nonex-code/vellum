import { useEffect, useState } from 'react'
import {
  App as AntApp,
  Button,
  Dropdown,
  Input,
  Layout,
  Modal,
  Segmented,
  Space,
  Tag,
  Typography,
} from 'antd'
import {
  ApartmentOutlined,
  CloudUploadOutlined,
  DownOutlined,
  FolderOpenOutlined,
  LinkOutlined,
  PlusOutlined,
  SyncOutlined,
} from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'

import { api } from '../api'
import { useApp } from '../context'
import { useThemeCtx } from '../theme-context'
import { t, useLang } from '../i18n'
import type { RepoMeta } from '../types'

function ThemeToggle() {
  const { mode, toggle } = useThemeCtx()
  const dark = mode === 'dark'
  return (
    <button
      className="nav-ghost"
      onClick={toggle}
      title={dark ? t('切换到浅色') : t('切换到暗色')}
      aria-label={t('切换主题')}
      style={{ padding: '5px 9px' }}
    >
      {dark ? (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      ) : (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
        </svg>
      )}
    </button>
  )
}

// LangToggle 显示要切换到的语言，与主题开关同样占一个幽灵按钮位。
function LangToggle() {
  const [lang, setLang] = useLang()
  return (
    <button
      className="nav-ghost"
      onClick={() => setLang(lang === 'zh' ? 'en' : 'zh')}
      title={lang === 'zh' ? 'Switch to English' : '切换到中文'}
      aria-label={t('切换语言')}
      style={{ padding: '5px 9px', minWidth: 38, justifyContent: 'center' }}
    >
      {lang === 'zh' ? 'EN' : '中'}
    </button>
  )
}

function shortRemote(url: string): string {
  return url
    .replace(/^https?:\/\//, '')
    .replace(/^git@([^:]+):/, '$1/')
    .replace(/\.git$/, '')
}

function shortPath(p: string): string {
  const parts = p.replace(/\\/g, '/').split('/')
  return parts.slice(-2).join('/')
}

export default function TopBar() {
  const { schema, repo, reload } = useApp()
  const nav = useNavigate()
  const { message } = AntApp.useApp()
  const [syncing, setSyncing] = useState(false)
  const [remoteOpen, setRemoteOpen] = useState(false)
  const [url, setUrl] = useState('')
  const [saving, setSaving] = useState(false)

  const [repos, setRepos] = useState<RepoMeta[]>([])
  const [addOpen, setAddOpen] = useState(false)
  const [addMode, setAddMode] = useState<'local' | 'remote'>('local')
  const [addVal, setAddVal] = useState('')
  const [addSaving, setAddSaving] = useState(false)

  const name = schema.workspace?.name || 'Vellum'
  const hasRemote = !!repo.hasRemote

  useEffect(() => {
    api
      .repos()
      .then((d) => setRepos(d.repos || []))
      .catch(() => {})
  }, [repo?.loaded, repo?.root])

  const currentName = repos.find((r) => r.path === repo.root)?.name || name

  async function refreshRepos() {
    try {
      const d = await api.repos()
      setRepos(d.repos || [])
    } catch {
      /* ignore */
    }
  }

  async function switchRepo(path: string) {
    try {
      await api.open(path)
      await reload()
      await refreshRepos()
      message.success(t('已切换仓库'))
      nav('/')
    } catch (e) {
      message.error((e as Error).message)
    }
  }

  async function addRepo() {
    const v = addVal.trim()
    if (!v) {
      message.warning(t('请输入地址'))
      return
    }
    setAddSaving(true)
    try {
      await api.open(v)
      await reload()
      await refreshRepos()
      setAddOpen(false)
      setAddVal('')
      message.success(t('已打开仓库'))
      nav('/')
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setAddSaving(false)
    }
  }

  async function doSync() {
    setSyncing(true)
    try {
      await api.sync()
      await reload()
      message.success(t('已同步'))
      nav('/')
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setSyncing(false)
    }
  }

  async function attach() {
    if (!url.trim()) {
      message.warning(t('请输入仓库地址'))
      return
    }
    setSaving(true)
    try {
      const r = await api.attachRemote(url.trim())
      if (r.pushError) message.warning(t('已关联，但推送失败：{err}', { err: r.pushError }))
      else message.success(t('已关联远程仓库'))
      setRemoteOpen(false)
      setUrl('')
      await reload()
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const repoMenu = {
    items: [
      ...repos.map((r) => ({
        key: r.path,
        label: (
          <div>
            <div>{r.name}</div>
            <div className="mono" style={{ fontSize: 11, color: 'var(--ink-faint)' }}>
              {shortPath(r.path)}
              {r.remote ? ` · ${t('远程')}` : ` · ${t('本地')}`}
            </div>
          </div>
        ),
      })),
      { type: 'divider' as const },
      {
        key: '__add',
        icon: <PlusOutlined />,
        label: t('添加仓库…'),
      },
    ],
    onClick: ({ key }: { key: string }) => {
      if (key === '__add') {
        setAddOpen(true)
      } else {
        switchRepo(key)
      }
    },
  }

  return (
    <Layout.Header
      className="app-topbar"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        borderBottom: '1px solid var(--rule)',
        position: 'sticky',
        top: 0,
        zIndex: 10,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, whiteSpace: 'nowrap' }}>
        <span style={{ fontWeight: 600, fontSize: 15 }}>{name}</span>
        {hasRemote ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: '50%',
                background: 'var(--ok)',
                display: 'inline-block',
              }}
            />
            <span className="mono">{shortRemote(repo.remote || '')}</span>
          </span>
        ) : (
          <Tag color="default" style={{ marginInlineEnd: 0 }}>
            {t('仅本地')}
          </Tag>
        )}
      </div>
      <Typography.Text type="secondary" className="mono" ellipsis style={{ flex: 1, fontSize: 12 }}>
        {repo.root}
      </Typography.Text>
      <Space>
        <Dropdown menu={repoMenu} trigger={['click']}>
          <Button className="nav-ghost" icon={<ApartmentOutlined />}>
            {currentName} <DownOutlined style={{ fontSize: 10 }} />
          </Button>
        </Dropdown>
        <ThemeToggle />
        <LangToggle />
        {hasRemote ? (
          <Button icon={<SyncOutlined />} loading={syncing} onClick={doSync}>
            {t('同步')}
          </Button>
        ) : (
          <Button icon={<CloudUploadOutlined />} onClick={() => setRemoteOpen(true)}>
            {t('关联远程')}
          </Button>
        )}
      </Space>

      <Modal
        title={t('关联远程仓库')}
        open={remoteOpen}
        onOk={attach}
        confirmLoading={saving}
        okText={t('关联并推送')}
        cancelText={t('取消')}
        onCancel={() => setRemoteOpen(false)}
      >
        <Typography.Paragraph type="secondary" style={{ fontSize: 13 }}>
          {t('填入一个远程仓库地址（建议空仓库）。关联后本地提交会自动推送，方便备份和换设备。')}
        </Typography.Paragraph>
        <Input
          size="large"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://git.example.com/me/vellum-data.git"
          onPressEnter={attach}
        />
      </Modal>

      <Modal
        title={t('添加仓库')}
        open={addOpen}
        onOk={addRepo}
        confirmLoading={addSaving}
        okText={t('打开')}
        cancelText={t('取消')}
        onCancel={() => setAddOpen(false)}
      >
        <Typography.Paragraph type="secondary" style={{ fontSize: 13 }}>
          {t('打开一个本地已存在的 Vellum 目录，或填入远程仓库地址克隆下来。打开后会记入左侧“仓库”列表，方便随时切换。')}
        </Typography.Paragraph>
        <Segmented
          block
          value={addMode}
          onChange={(v) => setAddMode(v as 'local' | 'remote')}
          style={{ marginBottom: 16 }}
          options={[
            { label: t('本地目录'), value: 'local', icon: <FolderOpenOutlined /> },
            { label: t('远程地址'), value: 'remote', icon: <LinkOutlined /> },
          ]}
        />
        <Input
          size="large"
          allowClear
          value={addVal}
          onChange={(e) => setAddVal(e.target.value)}
          onPressEnter={addRepo}
          placeholder={
            addMode === 'remote'
              ? 'https://git.example.com/me/vellum-data.git'
              : 'D:/vellum-data'
          }
        />
      </Modal>
    </Layout.Header>
  )
}
