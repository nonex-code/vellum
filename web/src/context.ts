import { createContext, useContext } from 'react'
import type { ProjectMeta, RepoInfo, Schema } from './types'

export interface AppCtx {
  schema: Schema
  repo: RepoInfo
  reload: () => Promise<void>
  /** 当前 URL 的项目 id（项目树的节点；根项目为 '~'）。 */
  projectId: string
  /** 当前项目元信息（multi 模式下由 URL 决定，而非服务端默认值）。 */
  project?: ProjectMeta
  /** 项目树里所有未归档子项目。 */
  projects: ProjectMeta[]
  /** 当前视图是否为聚合视图（根项目 + include=children，如“全部任务”）。 */
  aggregate: boolean
  /** 项目 id → 展示名（根项目回退到工作台名，未知 id 回退为 id 本身）。 */
  projectName: (id?: string) => string
}

export const Ctx = createContext<AppCtx | null>(null)

export function useApp(): AppCtx {
  const c = useContext(Ctx)
  if (!c) throw new Error('App context not ready')
  return c
}