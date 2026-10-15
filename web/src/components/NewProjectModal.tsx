import { useState } from 'react'
import { App as AntApp, Form, Input, Modal, Typography } from 'antd'

import { api } from '../api'
import { t } from '../i18n'

interface Props {
  open: boolean
  onClose: () => void
  /** 创建成功后回调，参数为新项目 id。 */
  onCreated: (id: string) => void | Promise<void>
}

// NewProjectModal 是唯一的新建项目入口，导航、项目集总览共用。
export default function NewProjectModal({ open, onClose, onCreated }: Props) {
  const { message } = AntApp.useApp()
  const [form] = Form.useForm()
  const [saving, setSaving] = useState(false)

  async function submit() {
    const v = await form.validateFields().catch(() => null)
    if (!v) return
    setSaving(true)
    try {
      const r = await api.createProject({
        name: (v.name as string).trim(),
        description: ((v.description as string) || '').trim(),
      })
      const created = (r.projects || []).find((p) => p.name === (v.name as string).trim())
      message.success(t('项目已创建'))
      form.resetFields()
      onClose()
      await onCreated(created?.id || '')
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      title={t('新建项目')}
      open={open}
      onOk={submit}
      okText={t('创建')}
      cancelText={t('取消')}
      confirmLoading={saving}
      onCancel={() => {
        form.resetFields()
        onClose()
      }}
    >
      <Typography.Paragraph type="secondary" style={{ fontSize: 13 }}>
        {t('项目存放在当前工作台仓库的')} <span className="mono">projects/</span>{' '}
        {t('下，各自独立编号、互不干扰。')}
      </Typography.Paragraph>
      <Form form={form} layout="vertical">
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