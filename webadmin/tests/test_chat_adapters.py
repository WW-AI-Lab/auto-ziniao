"""chat 适配层测试：命令构造（去投递）、CLI 执行/失败/超时（spec: agent-chat / 任务 6.4）。"""

import asyncio

import pytest

from webadmin.chat import adapters


@pytest.fixture
def fake_agents(monkeypatch):
    agents = {
        "openclaw": {
            "command": ["openclaw", "agent", "--session-key", "{session_key}",
                        "--message", "{prompt}", "--deliver", "--channel", "feishu",
                        "--timeout", "300"],
            "timeout_sec": 320,
        },
        "echo": {
            "command": ["echo", "{prompt}"],
            "timeout_sec": 10,
        },
        "slow": {
            "command": ["sleep", "100"],
            "timeout_sec": 2,
        },
        "failing": {
            "command": ["false"],
            "timeout_sec": 5,
        },
    }
    monkeypatch.setattr(adapters, "get_heal_agents", lambda: agents)
    return agents


async def collect(gen):
    return [evt async for evt in gen]


# ----------------------------------------------------------------------
# 命令构造：去投递处理
# ----------------------------------------------------------------------

def test_build_command_strips_delivery(fake_agents):
    cmd = adapters.build_chat_command("openclaw", "你好", "ziniao-webadmin:abc")
    assert "--deliver" not in cmd
    assert "--channel" not in cmd
    assert "feishu" not in cmd
    assert "--json" in cmd  # openclaw 追加 --json
    assert "ziniao-webadmin:abc" in cmd
    assert "你好" in cmd


def test_build_command_unknown_agent(fake_agents):
    with pytest.raises(ValueError):
        adapters.build_chat_command("nope", "hi", "k")


# ----------------------------------------------------------------------
# CLI 执行
# ----------------------------------------------------------------------

def test_cli_send_success(fake_agents):
    events = asyncio.run(collect(adapters.cli_send("echo", "k", "hello world")))
    types = [e["type"] for e in events]
    assert types == ["delta", "done"]
    assert events[1]["content"].strip() == "hello world"


def test_cli_send_timeout_kills_process(fake_agents):
    events = asyncio.run(collect(adapters.cli_send("slow", "k", "hi")))
    assert events[-1]["type"] == "error"
    assert "超时" in events[-1]["message"]


def test_cli_send_nonzero_exit(fake_agents):
    events = asyncio.run(collect(adapters.cli_send("failing", "k", "hi")))
    assert events[-1]["type"] == "error"


def test_cli_send_unknown_command(fake_agents, monkeypatch):
    agents = dict(fake_agents)
    agents["ghost"] = {"command": ["no_such_binary_xyz", "{prompt}"], "timeout_sec": 5}
    monkeypatch.setattr(adapters, "get_heal_agents", lambda: agents)
    events = asyncio.run(collect(adapters.cli_send("ghost", "k", "hi")))
    assert events[-1]["type"] == "error"
    assert "找不到命令" in events[-1]["message"]


# ----------------------------------------------------------------------
# openclaw --json 输出解析
# ----------------------------------------------------------------------

def test_extract_cli_reply_json_payloads():
    out = '{"result": {"payloads": [{"text": "第一段"}, {"text": "第二段"}]}}'
    assert adapters._extract_cli_reply("openclaw", out) == "第一段\n第二段"


def test_extract_cli_reply_plain_for_other_agents():
    assert adapters._extract_cli_reply("claude", "纯文本回复") == "纯文本回复"


def test_extract_cli_reply_fallback_to_raw():
    assert adapters._extract_cli_reply("openclaw", "非 JSON 输出") == "非 JSON 输出"
