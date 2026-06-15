// REST API 客户端：统一错误处理（后端错误结构 {"error": {code, message}}）

import type {
  ChatAgentInfo,
  ChatA2UIBlock,
  ChatMessage,
  ChatSession,
  ChatToolCall,
  CreateFlowRequest,
  CreateFlowResponse,
  ExtractDetail,
  FlowRunDetail,
  FlowRunHistoryItem,
  FlowDetail,
  FlowSummary,
  FlowTemplateResponse,
  HealDetail,
  HealEntry,
  HealSummary,
  ManualRunStatus,
  OutputDirectory,
  OutputPreview,
  OutputRef,
  RunEntry as SharedRunEntry,
  SaveExtractRequest,
  Schedule,
  ScheduleRun,
  WebAdminStats,
} from '@ww-ai-lab/auto-ziniao-schemas/webadmin'

export class ApiError extends Error {
  code: string
  status: number
  constructor(status: number, code: string, message: string) {
    super(message)
    this.code = code
    this.status = status
  }
}

async function handle<T>(resp: Response): Promise<T> {
  if (resp.ok) return resp.json() as Promise<T>
  let message = `HTTP ${resp.status}`
  let code = 'http_error'
  try {
    const body = await resp.json()
    if (body?.error) {
      message = body.error.message
      code = body.error.code
    }
  } catch {
    /* 非 JSON 响应 */
  }
  throw new ApiError(resp.status, code, message)
}

export function get<T>(url: string): Promise<T> {
  return fetch(url).then((r) => handle<T>(r))
}

export function post<T>(url: string, body?: unknown): Promise<T> {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).then((r) => handle<T>(r))
}

export function put<T>(url: string, body: unknown): Promise<T> {
  return fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then((r) => handle<T>(r))
}

export function del<T>(url: string): Promise<T> {
  return fetch(url, { method: 'DELETE' }).then((r) => handle<T>(r))
}

// ---------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------

export type {
  ChatMessage,
  ChatSession,
  ChatA2UIBlock,
  ChatToolCall,
  CreateFlowRequest,
  CreateFlowResponse,
  ExtractDetail,
  FlowRunDetail,
  FlowRunHistoryItem,
  FlowDetail,
  FlowSummary,
  FlowTemplateResponse,
  HealDetail,
  HealEntry,
  HealSummary,
  OutputRef,
  SaveExtractRequest,
  Schedule,
  ScheduleRun,
}

export type AgentInfo = ChatAgentInfo
export type ManualRun = ManualRunStatus
export type OutputList = OutputDirectory
export type Preview = OutputPreview
export type RunEntry = SharedRunEntry
export type Stats = WebAdminStats

// ---------------------------------------------------------------------
// SSE：发送 chat 消息并消费事件流
// ---------------------------------------------------------------------

export type ChatEvent =
  | { type: 'accepted'; message_id?: number }
  | { type: 'start'; message_id: number }
  | { type: 'delta'; text: string }
  | { type: 'reasoning_delta'; text: string }
  | ({ type: 'tool_call' } & ChatToolCall)
  | { type: 'a2ui'; block: ChatA2UIBlock }
  | { type: 'done'; content: string }
  | { type: 'error'; message: string }
  | { type: 'heartbeat' }

export async function sendChatMessage(
  sessionId: string,
  content: string,
  onEvent: (evt: ChatEvent) => void,
): Promise<void> {
  const resp = await fetch(`/api/chat/sessions/${sessionId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  })
  if (!resp.ok) {
    await handle(resp) // 抛出 ApiError
    return
  }
  const reader = resp.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const parts = buffer.split('\n\n')
    buffer = parts.pop() ?? ''
    for (const part of parts) {
      const line = part.trim()
      if (!line.startsWith('data:')) continue // 心跳注释行跳过
      try {
        onEvent(JSON.parse(line.slice(5).trim()) as ChatEvent)
      } catch {
        /* 忽略坏帧 */
      }
    }
  }
}
