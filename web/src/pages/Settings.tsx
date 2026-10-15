import { useEffect, useState } from 'react'
import { App as AntApp, Tabs } from 'antd'

import { api } from '../api'
import { useApp } from '../context'
import { t } from '../i18n'
import type { Schema } from '../types'
import { type Scope, clone, collectIdIssues, managedKeys, toYaml } from '../components/SettingsShared'
import SettingsBasicTab from '../components/SettingsBasicTab'
import SettingsDefsTab from '../components/SettingsDefsTab'
import SettingsFieldsTab from '../components/SettingsFieldsTab'
import SettingsTemplatesTab from '../components/SettingsTemplatesTab'
import SettingsYamlTab from '../components/SettingsYamlTab'
import UpdatePanel from '../components/UpdatePanel'

export default function Settings() {
  const { schema, repo, project, reload } = useApp()
  const { message } = AntApp.useApp()

  const multi = repo.mode === 'multi'
  const projectLabel =
    project?.name || repo.projectMeta?.name || repo.project?.name || repo.currentProject || t('当前项目')

  const [draft, setDraft] = useState<Schema>(() => clone(schema))
  const [scope, setScope] = useState<Scope>('repo')
  const [saving, setSaving] = useState(false)

  // 生效 schema 变化（如切换项目 / 保存后 reload）时，重置表单基线。
  useEffect(() => {
    setDraft(clone(schema))
  }, [schema])

  // 回到单项目模式时，作用域只能是仓库级。
  useEffect(() => {
    if (!multi) setScope((s) => (s === 'project' ? 'repo' : s))
  }, [multi])

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
          <div className="page-kicker">{t('跟仓库走的纯文本配置 · workbench.yaml')}</div>
          <h1 className="page-title">{t('配置中心')}</h1>
        </div>
      </div>

      <Tabs
        destroyInactiveTabPane
        items={[
          {
            key: 'basic',
            label: t('基本'),
            children: (
              <SettingsBasicTab
                {...formProps}
                scope={scope}
                setScope={setScope}
                multi={multi}
                projectLabel={projectLabel}
              />
            ),
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
            children: (
              <SettingsYamlTab
                scope={scope}
                setScope={setScope}
                multi={multi}
                projectLabel={projectLabel}
              />
            ),
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
