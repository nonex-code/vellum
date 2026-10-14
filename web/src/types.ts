export interface Status {
  id: string
  name: string
  category: string
  color?: string
  wip?: number
}

export interface Option {
  id: string
  name: string
  color?: string
  order?: number
  start?: string
  end?: string
}

export interface Label {
  id: string
  name: string
  color?: string
}

export interface Field {
  id: string
  name: string
  type: string
  options?: string[]
}

export interface Template {
  id: string
  name: string
  title?: string
  body?: string
  type?: string
  priority?: string
  labels?: string[]
}

export interface Modules {
  milestones: boolean
  subtasks: string
  attachments: boolean
  board: boolean
  gantt: boolean
  docs: boolean
  tree: boolean
  search: boolean
}

export interface Views {
  default: string
  nav: string[]
}

export interface ProjectMeta {
  id: string
  name: string
  description?: string
}

export interface Schema {
  workspace: { name: string; mode: string }
  project?: ProjectMeta
  language?: string
  idPrefix: string
  statuses: Status[]
  priorities: Option[]
  labels: Label[]
  milestones?: Option[]
  types: Option[]
  fields: Field[]
  templates?: Template[]
  modules: Modules
  views: Views
}

export interface Issue {
  id: string
  title: string
  status: string
  priority?: string
  type?: string
  assignee?: string
  labels?: string[]
  milestone?: string
  parent?: string
  fields?: Record<string, string>
  start?: string
  due?: string
  created: string
  updated: string
  body: string
}

export interface IssueNode extends Issue {
  children?: IssueNode[]
}

export interface Entry {
  author: string
  created: string
  type: string
  from?: string
  to?: string
  edited?: boolean
  body: string
  file: string
}

export interface SearchHit {
  issue: Issue
  snippet: string
}

export interface Doc {
  title: string
  tags?: string[]
  pinned?: boolean
  created: string
  updated: string
  path: string
  body: string
}

export interface DocHit {
  doc: Doc
  snippet: string
}

export interface ProjectStat {
  id: string
  name: string
  description?: string
  archived: boolean
  current: boolean
  total: number
  done: number
  updated?: string
}

export interface GanttItem {
  id: string
  title: string
  status: string
  done: boolean
  priority?: string
  assignee?: string
  start?: string
  due?: string
}

export interface GanttGroup {
  id: string
  name: string
  color?: string
  start?: string
  end?: string
  items: GanttItem[]
}

export interface Activity {
  issueId: string
  title: string
  status: string
  entry: Entry
}

export interface Overview {
  counts: Record<string, number>
  byStatus: { id: string; name: string; color?: string; category: string; count: number }[]
  byPriority: { id: string; name: string; color?: string; count: number }[]
  focus: Issue[]
  active: Issue[]
  stale: Issue[]
  assignees: Record<string, number>
  weekCreated: number
  weekDone: number
  milestones: { id: string; name: string; total: number; done: number }[]
  recent: Activity[]
}

export interface RepoInfo {
  loaded: boolean
  root?: string
  repoRoot?: string
  remote?: string
  hasRemote?: boolean
  head?: string
  mode?: string
  currentProject?: string
  project?: { name: string; mode: string }
  projectMeta?: ProjectMeta
  projects?: ProjectMeta[]
}

export interface RepoMeta {
  name: string
  path: string
  remote?: string
  mode?: string
  lastOpened?: string
}

export interface VersionInfo {
  version: string
  mode: string
  repo: string
  updatable: boolean
}

export interface UpdateInfo {
  current: string
  latest: string
  available: boolean
  notes?: string
  url?: string
  asset?: string
  size?: number
  publishedAt?: string
}