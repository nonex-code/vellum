import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

// 把仓库内的相对引用（files/...）改写到 /api/files/{issueId}/... ，
// 保持磁盘上的 Markdown 纯净、可迁移。绝对 URL 原样保留。
function resolve(url: string | undefined, issueId?: string): string {
  if (!url) return ''
  if (/^(https?:)?\/\//i.test(url) || url.startsWith('/') || url.startsWith('data:')) return url
  return issueId ? `/api/files/${encodeURIComponent(issueId)}/${url}` : url
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

interface Props {
  children: string
  issueId?: string
  onToggleCheckbox?: (index: number) => void
}

export default function Markdown({ children, issueId, onToggleCheckbox }: Props) {
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[tagCheckboxes]}
        components={{
          img: ({ node: _n, ...props }) => <img {...props} src={resolve(props.src, issueId)} />,
          a: ({ node: _n, ...props }) => (
            <a {...props} href={resolve(props.href, issueId)} target="_blank" rel="noopener noreferrer" />
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
