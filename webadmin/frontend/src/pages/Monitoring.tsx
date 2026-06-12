import { useCallback, useEffect, useState, type ReactNode } from 'react'
import {
  App, Breadcrumb, Button, Card, Drawer, Select, Space, Table, Tabs, Tag,
  Typography,
} from 'antd'
import { DownloadOutlined, FileOutlined, FolderOutlined, ReloadOutlined } from '@ant-design/icons'
import { get, type FlowSummary, type RunEntry } from '../api'

const STATUS_TAG: Record<string, ReactNode> = {
  success: <Tag color="green">成功</Tag>,
  failed: <Tag color="red">失败</Tag>,
  error: <Tag color="volcano">异常</Tag>,
}

// ---------------------------------------------------------------------
// 运行历史
// ---------------------------------------------------------------------

function RunsTab() {
  const { message } = App.useApp()
  const [items, setItems] = useState<RunEntry[]>([])
  const [total, setTotal] = useState(0)
  const [flowId, setFlowId] = useState<string | undefined>()
  const [flows, setFlows] = useState<FlowSummary[]>([])
  const [page, setPage] = useState(1)
  const pageSize = 20

  useEffect(() => {
    get<{ items: FlowSummary[] }>('/api/flows').then((d) => setFlows(d.items))
  }, [])

  const load = useCallback(() => {
    const params = new URLSearchParams({
      limit: String(pageSize),
      offset: String((page - 1) * pageSize),
    })
    if (flowId) params.set('flow_id', flowId)
    get<{ total: number; items: RunEntry[] }>(`/api/runs?${params}`)
      .then((d) => {
        setItems(d.items)
        setTotal(d.total)
      })
      .catch((e) => message.error(e.message))
  }, [flowId, page, message])

  useEffect(() => {
    load()
  }, [load])

  return (
    <Space direction="vertical" style={{ width: '100%' }}>
      <Space>
        <Select
          allowClear
          placeholder="按流程过滤"
          style={{ width: 240 }}
          value={flowId}
          onChange={(v) => {
            setPage(1)
            setFlowId(v)
          }}
          options={flows.map((f) => ({ value: f.id, label: f.id }))}
        />
        <Button icon={<ReloadOutlined />} onClick={load}>刷新</Button>
      </Space>
      <Table
        rowKey={(r) => `${r.flow_id}-${r.timestamp}-${r.duration_ms}`}
        size="small"
        dataSource={items}
        pagination={{
          current: page, pageSize, total, showSizeChanger: false,
          onChange: setPage,
        }}
        columns={[
          { title: '时间', dataIndex: 'timestamp', width: 170 },
          { title: '流程', dataIndex: 'flow_id', width: 180 },
          { title: '状态', dataIndex: 'status', width: 80, render: (v) => STATUS_TAG[v] ?? v },
          {
            title: '耗时', dataIndex: 'duration_ms', width: 100,
            render: (v) => (v != null ? `${Math.round(v)}ms` : '-'),
          },
          {
            title: '参数', dataIndex: 'params',
            render: (p?: Record<string, string>) =>
              p && Object.keys(p).length
                ? Object.entries(p).map(([k, v]) => <Tag key={k}>{k}={v}</Tag>)
                : '-',
          },
          { title: '错误', dataIndex: 'error', ellipsis: true, render: (v) => v ?? '-' },
        ]}
      />
    </Space>
  )
}

// ---------------------------------------------------------------------
// 自愈记录
// ---------------------------------------------------------------------

interface HealEntry {
  heal_id?: string
  timestamp?: string
  event?: string
  flow_id?: string
  step_id?: string
  error_type?: string
  reason?: string
  [k: string]: unknown
}

interface HealDetail {
  heal_id: string
  context: Record<string, unknown> | null
  prompt: string | null
}

