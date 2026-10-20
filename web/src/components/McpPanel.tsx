import { useEffect, useState } from 'react'
import { Alert, App as AntApp, Button, Card, Descriptions, Space, Table, Tag, Typography } from 'antd'

import { api } from '../api'
import { t } from '../i18n'
import type { McpInfo, McpTool } from '../types'

// MCP 接入：展示端点、鉴权状态与工具清单，并给出可直接粘贴到客户端的配置。
// 端点本身无状态（Streamable HTTP + JSON-RPC），这里只做展示与复制。
export default function McpPanel() {
  const { message } = AntApp.useApp()
  const [info, setInfo] = useState<McpInfo | null>(null)

  useEffect(() => {
    api
      .mcpInfo()
      .then(setInfo)
      .catch(() => {})
  }, [])

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text)
      message.success(t('已复制'))
    } catch {
      message.error(t('复制失败，请手动选择文本复制'))
    }
  }

  const config = info?.config ? JSON.stringify(info.config, null, 2) : ''

  return (
    <div>
      <Card size="small" title={t('MCP 接入')} style={{ marginBottom: 18 }}>
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 14 }}
          message={t('让 AI 助手直接读写这个工作台')}
          description={t(
            '这个端点走 MCP 的 Streamable HTTP 传输：POST JSON-RPC，无会话。工具直接读写仓库里的纯文本文件，每次写入都会自动 git commit，和界面操作完全等价。',
          )}
        />

        {info && !info.enabled && (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 14 }}
            message={t('MCP 未启用')}
            description={t('启动时设置了 WB_MCP=false，MCP 端点已关闭；去掉该变量（或设为 true）并重启即可启用。')}
          />
        )}

        <Descriptions column={1} size="small" colon={false}>
          <Descriptions.Item label={t('状态')}>
            {info ? (
              info.enabled ? (
                <Tag color="green">{t('已启用')}</Tag>
              ) : (
                <Tag>{t('未启用')}</Tag>
              )
            ) : (
              '…'
            )}
          </Descriptions.Item>
          <Descriptions.Item label={t('端点')}>
            {info?.endpoint ? <Typography.Text code>{info.endpoint}</Typography.Text> : '—'}
          </Descriptions.Item>
          <Descriptions.Item label={t('协议版本')}>
            <Tag color="blue">{info?.protocolVersion || '…'}</Tag>
          </Descriptions.Item>
          <Descriptions.Item label={t('鉴权')}>
            {info?.requiresToken ? t('需要 Bearer token') : t('无需 token')}
          </Descriptions.Item>
        </Descriptions>

        {info?.enabled && (
          <Space style={{ marginTop: 12 }}>
            <Button onClick={() => copy(config)}>{t('复制配置')}</Button>
            <Button onClick={() => info.endpoint && copy(info.endpoint)}>{t('复制端点')}</Button>
          </Space>
        )}
      </Card>

      {info?.enabled && config && (
        <Card size="small" title={t('客户端配置')} style={{ marginBottom: 18 }}>
          <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
            {t('粘贴到 MCP 客户端（Claude Desktop、Cursor、Codex 等）的配置里即可；桌面版端口是随机的，请以本页地址为准。')}
          </Typography.Paragraph>
          <pre
            style={{
              margin: 0,
              padding: 12,
              borderRadius: 6,
              background: 'rgba(127,127,127,0.08)',
              overflow: 'auto',
              fontSize: 12,
              lineHeight: 1.6,
            }}
          >
            {config}
          </pre>
          <Typography.Paragraph type="secondary" style={{ marginTop: 10, marginBottom: 0 }}>
            {t('设置 WB_MCP_TOKEN 后，客户端需带 Authorization: Bearer <token>；同时设置 WB_AUTH 时还要通过 Basic 认证。')}
          </Typography.Paragraph>
        </Card>
      )}

      {info?.enabled && (
        <Card size="small" title={t('工具')} extra={<Tag>{info.tools?.length || 0}</Tag>}>
          <Table<McpTool>
            rowKey="name"
            size="small"
            pagination={false}
            dataSource={info.tools || []}
            columns={[
              {
                title: t('工具名'),
                dataIndex: 'name',
                width: 170,
                render: (v: string) => <Typography.Text code>{v}</Typography.Text>,
              },
              {
                title: t('说明'),
                dataIndex: 'description',
                render: (v: string, row) => (
                  <>
                    {row.title && <Tag style={{ marginRight: 6 }}>{row.title}</Tag>}
                    <Typography.Text type="secondary">{v}</Typography.Text>
                  </>
                ),
              },
            ]}
          />
          <Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0 }}>
            {t('任务与文档也作为资源暴露给客户端：vellum://issues/<id>、vellum://docs/<path>。')}
          </Typography.Paragraph>
        </Card>
      )}
    </div>
  )
}
