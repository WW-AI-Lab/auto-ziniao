import { useCallback, useEffect, useRef, useState } from 'react'
import {
  App, Avatar, Button, Collapse, Empty, Select, Space, Spin, Tag, Typography,
} from 'antd'
import {
  PlusOutlined, RobotOutlined, ToolOutlined, UserOutlined,
} from '@ant-design/icons'
import { Bubble, Conversations, Sender } from '@ant-design/x'
import {
  del, get, post, put, sendChatMessage,
  type ChatMessage, type ChatSession, type ChatToolCall,
} from '../api'

interface AgentInfo {
  name: string
  timeout_sec: number
}

/** 流式接收中的累积状态（done=SSE 已结束，等打字机动画收尾） */
interface StreamState {
  text: string
  reasoning: string
  tools: ChatToolCall[]
  done: boolean
  failed: boolean
}

/** 推理（折叠面板）+ 工具调用标签，渲染在气泡 header 槽位 */
function ExtrasBlock({ reasoning, tools, thinking, failed }: {
  reasoning?: string
  tools?: ChatToolCall[]
  thinking?: boolean
  failed?: boolean
}) {
  const hasTools = !!tools?.length
  if (!reasoning && !hasTools && !failed) return null
  return (
    <div style={{ maxWidth: 640 }}>
      {failed && (
        <Typography.Text type="danger" style={{ fontSize: 12 }}>执行失败</Typography.Text>
      )}
      {reasoning && (
        <Collapse
          ghost
          size="small"
          defaultActiveKey={thinking ? ['r'] : []}
          style={{ background: '#fafafa', borderRadius: 8, marginBottom: 4 }}
          items={[{
            key: 'r',
            label: (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {thinking ? '思考中…' : '思考过程'}
              </Typography.Text>
            ),
            children: (
              <div style={{
                whiteSpace: 'pre-wrap', fontSize: 12, color: '#8c8c8c',
                maxHeight: 220, overflow: 'auto',
              }}>
                {reasoning}
              </div>
            ),
          }]}
        />
      )}
      {hasTools && (
        <Space wrap size={4} style={{ marginBottom: 4 }}>
          {tools!.map((t, i) => (
            <Tag key={i} icon={<ToolOutlined />} color="blue" style={{ margin: 0 }}>
              {t.name}
            </Tag>
          ))}
        </Space>
      )}
    </div>
  )
}

