"""调度器线程：扫描启用任务，到点执行 flow（spec: task-scheduler）。

- tick ≤ 30s（实际 15s）；
- 到点先推进 next_run_at 再异步执行（防同一任务重复触发）；
- 与手动运行共用 flow_exec 的 flow 级锁，拿不到锁记 skipped；
- 服务启动时重算全部启用任务的 next_run_at（错过的触发不补跑）；
- 线程异常自动恢复（守护循环 try/except）。
"""

import logging
import threading
import time
from datetime import datetime

from .. import storage
from ..flow_exec import execute_flow_blocking
from .triggers import compute_next_run, TriggerError

log = logging.getLogger("webadmin.scheduler")

TICK_SECONDS = 15
_FMT = "%Y-%m-%d %H:%M:%S"

_thread: threading.Thread | None = None
_stop_event = threading.Event()


def _fmt(dt: datetime) -> str:
    return dt.strftime(_FMT)


def _parse(s: str) -> datetime | None:
    try:
        return datetime.strptime(s, _FMT)
    except (TypeError, ValueError):
        return None


def recompute_all_next_runs() -> None:
    """启动时重算：错过的触发直接跳过到未来最近触发点，不补跑。"""
    for sched in storage.list_enabled_schedules():
        try:
            nxt = compute_next_run(sched["trigger"])
            storage.update_schedule(sched["id"], next_run_at=_fmt(nxt))
        except TriggerError as e:
            log.warning("任务 %s 触发配置非法，已跳过重算: %s", sched["id"], e)


def _fire(sched: dict) -> None:
    """执行一个到点任务（在独立线程中运行，不阻塞 tick 循环）。"""
    sid = sched["id"]
    flow_id = sched["flow_id"]
    fired_at = storage.now_str()
    log.info("调度触发: %s (flow=%s)", sched["name"], flow_id)
    try:
        result = execute_flow_blocking(flow_id, sched.get("params") or {})
        storage.add_schedule_run(
            sid,
            status=result["status"],
            exit_code=result["exit_code"],
            duration_ms=result["duration_ms"],
            error=result["error"],
            fired_at=fired_at,
        )
        log.info("调度完成: %s -> %s (%sms)", sched["name"],
                 result["status"], result["duration_ms"])
    except Exception as e:
        log.exception("调度执行异常: %s", sched["name"])
        storage.add_schedule_run(sid, status="failed", error=str(e),
                                 fired_at=fired_at)


def _tick() -> None:
    now = datetime.now()
    for sched in storage.list_enabled_schedules():
        nxt = _parse(sched.get("next_run_at") or "")
        if nxt is None:
            # 缺失则补算，不触发
            try:
                storage.update_schedule(
                    sched["id"], next_run_at=_fmt(compute_next_run(sched["trigger"])))
            except TriggerError:
                pass
            continue
        if nxt > now:
            continue
        # 先推进 next_run_at（以本次触发点为基准），再异步执行
        try:
            new_next = compute_next_run(sched["trigger"], after=now)
            storage.update_schedule(sched["id"], next_run_at=_fmt(new_next))
        except TriggerError as e:
            log.warning("任务 %s 触发配置非法，已停用: %s", sched["id"], e)
            storage.update_schedule(sched["id"], enabled=False)
            continue
        threading.Thread(target=_fire, args=(sched,), daemon=True,
                         name=f"sched-fire-{sched['id']}").start()


def _loop() -> None:
    log.info("调度器线程启动 (tick=%ss)", TICK_SECONDS)
    while not _stop_event.is_set():
        try:
            _tick()
        except Exception:
            # 守护：任何异常不允许杀死调度循环
            log.exception("调度 tick 异常，循环继续")
        _stop_event.wait(TICK_SECONDS)
    log.info("调度器线程退出")


def start_scheduler() -> None:
    global _thread
    if _thread and _thread.is_alive():
        return
    _stop_event.clear()
    recompute_all_next_runs()
    _thread = threading.Thread(target=_loop, daemon=True, name="webadmin-scheduler")
    _thread.start()


def stop_scheduler() -> None:
    _stop_event.set()
