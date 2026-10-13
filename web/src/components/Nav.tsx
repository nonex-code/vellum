import { App as AntApp, Button, Input, Modal, Select, Typography } from 'antd'
import {
  ApartmentOutlined,
  BarsOutlined,
  BookOutlined,
  FolderAddOutlined,
  HomeOutlined,
  ProjectOutlined,
  SearchOutlined,
  SettingOutlined,
  UnorderedListOutlined,
} from '@ant-design/icons'
import { useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'

import { api } from '../api'
import { useApp } from '../context'
import { t } from '../i18n'

export default function Nav({ onOpenPalette }: { onOpenPalette: () => void }) {
  const { schema, repo, reload } = useApp()
  const nav = useNavigate()
  const { message } = AntApp.useApp()
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')
  const [saving, setSaving] = useState(false)

  const multi = schema.workspace?.mode === 'multi'
  const projects = repo.projects || []

  async function switchProject(id: string) {
    try {
      await api.selectProject(id)
      await reload()
      nav('/')
    } catch (e) {
      message.error((e as Error).message)
    }
  }

  async function create() {
    if (!name.trim()) {
      message.warning(t('请输入项目名称'))
      return
    }
    setSaving(true)
    try {
      await api.createProject({ name: name.trim(), description: desc.trim() })
      await reload()
      setCreating(false)
      setName('')
      setDesc('')
      message.success(t('项目已创建'))
      nav('/')
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="navbar">
      <nav className="navlinks">
        <NavLink to="/" end title={t('首页')}>
          <HomeOutlined /> <span className="nav-text">{t('首页')}</span>
        </NavLink>
        <NavLink to="/issues" title={t('任务列表')}>
          <UnorderedListOutlined /> <span className="nav-text">{t('任务')}</span>
        </NavLink>
        {schema.modules.board && (
          <NavLink to="/board" title={t('看板')}>
            <ProjectOutlined /> <span className="nav-text">{t('看板')}</span>
          </NavLink>
        )}
        {schema.modules.gantt && (
          <NavLink to="/gantt" title={t('甘特图')}>
            <BarsOutlined /> <span className="nav-text">{t('甘特')}</span>
          </NavLink>
        )}
        {schema.modules.docs && (
          <NavLink to="/docs" title={t('文档')}>
            <BookOutlined /> <span className="nav-text">{t('文档')}</span>
          </NavLink>
        )}
        {schema.modules.search && (
          <NavLink to="/search" title={t('搜索')}>
            <SearchOutlined /> <span className="nav-text">{t('搜索')}</span>
          </NavLink>
        )}
        <NavLink to="/projects" title={multi ? t('项目集管理') : t('组织形式')}>
          <ApartmentOutlined />{' '}
          <span className="nav-text">{multi ? t('项目集') : t('组织形式')}</span>
        </NavLink>
        <NavLink to="/settings" title={t('配置中心')}>
          <SettingOutlined /> <span className="nav-text">{t('设置')}</span>
        </NavLink>
      </nav>

      <div className="nav-right">
        <button className="nav-ghost" onClick={onOpenPalette} title={t('打开命令面板')}>
          <SearchOutlined /> <span className="nav-text">{t('快速跳转')}</span>{' '}
          <span className="kbd nav-text">Ctrl K</span>
        </button>
        {multi && (
          <>
            <span className="nav-label nav-text">{t('项目')}</span>
            <Select
              size="small"
              value={repo.currentProject}
              style={{ minWidth: 130, maxWidth: 180 }}
              onChange={switchProject}
              options={projects.map((p) => ({ value: p.id, label: p.name }))}
            />
            <Button size="small" icon={<FolderAddOutlined />} onClick={() => setCreating(true)}>
              <span className="nav-text">{t('新建项目')}</span>
            </Button>
          </>
        )}
      </div>

      <Modal
        title={t('新建项目')}
        open={creating}
        onOk={create}
        confirmLoading={saving}
        okText={t('创建')}
        cancelText={t('取消')}
        onCancel={() => setCreating(false)}
      >
        <Typography.Paragraph type="secondary" style={{ fontSize: 13 }}>
          {t('项目存放在当前工作台仓库的')} <span className="mono">projects/</span>{' '}
          {t('下，各自独立编号、互不干扰。')}
        </Typography.Paragraph>
        <Input
          size="large"
          placeholder={t('项目名称')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onPressEnter={create}
          style={{ marginBottom: 12 }}
        />
        <Input
          placeholder={t('简介（可选）')}
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          onPressEnter={create}
        />
      </Modal>
    </div>
  )
}