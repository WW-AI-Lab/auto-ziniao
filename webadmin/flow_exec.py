"""flow 子进程执行与 flow 级锁（手动运行 API 与调度器共用）。

设计决策（design.md）：
- 执行走 subprocess 调 `manager.py run`，与 cron/手工路径完全一致，
  失败自愈由引擎内部处理，webadmin 不在外层包重试；
- 同一 flow 同时只允许一个运行实例（进程内锁，手动与调度共用）；
- 子进程默认 30 分钟超时，超时强杀记失败。
"""

import subprocess
import sys
import threading
import time
import uuid
from datetime import datetime

from .settings import ROOT_DIR, FLOW_TIMEOUT_SEC

# flow_id -> Lock（进程内防重；锁对象本身的创建用 _locks_guard 保护）
_flow_locks: dict[str, threading.Lock] = {}
_locks_guard = threading.Lock()

# 手动运行登记表: token -> 运行状态
_runs: dict[str, dict] = {}
_runs_guard = threading.Lock()
_MAX_RUNS_KEPT = 200

OUTPUT_TAIL_CHARS = 8000


def _get_lock(flow_id: str) -> threading.Lock:
    with _locks_guard:
        if flow_id not in _flow_locks:
            _flow_locks[flow_id] = threading.Lock()
        return _flow_locks[flow_id]


def is_flow_running(flow_id: str) -> bool:
    lock = _get_lock(flow_id)
    if lock.acquire(blocking=False):
        lock.release()
        return False
    return True


def build_run_command(flow_id: str, params: dict | None) -> list[str]:
    cmd = [sys.executable, str(ROOT_DIR / "manager.py"), "run", flow_id]
    for k, v in (params or {}).items():
        cmd += ["-p", f"{k}={v}"]
    return cmd


def execute_flow_blocking(flow_id: str, params: dict | None,
                          timeout_sec: int = FLOW_TIMEOUT_SEC) -> dict:
    """持锁执行 flow 子进程（阻塞调用方线程）。

    返回 {status: success|failed|timeout|skipped, exit_code, duration_ms, output, error}
    status=skipped 表示未拿到锁（已有实例运行中）。
    """
    lock = _get_lock(flow_id)
    if not lock.acquire(blocking=False):
        return {"status": "skipped", "error": f"flow {flow_id} 已有运行中实例",
                "exit_code": None, "duration_ms": 0, "output": ""}

    start = time.time()
    try:
        proc = subprocess.run(
            build_run_command(flow_id, params),
            cwd=str(ROOT_DIR),
            capture_output=True,
            text=True,
            timeout=timeout_sec,
        )
        duration_ms = int((time.time() - start) * 1000)
        output = (proc.stdout or "") + (proc.stderr or "")
        status = "success" if proc.returncode == 0 else "failed"
        error = None
        if status == "failed":
            error = output.strip().splitlines()[-1][:300] if output.strip() else "非零退出码"
        return {"status": status, "exit_code": proc.returncode,
                "duration_ms": duration_ms,
                "output": output[-OUTPUT_TAIL_CHARS:], "error": error}
    except subprocess.TimeoutExpired as e:
        duration_ms = int((time.time() - start) * 1000)
        output = ((e.stdout or b"").decode("utf-8", "replace")
                  if isinstance(e.stdout, bytes) else (e.stdout or ""))
        return {"status": "timeout", "exit_code": None,
                "duration_ms": duration_ms,
                "output": output[-OUTPUT_TAIL_CHARS:],
                "error": f"执行超时（{timeout_sec}s），子进程已终止"}
    finally:
        lock.release()


def start_manual_run(flow_id: str, params: dict | None) -> dict:
    """异步启动手动运行，返回受理信息（含 token）。

    若 flow 已在运行中，抛 RuntimeError（API 层转 409）。
    """
    if is_flow_running(flow_id):
        raise RuntimeError(f"flow {flow_id} 已有运行中实例")

    token = uuid.uuid4().hex[:16]
    entry = {
        "token": token,
        "flow_id": flow_id,
        "params": params or {},
        "status": "running",
        "started_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "finished_at": None,
        "exit_code": None,
        "duration_ms": None,
        "output": "",
        "error": None,
    }
    with _runs_guard:
        _runs[token] = entry
        # 防登记表无限增长
        if len(_runs) > _MAX_RUNS_KEPT:
            finished = [t for t, r in _runs.items() if r["status"] != "running"]
            for t in finished[:len(_runs) - _MAX_RUNS_KEPT]:
                _runs.pop(t, None)

    def _worker():
        result = execute_flow_blocking(flow_id, params)
        with _runs_guard:
            entry.update(
                status=result["status"],
                finished_at=datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                exit_code=result["exit_code"],
                duration_ms=result["duration_ms"],
                output=result["output"],
                error=result["error"],
            )

    threading.Thread(target=_worker, daemon=True,
                     name=f"flow-run-{flow_id}").start()
    return {"token": token, "flow_id": flow_id, "status": "running"}


def get_manual_run(token: str) -> dict | None:
    with _runs_guard:
        entry = _runs.get(token)
        return dict(entry) if entry else None
