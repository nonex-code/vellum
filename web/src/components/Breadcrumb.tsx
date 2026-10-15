import { Breadcrumb as AntBreadcrumb } from 'antd'
import { Link, useLocation } from 'react-router-dom'

import { useApp } from '../context'
import { t } from '../i18n'
import { PROGRAM_PID, isProgramScope, projectPath } from '../nav'

// labelFor 把项目内的相对路径段映射成面包屑文案。
function labelFor(rest: string): string | null {
  const seg = rest.replace(/^\/+/, '')
  if (seg === '') return null
  if (seg.startsWith('issue/')) return t('任务详情')
  switch (seg.split('/')[0].split('?')[0]) {
    case 'issues':
      return t('任务')
    case 'board':
      return t('看板')
    case 'gantt':
      return t('甘特图')
    case 'docs':
      return t('文档')
    case 'search':
      return t('搜索')
    case 'settings':
      return t('配置中心')
    case 'new':
      return t('新建任务')
    default:
      return null
  }
}

export default function Breadcrumb() {
  const { repo, project, projectId, projects } = useApp()
  const loc = useLocation()

  const multi = repo.mode === 'multi'
  const programName = repo.project?.name || 'Vellum'
  const projectName =
    project?.name || (multi ? projects.find((p) => p.id === projectId)?.name || projectId : programName)

  const items: { title: React.ReactNode }[] = []

  if (isProgramScope(projectId)) {
    items.push({ title: <Link to="/programs">{t('项目集总览')}</Link> })
    const tail = loc.pathname.replace(/^\/programs/, '')
    const label = labelFor(tail)
    if (label) items.push({ title: label })
  } else {
    // 单项目模式：仓库本身就是项目，只显示工作台名。
    if (multi) {
      items.push({
        title: <Link to="/programs">{programName}</Link>,
      })
      const atProjectRoot = /^\/p\/[^/]+\/?$/.test(loc.pathname)
      items.push({
        title: atProjectRoot ? (
          projectName
        ) : (
          <Link to={projectPath(projectId, '/')}>{projectName}</Link>
        ),
      })
    } else {
      items.push({ title: programName })
    }
    const rest = loc.pathname.replace(/^\/p\/[^/]+/, '')
    const label = labelFor(rest)
    if (label) items.push({ title: label })
    if (rest.startsWith('/issue/')) items.push({ title: rest.replace('/issue/', '') })
  }

  if (items.length === 0) return null
  return (
    <div className="wb-crumb">
      <AntBreadcrumb items={items} />
    </div>
  )
}