import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import 'dayjs/locale/zh-cn'

import { getLang } from './i18n'

dayjs.extend(relativeTime)

// 相对时间跟着界面语言走，不设全局 locale，避免影响日期选择器的取值格式。
const dayLocale = () => (getLang() === 'en' ? 'en' : 'zh-cn')

export function fromNow(s?: string): string {
  if (!s) return '—'
  const d = dayjs(s)
  return d.isValid() ? d.locale(dayLocale()).fromNow() : s
}

export function fmtTime(s?: string): string {
  if (!s) return '—'
  const d = dayjs(s)
  return d.isValid() ? d.format('YYYY-MM-DD HH:mm') : s
}

const CHECKBOX_RE = /^(\s*[-*] )\[([ xX])\]/

// toggleCheckbox 翻转正文中第 index 个 Markdown 复选框（0 起）。
export function toggleCheckbox(body: string, index: number): string {
  let n = -1
  return body
    .split('\n')
    .map((line) => {
      if (CHECKBOX_RE.test(line)) {
        n++
        if (n === index) {
          return line.replace(CHECKBOX_RE, (_m, pre: string, mark: string) =>
            `${pre}[${mark.toLowerCase() === 'x' ? ' ' : 'x'}]`,
          )
        }
      }
      return line
    })
    .join('\n')
}
