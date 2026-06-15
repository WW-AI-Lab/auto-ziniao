import { useEffect, useMemo, useState } from 'react'
import { Alert, Collapse, Descriptions, Space, Steps, Table, Tag, Typography } from 'antd'
import { CheckCircleOutlined, CloseCircleOutlined, LoadingOutlined, ToolOutlined } from '@ant-design/icons'
import { XMarkdown } from '@ant-design/x-markdown'
import type { ChatA2UIBlock, ChatToolCall } from '../../api'
import './RichMessage.css'

interface RichMessageProps {
  content: string
  reasoning?: string
  tools?: ChatToolCall[] | null
  a2ui?: ChatA2UIBlock[] | null
  failed?: boolean
  error?: string | null
  thinking?: boolean
  streaming?: boolean
}

type MarkdownSegment =
  | { type: 'markdown'; content: string }
  | { type: 'mermaid'; content: string }

export function RichMessage({
  content,
  reasoning,
  tools,
  a2ui,
  failed,
  error,
  thinking,
  streaming,
}: RichMessageProps) {
  const hasContent = !!content.trim()
  return (
    <div className="zn-rich-message">
      {failed && (
        <Alert
          type="error"
          showIcon
          message="执行失败"
          description={error ?? '发送失败'}
          className="zn-rich-message__alert"
        />
      )}
      <ReasoningPanel reasoning={reasoning} thinking={thinking} />
      <ToolCallList tools={tools ?? []} />
      {hasContent && <MarkdownContent content={content} streaming={streaming} />}
      <A2UIRenderer blocks={a2ui ?? []} />
    </div>
  )
}

function ReasoningPanel({ reasoning, thinking }: { reasoning?: string; thinking?: boolean }) {
  if (!reasoning) return null
  return (
    <Collapse
      ghost
      size="small"
      defaultActiveKey={thinking ? ['reasoning'] : []}
      className="zn-rich-message__reasoning"
      items={[{
        key: 'reasoning',
        label: (
          <Typography.Text type="secondary" className="zn-rich-message__section-label">
            {thinking ? '思考中' : '思考过程'}
          </Typography.Text>
        ),
        children: <pre className="zn-rich-message__reasoning-text">{reasoning}</pre>,
      }]}
    />
  )
}

function ToolCallList({ tools }: { tools: ChatToolCall[] }) {
  if (!tools.length) return null
  return (
    <div className="zn-rich-message__tools">
      <Typography.Text type="secondary" className="zn-rich-message__section-label">
        工具调用
      </Typography.Text>
      <Space direction="vertical" size={6} className="zn-rich-message__tool-list">
        {tools.map((tool, index) => (
          <div className="zn-rich-message__tool" key={tool.id ?? `${tool.name}-${index}`}>
            <Tag icon={toolStatusIcon(tool.status)} color={toolStatusColor(tool.status)} className="zn-rich-message__tool-name">
              {tool.name}
            </Tag>
            {tool.args_summary && <Typography.Text type="secondary">{tool.args_summary}</Typography.Text>}
            {tool.result_summary && <Typography.Text>{tool.result_summary}</Typography.Text>}
            {tool.error && <Typography.Text type="danger">{tool.error}</Typography.Text>}
          </div>
        ))}
      </Space>
    </div>
  )
}

function MarkdownContent({ content, streaming }: { content: string; streaming?: boolean }) {
  const segments = useMemo(() => splitMermaidSegments(content), [content])
  return (
    <div className="zn-rich-message__markdown">
      {segments.map((segment, index) => (
        segment.type === 'mermaid'
          ? <MermaidBlock key={index} source={segment.content} />
          : (
            <XMarkdown
              key={index}
              content={segment.content}
              openLinksInNewTab
              streaming={streaming ? { hasNextChunk: true, tail: true } : undefined}
              dompurifyConfig={{
                FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed'],
                FORBID_ATTR: ['onerror', 'onload', 'onclick', 'style'],
              }}
            />
          )
      ))}
    </div>
  )
}

function MermaidBlock({ source }: { source: string }) {
  const [svg, setSvg] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    const render = async () => {
      const code = source.trim()
      if (!code) {
        setSvg('')
        setError('')
        return
      }
      try {
        const mermaid = (await import('mermaid')).default
        mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'default' })
        const result = await mermaid.render(`zn-chat-mermaid-${hashString(code)}`, code)
        if (!cancelled) {
          setSvg(result.svg)
          setError('')
        }
      } catch (err) {
        if (!cancelled) {
          setSvg('')
          setError(err instanceof Error ? err.message : String(err))
        }
      }
    }
    render()
    return () => {
      cancelled = true
    }
  }, [source])

  if (error) {
    return (
      <Alert
        type="warning"
        showIcon
        message="Mermaid 渲染失败"
        description={<pre className="zn-rich-message__mermaid-source">{source}</pre>}
        className="zn-rich-message__alert"
      />
    )
  }
  if (!svg) {
    return <pre className="zn-rich-message__mermaid-source">{source}</pre>
  }
  return <div className="zn-rich-message__mermaid" dangerouslySetInnerHTML={{ __html: svg }} />
}

