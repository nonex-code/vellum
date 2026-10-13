import { useSyncExternalStore } from 'react'

import { en } from './en'

export type Lang = 'zh' | 'en'
export type Vars = Record<string, string | number>

// 中文是源语言：t() 的 key 就是界面里那句中文原文，缺译文时原样回落，
// 这样漏译只会露出中文，不会露出 "issue.detail.foo" 这种占位符。
const dict: Record<string, string> = en

const STORAGE_KEY = 'wb-lang'
const listeners = new Set<() => void>()

function normalize(v: string | null | undefined): Lang | null {
  if (!v) return null
  const s = v.toLowerCase()
  if (s.startsWith('zh')) return 'zh'
  if (s.startsWith('en')) return 'en'
  return null
}

function detect(): Lang {
  const saved = normalize(localStorage.getItem(STORAGE_KEY))
  if (saved) return saved
  return normalize(navigator.language) === 'en' ? 'en' : 'zh'
}

let lang: Lang = detect()

function publish() {
  document.documentElement.lang = lang === 'en' ? 'en' : 'zh-CN'
  listeners.forEach((fn) => fn())
}

publish()

function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function getLang(): Lang {
  return lang
}

// setLang 切换语言并记住到 localStorage（个人偏好，不写进仓库）。
export function setLang(next: Lang) {
  localStorage.setItem(STORAGE_KEY, next)
  if (next === lang) return
  lang = next
  publish()
}

// applyRepoDefault 用仓库 workbench.yaml 里的 language 兜底：
// 用户没在本机切换过语言时才生效。
export function applyRepoDefault(v: string | undefined | null) {
  if (localStorage.getItem(STORAGE_KEY)) return
  const l = normalize(v)
  if (l && l !== lang) {
    lang = l
    publish()
  }
}

// userChoseLang 表示本机是否有显式选择（决定要不要跟随仓库默认）。
export const hasUserLang = () => !!localStorage.getItem(STORAGE_KEY)

function interpolate(text: string, vars?: Vars): string {
  if (!vars) return text
  return text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m))
}

export function t(src: string, vars?: Vars): string {
  const text = lang === 'en' ? dict[src] || src : src
  return interpolate(text, vars)
}

// intlLocale 给 Intl / dayjs 用：日期、数字按界面语言格式化。
export function intlLocale(): string {
  return lang === 'en' ? 'en-US' : 'zh-CN'
}

// useT 订阅语言变化：组件用它即可在切换语言时重渲染。
export function useT() {
  const current = useSyncExternalStore(subscribe, getLang)
  return { lang: current, t }
}

export function useLang(): [Lang, (l: Lang) => void] {
  const current = useSyncExternalStore(subscribe, getLang)
  return [current, setLang]
}
