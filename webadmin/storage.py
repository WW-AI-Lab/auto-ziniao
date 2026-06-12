"""SQLite 存储层：建库建表、schema 版本、轻量 DAO。

设计约定（design.md）：
- 单库四业务表 + meta；WAL + busy_timeout 支撑调度线程与 API 线程并发读写；
- 不用 ORM，手写 SQL；每次操作使用短连接（连接开销在本场景可忽略，规避跨线程共享问题）。
"""

import json
import sqlite3
import threading
import uuid
from contextlib import contextmanager
from datetime import datetime

from .settings import DATA_DIR, DB_FILE

SCHEMA_VERSION = 1

_init_lock = threading.Lock()
_initialized = False

_SCHEMA = """
CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS schedules (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    flow_id TEXT NOT NULL,
    params TEXT NOT NULL DEFAULT '{}',          -- JSON 对象
    trigger TEXT NOT NULL,                       -- JSON: {type, ...}
    enabled INTEGER NOT NULL DEFAULT 1,
    next_run_at TEXT,                            -- ISO 秒级，本机时区
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS schedule_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    schedule_id TEXT NOT NULL,
    fired_at TEXT NOT NULL,
    status TEXT NOT NULL,                        -- success|failed|timeout|skipped
    exit_code INTEGER,
    duration_ms INTEGER,
    error TEXT,
    FOREIGN KEY (schedule_id) REFERENCES schedules(id)
);
CREATE INDEX IF NOT EXISTS idx_schedule_runs_sid
    ON schedule_runs(schedule_id, id DESC);

CREATE TABLE IF NOT EXISTS chat_sessions (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    agent TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL,                          -- user|assistant
    content TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'done',         -- pending|done|failed
    error TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (session_id) REFERENCES chat_sessions(id)
);
CREATE INDEX IF NOT EXISTS idx_chat_messages_sid
    ON chat_messages(session_id, id);
"""


def now_str() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def new_id() -> str:
    return uuid.uuid4().hex[:12]


def init_db() -> None:
    global _initialized
    with _init_lock:
        if _initialized:
            return
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        with _raw_conn() as conn:
            conn.executescript(_SCHEMA)
            conn.execute(
                "INSERT OR IGNORE INTO meta(key, value) VALUES('schema_version', ?)",
                (str(SCHEMA_VERSION),),
            )
        _initialized = True


def _raw_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_FILE, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=10000")
    return conn


@contextmanager
def db():
    """短连接上下文：自动 commit/rollback/close。"""
    init_db()
    conn = _raw_conn()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def _row_to_schedule(row: sqlite3.Row) -> dict:
    d = dict(row)
    d["params"] = json.loads(d["params"] or "{}")
    d["trigger"] = json.loads(d["trigger"])
    d["enabled"] = bool(d["enabled"])
    return d


# ----------------------------------------------------------------------
# schedules DAO
# ----------------------------------------------------------------------

def create_schedule(name, flow_id, params, trigger, enabled, next_run_at) -> dict:
    sid = new_id()
    ts = now_str()
    with db() as conn:
        conn.execute(
            "INSERT INTO schedules(id, name, flow_id, params, trigger, enabled,"
            " next_run_at, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?)",
            (sid, name, flow_id, json.dumps(params, ensure_ascii=False),
             json.dumps(trigger, ensure_ascii=False), int(enabled),
             next_run_at, ts, ts),
        )
    return get_schedule(sid)


def get_schedule(sid) -> dict | None:
    with db() as conn:
        row = conn.execute("SELECT * FROM schedules WHERE id=?", (sid,)).fetchone()
    return _row_to_schedule(row) if row else None


def list_schedules() -> list[dict]:
    with db() as conn:
        rows = conn.execute("SELECT * FROM schedules ORDER BY created_at").fetchall()
    return [_row_to_schedule(r) for r in rows]


def update_schedule(sid, **fields) -> dict | None:
    """允许字段：name/flow_id/params/trigger/enabled/next_run_at"""
    allowed = {"name", "flow_id", "params", "trigger", "enabled", "next_run_at"}
    sets, vals = [], []
    for k, v in fields.items():
        if k not in allowed:
            continue
        if k in ("params", "trigger"):
            v = json.dumps(v, ensure_ascii=False)
        if k == "enabled":
            v = int(v)
        sets.append(f"{k}=?")
        vals.append(v)
    if not sets:
        return get_schedule(sid)
    sets.append("updated_at=?")
    vals.append(now_str())
    vals.append(sid)
    with db() as conn:
        conn.execute(f"UPDATE schedules SET {', '.join(sets)} WHERE id=?", vals)
    return get_schedule(sid)


