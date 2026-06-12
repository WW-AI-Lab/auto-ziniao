import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import {
  Alert, App, Button, Card, Collapse, Drawer, Form, Input, Modal, Space,
  Table, Tag, Typography,
} from 'antd'
import {
  CaretRightOutlined, EditOutlined, ReloadOutlined, SaveOutlined,
} from '@ant-design/icons'
import {
  get, post, put, type FlowDetail, type FlowSummary, type ManualRun,
} from '../api'

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

  // 编辑抽屉
  const [editing, setEditing] = useState<FlowDetail | null>(null)
  const [editorText, setEditorText] = useState('')
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // 运行对话框
  const [runFlow, setRunFlow] = useState<FlowSummary | null>(null)
  const [runForm] = Form.useForm()

  // 运行状态跟踪
  const [tracking, setTracking] = useState<ManualRun | null>(null)
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null)

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

  return (
    <div style={{ padding: 24 }}>
      <Space style={{ marginBottom: 16, justifyContent: 'space-between', width: '100%' }}>
        <Typography.Title level={4} style={{ margin: 0 }}>流程管理</Typography.Title>
        <Button icon={<ReloadOutlined />} onClick={reload}>刷新</Button>
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
            保存前后端会再次执行引擎级校验；原文件自动备份至 flows/.backup/（保留 5 份）
          </Typography.Text>
        </Space>

        {!!editing?.extracts.length && (
          <Collapse
            style={{ marginTop: 16 }}
            items={editing.extracts.map((ex) => ({
              key: ex.path,
              label: `提取脚本（只读）: ${ex.path}${ex.exists ? '' : '（不存在）'}`,
              children: (
                <pre style={{ maxHeight: 300, overflow: 'auto', fontSize: 12 }}>
                  {ex.content ?? '（文件不存在）'}
                </pre>
              ),
            }))}
          />
        )}
      </Drawer>

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
          {tracking?.status === 'running' && (
            <Typography.Text type="secondary">
              运行中…（每 2 秒刷新；失败时引擎将按既有机制自动触发自愈）
            </Typography.Text>
          )}
        </Space>
      </Modal>
    </div>
  )
}
