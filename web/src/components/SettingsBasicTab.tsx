import { useState } from 'react'
import {
  Alert,
  App as AntApp,
  Button,
  Card,
  Divider,
  Input,
  Popconfirm,
  Segmented,
  Select,
  Space,
  Switch,
  Typography,
} from 'antd'

import { api } from '../api'
import { useApp } from '../context'
import { t } from '../i18n'
import type { Modules, Schema } from '../types'
import type { Scope } from './SettingsShared'
import { SaveBar } from './SettingsCommon'

interface Props {
  draft: Schema
  onChange: (next: Schema) => void
  scope: Scope
  setScope: (s: Scope) => void
  multi: boolean
  projectLabel: string
  saving: boolean
  onSave: () => void
}

// 模块级常量在导入时求值，语言切换不会重算；改为渲染期调用的函数。
function boolModules(): { key: keyof Modules; label: string; desc: string }[] {
  return [
    { key: 'board', label: t('看板'), desc: t('拖拽卡片按状态整理') },
    { key: 'gantt', label: t('甘特图'), desc: t('按里程碑/时间线排期') },
    { key: 'docs', label: t('文档'), desc: t('仓库内 Markdown 文档库') },
    { key: 'milestones', label: t('里程碑'), desc: t('详情/筛选/新建出现里程碑') },
    { key: 'attachments', label: t('附件'), desc: t('跟进里上传图片/文件') },
    { key: 'tree', label: t('树形'), desc: t('任务列表按父子层级展示') },
    { key: 'search', label: t('搜索'), desc: t('全文检索任务') },
  ]
}

function subtaskOptions() {
  return [
    { value: 'off', label: t('关闭') },
    { value: 'checklist', label: t('仅正文清单') },
    { value: 'issue', label: t('独立子任务') },
    { value: 'both', label: t('清单 + 子任务') },
  ]
}