def delete_schedule(sid) -> bool:
    with db() as conn:
        cur = conn.execute("DELETE FROM schedules WHERE id=?", (sid,))
        conn.execute("DELETE FROM schedule_runs WHERE schedule_id=?", (sid,))
    return cur.rowcount > 0


def list_enabled_schedules() -> list[dict]:
    with db() as conn:
        rows = conn.execute("SELECT * FROM schedules WHERE enabled=1").fetchall()
    return [_row_to_schedule(r) for r in rows]


# ----------------------------------------------------------------------
# schedule_runs DAO
# ----------------------------------------------------------------------

def add_schedule_run(schedule_id, status, exit_code=None, duration_ms=None,
                     error=None, fired_at=None) -> None:
    with db() as conn:
        conn.execute(
            "INSERT INTO schedule_runs(schedule_id, fired_at, status, exit_code,"
            " duration_ms, error) VALUES(?,?,?,?,?,?)",
            (schedule_id, fired_at or now_str(), status, exit_code,
             duration_ms, (error or None) and str(error)[:500]),
        )


def list_schedule_runs(schedule_id, limit=20, offset=0) -> list[dict]:
    with db() as conn:
        rows = conn.execute(
            "SELECT * FROM schedule_runs WHERE schedule_id=?"
            " ORDER BY id DESC LIMIT ? OFFSET ?",
            (schedule_id, limit, offset),
        ).fetchall()
    return [dict(r) for r in rows]


def latest_schedule_run(schedule_id) -> dict | None:
    runs = list_schedule_runs(schedule_id, limit=1)
    return runs[0] if runs else None


# ----------------------------------------------------------------------
# chat DAO
# ----------------------------------------------------------------------

def create_session(title, agent) -> dict:
    sid = new_id()
    ts = now_str()
    with db() as conn:
        conn.execute(
            "INSERT INTO chat_sessions(id, title, agent, created_at, updated_at)"
            " VALUES(?,?,?,?,?)",
            (sid, title, agent, ts, ts),
        )
    return get_session(sid)


def get_session(sid) -> dict | None:
    with db() as conn:
        row = conn.execute("SELECT * FROM chat_sessions WHERE id=?", (sid,)).fetchone()
    return dict(row) if row else None


def list_sessions() -> list[dict]:
    with db() as conn:
        rows = conn.execute(
            "SELECT * FROM chat_sessions ORDER BY updated_at DESC").fetchall()
    return [dict(r) for r in rows]


def update_session(sid, **fields) -> None:
    allowed = {"title", "agent"}
    sets, vals = [], []
    for k, v in fields.items():
        if k in allowed:
            sets.append(f"{k}=?")
            vals.append(v)
    sets.append("updated_at=?")
    vals.append(now_str())
    vals.append(sid)
    with db() as conn:
        conn.execute(f"UPDATE chat_sessions SET {', '.join(sets)} WHERE id=?", vals)


def delete_session(sid) -> bool:
    with db() as conn:
        cur = conn.execute("DELETE FROM chat_sessions WHERE id=?", (sid,))
        conn.execute("DELETE FROM chat_messages WHERE session_id=?", (sid,))
    return cur.rowcount > 0


def add_message(session_id, role, content="", status="done", error=None) -> int:
    with db() as conn:
        cur = conn.execute(
            "INSERT INTO chat_messages(session_id, role, content, status, error,"
            " created_at) VALUES(?,?,?,?,?,?)",
            (session_id, role, content, status, error, now_str()),
        )
        conn.execute("UPDATE chat_sessions SET updated_at=? WHERE id=?",
                     (now_str(), session_id))
        return cur.lastrowid


def update_message(msg_id, content=None, status=None, error=None) -> None:
    sets, vals = [], []
    if content is not None:
        sets.append("content=?")
        vals.append(content)
    if status is not None:
        sets.append("status=?")
        vals.append(status)
    if error is not None:
        sets.append("error=?")
        vals.append(str(error)[:500])
    if not sets:
        return
    vals.append(msg_id)
    with db() as conn:
        conn.execute(f"UPDATE chat_messages SET {', '.join(sets)} WHERE id=?", vals)


def list_messages(session_id) -> list[dict]:
    with db() as conn:
        rows = conn.execute(
            "SELECT * FROM chat_messages WHERE session_id=? ORDER BY id",
            (session_id,),
        ).fetchall()
    return [dict(r) for r in rows]
