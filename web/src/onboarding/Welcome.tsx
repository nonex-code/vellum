import { App as AntApp, Button, Collapse, Form, Input, Segmented, Typography } from 'antd'
import { ArrowLeftOutlined, DatabaseOutlined, LinkOutlined, PlusOutlined } from '@ant-design/icons'
import { useState } from 'react'

import { api } from '../api'
import { t } from '../i18n'

type Step = 'home' | 'create' | 'connect'

export default function Welcome({ onLoaded }: { onLoaded: () => Promise<void> }) {
  const [step, setStep] = useState<Step>('home')
  return (
    <div className="welcome">
      <div className="welcome-inner">
        {step === 'home' && <Home onPick={setStep} />}
        {step === 'create' && (
          <Create onLoaded={onLoaded} onBack={() => setStep('home')} />
        )}
        {step === 'connect' && (
          <Connect onLoaded={onLoaded} onBack={() => setStep('home')} />
        )}
      </div>
    </div>
  )
}

function Home({ onPick }: { onPick: (s: Step) => void }) {
  return (
    <div className="hero-grid">
      <div>
        <div className="brandline">vellum / {t('单人任务台')}</div>
        <h1>{t('把任务写进你自己的 git 仓库。')}</h1>
        <p className="welcome-lede">
          {t('没有账号、没有数据库。每个任务就是一组 Markdown 文件，随时可以 git clone、检索、迁移。')}
        </p>
        <div className="actions">
          <Button
            type="primary"
            size="large"
            icon={<PlusOutlined />}
            onClick={() => onPick('create')}
          >
            {t('新建工作台')}
          </Button>
          <Button size="large" icon={<LinkOutlined />} onClick={() => onPick('connect')}>
            {t('连接已有仓库')}
          </Button>
        </div>
      </div>
      <FilePreview />
    </div>
  )
}

function FilePreview() {
  return (
    <div className="filecard">
      <div className="filecard-bar">
        <span className="filecard-dot" />
        <span className="filecard-dot" />
        <span className="filecard-dot" />
        <span className="filecard-name">issues/WB-0001/issue.md</span>
      </div>
      <pre>
        <span className="tok-faint">---</span>
        {'\n'}
        <span className="tok-key">id</span>: WB-0001{'\n'}
        <span className="tok-key">title</span>: <span className="tok-str">修复登录超时</span>
        {'\n'}
        <span className="tok-key">status</span>: doing{'\n'}
        <span className="tok-key">priority</span>: high{'\n'}
        <span className="tok-key">labels</span>: [<span className="tok-str">bug</span>]{'\n'}
        <span className="tok-faint">---</span>
        {'\n'}
        用户反馈 15 分钟后被登出，先查 refresh token 的续期逻辑。
      </pre>
    </div>
  )
}

interface CreateValues {
  name: string
  dir?: string
  remote?: string
  prefix?: string
  mode?: string
}

