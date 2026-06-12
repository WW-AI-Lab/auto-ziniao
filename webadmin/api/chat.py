"""Agent 对话 API：会话 CRUD + SSE 消息流（spec: agent-chat）。

SSE 事件格式：`data: {"type": "delta|reasoning_delta|tool_call|done|error", ...}\n\n`，
心跳为注释行 `: ping`。推理与工具调用累计后随消息落库到 extras 列。
关键行为：
- 同会话串行（进行中再发返回 409）；
- 客户端断开不中断 agent 任务：处理协程独立于 SSE 生成器运行，回复照常落库。
"""

import asyncio
import json
import logging

from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from .. import storage
from ..chat import adapters
from ..errors import bad_request, conflict, not_found
from ..settings import get_default_agent

log = logging.getLogger("webadmin.chat")

router = APIRouter(prefix="/api", tags=["chat"])

HEARTBEAT_SEC = 15

# 进行中的会话 id 集合（串行控制）
_busy_sessions: set[str] = set()


class SessionBody(BaseModel):
    title: str = "新会话"
    agent: str | None = None


class SessionUpdateBody(BaseModel):
    title: str | None = None
    agent: str | None = None


class MessageBody(BaseModel):
    content: str


@router.get("/chat/agents")
def list_agents():
    return {"items": adapters.list_agents(), "default": get_default_agent()}


@router.get("/chat/sessions")
def list_sessions():
    items = storage.list_sessions()
    for s in items:
        s["busy"] = s["id"] in _busy_sessions
    return {"items": items}


@router.post("/chat/sessions")
def create_session(body: SessionBody):
    agent = body.agent or get_default_agent()
    if adapters.get_agent_config(agent) is None:
        raise bad_request(f"config.json 中未配置 agent: {agent}")
    return storage.create_session(title=body.title.strip() or "新会话", agent=agent)


@router.put("/chat/sessions/{sid}")
def update_session(sid: str, body: SessionUpdateBody):
    if storage.get_session(sid) is None:
        raise not_found(f"会话不存在: {sid}")
    fields = {}
    if body.title is not None:
        fields["title"] = body.title.strip() or "新会话"
    if body.agent is not None:
        if adapters.get_agent_config(body.agent) is None:
            raise bad_request(f"config.json 中未配置 agent: {body.agent}")
        fields["agent"] = body.agent
    storage.update_session(sid, **fields)
    return storage.get_session(sid)


@router.delete("/chat/sessions/{sid}")
def delete_session(sid: str):
    if sid in _busy_sessions:
        raise conflict("会话有进行中的消息，无法删除")
    if not storage.delete_session(sid):
        raise not_found(f"会话不存在: {sid}")
    return {"deleted": True}


@router.get("/chat/sessions/{sid}/messages")
def list_messages(sid: str):
    if storage.get_session(sid) is None:
        raise not_found(f"会话不存在: {sid}")
    return {"items": storage.list_messages(sid), "busy": sid in _busy_sessions}


async def _process_message(session: dict, content: str, assistant_msg_id: int,
                           queue: asyncio.Queue):
    """独立于 SSE 连接运行的处理协程：消费适配器事件流并落库。"""
    sid = session["id"]
    session_key = f"ziniao-webadmin:{sid}"
    parts: list[str] = []
    reasoning_parts: list[str] = []
    tools: list[dict] = []

    def _extras() -> dict | None:
        if not reasoning_parts and not tools:
            return None
        return {"reasoning": "".join(reasoning_parts), "tools": tools}

    try:
        async for evt in adapters.send(session["agent"], session_key, content):
            if evt["type"] == "delta":
                parts.append(evt["text"])
            elif evt["type"] == "reasoning_delta":
                reasoning_parts.append(evt["text"])
            elif evt["type"] == "tool_call":
                tools.append({"name": evt["name"]})
            elif evt["type"] == "done":
                full = evt.get("content") or "".join(parts)
                storage.update_message(assistant_msg_id, content=full,
                                       status="done", extras=_extras())
            elif evt["type"] == "error":
                storage.update_message(
                    assistant_msg_id, content="".join(parts),
                    status="failed", error=evt["message"], extras=_extras())
            queue.put_nowait(evt)
    except Exception as e:
        log.exception("chat 处理异常 (session=%s)", sid)
        storage.update_message(assistant_msg_id, content="".join(parts),
                               status="failed", error=str(e), extras=_extras())
        queue.put_nowait({"type": "error", "message": f"内部错误: {e}"})
    finally:
        _busy_sessions.discard(sid)
        queue.put_nowait(None)  # 结束哨兵


@router.post("/chat/sessions/{sid}/messages")
async def send_message(sid: str, body: MessageBody):
    session = storage.get_session(sid)
    if session is None:
        raise not_found(f"会话不存在: {sid}")
    if not body.content.strip():
        raise bad_request("消息内容不能为空")
    if sid in _busy_sessions:
        raise conflict("当前会话有进行中的消息，请等待完成")

    _busy_sessions.add(sid)
    storage.add_message(sid, "user", body.content, status="done")
    assistant_msg_id = storage.add_message(sid, "assistant", "", status="pending")

    queue: asyncio.Queue = asyncio.Queue()
    # 处理协程挂到事件循环上独立运行：SSE 断开不影响其完成与落库
    asyncio.get_running_loop().create_task(
        _process_message(session, body.content, assistant_msg_id, queue))

    async def event_stream():
        yield "data: " + json.dumps(
            {"type": "start", "message_id": assistant_msg_id},
            ensure_ascii=False) + "\n\n"
        while True:
            try:
                evt = await asyncio.wait_for(queue.get(), timeout=HEARTBEAT_SEC)
            except asyncio.TimeoutError:
                yield ": ping\n\n"  # SSE 心跳注释行
                continue
            if evt is None:
                break
            yield "data: " + json.dumps(evt, ensure_ascii=False) + "\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