function HealsTab() {
  const { message } = App.useApp()
  const [items, setItems] = useState<HealEntry[]>([])
  const [detail, setDetail] = useState<HealDetail | null>(null)

  const load = useCallback(() => {
    get<{ items: HealEntry[] }>('/api/heals?limit=100')
      .then((d) => setItems(d.items))
      .catch((e) => message.error(e.message))
  }, [message])

  useEffect(() => {
    load()
  }, [load])

  return (
    <Space direction="vertical" style={{ width: '100%' }}>
      <Button icon={<ReloadOutlined />} onClick={load}>刷新</Button>
      <Table
        rowKey={(r, i) => `${r.heal_id ?? i}`}
        size="small"
        dataSource={items}
        pagination={{ pageSize: 20, showSizeChanger: false }}
        columns={[
          { title: '时间', dataIndex: 'timestamp', width: 190 },
          { title: '事件', dataIndex: 'event', width: 100 },
          { title: '流程', dataIndex: 'flow_id', width: 170 },
          { title: '步骤', dataIndex: 'step_id', width: 150 },
          {
            title: '类型/原因',
            render: (_, r) => r.error_type ?? r.reason ?? '-',
          },
          {
            title: '详情',
            width: 80,
            render: (_, r) =>
              r.heal_id ? (
                <Button
                  size="small" type="link"
                  onClick={async () => {
                    try {
                      setDetail(await get<HealDetail>(`/api/heals/${r.heal_id}`))
                    } catch (e) {
                      message.error((e as Error).message)
                    }
                  }}
                >
                  查看
                </Button>
              ) : '-',
          },
        ]}
      />
      <Drawer
        title={`自愈详情: ${detail?.heal_id ?? ''}`}
        open={!!detail}
        width="55%"
        onClose={() => setDetail(null)}
      >
        <Typography.Title level={5}>失败上下文</Typography.Title>
        <pre style={{ maxHeight: 280, overflow: 'auto', fontSize: 12 }}>
          {detail?.context ? JSON.stringify(detail.context, null, 2) : '（无）'}
        </pre>
        <Typography.Title level={5}>提示词</Typography.Title>
        <pre style={{ maxHeight: 400, overflow: 'auto', fontSize: 12, whiteSpace: 'pre-wrap' }}>
          {detail?.prompt ?? '（无）'}
        </pre>
      </Drawer>
    </Space>
  )
}

// ---------------------------------------------------------------------
// known_issues
// ---------------------------------------------------------------------

function KnownIssuesTab() {
  const [items, setItems] = useState<Record<string, unknown>[]>([])
  useEffect(() => {
    get<{ items: Record<string, unknown>[] }>('/api/known-issues')
      .then((d) => setItems(d.items))
  }, [])
  return (
    <Table
      rowKey={(_, i) => String(i)}
      size="small"
      dataSource={items}
      pagination={false}
      columns={[
        { title: '流程', dataIndex: 'flow_id', width: 170 },
        { title: '步骤', dataIndex: 'step_id', width: 150 },
        { title: '匹配模式', dataIndex: 'pattern', ellipsis: true },
        { title: '修复方案', dataIndex: 'fix', ellipsis: true },
        {
          title: '已解决', dataIndex: 'resolved', width: 80,
          render: (v) => (v ? <Tag color="green">是</Tag> : <Tag>否</Tag>),
        },
      ]}
    />
  )
}

// ---------------------------------------------------------------------
// output 产出浏览
// ---------------------------------------------------------------------

interface OutputList {
  path: string
  dirs: { name: string }[]
  files: { name: string; size: number; mtime: number }[]
}

interface Preview {
  too_large?: boolean
  binary?: boolean
  size: number
  name?: string
  content?: string
  message?: string
}

function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

function CsvTable({ text }: { text: string }) {
  const lines = text.replace(/\r/g, '').split('\n').filter((l) => l.length)
  const rows = lines.slice(0, 500).map((l) => l.split(','))
  const header = rows[0] ?? []
  return (
    <Table
      size="small"
      rowKey={(_, i) => String(i)}
      dataSource={rows.slice(1).map((cells, i) => ({ key: i, cells }))}
      pagination={{ pageSize: 50, showSizeChanger: false }}
      columns={header.map((h, ci) => ({
        title: h || `列${ci + 1}`,
        render: (_: unknown, r: { cells: string[] }) => r.cells[ci] ?? '',
      }))}
    />
  )
}

