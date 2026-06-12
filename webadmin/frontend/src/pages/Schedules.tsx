import { useCallback, useEffect, useState, type ReactNode } from 'react'
import {
  App, Button, Card, Form, Input, InputNumber, Modal, Popconfirm, Radio,
  Select, Space, Switch, Table, Tag, TimePicker, Typography,
} from 'antd'
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import {
  del, get, post, put, type FlowSummary, type Schedule, type ScheduleRun,
} from '../api'

const RUN_TAG: Record<string, ReactNode> = {
  success: <Tag color="green">成功</Tag>,
  failed: <Tag color="red">失败</Tag>,
  timeout: <Tag color="orange">超时</Tag>,
  skipped: <Tag>跳过</Tag>,
}

interface FormValues {
  name: string
  flow_id: string
  trigger_type: 'interval' | 'daily' | 'cron'
  minutes?: number
  time?: Dayjs
  expr?: string
  params_text?: string
}

function triggerLabel(t: Schedule['trigger']): string {
  if (t.type === 'interval') return `每 ${t.minutes} 分钟`
  if (t.type === 'daily') return `每日 ${t.time}`
  return `cron: ${t.expr}`
}

export default function Schedules() {
  const { message } = App.useApp()
  const [items, setItems] = useState<Schedule[]>([])
  const [flows, setFlows] = useState<FlowSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [editTarget, setEditTarget] = useState<Schedule | 'new' | null>(null)
  const [form] = Form.useForm<FormValues>()
  const [runsOf, setRunsOf] = useState<Record<string, ScheduleRun[]>>({})

  const reload = useCallback(() => {
    setLoading(true)
    Promise.all([
      get<{ items: Schedule[] }>('/api/schedules'),
      get<{ items: FlowSummary[] }>('/api/flows'),
    ])
      .then(([s, f]) => {
        setItems(s.items)
        setFlows(f.items)
      })
      .catch((e) => message.error(e.message))
      .finally(() => setLoading(false))
  }, [message])

  useEffect(() => {
    reload()
  }, [reload])

  const openEdit = (target: Schedule | 'new') => {
    setEditTarget(target)
    if (target === 'new') {
      form.resetFields()
      form.setFieldsValue({ trigger_type: 'daily', time: dayjs('08:30', 'HH:mm') })
    } else {
      form.setFieldsValue({
        name: target.name,
        flow_id: target.flow_id,
        trigger_type: target.trigger.type as FormValues['trigger_type'],
        minutes: target.trigger.minutes,
        time: target.trigger.time ? dayjs(target.trigger.time, 'HH:mm') : undefined,
        expr: target.trigger.expr,
        params_text: Object.entries(target.params ?? {})
          .map(([k, v]) => `${k}=${v}`).join('\n'),
      })
    }
  }

  const submit = async () => {
    const vals = await form.validateFields()
    const trigger =
      vals.trigger_type === 'interval'
        ? { type: 'interval', minutes: vals.minutes }
        : vals.trigger_type === 'daily'
          ? { type: 'daily', time: vals.time!.format('HH:mm') }
          : { type: 'cron', expr: (vals.expr ?? '').trim() }
    const params: Record<string, string> = {}
    for (const line of (vals.params_text ?? '').split('\n')) {
      const t = line.trim()
      if (!t) continue
      const idx = t.indexOf('=')
      if (idx <= 0) {
        message.error(`参数格式应为 key=value: ${t}`)
        return
      }
      params[t.slice(0, idx).trim()] = t.slice(idx + 1).trim()
    }
    const body = { name: vals.name, flow_id: vals.flow_id, trigger, params }
    try {
      if (editTarget === 'new') {
        await post('/api/schedules', body)
        message.success('任务已创建')
      } else if (editTarget) {
        await put(`/api/schedules/${editTarget.id}`, body)
        message.success('任务已更新')
      }
      setEditTarget(null)
      reload()
    } catch (e) {
      message.error((e as Error).message)
    }
  }

  const toggle = async (sched: Schedule, enabled: boolean) => {
    try {
      await put(`/api/schedules/${sched.id}`, { enabled })
      reload()
    } catch (e) {
      message.error((e as Error).message)
    }
  }

  const loadRuns = async (sid: string) => {
    const d = await get<{ items: ScheduleRun[] }>(`/api/schedules/${sid}/runs?limit=20`)
    setRunsOf((prev) => ({ ...prev, [sid]: d.items }))
  }

  return (
    <div style={{ padding: 24 }}>
      <Space style={{ marginBottom: 16 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>计划任务</Typography.Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => openEdit('new')}>
          新建任务
        </Button>
        <Button icon={<ReloadOutlined />} onClick={reload}>刷新</Button>
      </Space>

      <Card>
        <Table
          rowKey="id"
          loading={loading}
          dataSource={items}
          pagination={false}
          expandable={{
            onExpand: (expanded, record) => expanded && loadRuns(record.id),
            expandedRowRender: (record) => (
              <Table
                rowKey="id"
                size="small"
                dataSource={runsOf[record.id] ?? []}
                pagination={false}
                columns={[
                  { title: '触发时间', dataIndex: 'fired_at' },
                  { title: '状态', dataIndex: 'status', render: (v) => RUN_TAG[v] ?? v },
                  {
                    title: '耗时', dataIndex: 'duration_ms',
                    render: (v) => (v != null ? `${v}ms` : '-'),
                  },
                  { title: '错误', dataIndex: 'error', render: (v) => v ?? '-' },
                ]}
              />
            ),
          }}
          columns={[
            { title: '名称', dataIndex: 'name' },
            { title: '流程', dataIndex: 'flow_id' },
            { title: '触发方式', render: (_, r) => triggerLabel(r.trigger) },
            { title: '下次运行', dataIndex: 'next_run_at', render: (v, r) => (r.enabled ? v : '-') },
            {
              title: '最近结果',
              render: (_, r) =>
                r.latest_run ? (
                  <Space size={4}>
                    {RUN_TAG[r.latest_run.status] ?? r.latest_run.status}
                    <span style={{ color: '#999', fontSize: 12 }}>{r.latest_run.fired_at}</span>
                  </Space>
                ) : '-',
            },
            {
              title: '启用',
              render: (_, r) => (
                <Switch checked={r.enabled} size="small" onChange={(v) => toggle(r, v)} />
              ),
            },
            {
              title: '操作',
              render: (_, r) => (
                <Space>
                  <Button size="small" onClick={() => openEdit(r)}>编辑</Button>
                  <Popconfirm title="确认删除该任务？" onConfirm={async () => {
                    await del(`/api/schedules/${r.id}`)
                    message.success('已删除')
                    reload()
                  }}>
                    <Button size="small" danger>删除</Button>
                  </Popconfirm>
                </Space>
              ),
            },
          ]}
        />
      </Card>

      <Modal
        title={editTarget === 'new' ? '新建计划任务' : '编辑计划任务'}
        open={!!editTarget}
        onCancel={() => setEditTarget(null)}
        onOk={submit}
        okText="保存"
        destroyOnHidden
      >
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="任务名称" rules={[{ required: true, message: '请输入名称' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="flow_id" label="目标流程" rules={[{ required: true, message: '请选择流程' }]}>
            <Select
              options={flows.map((f) => ({ value: f.id, label: `${f.name}（${f.id}）` }))}
            />
          </Form.Item>
          <Form.Item name="trigger_type" label="触发方式" rules={[{ required: true }]}>
            <Radio.Group
              options={[
                { value: 'interval', label: '固定间隔' },
                { value: 'daily', label: '每日定时' },
                { value: 'cron', label: 'cron 表达式' },
              ]}
            />
          </Form.Item>
          <Form.Item noStyle shouldUpdate={(p, c) => p.trigger_type !== c.trigger_type}>
            {({ getFieldValue }) => {
              const t = getFieldValue('trigger_type')
              if (t === 'interval') {
                return (
                  <Form.Item name="minutes" label="间隔（分钟）"
                    rules={[{ required: true, message: '请输入间隔分钟数' }]}>
                    <InputNumber min={1} style={{ width: 160 }} />
                  </Form.Item>
                )
              }
              if (t === 'daily') {
                return (
                  <Form.Item name="time" label="每日时间"
                    rules={[{ required: true, message: '请选择时间' }]}>
                    <TimePicker format="HH:mm" />
                  </Form.Item>
                )
              }
              return (
                <Form.Item name="expr" label="cron 表达式（分 时 日 月 周）"
                  rules={[{ required: true, message: '请输入 cron 表达式' }]}
                  extra="支持语法子集：* 、*/n 、a-b 、a,b（数字形式）。例：0 8 * * 1-5 = 工作日每天 08:00">
                  <Input placeholder="0 8 * * *" />
                </Form.Item>
              )
            }}
          </Form.Item>
          <Form.Item name="params_text" label="流程参数（每行一个 key=value，可空）">
            <Input.TextArea rows={3} placeholder={'store_name=某店铺'} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
