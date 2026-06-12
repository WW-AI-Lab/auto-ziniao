"""webadmin 配置与路径常量。

- 端口等用户级配置读取仓库根 config.json 的 "webadmin" 段（缺省给默认值）。
- 引擎数据目录统一复用 engine.paths（全仓路径唯一出处），不重复声明。
"""

import json
from pathlib import Path

from engine.paths import (
    REPO_ROOT as ROOT_DIR,
    FLOWS_DIR, EXTRACTS_DIR, OUTPUT_DIR, LOGS_DIR, LEARNINGS_DIR,
    FLOW_BACKUPS_DIR, DATA_DIR,
    CONFIG_PATH as CONFIG_FILE,
    WEBADMIN_DB as DB_FILE,
)

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
