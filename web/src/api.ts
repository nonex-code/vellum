import type { Doc, DocHit, Entry, GanttGroup, Issue, McpInfo, Overview, ProjectMeta, ProjectStat, RepoInfo, RepoMeta, Schema, SearchHit, UpdateInfo, VersionInfo } from './types'
import { getLang, t } from './i18n'

// apiProject 是当前 URL 项目上下文，App 每次渲染时同步设置。
// 所有请求带上 X-WB-Project；聚合视图（根项目 + include=children）再带上 X-WB-Include。
let apiProject = ''
let apiInclude = false
export function setApiScope(pid: string, include = false) {
  apiProject = pid
  apiInclude = include
}

async function req<T>(path: string, init?: RequestInit, project?: string): Promise<T> {
  // 每次请求带上界面语言，后端提示语跟着切换。
  const headers = new Headers(init?.headers)
  headers.set('X-WB-Lang', getLang())
  const proj = project === undefined ? apiProject : project
  // header 值只能是 ISO-8859-1；项目 id 可能是中文（slug 保留 CJK），必须先编码。
  if (proj) headers.set('X-WB-Project', encodeURIComponent(proj))
  if (project === undefined && apiInclude) headers.set('X-WB-Include', 'children')
  const r = await fetch(path, { ...init, headers })
  const ct = r.headers.get('content-type') || ''
  const data = ct.includes('json') ? await r.json() : await r.text()
  if (!r.ok) {
    const msg = data && typeof data === 'object' && 'error' in data ? (data as { error: string }).error : r.statusText
    throw new Error(msg || t('请求失败 ({status})', { status: r.status }))
  }
  return data as T
}

function json(body: unknown, method = 'POST'): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
}

export const api = {
  repo: () => req<RepoInfo>('/api/repo'),
  schema: () => req<Schema>('/api/schema'),
  overview: () => req<Overview>('/api/overview'),
  open: (repo: string) => req<{ ok: boolean }>('/api/open', json({ repo })),
  createWorkspace: (body: { name: string; dir?: string; remote?: string; prefix?: string; mode?: string }) =>
    req<{ ok: boolean; schema: Schema; root: string; pushError?: string }>('/api/workspace', json(body)),
  attachRemote: (url: string) =>
    req<{ ok: boolean; remote: string; pushError?: string }>('/api/remote', json({ url })),
  sync: () => req<{ ok: boolean }>('/api/sync', { method: 'POST' }),

  projects: () => req<{ projects: ProjectMeta[]; current: string }>('/api/projects'),
  createProject: (body: { name: string; description?: string; id?: string }) =>
    req<{ ok: boolean; projects: ProjectMeta[] }>('/api/projects', json(body)),
  selectProject: (project: string) => req<{ ok: boolean }>('/api/select', json({ project })),
  repos: () => req<{ repos: RepoMeta[]; current: string }>('/api/repos'),

  listIssues: (params: Record<string, string> = {}) =>
    req<{ issues: Issue[] }>(`/api/issues?${new URLSearchParams(params).toString()}`),
  getIssue: (id: string) => req<{ issue: Issue; entries: Entry[] }>(`/api/issues/${encodeURIComponent(id)}`),
  createIssue: (body: Partial<Issue>) => req<{ issue: Issue }>('/api/issues', json(body)),
  createIssueIn: (project: string, body: Partial<Issue>) =>
    req<{ issue: Issue }>('/api/issues', json(body), project),
  patchIssue: (id: string, body: Record<string, unknown>) =>
    req<{ issue: Issue }>(`/api/issues/${encodeURIComponent(id)}`, json(body, 'PATCH')),
  patchIssueIn: (project: string, id: string, body: Record<string, unknown>) =>
    req<{ issue: Issue }>(`/api/issues/${encodeURIComponent(id)}`, json(body, 'PATCH'), project),
  deleteIssue: (id: string) =>
    req<{ ok: boolean }>(`/api/issues/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  addEntry: (id: string, body: { body: string; type?: string }) =>
    req<{ entry: Entry }>(`/api/issues/${encodeURIComponent(id)}/entries`, json(body)),
  updateEntry: (id: string, file: string, body: string) =>
    req<{ entry: Entry }>(
      `/api/issues/${encodeURIComponent(id)}/entries/${encodeURIComponent(file)}`,
      json({ body }, 'PATCH'),
    ),
  deleteEntry: (id: string, file: string) =>
    req<{ ok: boolean }>(
      `/api/issues/${encodeURIComponent(id)}/entries/${encodeURIComponent(file)}`,
      { method: 'DELETE' },
    ),
  search: (q: string) => req<{ hits: SearchHit[] }>(`/api/search?q=${encodeURIComponent(q)}`),
  searchAll: (q: string) =>
    req<{ hits: SearchHit[] }>(`/api/search?q=${encodeURIComponent(q)}&project=*`),
  upload: (id: string, file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    return req<{ path: string; url: string; name: string }>(`/api/issues/${encodeURIComponent(id)}/files`, {
      method: 'POST',
      body: fd,
    })
  },

  gantt: () => req<{ groups: GanttGroup[] }>('/api/gantt'),
  projectStats: () => req<{ projects: ProjectStat[]; current: string }>('/api/projects/stats'),
  saveProjectOrder: (pinned: string[], order: string[]) =>
    req<{ ok: boolean; pinned: string[]; order: string[] }>('/api/projects/order', json({ pinned, order }, 'PUT')),
  renameProject: (id: string, body: { name: string; description?: string }) =>
    req<{ ok: boolean; projects: ProjectMeta[] }>(`/api/projects/${encodeURIComponent(id)}`, json(body, 'PATCH')),
  archiveProject: (id: string, archived: boolean) =>
    req<{ ok: boolean }>(`/api/projects/${encodeURIComponent(id)}`, json({ archived }, 'DELETE')),
  switchMode: (mode: string) => req<{ ok: boolean; mode: string }>('/api/config/mode', json({ mode })),
  getRawConfig: (scope: 'repo' | 'project') =>
    req<{ path: string; yaml: string; exists: boolean }>(`/api/config/raw?scope=${scope}`),
  putRawConfig: (scope: 'repo' | 'project', yamlText: string, managed?: string[]) =>
    req<{ ok: boolean }>('/api/config/raw', json({ scope, yaml: yamlText, managed }, 'PUT')),

  listDocs: () => req<{ docs: Doc[] }>('/api/docs'),
  createDoc: (body: { title: string; path?: string; tags?: string[]; body?: string }) =>
    req<{ doc: Doc }>('/api/docs', json(body)),
  getDoc: (path: string) => req<{ doc: Doc }>(`/api/docs/doc?path=${encodeURIComponent(path)}`),
  updateDoc: (path: string, body: Record<string, unknown>) =>
    req<{ doc: Doc }>(`/api/docs/doc?path=${encodeURIComponent(path)}`, json(body, 'PUT')),
  deleteDoc: (path: string) =>
    req<{ ok: boolean }>(`/api/docs/doc?path=${encodeURIComponent(path)}`, { method: 'DELETE' }),
  searchDocs: (q: string) => req<{ hits: DocHit[] }>(`/api/docs/search?q=${encodeURIComponent(q)}`),

  version: () => req<VersionInfo>('/api/version'),
  mcpInfo: () => req<McpInfo>('/api/mcp/info'),
  checkUpdate: () => req<UpdateInfo>('/api/update/check'),
  applyUpdate: () => req<{ ok: boolean; version: string }>('/api/update/apply', { method: 'POST' }),
}