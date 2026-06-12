"""引擎数据只读访问：flows / runs.jsonl / heals / known_issues / stats。

口径对齐 manager.py（list/history/stats），数据源为引擎既有 JSON/JSONL 文件。
"""

import json
import re

from .settings import FLOWS_DIR, EXTRACTS_DIR, LOGS_DIR, LEARNINGS_DIR

RUNS_FILE = LOGS_DIR / "runs.jsonl"
HEALS_FILE = LEARNINGS_DIR / "heals.jsonl"
KNOWN_ISSUES_FILE = LEARNINGS_DIR / "known_issues.json"
HEALS_DIR = LOGS_DIR / "heals"


def _read_jsonl(path) -> list[dict]:
    if not path.exists():
        return []
    entries = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                entries.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    return entries


# ----------------------------------------------------------------------
# flows
# ----------------------------------------------------------------------

def list_flow_files() -> list[dict]:
    """flow 摘要列表（排除 _template.json 等下划线文件）。"""
    flows = []
    for f in sorted(FLOWS_DIR.glob("*.json")):
        if f.name.startswith("_") or f.name.startswith("."):
            continue
        try:
            with open(f, encoding="utf-8") as fh:
                defn = json.load(fh)
            flows.append({
                "id": defn.get("id", f.stem),
                "name": defn.get("name", f.stem),
                "version": defn.get("version", 1),
                "enabled": defn.get("enabled", True),
                "schedule": defn.get("schedule", ""),
                "description": defn.get("description", ""),
                "params": {k: v for k, v in defn.get("params", {}).items()
                           if not k.startswith("_")},
                "file": f.name,
            })
        except Exception:
            flows.append({"id": f.stem, "name": f.stem, "error": "解析失败",
                          "file": f.name})
    return flows


def flow_exists(flow_id: str) -> bool:
    return bool(re.fullmatch(r"[A-Za-z0-9_\-]+", flow_id)) \
        and (FLOWS_DIR / f"{flow_id}.json").exists()


def read_flow_raw(flow_id: str) -> str:
    return (FLOWS_DIR / f"{flow_id}.json").read_text(encoding="utf-8")


def find_extract_refs(flow_json: dict) -> list[dict]:
    """提取流程步骤中 @extracts/xxx.js 引用及其内容（只读）。"""
    refs = []
    seen = set()
    raw = json.dumps(flow_json, ensure_ascii=False)
    for m in re.finditer(r'@(extracts/[A-Za-z0-9_\-./]+\.js)', raw):
        rel = m.group(1)
        if rel in seen:
            continue
        seen.add(rel)
        path = EXTRACTS_DIR.parent / rel
        item = {"path": rel, "exists": path.exists(), "content": None}
        if path.exists():
            try:
                item["content"] = path.read_text(encoding="utf-8")
            except OSError:
                item["exists"] = False
        refs.append(item)
    return refs


def last_run_of(flow_id: str, runs: list[dict] | None = None) -> dict | None:
    entries = runs if runs is not None else _read_jsonl(RUNS_FILE)
    for e in reversed(entries):
        if e.get("flow_id") == flow_id:
            return e
    return None


# ----------------------------------------------------------------------
# runs / heals / known_issues
# ----------------------------------------------------------------------

def list_runs(flow_id=None, limit=50, offset=0) -> dict:
    entries = _read_jsonl(RUNS_FILE)
    if flow_id:
        entries = [e for e in entries if e.get("flow_id") == flow_id]
    entries.reverse()  # 倒序：最新在前
    total = len(entries)
    return {"total": total, "items": entries[offset:offset + limit]}


def list_heals(limit=50, offset=0) -> dict:
    entries = _read_jsonl(HEALS_FILE)
    entries.reverse()
    total = len(entries)
    return {"total": total, "items": entries[offset:offset + limit]}


def get_heal_detail(heal_id: str) -> dict | None:
    """读取 logs/heals/<heal_id>.json + 同名提示词 MD（如有）。"""
    if not re.fullmatch(r"[A-Za-z0-9_\-]+", heal_id):
        return None
    ctx_file = HEALS_DIR / f"{heal_id}.json"
    if not ctx_file.exists():
        return None
    try:
        context = json.loads(ctx_file.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        context = None
    prompt = None
    for cand in (HEALS_DIR / f"{heal_id}.md", HEALS_DIR / f"{heal_id}_prompt.md"):
        if cand.exists():
            prompt = cand.read_text(encoding="utf-8")
            break
    return {"heal_id": heal_id, "context": context, "prompt": prompt}


def get_known_issues() -> list:
    if not KNOWN_ISSUES_FILE.exists():
        return []
    try:
        data = json.loads(KNOWN_ISSUES_FILE.read_text(encoding="utf-8"))
        return data if isinstance(data, list) else data.get("issues", [])
    except (OSError, json.JSONDecodeError):
        return []


# ----------------------------------------------------------------------
# stats（口径对齐 manager.py cmd_stats：最近 1000 次）
# ----------------------------------------------------------------------

def get_stats() -> dict:
    entries = _read_jsonl(RUNS_FILE)[-1000:]
    total = len(entries)
    by_flow: dict[str, dict] = {}
    for e in entries:
        fid = e.get("flow_id", "unknown")
        st = by_flow.setdefault(fid, {"total": 0, "success": 0, "last_run": None,
                                      "last_status": None})
        st["total"] += 1
        if e.get("status") == "success":
            st["success"] += 1
        st["last_run"] = e.get("timestamp")
        st["last_status"] = e.get("status")

    heals = _read_jsonl(HEALS_FILE)
    heal_by_flow: dict[str, int] = {}
    for h in heals:
        if h.get("event") == "triggered":
            fid = h.get("flow_id", "unknown")
            heal_by_flow[fid] = heal_by_flow.get(fid, 0) + 1

    flows_summary = []
    for fid, st in sorted(by_flow.items()):
        flows_summary.append({
            "flow_id": fid,
            "total": st["total"],
            "success": st["success"],
            "success_rate": round(st["success"] / st["total"] * 100) if st["total"] else 0,
            "last_run": st["last_run"],
            "last_status": st["last_status"],
            "heal_count": heal_by_flow.get(fid, 0),
        })

    return {
        "runs_total": total,
        "runs_success": sum(1 for e in entries if e.get("status") == "success"),
        "runs_failed": sum(1 for e in entries if e.get("status") == "failed"),
        "runs_error": sum(1 for e in entries if e.get("status") == "error"),
        "heals_total": len(heals),
        "flows": flows_summary,
    }
