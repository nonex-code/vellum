import React, { Fragment } from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router-dom'

import '@fontsource/ibm-plex-sans/latin-400.css'
import '@fontsource/ibm-plex-sans/latin-500.css'
import '@fontsource/ibm-plex-sans/latin-600.css'
import '@fontsource/ibm-plex-sans/latin-700.css'
import '@fontsource/ibm-plex-mono/latin-400.css'
import '@fontsource/ibm-plex-mono/latin-500.css'
import 'antd/dist/reset.css'
import './index.css'

import App from './App'
import { ThemeProvider } from './theme-context'
import { useLang } from './i18n'

// 语言变化时整棵树重挂载（key={lang}）：模块级常量与未订阅的纯函数
// （如时间格式化）也一定能拿到新文案，不必逐个组件登记。
function Root() {
  const [lang] = useLang()
  return (
    <Fragment key={lang}>
      <ThemeProvider>
        <HashRouter>
          <App />
        </HashRouter>
      </ThemeProvider>
    </Fragment>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
)