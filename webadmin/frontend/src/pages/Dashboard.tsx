import { useEffect, useState, type ReactNode } from 'react'
import { Card, Col, Row, Statistic, Table, Tag, Typography, Spin } from 'antd'
import { get, type Stats } from '../api'

const STATUS_TAG: Record<string, ReactNode> = {
  success: <Tag color="green">成功</Tag>,
  failed: <Tag color="red">失败</Tag>,
  error: <Tag color="volcano">异常</Tag>,
}

export default function Dashboard() {
  const [stats, setStats] = useState<Stats | null>(null)

  useEffect(() => {
    get<Stats>('/api/stats').then(setStats).catch(() => setStats(null))
  }, [])

  if (!stats) {
    return (
      <div style={{ padding: 48, textAlign: 'center' }}>
        <Spin />
      </div>
    )
  }

  const rate = stats.runs_total
    ? Math.round((stats.runs_success / stats.runs_total) * 100)
    : 0

  return (
    <div style={{ padding: 24 }}>
      <Typography.Title level={4} style={{ marginTop: 0 }}>
        概览
      </Typography.Title>
      <Row gutter={16}>
        <Col span={4}>
          <Card>
            <Statistic title="总运行次数" value={stats.runs_total} />
          </Card>
        </Col>
        <Col span={4}>
          <Card>
            <Statistic title="总成功率" value={rate} suffix="%" />
          </Card>
        </Col>
        <Col span={4}>
          <Card>
            <Statistic title="失败 / 异常" value={stats.runs_failed + stats.runs_error} />
          </Card>
        </Col>
        <Col span={4}>
          <Card>
            <Statistic title="自愈事件" value={stats.heals_total} />
          </Card>
        </Col>
        <Col span={4}>
          <Card>
            <Statistic
              title="计划任务（启用/总数）"
              value={`${stats.schedules.enabled}/${stats.schedules.total}`}
            />
          </Card>
        </Col>
        <Col span={4}>
          <Card>
            <Statistic title="对话会话" value={stats.chat_sessions} />
          </Card>
        </Col>
      </Row>

      <Card title="各流程运行情况" style={{ marginTop: 16 }}>
        <Table
          rowKey="flow_id"
          dataSource={stats.flows}
          pagination={false}
          size="small"
          columns={[
            { title: '流程', dataIndex: 'flow_id' },
            {
              title: '成功率',
              dataIndex: 'success_rate',
              render: (v: number, r) => `${v}%（${r.success}/${r.total}）`,
            },
            { title: '最近运行', dataIndex: 'last_run', render: (v) => v ?? '-' },
            {
              title: '最近状态',
              dataIndex: 'last_status',
              render: (v: string | null) => (v ? STATUS_TAG[v] ?? v : '-'),
            },
            { title: '自愈次数', dataIndex: 'heal_count' },
          ]}
        />
      </Card>
    </div>
  )
}
