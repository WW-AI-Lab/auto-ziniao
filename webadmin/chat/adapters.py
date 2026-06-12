"""chat 适配层：统一 `send(session_key, message) -> 异步事件流` 协议。

事件类型（spec: agent-chat）：
- {"type": "delta", "text": str}    增量内容
- {"type": "done", "content": str}  完成（content 为完整回复）
- {"type": "error", "message": str} 错误

适配器（探测结论见 openspec/changes/add-web-admin/notes-gateway.md）：
- OpenClawGatewayAdapter: POST /v1/chat/completions（Bearer token），SSE 流式；
  端点默认未启用（404）→ 探测失败自动回退 CLI。
- CliAgentAdapter: 命令模板取 config.json heal.agents，chat 场景做去投递处理
  （移除 --deliver / --channel <值>；openclaw 追加 --json）。
"""

import asyncio
import json
import logging
import shlex
import urllib.error
import urllib.request
from pathlib import Path

from ..settings import get_heal_agents

log = logging.getLogger("webadmin.chat")

GATEWAY_BASE = "http://127.0.0.1:18789"
OPENCLAW_CONFIG = Path.home() / ".openclaw" / "openclaw.json"

# gateway 可达性探测缓存（秒）
_PROBE_TTL = 300
_probe_cache: dict = {"ts": 0.0, "ok": False}


def list_agents() -> list[dict]:
    """可用 agent 清单（来源 config.json heal.agents，spec 要求不另建配置）。"""
    agents = []
    for name, cfg in get_heal_agents().items():
        agents.append({
            "name": name,
            "timeout_sec": cfg.get("timeout_sec", 600),
        })
    return agents


def get_agent_config(name: str) -> dict | None:
    return get_heal_agents().get(name)


# ----------------------------------------------------------------------
# OpenClaw gateway（HTTP，OpenAI 兼容端点）
# ----------------------------------------------------------------------

def _gateway_token() -> str | None:
    try:
        cfg = json.loads(OPENCLAW_CONFIG.read_text(encoding="utf-8"))
        return cfg.get("gateway", {}).get("auth", {}).get("token")
    except (OSError, json.JSONDecodeError):
        return None


def probe_gateway() -> bool:
    """探测 gateway chat completions 端点可用性（带缓存）。

    注意：gateway 对未知路径回退返回 SPA index.html（200），
    因此必须用 POST 实际请求判断；404 = 端点未启用。
    """
    import time
    now = time.time()
    if now - _probe_cache["ts"] < _PROBE_TTL:
        return _probe_cache["ok"]

    ok = False
    token = _gateway_token()
    if token:
        try:
            req = urllib.request.Request(
                GATEWAY_BASE + "/v1/chat/completions",
                data=json.dumps({
                    "model": "openclaw",
                    "messages": [{"role": "user", "content": "ping"}],
                    "max_tokens": 1,
                }).encode("utf-8"),
                headers={"Content-Type": "application/json",
                         "Authorization": f"Bearer {token}"},
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=5) as resp:
                ctype = resp.headers.get("Content-Type", "")
                ok = resp.status == 200 and "text/html" not in ctype
        except urllib.error.HTTPError as e:
            # 401/403 说明端点存在但鉴权失败；404 说明未启用
            ok = False
            log.info("gateway 探测 HTTP %s", e.code)
        except OSError:
            ok = False
    _probe_cache.update(ts=now, ok=ok)
    log.info("gateway chat completions 可用性: %s", ok)
    return ok


async def gateway_send(session_key: str, message: str, timeout_sec: int = 600):
    """经 gateway OpenAI 兼容端点流式发送。user 字段传会话 key 实现会话隔离。"""
    token = _gateway_token()
    if not token:
        yield {"type": "error", "message": "未找到 gateway token（~/.openclaw/openclaw.json）"}
        return

    payload = json.dumps({
        "model": "openclaw",
        "stream": True,
        "user": session_key,
        "messages": [{"role": "user", "content": message}],
    }).encode("utf-8")

    def _request():
        req = urllib.request.Request(
            GATEWAY_BASE + "/v1/chat/completions",
            data=payload,
            headers={"Content-Type": "application/json",
                     "Authorization": f"Bearer {token}",
                     "Accept": "text/event-stream"},
            method="POST",
        )
        return urllib.request.urlopen(req, timeout=timeout_sec)

    loop = asyncio.get_running_loop()
    try:
        resp = await loop.run_in_executor(None, _request)
    except urllib.error.HTTPError as e:
        yield {"type": "error", "message": f"gateway 请求失败: HTTP {e.code}"}
        return
    except OSError as e:
        yield {"type": "error", "message": f"gateway 连接失败: {e}"}
        return

    full = []
    try:
        queue: asyncio.Queue = asyncio.Queue()

        def _reader():
            try:
                for raw_line in resp:
                    loop.call_soon_threadsafe(queue.put_nowait, raw_line)
            except Exception as e:  # 读取中断
                loop.call_soon_threadsafe(queue.put_nowait, e)
            finally:
                loop.call_soon_threadsafe(queue.put_nowait, None)

        import threading
        threading.Thread(target=_reader, daemon=True).start()

        while True:
            item = await queue.get()
            if item is None:
                break
            if isinstance(item, Exception):
                yield {"type": "error", "message": f"gateway 流读取失败: {item}"}
                return
            line = item.decode("utf-8", "replace").strip()
            if not line.startswith("data:"):
                continue
            data = line[5:].strip()
            if data == "[DONE]":
                break
            try:
                chunk = json.loads(data)
                delta = chunk.get("choices", [{}])[0].get("delta", {}).get("content")
                if delta:
                    full.append(delta)
                    yield {"type": "delta", "text": delta}
            except (json.JSONDecodeError, IndexError):
                continue
    finally:
        try:
            resp.close()
        except Exception:
            pass

    yield {"type": "done", "content": "".join(full)}