function A2UIRenderer({ blocks }: { blocks: ChatA2UIBlock[] }) {
  if (!blocks.length) return null
  return (
    <div className="zn-rich-message__a2ui">
      <Typography.Text type="secondary" className="zn-rich-message__section-label">
        A2UI
      </Typography.Text>
      <Space direction="vertical" size={8} className="zn-rich-message__a2ui-list">
        {blocks.map((block, index) => <A2UIBlockView key={block.id ?? index} block={block} />)}
      </Space>
    </div>
  )
}

function A2UIBlockView({ block }: { block: ChatA2UIBlock }) {
  if (block.type === 'text') {
    return (
      <section className="zn-a2ui-block">
        {block.title && <Typography.Text strong>{block.title}</Typography.Text>}
        <Typography.Paragraph className="zn-a2ui-block__paragraph">{String(block.text ?? '')}</Typography.Paragraph>
      </section>
    )
  }
  if (block.type === 'alert') {
    return (
      <Alert
        type={alertType(block.level)}
        showIcon
        message={block.title ?? block.text ?? '提示'}
        description={block.title ? block.text : undefined}
      />
    )
  }
  if (block.type === 'table') {
    const rows = Array.isArray(block.rows) ? block.rows : []
    const columns = (block.columns?.length ? block.columns : inferColumns(rows)).map((key) => ({
      title: key,
      dataIndex: key,
      key,
      render: (value: unknown) => formatCell(value),
    }))
    return (
      <section className="zn-a2ui-block">
        {block.title && <Typography.Text strong>{block.title}</Typography.Text>}
        <Table
          size="small"
          pagination={false}
          columns={columns}
          dataSource={rows.map((row, index) => ({ key: index, ...row }))}
          scroll={{ x: true }}
        />
      </section>
    )
  }
  if (block.type === 'description') {
    const data = isRecord(block.data) ? block.data : (block.props ?? {})
    return (
      <section className="zn-a2ui-block">
        {block.title && <Typography.Text strong>{block.title}</Typography.Text>}
        <Descriptions
          size="small"
          column={1}
          items={Object.entries(data).map(([key, value]) => ({
            key,
            label: key,
            children: formatCell(value),
          }))}
        />
      </section>
    )
  }
  if (block.type === 'steps') {
    return (
      <section className="zn-a2ui-block">
        {block.title && <Typography.Text strong>{block.title}</Typography.Text>}
        <Steps
          size="small"
          direction="vertical"
          items={(block.items ?? []).map((item, index) => {
            const record = isRecord(item) ? item : {}
            return {
              title: String(record.title ?? record.name ?? `步骤 ${index + 1}`),
              description: record.description === undefined ? undefined : formatCell(record.description),
              status: stepStatus(record.status),
            }
          })}
        />
      </section>
    )
  }
  if (block.type === 'json') {
    return (
      <section className="zn-a2ui-block">
        {block.title && <Typography.Text strong>{block.title}</Typography.Text>}
        <pre className="zn-a2ui-block__json">{JSON.stringify(block.data ?? block.props ?? block, null, 2)}</pre>
      </section>
    )
  }
  return (
    <section className="zn-a2ui-block">
      <Typography.Text type="secondary">未知 A2UI block: {block.type}</Typography.Text>
      <pre className="zn-a2ui-block__json">{JSON.stringify(block, null, 2)}</pre>
    </section>
  )
}

function splitMermaidSegments(content: string): MarkdownSegment[] {
  const segments: MarkdownSegment[] = []
  const pattern = /```mermaid\s*([\s\S]*?)```/gi
  let lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = pattern.exec(content)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: 'markdown', content: content.slice(lastIndex, match.index) })
    }
    segments.push({ type: 'mermaid', content: match[1] ?? '' })
    lastIndex = pattern.lastIndex
  }
  if (lastIndex < content.length) {
    segments.push({ type: 'markdown', content: content.slice(lastIndex) })
  }
  return segments.length ? segments : [{ type: 'markdown', content }]
}

function toolStatusIcon(status?: string) {
  if (status === 'running' || status === 'pending') return <LoadingOutlined />
  if (status === 'failed') return <CloseCircleOutlined />
  if (status === 'success') return <CheckCircleOutlined />
  return <ToolOutlined />
}

function toolStatusColor(status?: string) {
  if (status === 'success') return 'success'
  if (status === 'failed') return 'error'
  if (status === 'running' || status === 'pending') return 'processing'
  if (status === 'skipped') return 'default'
  return 'blue'
}

function alertType(level?: string) {
  if (level === 'success' || level === 'warning' || level === 'error') return level
  return 'info'
}

function stepStatus(status: unknown) {
  return status === 'finish' || status === 'process' || status === 'wait' || status === 'error'
    ? status
    : undefined
}

function inferColumns(rows: Record<string, unknown>[]) {
  return Array.from(new Set(rows.flatMap((row) => Object.keys(row)))).slice(0, 8)
}

function formatCell(value: unknown) {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function hashString(value: string) {
  let hash = 0
  for (let i = 0; i < value.length; i += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0
  }
  return Math.abs(hash).toString(36)
}
