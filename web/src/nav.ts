import { useCallback } from 'react'
import { useNavigate, type NavigateOptions } from 'react-router-dom'

import { useApp } from './context'

// single 模式没有项目目录，用一个稳定的合成 id 占位，后端会忽略。
export const SINGLE_PID = 'default'
// 项目集级（跨项目）聚合作用域的 id。
export const PROGRAM_PID = '*'

export function isProgramScope(pid: string): boolean {
  return pid === PROGRAM_PID
}

// parseProjectId 从路径解析项目上下文：/programs/* → '*'；/p/<id>/* → <id>。
export function parseProjectId(pathname: string): string | null {
  if (pathname === '/programs' || pathname.startsWith('/programs/')) return PROGRAM_PID
  const m = pathname.match(/^\/p\/([^/]+)/)
  return m ? decodeURIComponent(m[1]) : null
}

// projectPath 把项目内的相对路径拼成绝对路径。
export function projectPath(pid: string, to: string): string {
  const base = isProgramScope(pid) ? '/programs' : `/p/${encodeURIComponent(pid)}`
  if (!to || to === '/') return base
  return base + (to.startsWith('/') ? to : `/${to}`)
}

// useGo 是项目感知的 navigate：页面里写 go('/issues')，自动落到当前项目下。
export function useGo() {
  const nav = useNavigate()
  const { projectId } = useApp()
  return useCallback(
    (to: string, opts?: NavigateOptions) => {
      // 已经是绝对的项目级/程序级路径时原样放行。
      if (to.startsWith('/programs') || to.startsWith('/p/')) {
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