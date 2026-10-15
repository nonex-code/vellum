import { App as AntApp, Button, Select } from 'antd'
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
import { NavLink, useLocation, useNavigate } from 'react-router-dom'

import { api } from '../api'
import { useApp } from '../context'
import { t } from '../i18n'
import { isProgramScope, parseProjectId, projectPath } from '../nav'
import NewProjectModal from './NewProjectModal'

export default function Nav({ onOpenPalette }: { onOpenPalette: () => void }) {
  const { schema, repo, reload, projectId, projects } = useApp()
  const nav = useNavigate()
  const loc = useLocation()
  const { message } = AntApp.useApp()
  const [creating, setCreating] = useState(false)

  const multi = repo.mode === 'multi'
  const program = isProgramScope(projectId)

  // 切换项目时保留当前视图类型（看板→看板、甘特→甘特），不再一律回首页。
  function restPath(): string {
    const m = loc.pathname.match(/^\/p\/[^/]+(\/.*)?$/)
    return m?.[1] || '/'
  }

  async function switchProject(id: string) {
    if (id === projectId && !program) return
    try {
      await api.selectProject(id)
      const target = program ? '/' : restPath()
      nav(projectPath(id, target))
      await reload()
    } catch (e) {
      message.error((e as Error).message)
    }
  }

  // 项目级导航链接。
  const link = (to: string, label: string, icon: React.ReactNode, end = false) => (
    <NavLink to={projectPath(projectId, to)} end={end} title={label}>
      {icon} <span className="nav-text">{label}</span>
    </NavLink>
  )

  return (
    <div className="navbar">
      <nav className="navlinks">
        {program ? (
          <>
            {link('/', t('项目集总览'), <ApartmentOutlined />, true)}
            {link('/issues', t('全部任务'), <UnorderedListOutlined />)}
            {schema.modules.board && link('/board', t('看板'), <ProjectOutlined />)}
            {schema.modules.gantt && link('/gantt', t('甘特'), <BarsOutlined />)}
            {schema.modules.search && link('/search', t('搜索'), <SearchOutlined />)}
          </>
        ) : (
          <>
            {link('/', t('首页'), <HomeOutlined />, true)}
            {link('/issues', t('任务'), <UnorderedListOutlined />)}
            {schema.modules.board && link('/board', t('看板'), <ProjectOutlined />)}
            {schema.modules.gantt && link('/gantt', t('甘特'), <BarsOutlined />)}
            {schema.modules.docs && link('/docs', t('文档'), <BookOutlined />)}
            {schema.modules.search && link('/search', t('搜索'), <SearchOutlined />)}
            <NavLink to="/programs" title={multi ? t('项目集总览') : t('转为项目集')}>
              <ApartmentOutlined />{' '}
              <span className="nav-text">{multi ? t('项目集') : t('项目集')}</span>
            </NavLink>
            {link('/settings', t('设置'), <SettingOutlined />)}
          </>
        )}
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
              value={program ? repo.currentProject : parseProjectId(loc.pathname) || undefined}
              style={{ minWidth: 130, maxWidth: 180 }}
              placeholder={t('选择项目')}
              onChange={switchProject}
              options={projects.map((p) => ({ value: p.id, label: p.name }))}
            />
            <Button size="small" icon={<FolderAddOutlined />} onClick={() => setCreating(true)}>
              <span className="nav-text">{t('新建项目')}</span>
            </Button>
          </>
        )}
      </div>

      <NewProjectModal
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={async (id) => {
          await reload()
          if (id) nav(projectPath(id, '/'))
        }}
      />
    </div>
  )
}