export default function Chat() {
  const { message, modal } = App.useApp()
  const [agents, setAgents] = useState<AgentInfo[]>([])
  const [defaultAgent, setDefaultAgent] = useState('openclaw')
  const [sessions, setSessions] = useState<ChatSession[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [sending, setSending] = useState(false)
  const [senderValue, setSenderValue] = useState('')

  // 流式渲染中的 assistant 消息
  const [stream, setStream] = useState<StreamState | null>(null)
  const streamingIdRef = useRef<number | null>(null)
  // 打字机动画结束后的收尾动作（幂等：执行一次后清空）
  const finalizeRef = useRef<(() => void) | null>(null)

  const active = sessions.find((s) => s.id === activeId) ?? null

  const reloadSessions = useCallback(async (selectFirst = false) => {
    const d = await get<{ items: ChatSession[] }>('/api/chat/sessions')
    setSessions(d.items)
    if (selectFirst && d.items.length && !activeId) setActiveId(d.items[0].id)
    return d.items
  }, [activeId])

  useEffect(() => {
    get<{ items: AgentInfo[]; default: string }>('/api/chat/agents').then((d) => {
      setAgents(d.items)
      setDefaultAgent(d.default)
    })
    reloadSessions(true).catch((e) => message.error(e.message))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const loadMessages = useCallback(async (sid: string) => {
    setLoadingMessages(true)
    try {
      const d = await get<{ items: ChatMessage[]; busy: boolean }>(
        `/api/chat/sessions/${sid}/messages`)
      setMessages(d.items)
      setSending(d.busy)
    } finally {
      setLoadingMessages(false)
    }
  }, [])

  useEffect(() => {
    if (activeId) loadMessages(activeId).catch((e) => message.error(e.message))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId])

  const newSession = async () => {
    const s = await post<ChatSession>('/api/chat/sessions',
      { title: `会话 ${new Date().toLocaleTimeString('zh-CN')}`, agent: defaultAgent })
    await reloadSessions()
    setActiveId(s.id)
    setMessages([])
  }

  const send = async (text: string) => {
    if (!activeId || !text.trim()) return
    const sid = activeId
    setSending(true)
    // 本地先上屏 user 气泡与 pending 占位
    const tmpUserId = -Date.now()
    const tmpAsstId = tmpUserId - 1
    streamingIdRef.current = tmpAsstId
    const acc: StreamState = { text: '', reasoning: '', tools: [], done: false, failed: false }
    const pushStream = () => setStream({ ...acc, tools: [...acc.tools] })
    pushStream()
    setMessages((prev) => [
      ...prev,
      { id: tmpUserId, session_id: sid, role: 'user', content: text,
        status: 'done', error: null, created_at: '' },
      { id: tmpAsstId, session_id: sid, role: 'assistant', content: '',
        status: 'pending', error: null, created_at: '' },
    ])

    const finalize = () => {
      if (finalizeRef.current !== finalize) return // 已收尾过
      finalizeRef.current = null
      streamingIdRef.current = null
      setStream(null)
      setSending(false)
      // 以服务端落库结果为准刷新
      loadMessages(sid).catch(() => undefined)
      reloadSessions().catch(() => undefined)
    }
    finalizeRef.current = finalize

    try {
      await sendChatMessage(sid, text, (evt) => {
        if (evt.type === 'delta') acc.text += evt.text
        else if (evt.type === 'reasoning_delta') acc.reasoning += evt.text
        else if (evt.type === 'tool_call') acc.tools.push({ name: evt.name })
        else if (evt.type === 'error') {
          acc.failed = true
          setMessages((prev) => prev.map((m) =>
            m.id === tmpAsstId
              ? { ...m, status: 'failed', error: evt.message, content: acc.text }
              : m))
        }
        pushStream()
      })
      // SSE 结束：有正文则等待打字机动画完成（onTypingComplete 触发 finalize）
      acc.done = true
      pushStream()
      if (!acc.text || acc.failed) {
        finalize()
      } else {
        // 兜底：动画依赖 rAF，页面切后台会被暂停，超时后强制收尾（finalize 幂等）
        const graceMs = Math.min(acc.text.length * 25 + 5000, 60000)
        setTimeout(finalize, graceMs)
      }
    } catch (e) {
      message.error((e as Error).message)
      finalize()
    }
  }

  const changeAgent = async (agent: string) => {
    if (!activeId) return
    await put(`/api/chat/sessions/${activeId}`, { agent })
    reloadSessions()
  }

  const bubbleItems = messages.map((m) => {
    const isStreaming = streamingIdRef.current != null && m.id === streamingIdRef.current
    if (m.role === 'user') {
      return { key: m.id, role: 'user' as const, content: m.content }
    }
    if (isStreaming && stream) {
      // 流式气泡：打字机动画 + 实时推理/工具调用
      return {
        key: m.id,
        role: 'ai' as const,
        content: stream.failed && m.error
          ? `${stream.text ? stream.text + '\n\n' : ''}❌ ${m.error}`
          : stream.text,
        loading: !stream.text && !stream.reasoning && !stream.tools.length && !stream.failed,
        header: (
          <ExtrasBlock
            reasoning={stream.reasoning}
            tools={stream.tools}
            thinking={!stream.done && !stream.failed}
            failed={stream.failed}
          />
        ),
        typing: { effect: 'typing' as const, step: [2, 6] as [number, number], interval: 20 },
        streaming: !stream.done,
        onTypingComplete: () => finalizeRef.current?.(),
      }
    }
    const failed = m.status === 'failed'
    return {
      key: m.id,
      role: 'ai' as const,
      content: failed
        ? `${m.content ? m.content + '\n\n' : ''}❌ ${m.error ?? '发送失败'}`
        : m.content,
      header: (
        <ExtrasBlock
          reasoning={m.extras?.reasoning}
          tools={m.extras?.tools}
          failed={failed}
        />
      ),
    }
  })

  return (
    <div style={{ display: 'flex', height: '100%' }}>
      {/* 左栏：会话列表 */}
      <div style={{ width: 260, borderRight: '1px solid #f0f0f0', background: '#fff',
                    display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: 12 }}>
          <Button block icon={<PlusOutlined />} type="primary" onClick={newSession}>
            新建会话
          </Button>
        </div>
        <Conversations
          style={{ flex: 1, overflow: 'auto' }}
          items={sessions.map((s) => ({
            key: s.id,
            label: `${s.title}（${s.agent}）`,
          }))}
          activeKey={activeId ?? undefined}
          onActiveChange={(key) => setActiveId(String(key))}
          menu={(item) => ({
            items: [{ key: 'delete', label: '删除会话', danger: true }],
            onClick: ({ key }) => {
              if (key !== 'delete') return
              modal.confirm({
                title: '删除该会话及全部历史消息？',
                onOk: async () => {
                  try {
                    await del(`/api/chat/sessions/${item.key}`)
                    if (activeId === item.key) {
                      setActiveId(null)
                      setMessages([])
                    }
                    reloadSessions()
                  } catch (e) {
                    message.error((e as Error).message)
                  }
                },
              })
            },
          })}
        />
      </div>

      {/* 右栏：消息流 + 输入 */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0,
                    background: '#fff' }}>
        <div style={{ padding: '10px 16px', borderBottom: '1px solid #f0f0f0' }}>
          <Space>
            <Typography.Text strong>{active?.title ?? 'Agent 对话'}</Typography.Text>
            <Select
              size="small"
              style={{ width: 160 }}
              value={active?.agent ?? defaultAgent}
              disabled={!active || sending}
              onChange={changeAgent}
              options={agents.map((a) => ({ value: a.name, label: a.name }))}
            />
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              agent 清单来自 config.json
            </Typography.Text>
          </Space>
        </div>

        <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
          {!active ? (
            <Empty description="新建或选择一个会话开始对话" style={{ marginTop: 80 }} />
          ) : loadingMessages ? (
            <div style={{ textAlign: 'center', marginTop: 80 }}><Spin /></div>
          ) : (
            <Bubble.List
              autoScroll
              items={bubbleItems}
              role={{
                user: {
                  placement: 'end',
                  avatar: <Avatar icon={<UserOutlined />} style={{ background: '#1677ff' }} />,
                },
                ai: {
                  placement: 'start',
                  avatar: <Avatar icon={<RobotOutlined />} style={{ background: '#87d068' }} />,
                },
              }}
            />
          )}
        </div>

        <div style={{ padding: 16, borderTop: '1px solid #f0f0f0' }}>
          <Sender
            value={senderValue}
            onChange={(v) => setSenderValue(v)}
            loading={sending}
            disabled={!active}
            placeholder={active ? '输入消息，Enter 发送' : '请先选择会话'}
            onSubmit={(text) => {
              setSenderValue('')
              send(text)
              return true
            }}
          />
        </div>
      </div>
    </div>
  )
}
