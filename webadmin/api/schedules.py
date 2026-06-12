"""计划任务 CRUD 与调度历史 API（spec: task-scheduler）。"""

from fastapi import APIRouter, Query
from pydantic import BaseModel

from .. import engine_data, storage
from ..errors import bad_request, not_found
from ..scheduler.triggers import TriggerError, compute_next_run

router = APIRouter(prefix="/api", tags=["schedules"])


class ScheduleBody(BaseModel):
    name: str
    flow_id: str
    params: dict[str, str] = {}
    trigger: dict
    enabled: bool = True


class ScheduleUpdateBody(BaseModel):
    name: str | None = None
    flow_id: str | None = None
    params: dict[str, str] | None = None
    trigger: dict | None = None
    enabled: bool | None = None


def _attach_latest(sched: dict) -> dict:
    sched["latest_run"] = storage.latest_schedule_run(sched["id"])
    return sched


@router.get("/schedules")
def list_schedules():
    return {"items": [_attach_latest(s) for s in storage.list_schedules()]}


@router.post("/schedules")
def create_schedule(body: ScheduleBody):
    if not body.name.strip():
        raise bad_request("任务名称不能为空")
    if not engine_data.flow_exists(body.flow_id):
        raise bad_request(f"flow 不存在: {body.flow_id}")
    try:
        next_run = compute_next_run(body.trigger)
    except TriggerError as e:
        raise bad_request(f"触发配置非法: {e}")
    return storage.create_schedule(
        name=body.name.strip(),
        flow_id=body.flow_id,
        params=body.params,
        trigger=body.trigger,
        enabled=body.enabled,
        next_run_at=next_run.strftime("%Y-%m-%d %H:%M:%S"),
    )


@router.get("/schedules/{sid}")
def get_schedule(sid: str):
    sched = storage.get_schedule(sid)
    if sched is None:
        raise not_found(f"任务不存在: {sid}")
    return _attach_latest(sched)


@router.put("/schedules/{sid}")
def update_schedule(sid: str, body: ScheduleUpdateBody):
    sched = storage.get_schedule(sid)
    if sched is None:
        raise not_found(f"任务不存在: {sid}")

    fields: dict = {}
    if body.name is not None:
        if not body.name.strip():
            raise bad_request("任务名称不能为空")
        fields["name"] = body.name.strip()
    if body.flow_id is not None:
        if not engine_data.flow_exists(body.flow_id):
            raise bad_request(f"flow 不存在: {body.flow_id}")
        fields["flow_id"] = body.flow_id
    if body.params is not None:
        fields["params"] = body.params
    if body.trigger is not None:
        try:
            fields["next_run_at"] = compute_next_run(body.trigger) \
                .strftime("%Y-%m-%d %H:%M:%S")
        except TriggerError as e:
            raise bad_request(f"触发配置非法: {e}")
        fields["trigger"] = body.trigger
    if body.enabled is not None:
        fields["enabled"] = body.enabled
        # 重新启用时基于当前时刻重算下次运行（避免立即补跑历史触发点）
        if body.enabled and "next_run_at" not in fields:
            trigger = fields.get("trigger", sched["trigger"])
            try:
                fields["next_run_at"] = compute_next_run(trigger) \
                    .strftime("%Y-%m-%d %H:%M:%S")
            except TriggerError as e:
                raise bad_request(f"触发配置非法: {e}")

    return _attach_latest(storage.update_schedule(sid, **fields))


@router.delete("/schedules/{sid}")
def delete_schedule(sid: str):
    if not storage.delete_schedule(sid):
        raise not_found(f"任务不存在: {sid}")
    return {"deleted": True}


@router.get("/schedules/{sid}/runs")
def schedule_runs(sid: str,
                  limit: int = Query(20, ge=1, le=200),
                  offset: int = Query(0, ge=0)):
    if storage.get_schedule(sid) is None:
        raise not_found(f"任务不存在: {sid}")
    return {"items": storage.list_schedule_runs(sid, limit=limit, offset=offset)}