function OutputsTab() {
  const { message } = App.useApp()
  const [path, setPath] = useState('')
  const [listing, setListing] = useState<OutputList | null>(null)
  const [preview, setPreview] = useState<(Preview & { path: string }) | null>(null)

  const load = useCallback((p: string) => {
    get<OutputList>(`/api/outputs?path=${encodeURIComponent(p)}`)
      .then((d) => {
        setListing(d)
        setPath(p)
      })
      .catch((e) => message.error(e.message))
  }, [message])

  useEffect(() => {
    load('')
  }, [load])

  const crumbs = ['output', ...path.split('/').filter(Boolean)]

  return (
    <Space direction="vertical" style={{ width: '100%' }}>
      <Breadcrumb
        items={crumbs.map((seg, i) => ({
          title: (
            <a onClick={() => load(crumbs.slice(1, i + 1).join('/'))}>{seg}</a>
          ),
        }))}
      />
      <Table
        rowKey="name"
        size="small"
        pagination={false}
        dataSource={[
          ...(listing?.dirs.map((d) => ({ ...d, kind: 'dir', size: 0, mtime: 0 })) ?? []),
          ...(listing?.files.map((f) => ({ ...f, kind: 'file' })) ?? []),
        ]}
        columns={[
          {
            title: '名称',
            render: (_, r) =>
              r.kind === 'dir' ? (
                <a onClick={() => load(path ? `${path}/${r.name}` : r.name)}>
                  <FolderOutlined /> {r.name}
                </a>
              ) : (
                <a
                  onClick={async () => {
                    const p = path ? `${path}/${r.name}` : r.name
                    try {
                      const pv = await get<Preview>(
                        `/api/outputs/preview?path=${encodeURIComponent(p)}`)
                      setPreview({ ...pv, path: p, name: pv.name ?? r.name })
                      if (pv.too_large || pv.binary) message.info(pv.message)
                    } catch (e) {
                      message.error((e as Error).message)
                    }
                  }}
                >
                  <FileOutlined /> {r.name}
                </a>
              ),
          },
          {
            title: '大小', dataIndex: 'size', width: 110,
            render: (v, r) => (r.kind === 'dir' ? '-' : fmtSize(v)),
          },
          {
            title: '修改时间', dataIndex: 'mtime', width: 180,
            render: (v, r) =>
              r.kind === 'dir' ? '-' : new Date(v * 1000).toLocaleString('zh-CN'),
          },
          {
            title: '下载', width: 70,
            render: (_, r) =>
              r.kind === 'file' ? (
                <a
                  href={`/api/outputs/download?path=${encodeURIComponent(
                    path ? `${path}/${r.name}` : r.name)}`}
                >
                  <DownloadOutlined />
                </a>
              ) : null,
          },
        ]}
      />
      <Drawer
        title={preview?.name}
        open={!!preview}
        width="60%"
        onClose={() => setPreview(null)}
        extra={
          preview && (
            <a href={`/api/outputs/download?path=${encodeURIComponent(preview.path)}`}>
              <Button icon={<DownloadOutlined />}>下载</Button>
            </a>
          )
        }
      >
        {preview?.too_large || preview?.binary ? (
          <Typography.Text type="secondary">{preview.message}</Typography.Text>
        ) : preview?.name?.endsWith('.csv') ? (
          <CsvTable text={preview.content ?? ''} />
        ) : (
          <pre style={{ maxHeight: '75vh', overflow: 'auto', fontSize: 12 }}>
            {preview?.content}
          </pre>
        )}
      </Drawer>
    </Space>
  )
}

// ---------------------------------------------------------------------

export default function Monitoring() {
  return (
    <div style={{ padding: 24 }}>
      <Typography.Title level={4} style={{ marginTop: 0 }}>运行与自愈</Typography.Title>
      <Card>
        <Tabs
          items={[
            { key: 'runs', label: '运行历史', children: <RunsTab /> },
            { key: 'heals', label: '自愈记录', children: <HealsTab /> },
            { key: 'known', label: '已知问题库', children: <KnownIssuesTab /> },
            { key: 'outputs', label: '产出文件', children: <OutputsTab /> },
          ]}
        />
      </Card>
    </div>
  )
}
