import { useCallback, useEffect, useState } from 'react'
import { Alert, App as AntApp, Button, Card, Space, Spin, Typography } from 'antd'

import { api } from '../api'
import { useApp } from '../context'
import { t } from '../i18n'
import type { Scope } from './SettingsShared'

interface Props {
  scope: Scope
}

export default function SettingsYamlTab({ scope }: Props) {
  const { reload } = useApp()
  const { message } = AntApp.useApp()

  const [text, setText] = useState('')
  const [path, setPath] = useState('')
  const [exists, setExists] = useState(true)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const d = await api.getRawConfig(scope)
      setText(d.yaml || '')
      setPath(d.path)
      setExists(d.exists)
      setDirty(false)
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [scope, message])

  useEffect(() => {
    load()
  }, [load])

  async function save() {
    setSaving(true)
    try {
      await api.putRawConfig(scope, text)
      await reload()
      await load()
      message.success(t('已保存并生效'))
    } catch (e) {
      // 后端会做 YAML 校验，非法时返回具体错误
      message.error((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
        <span style={{ flex: 1 }} />
        <Button onClick={load} disabled={loading}>
          {t('重新加载')}
        </Button>
        <Button type="primary" loading={saving} disabled={loading || !dirty} onClick={save}>
          {t('保存')}
        </Button>
      </div>

      <Card size="small" style={{ marginBottom: 12 }} bodyStyle={{ padding: '10px 14px' }}>
        <Space direction="vertical" size={4} style={{ width: '100%' }}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {t('文件路径')}
          </Typography.Text>
          <span className="mono" style={{ wordBreak: 'break-all' }}>
            {path || '—'}
          </span>
        </Space>
      </Card>

      {!exists && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message={t('当前为内置默认')}
          description={t('该作用域还没有 workbench.yaml 文件；保存后会把下面的内容写入仓库。')}
        />
      )}

      <Spin spinning={loading}>
        <textarea
          className="yaml-editor"
          spellCheck={false}
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            setDirty(true)
          }}
          placeholder={'# workbench.yaml\nworkspace:\n  name: 我的工作台\n  mode: single\nidPrefix: WB\n# webhook:\n#   url: https://example.com/hook\n#   events: ["issue.create", "entry.create"]'}
          style={{
            width: '100%',
            minHeight: 400,
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 13,
            lineHeight: 1.6,
            color: 'var(--ink)',
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 10,
            padding: 14,
            resize: 'vertical',
            tabSize: 2,
          }}
        />
      </Spin>
      <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: 10 }}>
        {t('直接编辑仓库内的纯文本配置。保存时后端做 YAML 校验，非法会报错且不写入；成功后全局配置即时生效。')}
      </Typography.Paragraph>
    </div>
  )
}