export default function SettingsBasicTab({
  draft,
  onChange,
  scope,
  setScope,
  multi,
  projectLabel,
  saving,
  onSave,
}: Props) {
  const { repo, reload } = useApp()
  const { message } = AntApp.useApp()
  const [converting, setConverting] = useState(false)

  const currentMode = repo.mode || draft.workspace.mode

  function setModule(key: keyof Modules, value: string | boolean) {
    onChange({ ...draft, modules: { ...draft.modules, [key]: value } as Modules })
  }

  const viewOptions = (() => {
    const m = draft.modules
    const opts = [
      { value: 'home', label: t('首页') },
      { value: 'list', label: t('任务列表') },
    ]
    if (m.board) opts.push({ value: 'board', label: t('看板') })
    if (m.gantt) opts.push({ value: 'gantt', label: t('甘特图') })
    if (m.docs) opts.push({ value: 'docs', label: t('文档') })
    if (m.search) opts.push({ value: 'search', label: t('搜索') })
    if (multi) opts.push({ value: 'projects', label: t('项目集') })
    const d = draft.views?.default
    if (d && !opts.some((o) => o.value === d)) opts.push({ value: d, label: d })
    return opts
  })()

  async function convert(mode: 'single' | 'multi') {
    setConverting(true)
    try {
      await api.switchMode(mode)
      await reload()
      message.success(mode === 'multi' ? t('已转为多项目模式') : t('已转为单项目模式'))
      if (mode === 'single') setScope('repo')
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setConverting(false)
    }
  }

  const scopeOptions = [
    { label: t('仓库级'), value: 'repo' },
    ...(multi ? [{ label: t('当前项目：{name}', { name: projectLabel }), value: 'project' }] : []),
  ]

  return (
    <div>
      <Card size="small" style={{ marginBottom: 18 }} title={t('编辑作用域')}>
        <Segmented
          value={scope}
          onChange={(v) => setScope(v as Scope)}
          options={scopeOptions}
          style={{ marginBottom: 10 }}
        />
        <Typography.Paragraph type="secondary" style={{ fontSize: 13, margin: 0 }}>
          {scope === 'repo'
            ? t('写入仓库根 workbench.yaml，对所有项目生效（内置默认之上的一层）。')
            : t('写入 projects/{path}/workbench.yaml，仅覆盖当前项目。', {
                path: draft.project?.id || projectLabel,
              })}
        </Typography.Paragraph>
      </Card>

      <Card size="small" title={t('工作台信息')} style={{ marginBottom: 18 }}>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 260px' }}>
            <div className="section-label" style={{ margin: '0 0 6px' }}>
              {t('工作台名称')}
            </div>
            <Input
              value={draft.workspace.name}
              onChange={(e) =>
                onChange({ ...draft, workspace: { ...draft.workspace, name: e.target.value } })
              }
              placeholder={t('我的工作台')}
            />
          </div>
          <div style={{ flex: '0 1 200px' }}>
            <div className="section-label" style={{ margin: '0 0 6px' }}>
              {t('ID 前缀')}
            </div>
            <Input
              value={draft.idPrefix}
              onChange={(e) => onChange({ ...draft, idPrefix: e.target.value })}
              placeholder={t('例如 WB')}
            />
          </div>
          <div style={{ flex: '0 1 200px' }}>
            <div className="section-label" style={{ margin: '0 0 6px' }}>
              {t('默认视图')}
            </div>
            <Select
              value={draft.views?.default}
              onChange={(v: string) => onChange({ ...draft, views: { ...draft.views, default: v } })}
              options={viewOptions}
              style={{ width: '100%' }}
            />
          </div>
          <div style={{ flex: '0 1 200px' }}>
            <div className="section-label" style={{ margin: '0 0 6px' }}>
              {t('界面语言')}
            </div>
            <Select
              value={draft.language || 'zh'}
              onChange={(v: string) => onChange({ ...draft, language: v })}
              options={[
                { value: 'zh', label: '中文' },
                { value: 'en', label: 'English' },
              ]}
              style={{ width: '100%' }}
            />
          </div>
        </div>
        <Typography.Paragraph type="secondary" style={{ fontSize: 12, margin: '10px 0 0' }}>
          {t('仓库默认语言；本机用顶栏「中/EN」切换会覆盖它，且不影响任何数据。')}
        </Typography.Paragraph>
      </Card>

      <Card size="small" title={t('模块开关')} style={{ marginBottom: 18 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '4px 20px' }}>
          {boolModules().map((m) => (
            <div
              key={m.key}
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0' }}
            >
              <Switch
                checked={Boolean(draft.modules?.[m.key])}
                onChange={(checked) => setModule(m.key, checked)}
              />
              <div style={{ lineHeight: 1.3 }}>
                <div>{m.label}</div>
                <div style={{ color: 'var(--ink-faint)', fontSize: 12 }}>{m.desc}</div>
              </div>
            </div>
          ))}
        </div>
        <Divider style={{ margin: '10px 0' }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ minWidth: 72 }}>{t('子任务')}</span>
          <Select
            value={draft.modules?.subtasks}
            onChange={(v: string) => setModule('subtasks', v)}
            options={subtaskOptions()}
            style={{ width: 200 }}
          />
        </div>
      </Card>

      <Card size="small" title={t('单 / 多项目模式转换')}>
        <Typography.Paragraph type="secondary" style={{ fontSize: 13 }}>
          {t('当前模式：')}
          <strong>{currentMode === 'multi' ? t('多项目（项目集）') : t('单项目')}</strong>
          {t('。模式转换由后端直接改写仓库结构，不经过上面的表单保存。')}
        </Typography.Paragraph>
        <Space wrap>
          <Popconfirm
            title={t('转为多项目模式？')}
            description={t(
              '会把仓库根现有的任务与文档迁移到 projects/ 下的一个项目里，之后可用项目集管理多个项目。',
            )}
            okText={t('转换')}
            cancelText={t('取消')}
            disabled={currentMode === 'multi' || converting}
            onConfirm={() => convert('multi')}
          >
            <Button disabled={currentMode === 'multi'} loading={converting}>
              {t('转为多项目')}
            </Button>
          </Popconfirm>
          <Popconfirm
            title={t('转为单项目模式？')}
            description={t('会把当前项目的数据合并回仓库根，取消 projects/ 分隔。')}
            okText={t('转换')}
            cancelText={t('取消')}
            disabled={currentMode === 'single' || converting}
            onConfirm={() => convert('single')}
          >
            <Button disabled={currentMode === 'single'} loading={converting}>
              {t('转为单项目')}
            </Button>
          </Popconfirm>
        </Space>
        <Alert
          style={{ marginTop: 14 }}
          type="info"
          showIcon
          message={t('Webhook、自定义字段等进阶项')}
          description={t(
            '如需配置事件回调 webhook（url / events）等未在此表单的字段，请到「YAML 源码」标签直接编辑仓库内的 workbench.yaml。',
          )}
        />
      </Card>

      <SaveBar saving={saving} onSave={onSave} note={t('表单保存会以当前生效配置为基线，写回所选作用域的 workbench.yaml')} />
    </div>
  )
}
