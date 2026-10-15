import { useContext, useEffect, useId, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

import { Ctx } from '../context'
import { t } from '../i18n'
import { isProgramScope } from '../nav'
import { useThemeCtx } from '../theme-context'

// 把仓库内的相对引用（files/...）改写到 /api/files/{issueId}/... ，
// 并带上 ?project=，让 <img>/<a> 这类无法加请求头的场景也能定位到正确项目。
// 绝对 URL 原样保留。
function resolve(url: string | undefined, issueId: string | undefined, project: string): string {
  if (!url) return ''
  if (/^(https?:)?\/\//i.test(url) || url.startsWith('/') || url.startsWith('data:')) return url
  if (!issueId) return url
  return `/api/files/${encodeURIComponent(issueId)}/${url}${project}`
}

// remark-gfm 生成的复选框节点没有 position，只能按文档顺序重新编号，
// 勾选时才能对应回正文里第几个 `- [ ]` 行。
function tagCheckboxes() {
  return (tree: any) => {
    let n = 0
    const walk = (node: any) => {
      if (node.type === 'element' && node.tagName === 'input' && node.properties?.type === 'checkbox') {
        node.properties.dataMdIdx = String(n++)
      }
      for (const child of node.children || []) walk(child)
    }
    walk(tree)
    return tree
  }
}

// nodeText 递归拼接 hast 节点的纯文本，用来取出 mermaid 代码块的源码。
function nodeText(node: any): string {
  if (!node) return ''
  if (node.type === 'text') return node.value || ''
  if (Array.isArray(node.children)) return node.children.map(nodeText).join('')
  return ''
}

// mermaidCodeFrom 判断一个 <pre> 是否为 ```mermaid 代码块，是则返回源码。
function mermaidCodeFrom(preNode: any): string | null {
  const child = preNode?.children?.find((c: any) => c.type === 'element' && c.tagName === 'code')
  if (!child) return null
  const cls = child.properties?.className
  const list = Array.isArray(cls) ? cls : typeof cls === 'string' ? cls.split(/\s+/) : []
  if (!list.includes('language-mermaid')) return null
  return nodeText(child)
}

// Mermaid 按需加载 mermaid（独立的异步 chunk，只有出现图表时才下载），
// 跟随明暗主题重渲染；语法有误时回落到源码，不破坏正文排版。
function Mermaid({ code }: { code: string }) {
  const { mode } = useThemeCtx()
  const id = useId()
  const [svg, setSvg] = useState('')
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true
    const renderId = 'wb-mermaid-' + id.replace(/[^a-zA-Z0-9]/g, '')
    ;(async () => {
      try {
        const mermaid = (await import('mermaid')).default
        if (!alive) return
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          theme: mode === 'dark' ? 'dark' : 'default',
          fontFamily: 'inherit',
          suppressErrorRendering: true,
        })
        const { svg: out } = await mermaid.render(renderId, code.trim())
        if (alive) {
          setSvg(out)
          setFailed(false)
        }
      } catch {
        if (alive) {
          setSvg('')
          setFailed(true)
        }
      }
    })()
    return () => {
      alive = false
    }
  }, [code, id, mode])

  if (failed) {
    return (
      <div className="mermaid-fallback">
        <div className="mermaid-hint">{t('图表语法有误，已显示源码')}</div>
        <pre>{code}</pre>
      </div>
    )
  }
  if (!svg) return <div className="mermaid-loading">{t('图表渲染中…')}</div>
  return <div className="mermaid" dangerouslySetInnerHTML={{ __html: svg }} />
}

interface Props {
  children: string
  issueId?: string
  onToggleCheckbox?: (index: number) => void
}

export default function Markdown({ children, issueId, onToggleCheckbox }: Props) {
  const pid = useContext(Ctx)?.projectId
  const project = pid && !isProgramScope(pid) ? `?project=${encodeURIComponent(pid)}` : ''
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[tagCheckboxes]}
        components={{
          // mermaid 代码块整块替换为渲染结果，避免 <pre><div> 的非法嵌套。
          pre: ({ node, children, ...props }: any) => {
            const code = mermaidCodeFrom(node)
            if (code !== null) return <Mermaid code={code} />
            return <pre {...props}>{children}</pre>
          },
          img: ({ node: _n, ...props }) => <img {...props} src={resolve(props.src, issueId, project)} />,
          a: ({ node: _n, ...props }) => (
            <a
              {...props}
              href={resolve(props.href, issueId, project)}
              target="_blank"
              rel="noopener noreferrer"
            />
          ),
          input: ({ node: _n, ...props }: any) => {
            if (props.type !== 'checkbox') return <input {...props} />
            const idx = Number(props['data-md-idx'])
            return (
              <input
                {...props}
                disabled={!onToggleCheckbox}
                style={{ cursor: onToggleCheckbox ? 'pointer' : 'default' }}
                onChange={() => {
                  if (onToggleCheckbox && Number.isInteger(idx)) onToggleCheckbox(idx)
                }}
              />
            )
          },
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  )
}