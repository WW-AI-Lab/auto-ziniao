// REST API 客户端：统一错误处理（后端错误结构 {"error": {code, message}}）

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

export interface FlowSummary {
  id: string
  name: string
  version: number
  enabled: boolean
  schedule: string
  description: string
  params: Record<string, string>
  file: string
  error?: string
  running: boolean
  last_run: { timestamp: string; status: string; duration_ms: number } | null
}

export interface FlowDetail {
  id: string
  content: string
  extracts: { path: string; exists: boolean; content: string | null }[]
  last_run: Record<string, unknown> | null
  running: boolean
}

export interface RunEntry {
  flow_id: string
  timestamp: string
  status: string
  duration_ms: number
  error: string | null
  params?: Record<string, string>
  data_summary?: Record<string, string>
}

export interface Schedule {
  id: string
  name: string
  flow_id: string
  params: Record<string, string>
  trigger: { type: string; minutes?: number; time?: string; expr?: string }
  enabled: boolean
  next_run_at: string | null
  created_at: string
  updated_at: string
  latest_run: ScheduleRun | null
}

export interface ScheduleRun {
  id: number
  schedule_id: string
  fired_at: string
  status: string
  exit_code: number | null
  duration_ms: number | null
  error: string | null
}

export interface ChatSession {
  id: string
  title: string
  agent: string
  created_at: string
  updated_at: string
  busy?: boolean
}

export interface ChatToolCall {
  name: string
}

/** 推理与工具调用附加信息（随 assistant 消息落库） */
export interface ChatExtras {
  reasoning?: string
  tools?: ChatToolCall[]
}

export interface ChatMessage {
  id: number
  session_id: string
  role: 'user' | 'assistant'
  content: string
  status: 'pending' | 'done' | 'failed'
  error: string | null
  extras?: ChatExtras | null
  created_at: string
}

export interface Stats {
  runs_total: number
  runs_success: number
  runs_failed: number
  runs_error: number
  heals_total: number
  flows: {
    flow_id: string
    total: number
    success: number
    success_rate: number
    last_run: string | null
    last_status: string | null
    heal_count: number
  }[]
  schedules: { total: number; enabled: number }
  chat_sessions: number
}

export interface ManualRun {
  token: string
  flow_id: string
  status: string
  started_at?: string
  finished_at?: string | null
  duration_ms?: number | null
  output?: string
  error?: string | null
}

// ---------------------------------------------------------------------
// SSE：发送 chat 消息并消费事件流
// ---------------------------------------------------------------------

export type ChatEvent =
  | { type: 'start'; message_id: number }
  | { type: 'delta'; text: string }
  | { type: 'reasoning_delta'; text: string }
  | { type: 'tool_call'; name: string }
  | { type: 'done'; content: string }
  | { type: 'error'; message: string }

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
