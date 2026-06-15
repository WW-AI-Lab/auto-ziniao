import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import {
  Alert, App, Button, Card, Collapse, Drawer, Form, Input, Modal, Space,
  Table, Tag, Typography,
} from 'antd'
import {
  CaretRightOutlined, EditOutlined, HistoryOutlined, PlusOutlined, ReloadOutlined, SaveOutlined,
} from '@ant-design/icons'
import {
  get, post, put, type CreateFlowResponse, type ExtractDetail, type FlowDetail,
  type FlowRunHistoryItem, type FlowSummary, type ManualRun,
} from '../api'
import RunDetailDrawer from './RunDetailDrawer'

const STATUS_TAG: Record<string, ReactNode> = {
  success: <Tag color="green">成功</Tag>,
  failed: <Tag color="red">失败</Tag>,
  error: <Tag color="volcano">异常</Tag>,
  running: <Tag color="blue">运行中</Tag>,
  timeout: <Tag color="orange">超时</Tag>,
  skipped: <Tag>跳过</Tag>,
}

export default function Flows() {
  const { message, modal } = App.useApp()
  const [flows, setFlows] = useState<FlowSummary[]>([])
  const [loading, setLoading] = useState(false)

  // 创建流程
  const [createOpen, setCreateOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [createForm] = Form.useForm()

  // 编辑抽屉
  const [editing, setEditing] = useState<FlowDetail | null>(null)
  const [editorText, setEditorText] = useState('')
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // extract 编辑
  const [extractEditor, setExtractEditor] = useState<{ name: string; content: string; exists: boolean } | null>(null)
  const [extractSaving, setExtractSaving] = useState(false)
  const [extractError, setExtractError] = useState<string | null>(null)

  // 运行对话框
  const [runFlow, setRunFlow] = useState<FlowSummary | null>(null)
  const [runForm] = Form.useForm()

  // 运行状态跟踪
  const [tracking, setTracking] = useState<ManualRun | null>(null)
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null)

  // 历史与详情
  const [historyFlow, setHistoryFlow] = useState<FlowSummary | null>(null)
  const [historyRuns, setHistoryRuns] = useState<FlowRunHistoryItem[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [detailRunId, setDetailRunId] = useState<string | null>(null)

  const reload = useCallback(() => {
    setLoading(true)
    get<{ items: FlowSummary[] }>('/api/flows')
      .then((d) => setFlows(d.items))
      .catch((e) => message.error(e.message))
      .finally(() => setLoading(false))
  }, [message])

  useEffect(() => {
    reload()
  }, [reload])

  useEffect(() => () => {
    if (pollTimer.current) clearInterval(pollTimer.current)
  }, [])

  const openEditor = async (flowId: string) => {
    try {
      const detail = await get<FlowDetail>(`/api/flows/${flowId}`)
      setEditing(detail)
      setEditorText(detail.content)
      setSaveError(null)
    } catch (e) {
      message.error((e as Error).message)
    }
  }

  const createFlow = async () => {
    const values = await createForm.validateFields()
    setCreating(true)
    try {
      const created = await post<CreateFlowResponse>('/api/flows', {
        id: values.id,
        name: values.name,
      })
      message.success(`已创建流程: ${created.id}`)
      setCreateOpen(false)
      createForm.resetFields()
      reload()
      openEditor(created.id)
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setCreating(false)
    }
  }

  const save = async () => {
    if (!editing) return
    setSaving(true)
    setSaveError(null)
    try {
      const res = await put<{ saved: boolean; warnings: string[] }>(
        `/api/flows/${editing.id}`, { content: editorText })
      message.success('已保存（原文件已自动备份）')
      if (res.warnings.length) {
        modal.warning({
          title: '保存成功，但有告警',
          content: res.warnings.join('；'),
        })
      }
      setEditing(null)
      reload()
    } catch (e) {
      setSaveError((e as Error).message) // 编辑内容保留，展示具体校验错误
    } finally {
      setSaving(false)
    }
  }

  const openExtractEditor = async (path: string) => {
    const name = path.replace(/^extracts\//, '')
    setExtractError(null)
    try {
      const detail = await get<ExtractDetail>(extractUrl(name))
      setExtractEditor({
        name: detail.name,
        exists: detail.exists,
        content: detail.content ?? defaultExtractContent(),
      })
    } catch (e) {
      message.error((e as Error).message)
    }
  }

  const saveExtract = async () => {
    if (!extractEditor) return
    setExtractSaving(true)
    setExtractError(null)
    try {
      const saved = await put<ExtractDetail>(extractUrl(extractEditor.name), {
        content: extractEditor.content,
      })
      message.success(`已保存 extract: ${saved.path}`)
      setExtractEditor({ name: saved.name, exists: saved.exists, content: saved.content ?? '' })
      if (editing) openEditor(editing.id)
    } catch (e) {
      setExtractError((e as Error).message)
    } finally {
      setExtractSaving(false)
    }
  }

  const startRun = async (flow: FlowSummary, params: Record<string, string>) => {
    try {
      const accepted = await post<ManualRun>(`/api/flows/${flow.id}/run`, { params })
      setRunFlow(null)
      setTracking(accepted)
      pollTimer.current = setInterval(async () => {
        const st = await get<ManualRun>(`/api/flow-runs/${accepted.token}`)
        setTracking(st)
        if (st.status !== 'running' && pollTimer.current) {
          clearInterval(pollTimer.current)
          pollTimer.current = null
          reload()
        }
      }, 2000)
    } catch (e) {
      message.error((e as Error).message)
    }
  }

  const openHistory = async (flow: FlowSummary) => {
    setHistoryFlow(flow)
    setHistoryLoading(true)
    try {
      const data = await get<{ items: FlowRunHistoryItem[] }>(`/api/flows/${flow.id}/runs?limit=50`)
      setHistoryRuns(data.items)
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setHistoryLoading(false)
    }
  }

  return (
    <div style={{ padding: 24 }}>
      <Space style={{ marginBottom: 16, justifyContent: 'space-between', width: '100%' }}>
        <Typography.Title level={4} style={{ margin: 0 }}>流程管理</Typography.Title>
        <Space>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
            创建流程
          </Button>
          <Button icon={<ReloadOutlined />} onClick={reload}>刷新</Button>
        </Space>
      </Space>

      <Card>
        <Table
          rowKey="id"
          loading={loading}
          dataSource={flows}
          size="middle"
          pagination={false}
          columns={[
            { title: 'ID', dataIndex: 'id' },
            { title: '名称', dataIndex: 'name' },
            { title: '版本', dataIndex: 'version', render: (v) => `v${v}` },
            {
              title: '参数',
              dataIndex: 'params',
              render: (p: Record<string, string>) =>
                Object.keys(p ?? {}).length
                  ? Object.entries(p).map(([k, v]) => (
                      <Tag key={k}>{k}={String(v) || '∅'}</Tag>
                    ))
                  : '-',
            },
            {
              title: '最近运行',
              render: (_, r) =>
                r.running ? STATUS_TAG.running : r.last_run ? (
                  <Space size={4}>
                    {STATUS_TAG[r.last_run.status] ?? r.last_run.status}
                    <span style={{ color: '#999', fontSize: 12 }}>{r.last_run.timestamp}</span>
                  </Space>
                ) : '-',
            },
            {
              title: '操作',
              render: (_, r) => (
                <Space>
                  <Button
                    size="small" type="primary" icon={<CaretRightOutlined />}
                    disabled={r.running}
                    onClick={() => {
                      runForm.setFieldsValue(r.params ?? {})
                      setRunFlow(r)
                    }}
                  >
                    运行
                  </Button>
                  <Button size="small" icon={<EditOutlined />} onClick={() => openEditor(r.id)}>
                    编辑
                  </Button>
                  <Button size="small" icon={<HistoryOutlined />} onClick={() => openHistory(r)}>
                    历史
                  </Button>
                </Space>
              ),
            },
          ]}
        />
      </Card>

      {/* JSON 编辑抽屉 */}
      <Drawer
        title={`编辑流程: ${editing?.id ?? ''}`}
        open={!!editing}
        width="60%"
        onClose={() => setEditing(null)}
        extra={
          <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={save}>
            校验并保存
          </Button>
        }
      >
        {saveError && (
          <Alert type="error" showIcon style={{ marginBottom: 12 }}
            message="校验失败，未写入" description={saveError} />
        )}
        <Input.TextArea
          value={editorText}
          onChange={(e) => setEditorText(e.target.value)}
          autoSize={{ minRows: 24, maxRows: 32 }}
          style={{ fontFamily: 'Menlo, Monaco, monospace', fontSize: 12 }}
        />
        <Space style={{ marginTop: 8 }}>
          <Button
            size="small"
            onClick={() => {
              try {
                setEditorText(JSON.stringify(JSON.parse(editorText), null, 2))
                setSaveError(null)
              } catch (e) {
                setSaveError(`JSON 语法错误: ${(e as Error).message}`)
              }
            }}
          >
            格式化
          </Button>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            保存前后端会再次执行引擎级校验；原文件自动备份至 data/backups/flows/（保留 5 份）
          </Typography.Text>
        </Space>

        {!!editing?.extracts.length && (
          <Collapse
            style={{ marginTop: 16 }}
            items={editing.extracts.map((ex) => ({
              key: ex.path,
              label: `提取脚本: ${ex.path}${ex.exists ? '' : '（不存在）'}`,
              children: (
                <Space direction="vertical" style={{ width: '100%' }}>
                  <Button size="small" icon={<EditOutlined />} onClick={() => openExtractEditor(ex.path)}>
                    {ex.exists ? '编辑' : '创建'}
                  </Button>
                  <pre style={{ maxHeight: 300, overflow: 'auto', fontSize: 12 }}>
                    {ex.content ?? '（文件不存在）'}
                  </pre>
                </Space>
              ),
            }))}
          />
        )}
      </Drawer>

      {/* 创建流程 */}
      <Modal
        title="创建流程"
        open={createOpen}
        okText="创建"
        confirmLoading={creating}
        onOk={createFlow}
        onCancel={() => setCreateOpen(false)}
      >
        <Form form={createForm} layout="vertical">
          <Form.Item
            name="id"
            label="flow_id"
            rules={[
              { required: true, message: '请输入 flow_id' },
              { pattern: /^[A-Za-z0-9_-]+$/, message: '仅支持字母、数字、下划线和连字符' },
            ]}
          >
            <Input placeholder="orders_overview" />
          </Form.Item>
          <Form.Item name="name" label="中文名">
            <Input placeholder="订单概览" />
          </Form.Item>
        </Form>
      </Modal>

      {/* extract 编辑 */}
      <Modal
        title={`编辑 extract: ${extractEditor?.name ?? ''}`}
        open={!!extractEditor}
        okText="保存"
        width={720}
        confirmLoading={extractSaving}
        onOk={saveExtract}
        onCancel={() => setExtractEditor(null)}
      >
        {extractError && (
          <Alert type="error" showIcon style={{ marginBottom: 12 }}
            message="保存失败" description={extractError} />
        )}
        <Input.TextArea
          value={extractEditor?.content ?? ''}
          onChange={(e) => setExtractEditor((current) =>
            current ? { ...current, content: e.target.value } : current)}
          autoSize={{ minRows: 16, maxRows: 28 }}
          style={{ fontFamily: 'Menlo, Monaco, monospace', fontSize: 12 }}
        />
      </Modal>

      {/* 运行参数对话框（按 params 声明自动生成表单） */}
      <Modal
        title={`运行流程: ${runFlow?.name ?? ''}`}
        open={!!runFlow}
        onCancel={() => setRunFlow(null)}
        onOk={() => runForm.validateFields().then((vals) => startRun(runFlow!, vals))}
        okText="开始运行"
      >
        {runFlow && Object.keys(runFlow.params ?? {}).length === 0 && (
          <Typography.Text type="secondary">该流程无参数，直接运行。</Typography.Text>
        )}
        <Form form={runForm} layout="vertical">
          {Object.entries(runFlow?.params ?? {}).map(([key, defVal]) => (
            <Form.Item key={key} name={key} label={key} initialValue={defVal}>
              <Input placeholder={String(defVal) || `请输入 ${key}`} />
            </Form.Item>
          ))}
        </Form>
      </Modal>

      {/* 运行状态跟踪 */}
      <Modal
        title={`运行状态: ${tracking?.flow_id ?? ''}`}
        open={!!tracking}
        footer={
          <Button
            onClick={() => {
              if (pollTimer.current) clearInterval(pollTimer.current)
              pollTimer.current = null
              setTracking(null)
            }}
          >
            关闭
          </Button>
        }
        onCancel={() => {
          if (pollTimer.current) clearInterval(pollTimer.current)
          pollTimer.current = null
          setTracking(null)
        }}
        width={720}
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          <div>
            状态: {STATUS_TAG[tracking?.status ?? ''] ?? tracking?.status}
            {tracking?.duration_ms != null && ` （${tracking.duration_ms}ms）`}
          </div>
          {tracking?.error && <Alert type="error" message={tracking.error} />}
          {tracking?.output && (
            <pre style={{ maxHeight: 360, overflow: 'auto', background: '#1e1e1e',
                          color: '#d4d4d4', padding: 12, fontSize: 12 }}>
              {tracking.output}
            </pre>
          )}
          {tracking?.run_id && tracking.status !== 'running' && (
            <Button size="small" icon={<HistoryOutlined />} onClick={() => setDetailRunId(tracking.run_id!)}>
              查看详情
            </Button>
          )}
          {tracking?.heal_summary && (
            <Typography.Text type="secondary">
              自愈状态：{String(tracking.heal_summary.status ?? '-')}
            </Typography.Text>
          )}
          {tracking?.status === 'running' && (
            <Typography.Text type="secondary">
              运行中…（每 2 秒刷新；完成后可查看执行详情和自愈状态）
            </Typography.Text>
          )}
        </Space>
      </Modal>

      <Drawer
        title={`运行历史: ${historyFlow?.name ?? ''}`}
        open={!!historyFlow}
        width={860}
        onClose={() => setHistoryFlow(null)}
      >
        <Table<FlowRunHistoryItem>
          rowKey="run_id"
          loading={historyLoading}
          dataSource={historyRuns}
          pagination={{ pageSize: 10 }}
          size="small"
          columns={[
            { title: '时间', render: (_, r) => r.started_at ?? r.timestamp ?? '-' },
            { title: '来源', dataIndex: 'source' },
            { title: '状态', dataIndex: 'status', render: (v) => STATUS_TAG[v] ?? v },
            {
              title: '耗时',
              dataIndex: 'duration_ms',
              render: (v) => (v != null ? `${v}ms` : '-'),
            },
            {
              title: '错误',
              dataIndex: 'error',
              render: (v) => v ? <Typography.Text style={{ wordBreak: 'break-word' }}>{v}</Typography.Text> : '-',
            },
            {
              title: '自愈',
              render: (_, r) => r.heal_summary?.status ?? '-',
            },
            {
              title: '操作',
              render: (_, r) => (
                <Button size="small" onClick={() => setDetailRunId(r.run_id)}>
                  详情
                </Button>
              ),
            },
          ]}
        />
      </Drawer>

      <RunDetailDrawer
        open={!!detailRunId}
        runId={detailRunId}
        onClose={() => setDetailRunId(null)}
      />
    </div>
  )
}

function extractUrl(name: string) {
  return `/api/extracts/${name.split('/').map(encodeURIComponent).join('/')}`
}

function defaultExtractContent() {
  return [
    '(() => {',
    '  const data = {};',
    '  return JSON.stringify(data);',
    '})();',
    '',
  ].join('\n')
}
