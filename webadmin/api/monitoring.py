"""运行观测 API：runs / heals / known_issues / stats / outputs（spec: run-monitoring）。"""

import mimetypes

from fastapi import APIRouter, Query
from fastapi.responses import FileResponse

from .. import engine_data, storage
from ..errors import bad_request, not_found
from ..security import PathSecurityError, resolve_safe_path
from ..settings import PREVIEW_MAX_BYTES

router = APIRouter(prefix="/api", tags=["monitoring"])


@router.get("/runs")
def list_runs(flow_id: str | None = None,
              limit: int = Query(50, ge=1, le=500),
              offset: int = Query(0, ge=0)):
    return engine_data.list_runs(flow_id=flow_id, limit=limit, offset=offset)


@router.get("/heals")
def list_heals(limit: int = Query(50, ge=1, le=500),
               offset: int = Query(0, ge=0)):
    return engine_data.list_heals(limit=limit, offset=offset)


@router.get("/heals/{heal_id}")
def get_heal(heal_id: str):
    detail = engine_data.get_heal_detail(heal_id)
    if detail is None:
        raise not_found(f"自愈记录不存在: {heal_id}")
    return detail


@router.get("/known-issues")
def known_issues():
    return {"items": engine_data.get_known_issues()}


@router.get("/stats")
def stats():
    data = engine_data.get_stats()
    schedules = storage.list_schedules()
    data["schedules"] = {
        "total": len(schedules),
        "enabled": sum(1 for s in schedules if s["enabled"]),
    }
    chat_sessions = storage.list_sessions()
    data["chat_sessions"] = len(chat_sessions)
    return data


# ----------------------------------------------------------------------
# output 产出浏览 / 预览 / 下载
# ----------------------------------------------------------------------

def _safe(root_key: str, path: str):
    try:
        return resolve_safe_path(root_key, path)
    except PathSecurityError as e:
        raise bad_request(str(e))


@router.get("/outputs")
def browse_outputs(path: str = ""):
    target = _safe("output", path)
    if not target.exists():
        # output 根目录可能尚未创建
        if path in ("", "/"):
            return {"path": "", "dirs": [], "files": []}
        raise not_found(f"目录不存在: {path}")
    if not target.is_dir():
        raise bad_request(f"不是目录: {path}")
    dirs, files = [], []
    for child in sorted(target.iterdir()):
        if child.name.startswith("."):
            continue
        if child.is_dir():
            dirs.append({"name": child.name})
        else:
            st = child.stat()
            files.append({
                "name": child.name,
                "size": st.st_size,
                "mtime": int(st.st_mtime),
            })
    return {"path": path, "dirs": dirs, "files": files}


@router.get("/outputs/preview")
def preview_output(path: str):
    target = _safe("output", path)
    if not target.exists() or not target.is_file():
        raise not_found(f"文件不存在: {path}")
    size = target.stat().st_size
    if size > PREVIEW_MAX_BYTES:
        return {"too_large": True, "size": size,
                "message": f"文件超过预览上限（{PREVIEW_MAX_BYTES // 1024 // 1024} MB），请下载查看"}
    try:
        content = target.read_text(encoding="utf-8-sig")
    except UnicodeDecodeError:
        return {"binary": True, "size": size, "message": "二进制文件不支持预览，请下载"}
    return {"too_large": False, "binary": False, "size": size,
            "name": target.name, "content": content}


@router.get("/outputs/download")
def download_output(path: str):
    target = _safe("output", path)
    if not target.exists() or not target.is_file():
        raise not_found(f"文件不存在: {path}")
    media_type = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
    return FileResponse(target, media_type=media_type, filename=target.name)
