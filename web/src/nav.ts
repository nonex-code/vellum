import { useCallback } from 'react'
import { useNavigate, type NavigateOptions } from 'react-router-dom'

import { useApp } from './context'

// 项目树根项目的保留 id，映射到仓库根目录（single 模式也只有它）。
export const ROOT_PID = '~'

export function isRoot(pid: string): boolean {
  return pid === ROOT_PID
}

// parseProjectId 从路径解析项目上下文：
// /p/<id>/* → <id>；旧 /programs/* → 根项目；旧合成 id 也归并到根项目。
export function parseProjectId(pathname: string): string | null {
  if (pathname === '/programs' || pathname.startsWith('/programs/')) return ROOT_PID
  const m = pathname.match(/^\/p\/([^/]+)/)
  if (!m) return null
  const id = decodeURIComponent(m[1])
  return id === 'default' || id === '*' || id === 'all' ? ROOT_PID : id
}

// projectPath 把项目内的相对路径拼成绝对路径。
export function projectPath(pid: string, to: string): string {
  const base = `/p/${encodeURIComponent(pid || ROOT_PID)}`
  if (!to || to === '/') return base
  return base + (to.startsWith('/') ? to : `/${to}`)
}

// projectAggPath 在项目路径上追加 include=children：项目树聚合视图（如“全部任务”）。
export function projectAggPath(pid: string, to: string): string {
  const base = projectPath(pid, to)
  return `${base}${base.includes('?') ? '&' : '?'}include=children`
}

// useGo 是项目感知的 navigate：页面里写 go('/issues')，自动落到当前项目下。
export function useGo() {
  const nav = useNavigate()
  const { projectId } = useApp()
  return useCallback(
    (to: string, opts?: NavigateOptions) => {
      // 已经是绝对的项目级路径时原样放行。
      if (to.startsWith('/p/') || to.startsWith('/programs')) {
        nav(to, opts)
        return
      }
      nav(projectPath(projectId, to), opts)
    },
    [nav, projectId],
  )
}

// useProjectPath 返回绑定当前项目的路径拼接函数（用于生成 href）。
export function useProjectPath() {
  const { projectId } = useApp()
  return useCallback((to: string) => projectPath(projectId, to), [projectId])
}