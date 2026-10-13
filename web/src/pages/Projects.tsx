import { useCallback, useEffect, useState, type ReactNode } from 'react'
import {
  App as AntApp,
  Button,
  Card,
  Col,
  Empty,
  Form,
  Input,
  Modal,
  Popconfirm,
  Progress,
  Row,
  Skeleton,
  Tag,
  Typography,
  theme,
} from 'antd'
import {
  AppstoreOutlined,
  CheckOutlined,
  EditOutlined,
  FolderAddOutlined,
  InboxOutlined,
  MergeCellsOutlined,
  RestOutlined,
  SwapOutlined,
} from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'

import { api } from '../api'
import { useApp } from '../context'
import { t } from '../i18n'
import type { ProjectStat } from '../types'
import { fromNow } from '../util'

export default function Projects() {
  const { schema, repo, reload } = useApp()
  const nav = useNavigate()
  const { message } = AntApp.useApp()
  const { token } = theme.useToken()
  const [stats, setStats] = useState<ProjectStat[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<ProjectStat | null>(null)
  const [creating, setCreating] = useState(false)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const r = await api.projectStats()
      setStats(r.projects)
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [message])

  useEffect(() => {
    load()
  }, [load])

  async function switchTo(id: string) {
    try {
      await api.selectProject(id)
      await reload()
      nav('/')
    } catch (e) {
      message.error((e as Error).message)
    }
  }

  async function setArchived(p: ProjectStat, archived: boolean) {
    try {
      await api.archiveProject(p.id, archived)
      message.success(
        archived
          ? t('已归档「{name}」', { name: p.name })
          : t('已取消归档「{name}」', { name: p.name })
      )
      await Promise.all([reload(), load()])
    } catch (e) {
      message.error((e as Error).message)
    }
  }

  async function toMulti() {
    setBusy(true)
    try {
      await api.switchMode('multi')
      await reload()
      message.success(t('已转为项目集，原任务已归入「默认项目」'))
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function toSingle() {
    setBusy(true)
    try {
      await api.switchMode('single')
      await reload()
      message.success(t('已合并回单项目'))
      nav('/')
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (repo.mode !== 'multi') {
    return (
      <>
        <div className="page-kicker">vellum / {t('项目集')}</div>
        <h1 className="page-title">{schema.workspace.name}</h1>
        <Typography.Paragraph type="secondary" style={{ maxWidth: 620, margin: '10px 0 24px' }}>
          {t('当前仓库是单项目模式：根目录的')} <span className="mono">issues/</span>{' '}
          {t('即全部任务。')}
          {t('项目集按「项目集 → 项目 → 任务」三层组织，转换后现有任务会整体迁入')}
          <span className="mono"> projects/main</span>
          {t('，之后可在同一仓库里并行推进多个项目，各项目独立编号。')}
        </Typography.Paragraph>
        <Button type="primary" size="large" icon={<AppstoreOutlined />} loading={busy} onClick={toMulti}>
          {t('转为项目集')}
        </Button>
      </>
    )
  }

  if (loading) {
    return (
      <div className="fade">
        <Skeleton.Input active style={{ width: 160, height: 14 }} />
        <Skeleton.Input active style={{ width: 320, height: 32, marginTop: 14, display: 'block' }} />
        <Row gutter={[16, 16]} style={{ marginTop: 26 }}>
          {[0, 1, 2].map((i) => (
            <Col key={i} xs={24} md={12} xl={8}>
              <Card loading />
            </Col>
          ))}
        </Row>
      </div>
    )
  }

  const active = stats.filter((p) => !p.archived)
  const archived = stats.filter((p) => p.archived)
  const totalTasks = stats.reduce((n, p) => n + p.total, 0)
  const doneTasks = stats.reduce((n, p) => n + p.done, 0)

  const card = (p: ProjectStat) => {
    const percent = p.total ? Math.round((p.done / p.total) * 100) : 0
    const actions = p.archived
      ? [
          <Popconfirm
            key="restore"
            title={t('取消归档该项目？')}
            description={t('项目将重新出现在项目列表中。')}
            okText={t('取消归档')}
            cancelText={t('保留归档')}
            onConfirm={() => setArchived(p, false)}
          >
            <span>
              <RestOutlined /> {t('取消归档')}
            </span>
          </Popconfirm>,
        ]
      : [
          p.current ? (
            <span key="cur" style={{ color: 'var(--ink-faint)' }}>
              <CheckOutlined /> {t('当前')}
            </span>
          ) : (
            <span key="switch" onClick={() => switchTo(p.id)}>
              <SwapOutlined /> {t('切换')}
            </span>
          ),
          <span key="edit" onClick={() => setEditing(p)}>
            <EditOutlined /> {t('重命名')}
          </span>,
          <Popconfirm
            key="archive"
            title={t('归档「{name}」？', { name: p.name })}
            description={
              p.current
                ? t('不能归档当前活动项目，请先切换到其他项目。')
                : t('归档后从项目列表隐藏，任务数据保留，可随时取消归档。')
            }
            okText={t('归档')}
            cancelText={t('取消')}
            okButtonProps={{ disabled: p.current }}
            onConfirm={() => setArchived(p, true)}
          >
            <span>
              <InboxOutlined /> {t('归档')}
            </span>
          </Popconfirm>,
        ]
    return (
      <Card
        className="rise"
        style={{ height: '100%', opacity: p.archived ? 0.55 : 1 }}
        title={
          <span>
            {p.name}
            {p.current && (
              <Tag color="blue" style={{ marginInlineStart: 8 }}>
                {t('当前')}
              </Tag>
            )}
          </span>
        }
        actions={actions}
      >
        <div className="mono" style={{ marginBottom: 10 }}>{p.id}</div>
        <Typography.Paragraph type="secondary" ellipsis={{ rows: 2 }} style={{ minHeight: 44, marginBottom: 12 }}>
          {p.description || t('暂无简介')}
        </Typography.Paragraph>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
          <span style={{ fontSize: 13 }}>
            {t('任务')} <span className="mono">{p.done}/{p.total}</span>
          </span>
          <span className="mono">{fromNow(p.updated)}</span>
        </div>
        <Progress
          percent={percent}
          size="small"
          showInfo={false}
          strokeColor={p.total > 0 && p.done === p.total ? token.colorSuccess : token.colorPrimary}
        />
      </Card>
    )
  }

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-kicker">vellum / {t('项目集')}</div>
          <h1 className="page-title">{schema.workspace.name}</h1>
          <Typography.Paragraph type="secondary" style={{ margin: '8px 0 0', maxWidth: 640 }}>
            {t('一个仓库即一个项目集：任务存放在')} <span className="mono">projects/&lt;id&gt;/</span>{' '}
            {t('下的各项目里，各自独立编号、互不干扰。')}
          </Typography.Paragraph>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {active.length === 1 && (
            <Button icon={<MergeCellsOutlined />} loading={busy} onClick={toSingle}>
              {t('合并回单项目')}
            </Button>
          )}
          <Button type="primary" icon={<FolderAddOutlined />} onClick={() => setCreating(true)}>
            {t('新建项目')}
          </Button>
        </div>
      </div>

      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        <div className="stat">
          <div className="stat-num" style={{ color: 'var(--primary)' }}>
            {active.length}
          </div>
          <div className="stat-label">
            <span className="stat-dot" style={{ background: 'var(--primary)' }} />
            {t('项目数')}
            {archived.length > 0 && t(' · {n} 个已归档', { n: archived.length })}
          </div>
        </div>
        <div className="stat">
          <div className="stat-num">{totalTasks}</div>
          <div className="stat-label">
            <span className="stat-dot" style={{ background: 'var(--border-strong)' }} />
            {t('总任务数')}
          </div>
        </div>
        <div className="stat">
          <div className="stat-num" style={{ color: 'var(--ok)' }}>
            {doneTasks}
          </div>
          <div className="stat-label">
            <span className="stat-dot" style={{ background: 'var(--ok)' }} />
            {t('已完成')}
          </div>
        </div>
      </div>

      {active.length === 0 && archived.length === 0 ? (
        <Empty description={t('还没有项目，点击右上角新建')} style={{ marginTop: 48 }} />
      ) : (
        <>
          {active.length > 0 && (
            <Row gutter={[16, 16]}>
              {active.map((p) => (
                <Col key={p.id} xs={24} md={12} xl={8}>
                  {card(p)}
                </Col>
              ))}
            </Row>
          )}
          {archived.length > 0 && (
            <>
              <div className="form-section" style={{ margin: '28px 0 14px' }}>
                {t('已归档')}
              </div>
              <Row gutter={[16, 16]}>
                {archived.map((p) => (
                  <Col key={p.id} xs={24} md={12} xl={8}>
                    {card(p)}
                  </Col>
                ))}
              </Row>
            </>
          )}
        </>
      )}

      {creating && (
        <ProjectModal
          title={t('新建项目')}
          okText={t('创建')}
          hint={
            <>
              {t('项目存放在当前工作台仓库的')} <span className="mono">projects/</span> {t('下，各自独立编号、互不干扰。')}
            </>
          }
          onClose={() => setCreating(false)}
          onSubmit={async (v) => {
            await api.createProject(v)
            await Promise.all([reload(), load()])
            message.success(t('项目已创建'))
            setCreating(false)
          }}
        />
      )}

      {editing && (
        <ProjectModal
          title={t('重命名「{name}」', { name: editing.name })}
          okText={t('保存')}
          initial={{ name: editing.name, description: editing.description }}
          onClose={() => setEditing(null)}
          onSubmit={async (v) => {
            await api.renameProject(editing.id, v)
            await Promise.all([reload(), load()])
            message.success(t('项目信息已更新'))
            setEditing(null)
          }}
        />
      )}
    </>
  )
}

function ProjectModal({
  title,
  okText,
  hint,
  initial,
  onSubmit,
  onClose,
}: {
  title: string
  okText: string
  hint?: ReactNode
  initial?: { name: string; description?: string }
  onSubmit: (v: { name: string; description: string }) => Promise<void>
  onClose: () => void
}) {
  const { message } = AntApp.useApp()
  const [form] = Form.useForm()
  const [saving, setSaving] = useState(false)

  async function finish() {
    const v = await form.validateFields().catch(() => null)
    if (!v) return
    setSaving(true)
    try {
      await onSubmit({ name: (v.name as string).trim(), description: ((v.description as string) || '').trim() })
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      title={title}
      open
      onCancel={onClose}
      onOk={finish}
      okText={okText}
      cancelText={t('取消')}
      confirmLoading={saving}
    >
      {hint && (
        <Typography.Paragraph type="secondary" style={{ fontSize: 13 }}>
          {hint}
        </Typography.Paragraph>
      )}
      <Form form={form} layout="vertical" initialValues={initial}>
        <Form.Item
          name="name"
          label={t('项目名称')}
          rules={[{ required: true, whitespace: true, message: t('请输入项目名称') }]}
        >
          <Input autoFocus placeholder={t('例如：客户官网改版')} />
        </Form.Item>
        <Form.Item name="description" label={t('简介（可选）')}>
          <Input.TextArea rows={2} placeholder={t('一句话说明这个项目在做什么')} />
        </Form.Item>
      </Form>
    </Modal>
  )
}