# ----------------------------------------------------------------------
# agent CLI（subprocess）
# ----------------------------------------------------------------------

def build_chat_command(agent_name: str, message: str, session_key: str) -> list[str]:
    """从 heal.agents 命令模板构造 chat 命令（去投递处理）。"""
    cfg = get_agent_config(agent_name)
    if not cfg:
        raise ValueError(f"config.json 中未配置 agent: {agent_name}")
    template = cfg.get("command", [])
    placeholders = {
        "prompt": message,
        "prompt_path": "",
        "session_key": session_key,
        "flow_id": "",
        "heal_id": "",
    }
    cmd = []
    skip_next = False
    for part in template:
        if skip_next:
            skip_next = False
            continue
        # chat 场景去投递：移除 --deliver 与 --channel <值>
        if part == "--deliver":
            continue
        if part == "--channel":
            skip_next = True
            continue
        for key, val in placeholders.items():
            part = part.replace("{" + key + "}", str(val))
        cmd.append(part)
    # openclaw 输出 JSON 便于解析回复
    if cmd and cmd[0] == "openclaw" and "--json" not in cmd:
        cmd.append("--json")
    return cmd


def _extract_cli_reply(agent_name: str, stdout: str) -> str:
    """从 CLI 输出提取回复文本（openclaw --json 输出做解析，其余原样）。"""
    text = stdout.strip()
    if agent_name != "openclaw":
        return text
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        # 容错：输出可能混有非 JSON 前缀行，取最后一个 { 开头的行
        for line in reversed(text.splitlines()):
            line = line.strip()
            if line.startswith("{"):
                try:
                    data = json.loads(line)
                    break
                except json.JSONDecodeError:
                    continue
        else:
            return text
    # openclaw agent --json 的回复结构：尽力取常见字段，取不到则整体序列化
    if isinstance(data, dict):
        result = data.get("result") if isinstance(data.get("result"), dict) else data
        for key in ("reply", "text", "message", "content", "response"):
            val = result.get(key)
            if isinstance(val, str) and val.strip():
                return val
        payloads = result.get("payloads")
        if isinstance(payloads, list):
            texts = [p.get("text") for p in payloads
                     if isinstance(p, dict) and isinstance(p.get("text"), str)]
            if texts:
                return "\n".join(texts)
        return json.dumps(data, ensure_ascii=False, indent=2)
    return text


async def cli_send(agent_name: str, session_key: str, message: str):
    """经 agent CLI 发送（无原生流式：完成后整段下发 + done 事件）。"""
    cfg = get_agent_config(agent_name)
    if not cfg:
        yield {"type": "error", "message": f"config.json 中未配置 agent: {agent_name}"}
        return
    timeout_sec = cfg.get("timeout_sec", 600)

    try:
        cmd = build_chat_command(agent_name, message, session_key)
    except ValueError as e:
        yield {"type": "error", "message": str(e)}
        return

    log.info("CLI chat: %s", " ".join(shlex.quote(c) for c in cmd[:4]) + " ...")
    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
    except FileNotFoundError:
        yield {"type": "error", "message": f"找不到命令: {cmd[0]}（请确认已安装）"}
        return

    try:
        stdout, stderr = await asyncio.wait_for(
            proc.communicate(), timeout=timeout_sec)
    except asyncio.TimeoutError:
        proc.kill()
        await proc.wait()
        yield {"type": "error",
               "message": f"agent 执行超时（{timeout_sec}s），子进程已终止"}
        return

    out = stdout.decode("utf-8", "replace")
    err = stderr.decode("utf-8", "replace")
    if proc.returncode != 0:
        detail = (err or out).strip()[-400:] or f"退出码 {proc.returncode}"
        yield {"type": "error", "message": f"agent 执行失败: {detail}"}
        return

    reply = _extract_cli_reply(agent_name, out)
    if not reply.strip():
        yield {"type": "error", "message": "agent 返回了空回复"}
        return
    yield {"type": "delta", "text": reply}
    yield {"type": "done", "content": reply}


# ----------------------------------------------------------------------
# 统一入口
# ----------------------------------------------------------------------

async def send(agent_name: str, session_key: str, message: str):
    """统一发送：openclaw 优先 gateway（可达时），否则/其余走 CLI。"""
    if agent_name == "openclaw":
        loop = asyncio.get_running_loop()
        gateway_ok = await loop.run_in_executor(None, probe_gateway)
        if gateway_ok:
            cfg = get_agent_config(agent_name) or {}
            async for evt in gateway_send(session_key, message,
                                          timeout_sec=cfg.get("timeout_sec", 600)):
                yield evt
            return
    async for evt in cli_send(agent_name, session_key, message):
        yield evt
