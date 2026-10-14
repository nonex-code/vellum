import { useEffect, useState } from 'react'
import { App as AntApp, Alert, Button, Card, Descriptions, Space, Tag, Typography } from 'antd'

import { api } from '../api'
import { t } from '../i18n'
import type { UpdateInfo, VersionInfo } from '../types'

function modeLabel(mode: string): string {
  if (mode === 'desktop') return t('桌面版')
  if (mode === 'web') return t('服务器版')
  return mode
}

function yesNo(v: boolean): string {
  return v ? t('是') : t('否')
}

// 关于与更新：展示当前版本，并从 GitHub Releases 检查 / 应用更新。
// 应用后二进制会被原子替换、进程自动重启，页面稍后重连即可。
export default function UpdatePanel() {
  const { message, modal } = AntApp.useApp()
  const [ver, setVer] = useState<VersionInfo | null>(null)
  const [info, setInfo] = useState<UpdateInfo | null>(null)
  const [checking, setChecking] = useState(false)
  const [applying, setApplying] = useState(false)

  useEffect(() => {
    api
      .version()
      .then(setVer)
      .catch(() => {})
  }, [])

  async function check() {
    setChecking(true)
    try {
      setInfo(await api.checkUpdate())
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setChecking(false)
    }
  }

  function apply() {
    modal.confirm({
      title: t('立即更新？'),
      content: t('将下载新版本、校验后原子替换当前程序并自动重启。'),
      okText: t('更新并重启'),
      cancelText: t('取消'),
      onOk: async () => {
        setApplying(true)
        try {
          const r = await api.applyUpdate()
          message.success(t('正在重启到 {version}…', { version: r.version }))
          // 旧进程即将退出、新进程接管；稍后自动刷新页面完成重连。
          setTimeout(() => window.location.reload(), 8000)
        } catch (e) {
          message.error((e as Error).message)
          setApplying(false)
        }
      },
    })
  }

  const repoURL = ver?.repo ? `https://github.com/${ver.repo}` : undefined

  return (
    <div>
      <Card size="small" title={t('版本信息')} style={{ marginBottom: 18 }}>
        <Descriptions column={1} size="small" colon={false}>
          <Descriptions.Item label={t('当前版本')}>
            <Tag color="blue">{ver?.version || '…'}</Tag>
          </Descriptions.Item>
          <Descriptions.Item label={t('构建形态')}>
            {ver ? modeLabel(ver.mode) : '…'}
          </Descriptions.Item>
          <Descriptions.Item label={t('更新源')}>
            {repoURL ? (
              <a href={repoURL} target="_blank" rel="noreferrer">
                {ver?.repo}
              </a>
            ) : (
              '—'
            )}
          </Descriptions.Item>
          <Descriptions.Item label={t('可自更新')}>{ver ? yesNo(ver.updatable) : '…'}</Descriptions.Item>
        </Descriptions>

        {ver && !ver.updatable && (
          <Alert
            type="warning"
            showIcon
            style={{ marginTop: 10 }}
            message={t('当前构建未启用自更新')}
            description={t('启动时设置了 WB_UPDATE=false，或该构建未包含更新接口。')}
          />
        )}

        <Space style={{ marginTop: 14 }}>
          <Button type="primary" onClick={check} loading={checking} disabled={!ver?.updatable}>
            {t('检查更新')}
          </Button>
        </Space>
      </Card>

      {info && (
        <Card size="small" title={t('更新结果')}>
          <Descriptions column={1} size="small" colon={false}>
            <Descriptions.Item label={t('最新版本')}>
              <Tag color="geekblue">{info.latest}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label={t('状态')}>
              {info.available ? (
                <Tag color="green">{t('有新版本可用')}</Tag>
              ) : (
                <Tag>{t('已是最新版本')}</Tag>
              )}
            </Descriptions.Item>
            {info.publishedAt && (
              <Descriptions.Item label={t('发布时间')}>
                {new Date(info.publishedAt).toLocaleString()}
              </Descriptions.Item>
            )}
            {info.asset && (
              <Descriptions.Item label={t('安装包')}>
                {info.asset}
                {info.size ? ` · ${(info.size / 1048576).toFixed(1)} MB` : ''}
              </Descriptions.Item>
            )}
          </Descriptions>

          {info.notes && (
            <div style={{ marginTop: 10 }}>
              <div className="section-label" style={{ margin: '0 0 6px' }}>
                {t('更新说明')}
              </div>
              <Typography.Paragraph
                style={{ whiteSpace: 'pre-wrap', maxHeight: 240, overflow: 'auto', margin: 0 }}
              >
                {info.notes}
              </Typography.Paragraph>
            </div>
          )}

          {info.available && (
            <Space style={{ marginTop: 14 }}>
              <Button danger type="primary" onClick={apply} loading={applying}>
                {t('更新并重启')}
              </Button>
            </Space>
          )}
        </Card>
      )}
    </div>
  )
}