function Create({ onLoaded, onBack }: { onLoaded: () => Promise<void>; onBack: () => void }) {
  const { message } = AntApp.useApp()
  const [loading, setLoading] = useState(false)

  async function submit(v: CreateValues) {
    setLoading(true)
    try {
      const r = await api.createWorkspace(v)
      if (r.pushError) message.warning(t('已创建，但推送到远程失败：{err}', { err: r.pushError }))
      else message.success(t('工作台已就绪'))
      await onLoaded()
    } catch (e) {
      message.error((e as Error).message)
      setLoading(false)
    }
  }

  return (
    <div className="panel">
      <Button
        type="text"
        icon={<ArrowLeftOutlined />}
        onClick={onBack}
        style={{ paddingLeft: 0, marginBottom: 10 }}
      >
        {t('返回')}
      </Button>
      <h2 className="panel-title">{t('新建工作台')}</h2>
      <p className="panel-sub">
        {t('先在本地建一个 git 仓库并立即开始；需要备份或换设备时，再关联远程仓库即可。')}
      </p>
      <Form
        layout="vertical"
        onFinish={submit}
        initialValues={{ name: '我的工作台', prefix: 'WB' }}
      >
        <Form.Item
          name="name"
          label={t('工作台名称')}
          rules={[{ required: true, message: t('请输入名称') }]}
        >
          <Input size="large" placeholder={t('我的工作台')} />
        </Form.Item>
        <Form.Item name="dir" label={t('存放目录')} extra={t('留空则自动创建在数据目录下')}>
          <Input size="large" placeholder={t('例如 D:/vellum-data')} />
        </Form.Item>
        <Form.Item
          name="mode"
          label={t('组织形式')}
          initialValue="single"
          extra={t(
            '一个仓库就是一个项目集，按「项目集 → 项目 → 任务」三层组织；单项目仓库之后也能在「项目集」页一键转为项目集',
          )}
        >
          <Segmented
            options={[
              { label: t('单项目'), value: 'single' },
              { label: t('多项目（项目集）'), value: 'multi' },
            ]}
          />
        </Form.Item>
        <Collapse
          ghost
          style={{ marginBottom: 12 }}
          items={[
            {
              key: 'adv',
              label: t('高级：远程备份 / ID 前缀'),
              children: (
                <>
                  <Form.Item
                    name="remote"
                    label={t('远程仓库（可选）')}
                    extra={t('填入一个空仓库地址，本地提交会同步过去')}
                  >
                    <Input placeholder="https://git.example.com/me/vellum-data.git" />
                  </Form.Item>
                  <Form.Item name="prefix" label={t('ID 前缀')} extra={t('任务的编号前缀，如 WB-0001')}>
                    <Input style={{ width: 160 }} />
                  </Form.Item>
                </>
              ),
            },
          ]}
        />
        <Button type="primary" htmlType="submit" size="large" loading={loading} block>
          {t('创建工作台')}
        </Button>
      </Form>
    </div>
  )
}

function Connect({ onLoaded, onBack }: { onLoaded: () => Promise<void>; onBack: () => void }) {
  const { message } = AntApp.useApp()
  const [mode, setMode] = useState<'remote' | 'local'>('remote')
  const [loading, setLoading] = useState(false)

  async function submit(v: { repo: string }) {
    setLoading(true)
    try {
      await api.open(v.repo.trim())
      await onLoaded()
      message.success(t('已连接'))
    } catch (e) {
      message.error((e as Error).message)
      setLoading(false)
    }
  }

  return (
    <div className="panel">
      <Button
        type="text"
        icon={<ArrowLeftOutlined />}
        onClick={onBack}
        style={{ paddingLeft: 0, marginBottom: 10 }}
      >
        {t('返回')}
      </Button>
      <h2 className="panel-title">{t('连接已有仓库')}</h2>
      <p className="panel-sub">{t('接入一个已经装着 Vellum 数据的 git 仓库。')}</p>
      <Segmented
        block
        value={mode}
        onChange={(v) => setMode(v as 'remote' | 'local')}
        style={{ marginBottom: 20 }}
        options={[
          { label: t('从远程克隆'), value: 'remote', icon: <LinkOutlined /> },
          { label: t('打开本地目录'), value: 'local', icon: <DatabaseOutlined /> },
        ]}
      />
      <Form layout="vertical" onFinish={submit} key={mode}>
        <Form.Item
          name="repo"
          label={mode === 'remote' ? t('远程仓库地址') : t('本地目录')}
          rules={[{ required: true, message: t('请输入地址') }]}
        >
          <Input
            size="large"
            allowClear
            placeholder={
              mode === 'remote'
                ? 'https://git.example.com/me/vellum-data.git'
                : 'D:/vellum-data'
            }
          />
        </Form.Item>
        <Typography.Paragraph type="secondary" style={{ fontSize: 13, marginTop: -6 }}>
          {mode === 'remote'
            ? t('会克隆到本地数据目录，并保持可同步。')
            : t('指向一个已存在的目录；若还不是 git 仓库，会自动初始化。')}
        </Typography.Paragraph>
        <Button type="primary" htmlType="submit" size="large" loading={loading} block>
          {mode === 'remote' ? t('克隆并连接') : t('打开')}
        </Button>
      </Form>
    </div>
  )
}