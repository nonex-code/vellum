import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { App as AntApp, ConfigProvider } from 'antd'
import enUS from 'antd/locale/en_US'
import zhCN from 'antd/locale/zh_CN'

import { getLang } from './i18n'
import { makeTheme } from './theme'

type Mode = 'light' | 'dark'

interface ThemeCtx {
  mode: Mode
  toggle: () => void
  setMode: (m: Mode) => void
}

const Ctx = createContext<ThemeCtx | null>(null)

function getInitial(): Mode {
  const saved = localStorage.getItem('wb-theme')
  if (saved === 'light' || saved === 'dark') return saved
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return 'light'
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<Mode>(getInitial)

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', mode)
    localStorage.setItem('wb-theme', mode)
  }, [mode])

  const toggle = () => setMode((m) => (m === 'dark' ? 'light' : 'dark'))

  return (
    <Ctx.Provider value={{ mode, toggle, setMode }}>
      <ConfigProvider locale={getLang() === 'en' ? enUS : zhCN} theme={makeTheme(mode)}>
        <AntApp>{children}</AntApp>
      </ConfigProvider>
    </Ctx.Provider>
  )
}

export function useThemeCtx(): ThemeCtx {
  const c = useContext(Ctx)
  if (!c) throw new Error('Theme context not ready')
  return c
}
