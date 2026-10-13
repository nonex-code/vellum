import { createContext, useContext } from 'react'
import type { RepoInfo, Schema } from './types'

export interface AppCtx {
  schema: Schema
  repo: RepoInfo
  reload: () => Promise<void>
}

export const Ctx = createContext<AppCtx | null>(null)

export function useApp(): AppCtx {
  const c = useContext(Ctx)
  if (!c) throw new Error('App context not ready')
  return c
}