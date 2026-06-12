"""flows 管理 API（spec: flow-management）。"""

import json
import sys
import time

from fastapi import APIRouter
from pydantic import BaseModel

from .. import engine_data, flow_exec
from ..errors import ApiError, bad_request, conflict, not_found
from ..settings import FLOWS_DIR, ROOT_DIR

# 复用引擎同一校验实现（flow_engine 纯标准库，导入无副作用）
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))
from flow_engine import validate_flow  # noqa: E402

router = APIRouter(prefix="/api", tags=["flows"])

BACKUP_DIR = FLOWS_DIR / ".backup"
BACKUP_KEEP = 5


class SaveFlowBody(BaseModel):
    content: str


class RunFlowBody(BaseModel):
    params: dict[str, str] = {}


@router.get("/flows")
def list_flows():
    flows = engine_data.list_flow_files()
    runs = engine_data.list_runs(limit=10_000)["items"]
    # list_runs 返回倒序，建立 flow -> 最近一条 的索引
    last_by_flow: dict[str, dict] = {}
    for e in runs:
        fid = e.get("flow_id")
        if fid and fid not in last_by_flow:
            last_by_flow[fid] = e
    for f in flows:
        last = last_by_flow.get(f["id"])
        f["last_run"] = {
            "timestamp": last.get("timestamp"),
            "status": last.get("status"),
            "duration_ms": last.get("duration_ms"),
        } if last else None
        f["running"] = flow_exec.is_flow_running(f["id"])
    return {"items": flows}


@router.get("/flows/{flow_id}")
def get_flow(flow_id: str):
    if not engine_data.flow_exists(flow_id):
        raise not_found(f"流程不存在: {flow_id}")
    raw = engine_data.read_flow_raw(flow_id)
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        parsed = None
    return {
        "id": flow_id,
        "content": raw,
        "extracts": engine_data.find_extract_refs(parsed) if parsed else [],
        "last_run": engine_data.last_run_of(flow_id),
        "running": flow_exec.is_flow_running(flow_id),
    }


def _validate_content(flow_id: str, content: str) -> dict:
    """JSON 解析 + 引擎同等校验；失败抛 ApiError(400)。返回解析后的 dict。"""
    try:
        flow_def = json.loads(content)
    except json.JSONDecodeError as e:
        raise bad_request(f"JSON 语法错误: {e}")
    if not isinstance(flow_def, dict):
        raise bad_request("flow 定义必须是 JSON 对象")
    if flow_def.get("id") != flow_id:
        raise bad_request(
            f"flow 定义的 id 字段（{flow_def.get('id')}）必须与文件名一致（{flow_id}）")
    issues = validate_flow(flow_def)
    errors = [msg for lv, msg in issues if lv == "error"]
    if errors:
        raise ApiError(400, "validate_failed", "流程校验失败: " + "; ".join(errors))
    return flow_def


def _backup_flow(flow_id: str) -> None:
    """保存前备份原文件，每个 flow 保留最近 BACKUP_KEEP 份。"""
    src = FLOWS_DIR / f"{flow_id}.json"
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    ts = time.strftime("%Y%m%d%H%M%S")
    dst = BACKUP_DIR / f"{flow_id}.{ts}.json"
    dst.write_text(src.read_text(encoding="utf-8"), encoding="utf-8")
    backups = sorted(BACKUP_DIR.glob(f"{flow_id}.*.json"))
    for old in backups[:-BACKUP_KEEP]:
        old.unlink(missing_ok=True)


@router.put("/flows/{flow_id}")
def save_flow(flow_id: str, body: SaveFlowBody):
    if not engine_data.flow_exists(flow_id):
        raise not_found(f"流程不存在: {flow_id}")
    flow_def = _validate_content(flow_id, body.content)
    _backup_flow(flow_id)
    # 统一以格式化 JSON 落盘
    (FLOWS_DIR / f"{flow_id}.json").write_text(
        json.dumps(flow_def, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8")
    warnings = [msg for lv, msg in validate_flow(flow_def) if lv == "warn"]
    return {"saved": True, "warnings": warnings}


@router.post("/flows/{flow_id}/validate")
def validate_flow_content(flow_id: str, body: SaveFlowBody):
    """仅校验不保存（编辑器实时校验用）。"""
    _validate_content(flow_id, body.content)
    flow_def = json.loads(body.content)
    warnings = [msg for lv, msg in validate_flow(flow_def) if lv == "warn"]
    return {"valid": True, "warnings": warnings}


@router.post("/flows/{flow_id}/run")
def run_flow(flow_id: str, body: RunFlowBody):
    if not engine_data.flow_exists(flow_id):
        raise not_found(f"流程不存在: {flow_id}")
    try:
        return flow_exec.start_manual_run(flow_id, body.params)
    except RuntimeError as e:
        raise conflict(str(e))


@router.get("/flow-runs/{token}")
def get_run_status(token: str):
    entry = flow_exec.get_manual_run(token)
    if entry is None:
        raise not_found(f"运行记录不存在: {token}")
    return entry
