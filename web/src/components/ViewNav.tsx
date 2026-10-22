import { NavLink } from 'react-router-dom'
import {
  ApartmentOutlined,
  BarsOutlined,
  BookOutlined,
  CalendarOutlined,
  ProjectOutlined,
  SearchOutlined,
  UnorderedListOutlined,
} from '@ant-design/icons'

import { useApp } from '../context'
import { t } from '../i18n'
import { ROOT_PID, projectAggPath, projectPath } from '../nav'

interface ViewTab {
  to: string
  label: string
  icon: React.ReactNode
  end?: boolean
  show?: boolean
}

// ViewNav 是主内容区顶部的视图切换栏（面包屑上方）：
// 显示当前项目下的 任务 / 看板 / 甘特 / 日历 / 文档 / 搜索 等视图入口。
export default function ViewNav() {
  const { schema, repo, projectId } = useApp()
  const multi = repo.mode === 'multi'

  const views: ViewTab[] =
    multi && projectId === ROOT_PID
      ? [
          { to: projectPath(ROOT_PID, '/'), label: t('总览'), icon: <ApartmentOutlined />, end: true },
          { to: projectAggPath(ROOT_PID, '/issues'), label: t('全部任务'), icon: <UnorderedListOutlined /> },
          { to: projectAggPath(ROOT_PID, '/board'), label: t('全部看板'), icon: <ProjectOutlined />, show: schema.modules.board },
          { to: projectAggPath(ROOT_PID, '/gantt'), label: t('全部甘特'), icon: <BarsOutlined />, show: schema.modules.gantt },
          { to: projectAggPath(ROOT_PID, '/calendar'), label: t('全部日历'), icon: <CalendarOutlined />, show: schema.modules.calendar },
          { to: projectAggPath(ROOT_PID, '/docs'), label: t('全部文档'), icon: <BookOutlined />, show: schema.modules.docs },
          { to: projectAggPath(ROOT_PID, '/search'), label: t('全部搜索'), icon: <SearchOutlined />, show: schema.modules.search },
        ]
      : [
          { to: projectPath(projectId, '/'), label: multi ? t('总览') : t('首页'), icon: <ApartmentOutlined />, end: true },
          { to: projectPath(projectId, '/issues'), label: t('任务'), icon: <UnorderedListOutlined /> },
          { to: projectPath(projectId, '/board'), label: t('看板'), icon: <ProjectOutlined />, show: schema.modules.board },
          { to: projectPath(projectId, '/gantt'), label: t('甘特'), icon: <BarsOutlined />, show: schema.modules.gantt },
          { to: projectPath(projectId, '/calendar'), label: t('日历'), icon: <CalendarOutlined />, show: schema.modules.calendar },
          { to: projectPath(projectId, '/docs'), label: t('文档'), icon: <BookOutlined />, show: schema.modules.docs },
          { to: projectPath(projectId, '/search'), label: t('搜索'), icon: <SearchOutlined />, show: schema.modules.search },
        ]

  return (
    <nav className="view-nav">
      {views
        .filter((v) => v.show !== false)
        .map((v) => (
          <NavLink key={v.to} to={v.to} end={v.end} className="view-tab" title={v.label}>
            <span className="view-tab-ico">{v.icon}</span>
            <span className="view-tab-label">{v.label}</span>
          </NavLink>
        ))}
    </nav>
  )
}
