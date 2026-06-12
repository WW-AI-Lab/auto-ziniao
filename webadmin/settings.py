"""webadmin 配置与路径常量。

- 端口等用户级配置读取仓库根 config.json 的 "webadmin" 段（缺省给默认值）。
- 所有引擎数据目录只在这里声明一次，其余模块统一引用。
"""

import json
from pathlib import Path

# 仓库根目录（webadmin/ 的上一级）
ROOT_DIR = Path(__file__).resolve().parent.parent

FLOWS_DIR = ROOT_DIR / "flows"
EXTRACTS_DIR = ROOT_DIR / "extracts"
OUTPUT_DIR = ROOT_DIR / "output"
LOGS_DIR = ROOT_DIR / "logs"
LEARNINGS_DIR = ROOT_DIR / "learnings"
CONFIG_FILE = ROOT_DIR / "config.json"

# webadmin 自有数据
DATA_DIR = Path(__file__).resolve().parent / "data"
DB_FILE = DATA_DIR / "webadmin.db"
FRONTEND_DIST = Path(__file__).resolve().parent / "frontend" / "dist"

# 安全边界：仅回环。绝不提供绑定其他地址的开关（spec: web-admin-server）。
BIND_HOST = "127.0.0.1"
DEFAULT_PORT = 9482

# flow 子进程上限（设计决策：30 分钟）
FLOW_TIMEOUT_SEC = 30 * 60

# 文件预览大小上限（spec: run-monitoring，2 MB）
PREVIEW_MAX_BYTES = 2 * 1024 * 1024

# 文件访问白名单根目录（spec: web-admin-server）
ALLOWED_FILE_ROOTS = {
    "output": OUTPUT_DIR,
    "logs": LOGS_DIR,
    "flows": FLOWS_DIR,
    "extracts": EXTRACTS_DIR,
}


def load_config() -> dict:
    """读取仓库根 config.json（容错：不存在/损坏返回空 dict）。"""
    try:
        with open(CONFIG_FILE, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return {}


def get_port() -> int:
    cfg = load_config().get("webadmin", {})
    port = cfg.get("port", DEFAULT_PORT)
    try:
        return int(port)
    except (TypeError, ValueError):
        return DEFAULT_PORT


def get_heal_agents() -> dict:
    """chat 可用 agent 清单（来源 config.json heal.agents，spec: agent-chat）。"""
    return load_config().get("heal", {}).get("agents", {})


def get_default_agent() -> str:
    return load_config().get("heal", {}).get("agent", "openclaw")
