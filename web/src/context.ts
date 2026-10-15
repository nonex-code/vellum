import { createContext, useContext } from 'react'
import type { ProjectMeta, RepoInfo, Schema } from './types'

export interface AppCtx {
  schema: Schema
  repo: RepoInfo
  reload: () => Promise<void>
  /** 当前 URL 的项目：真实项目 id；single 模式为 'default'；程序级聚合为 '*'。 */
  projectId: string
  /** 当前项目元信息（multi 模式下由 URL 决定，而非服务端默认值）。 */
  project?: ProjectMeta
  /** 项目集下所有未归档项目。 */
  projects: ProjectMeta[]
}

export const Ctx = createContext<AppCtx | null>(null)

export function useApp(): AppCtx {
  const c = useContext(Ctx)
  if (!c) throw new Error('App context not ready')
  return c
}