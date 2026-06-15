import { useEffect, useState, type ReactNode } from 'react'
import { Alert, Descriptions, Drawer, Space, Table, Tag, Typography } from 'antd'

import { get, type FlowRunDetail, type HealSummary, type OutputRef } from '../api'

const STATUS_TAG: Record<string, ReactNode> = {
  success: <Tag color="green">成功</Tag>,
  failed: <Tag color="red">失败</Tag>,
  error: <Tag color="volcano">异常</Tag>,
  running: <Tag color="blue">运行中</Tag>,
  timeout: <Tag color="orange">超时</Tag>,
  skipped: <Tag>跳过</Tag>,
}

const HEAL_TAG: Record<string, ReactNode> = {
  not_triggered: <Tag>未触发</Tag>,
  triggered: <Tag color="blue">已触发</Tag>,
  skipped: <Tag color="gold">已跳过</Tag>,
  success: <Tag color="green">已触发</Tag>,
  failed: <Tag color="red">触发失败</Tag>,
  timeout: <Tag color="orange">超时</Tag>,
  dry_run: <Tag color="purple">dry-run</Tag>,
  disabled: <Tag>已禁用</Tag>,
}

export default function RunDetailDrawer({
  runId,
  open,
  onClose,
}: {
  runId: string | null
  open: boolean
  onClose: () => void
}) {
  const [detail, setDetail] = useState<FlowRunDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !runId) return
    setLoading(true)
    setError(null)
    get<FlowRunDetail>(`/api/runs/${encodeURIComponent(runId)}`)
      .then(setDetail)
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false))
  }, [open, runId])

  const heal = detail?.heal_summary as HealSummary | null | undefined
  const hasAgentDiagnostics = Boolean(
    heal &&
    (heal.cli_exit_code !== undefined ||
      heal.cli_stderr ||
      heal.timed_out !== undefined ||
      heal.command_missing !== undefined)
  )
  return (
    <Drawer
      title={`运行详情: ${detail?.flow_id ?? runId ?? ''}`}
      open={open}
      width={760}
      onClose={onClose}
      loading={loading}
    >
      {error && <Alert type="error" showIcon message="加载失败" description={error} style={{ marginBottom: 12 }} />}
      {detail && (
        <Space orientation="vertical" style={{ width: '100%' }} size="middle">
          <Descriptions bordered size="small" column={1}>
            <Descriptions.Item label="状态">{STATUS_TAG[detail.status] ?? detail.status}</Descriptions.Item>
            <Descriptions.Item label="来源">{detail.source}</Descriptions.Item>
            <Descriptions.Item label="时间">{detail.started_at ?? detail.timestamp ?? '-'}</Descriptions.Item>
            <Descriptions.Item label="耗时">
              {detail.duration_ms != null ? `${detail.duration_ms}ms` : '-'}
            </Descriptions.Item>
            <Descriptions.Item label="参数">
              <WrappedJson value={detail.params} />
            </Descriptions.Item>
          </Descriptions>

          {detail.error && <Alert type="error" showIcon message="失败原因" description={detail.error} />}

          {detail.failed_step && (
            <Descriptions bordered size="small" column={1} title="失败步骤">
              <Descriptions.Item label="step_id">{detail.failed_step.step_id ?? '-'}</Descriptions.Item>
              <Descriptions.Item label="tool/action">
                {detail.failed_step.tool ?? detail.failed_step.action ?? '-'}
              </Descriptions.Item>
              <Descriptions.Item label="args">
                <WrappedJson value={detail.failed_step.args} />
              </Descriptions.Item>
              <Descriptions.Item label="error">{detail.failed_step.error ?? '-'}</Descriptions.Item>
            </Descriptions>
          )}

          <Descriptions bordered size="small" column={1} title="自愈">
            <Descriptions.Item label="状态">
              {heal?.status ? HEAL_TAG[heal.status] ?? heal.status : '-'}
            </Descriptions.Item>
            <Descriptions.Item label="heal_id">{heal?.heal_id ?? '-'}</Descriptions.Item>
            <Descriptions.Item label="error_type">{heal?.error_type ?? '-'}</Descriptions.Item>
            <Descriptions.Item label="agent">{heal?.agent ?? '-'}</Descriptions.Item>
            <Descriptions.Item label="reason/error">{heal?.reason ?? heal?.error ?? '-'}</Descriptions.Item>
            {hasAgentDiagnostics && (
              <>
                {heal?.cli_exit_code !== undefined && (
                  <Descriptions.Item label="cli_exit_code">{heal.cli_exit_code}</Descriptions.Item>
                )}
                {heal?.cli_stderr && (
                  <Descriptions.Item label="cli_stderr">
                    <Typography.Text style={{ wordBreak: 'break-word' }}>{heal.cli_stderr}</Typography.Text>
                  </Descriptions.Item>
                )}
                {heal?.timed_out !== undefined && (
                  <Descriptions.Item label="timed_out">{String(heal.timed_out)}</Descriptions.Item>
                )}
                {heal?.command_missing !== undefined && (
                  <Descriptions.Item label="command_missing">{String(heal.command_missing)}</Descriptions.Item>
                )}
              </>
            )}
            <Descriptions.Item label="context">{heal?.heal_log_path ?? '-'}</Descriptions.Item>
            <Descriptions.Item label="prompt">{heal?.prompt_path ?? '-'}</Descriptions.Item>
          </Descriptions>

          {!!detail.output_refs?.length && (
            <Table<OutputRef>
              rowKey={(r) => r.path}
              size="small"
              pagination={false}
              dataSource={detail.output_refs}
              columns={[
                { title: '输出', dataIndex: 'name' },
                {
                  title: '路径',
                  dataIndex: 'path',
                  render: (v) => <Typography.Text style={{ wordBreak: 'break-all' }}>{v}</Typography.Text>,
                },
                { title: '可用', dataIndex: 'available', render: (v) => (v ? <Tag color="green">可用</Tag> : <Tag>不可用</Tag>) },
              ]}
            />
          )}

          <Descriptions bordered size="small" column={1} title="结果摘要">
            <Descriptions.Item label="data_summary">
              <WrappedJson value={detail.data_summary} />
            </Descriptions.Item>
          </Descriptions>
        </Space>
      )}
    </Drawer>
  )
}

function WrappedJson({ value }: { value: unknown }) {
  return (
    <pre style={{
      margin: 0,
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-word',
      maxHeight: 220,
      overflow: 'auto',
      fontSize: 12,
    }}>
      {JSON.stringify(value ?? {}, null, 2)}
    </pre>
  )
}
