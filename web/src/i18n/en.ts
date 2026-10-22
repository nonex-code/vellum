import { calendar } from './en/calendar'
import { chrome } from './en/chrome'
import { common } from './en/common'
import { docs } from './en/docs'
import { gantt } from './en/gantt'
import { home } from './en/home'
import { issues } from './en/issues'
import { projects } from './en/projects'
import { settings } from './en/settings'
import { welcome } from './en/welcome'

// 中文原文 -> English。按模块分文件，避免多人/多任务同时改一张大表。
export const en: Record<string, string> = {
  ...common,
  ...chrome,
  ...home,
  ...issues,
  ...gantt,
  ...calendar,
  ...docs,
  ...projects,
  ...settings,
  ...welcome,
}
