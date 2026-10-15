import { useEffect, useState } from 'react'
import { App as AntApp, Tabs } from 'antd'
import { useLocation } from 'react-router-dom'

import { api } from '../api'
import { useApp } from '../context'
import { t } from '../i18n'
import { ROOT_PID, useGo } from '../nav'
import type { Schema } from '../types'
import { type Scope, clone, collectIdIssues, managedKeys, toYaml } from '../components/SettingsShared'
import SettingsBasicTab from '../components/SettingsBasicTab'
import SettingsDefsTab from '../components/SettingsDefsTab'
import SettingsFieldsTab from '../components/SettingsFieldsTab'
import SettingsTemplatesTab from '../components/SettingsTemplatesTab'
import SettingsYamlTab from '../components/SettingsYamlTab'
import UpdatePanel from '../components/UpdatePanel'

export default function Settings() {
  const { schema, repo, projectId, reload } = useApp()
  const { message } = AntApp.useApp()
  const loc = useLocation()
  const go = useGo()

  const multi = repo.mode === 'multi'
  // 设置的职责由所在位置决定：项目集节点下 = 仓库级（项目集默认）；项目下 = 项目级（仅覆盖本项目）。
  // 单项目模式没有项目级概念，恒为仓库级。
  const program = !multi || projectId === ROOT_PID
  const scope: Scope = program ? 'repo' : 'project'

  // 页签是 URL 的一部分（/settings/<tab>），可深链接、可后退；非法值回落「基本」。
  const TAB_KEYS = ['basic', 'defs', 'fields', 'templates', 'yaml', 'about']
  const pathRest = loc.pathname.replace(/^\/p\/[^/]+/, '')
  const seg = pathRest.startsWith('/settings')
    ? pathRest.slice('/settings'.length).replace(/^\//, '')
    : ''
  const active = TAB_KEYS.includes(seg) ? seg : 'basic'

  const [draft, setDraft] = useState<Schema>(() => clone(schema))
  const [saving, setSaving] = useState(false)

  // 生效 schema 变化（如切换项目 / 保存后 reload）时，重置表单基线。
  useEffect(() => {
    setDraft(clone(schema))
  }, [schema])

  async function save() {
    const issues = collectIdIssues(draft)
    if (issues.length) {
      message.error(issues.join('；'))
      return
    }
    setSaving(true)
    try {
      await api.putRawConfig(scope, toYaml(draft, scope), managedKeys(scope))
      await reload()
      message.success(t('配置已保存'))
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const formProps = { draft, onChange: setDraft, saving, onSave: save }

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-kicker">
            {program
              ? t('跟仓库走的纯文本配置 · workbench.yaml')
              : t('仅覆盖当前项目的纯文本配置 · projects/<id>/workbench.yaml')}
          </div>
          <h1 className="page-title">{program ? t('项目集设置') : t('项目设置')}</h1>
        </div>
      </div>

      <Tabs
        destroyInactiveTabPane
        activeKey={active}
        onChange={(k) => go(`/settings/${k}`, { replace: true })}
        items={[
          {
            key: 'basic',
            label: t('基本'),
            children: <SettingsBasicTab {...formProps} scope={scope} multi={multi} />,
          },
          {
            key: 'defs',
            label: t('状态与标签'),
            children: <SettingsDefsTab {...formProps} />,
          },
          {
            key: 'fields',
            label: t('里程碑与字段'),
            children: <SettingsFieldsTab {...formProps} />,
          },
          {
            key: 'templates',
            label: t('模板'),
            children: <SettingsTemplatesTab {...formProps} />,
          },
          {
            key: 'yaml',
            label: t('YAML 源码'),
            children: <SettingsYamlTab scope={scope} />,
          },
          {
            key: 'about',
            label: t('关于'),
            children: <UpdatePanel />,
          },
        ]}
      />
    </>
  )
}