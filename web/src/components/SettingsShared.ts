import type { Schema } from '../types'

import { t } from '../i18n'

// 配置作用域：仓库级 workbench.yaml 或 项目级 projects/<id>/workbench.yaml
export type Scope = 'repo' | 'project'

export function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T
}

// ---- 数组不可变操作小工具 ----

export function updateAt<T>(arr: T[], i: number, patch: Partial<T>): T[] {
  return arr.map((it, idx) => (idx === i ? { ...it, ...patch } : it))
}

export function removeAt<T>(arr: T[], i: number): T[] {
  return arr.filter((_, idx) => idx !== i)
}

export function moveItem<T>(arr: T[], from: number, to: number): T[] {
  const a = arr.slice()
  if (to < 0 || to >= a.length) return a
  const [x] = a.splice(from, 1)
  a.splice(to, 0, x)
  return a
}

export function insertAt<T>(arr: T[], i: number, item: T): T[] {
  const a = arr.slice()
  a.splice(i, 0, item)
  return a
}

// 返回存在问题的 id 集合（空 id 或重复 id），用于列表内的即时红框提示。
export function problemIds(arr: { id?: string }[]): Set<string> {
  const counts = new Map<string, number>()
  for (const it of arr) {
    const id = (it.id || '').trim()
    if (id) counts.set(id, (counts.get(id) || 0) + 1)
  }
  const bad = new Set<string>()
  for (const it of arr) {
    const id = (it.id || '').trim()
    if (!id) bad.add('')
    else if ((counts.get(id) || 0) > 1) bad.add(id)
  }
  return bad
}

// ---- ID 唯一 / 非空校验 ----
// 返回人类可读的问题列表；为空表示通过。
export function collectIdIssues(s: Schema): string[] {
  const groups: { name: string; arr: { id?: string }[] }[] = [
    { name: '状态', arr: s.statuses || [] },
    { name: '优先级', arr: s.priorities || [] },
    { name: '标签', arr: s.labels || [] },
    { name: '类型', arr: s.types || [] },
    { name: '里程碑', arr: s.milestones || [] },
    { name: '字段', arr: s.fields || [] },
    { name: '模板', arr: s.templates || [] },
  ]
  const out: string[] = []
  for (const g of groups) {
    const seen = new Map<string, number>()
    let blank = 0
    for (const it of g.arr) {
      const id = (it.id || '').trim()
      if (!id) {
        blank++
        continue
      }
      seen.set(id, (seen.get(id) || 0) + 1)
    }
    if (blank > 0) out.push(t('{name}：有 {count} 项 ID 为空', { name: t(g.name), count: blank }))
    for (const [id, n] of seen) {
      if (n > 1) out.push(t('{name}：ID「{id}」重复 {count} 次', { name: t(g.name), id, count: n }))
    }
  }
  return out
}

// ---- 由生效 schema + 目标作用域 构造待写入的配置对象 ----
// 表单保存采用「以生效 schema 为基线」的策略：把整份配置序列化后覆盖目标 yaml。
export function buildConfig(s: Schema, scope: Scope): Record<string, unknown> {
  const cfg: Record<string, unknown> = {}

  // workspace.name 与 idPrefix 必须写入；mode 是仓库级概念，项目级不写以免冲突。
  cfg.workspace =
    scope === 'project' ? { name: s.workspace.name } : { name: s.workspace.name, mode: s.workspace.mode }
  cfg.idPrefix = s.idPrefix

  if (s.statuses?.length) cfg.statuses = s.statuses
  if (s.priorities?.length) cfg.priorities = s.priorities
  if (s.labels?.length) cfg.labels = s.labels
  if (s.types?.length) cfg.types = s.types
  // milestones / fields / templates 为空数组时省略。
  if (s.milestones?.length) cfg.milestones = s.milestones
  if (s.fields?.length) cfg.fields = s.fields
  if (s.templates?.length) cfg.templates = s.templates

  cfg.modules = s.modules
  cfg.views = s.views
  // 界面语言的仓库默认值，跟着 workbench.yaml 走。
  if (s.language) cfg.language = s.language

  // 项目级保留 project 元信息，避免覆盖后丢失项目名称/简介。
  if (scope === 'project' && s.project) cfg.project = s.project

  return cfg
}

export function toYaml(s: Schema, scope: Scope): string {
  return stringifyYaml(buildConfig(s, scope))
}

// 表单负责写入的顶层键。保存时后端只覆盖这些键，其余（如 webhook）原样保留，
// 避免「表单保存」静默删掉只在 YAML 源码里配置过的内容。
export function managedKeys(scope: Scope): string[] {
  const keys = ['workspace', 'idPrefix', 'statuses', 'priorities', 'labels', 'types',
    'milestones', 'fields', 'templates', 'modules', 'views', 'language']
  return scope === 'project' ? [...keys, 'project'] : keys
}

// ---- 极简 YAML 序列化 ----
// 仅处理已知结构：标量、对象、数组（对象数组 / 标量数组）。字符串一律双引号并转义。
// 采用「键缩进、序列再深一层」的通用缩进风格，Go 系列 YAML 解析器均可读。
const IND = '  '

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function has(v: unknown): boolean {
  return v !== undefined && v !== null
}

function quote(s: string): string {
  const esc = s
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r/g, '')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t')
  return `"${esc}"`
}

function scalar(v: unknown): string {
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '0'
  if (typeof v === 'string') return quote(v)
  return quote(String(v))
}

function emitNode(key: string | null, value: unknown, indent: number, out: string[]): void {
  const pad = IND.repeat(indent)
  const head = key === null ? '' : `${key}:`

  if (Array.isArray(value)) {
    if (value.length === 0) {
      out.push(`${pad}${head} []`)
      return
    }
    if (key !== null) {
      out.push(`${pad}${head}`)
      emitSeq(value, indent + 1, out)
    } else {
      emitSeq(value, indent, out)
    }
    return
  }

  if (isObj(value)) {
    const entries = Object.entries(value).filter(([, v]) => has(v))
    if (entries.length === 0) {
      out.push(`${pad}${head} {}`)
      return
    }
    if (key !== null) {
      out.push(`${pad}${head}`)
      emitMap(value, indent + 1, out)
    } else {
      emitMap(value, indent, out)
    }
    return
  }

  out.push(`${pad}${head} ${scalar(value)}`)
}

function emitMap(obj: Record<string, unknown>, indent: number, out: string[]): void {
  for (const [k, v] of Object.entries(obj)) {
    if (!has(v)) continue
    emitNode(k, v, indent, out)
  }
}

function emitSeq(arr: unknown[], indent: number, out: string[]): void {
  const pad = IND.repeat(indent)
  for (const item of arr) {
    if (isObj(item)) {
      const lines: string[] = []
      emitMap(item, indent + 1, lines)
      if (lines.length === 0) {
        out.push(`${pad}- {}`)
        continue
      }
      // 首个键缩进为 (indent+1)*2 空格；用 pad + "- " 等宽替换成序列项。
      lines[0] = `${pad}- ${lines[0].slice((indent + 1) * IND.length)}`
      out.push(...lines)
    } else if (Array.isArray(item)) {
      out.push(`${pad}-`)
      emitSeq(item, indent + 1, out)
    } else {
      out.push(`${pad}- ${scalar(item)}`)
    }
  }
}

export function stringifyYaml(obj: Record<string, unknown>): string {
  const out: string[] = []
  emitMap(obj, 0, out)
  return out.join('\n') + '\n'
}
