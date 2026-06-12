"""API 层冒烟测试（FastAPI TestClient，不启动 lifespan/调度线程）。"""

import json

from fastapi.testclient import TestClient

from webadmin.app import create_app

client = TestClient(create_app(), raise_server_exceptions=False)


# ----------------------------------------------------------------------
# 统一错误结构（spec: web-admin-server）
# ----------------------------------------------------------------------

def test_not_found_error_structure():
    resp = client.get("/api/flows/not_exist_flow")
    assert resp.status_code == 404
    body = resp.json()
    assert body["error"]["code"] == "not_found"
    assert "message" in body["error"]


def test_validation_error_structure():
    resp = client.post("/api/schedules", json={"name": "x"})
    assert resp.status_code == 422
    assert resp.json()["error"]["code"] == "validation_error"


# ----------------------------------------------------------------------
# flows（spec: flow-management）
# ----------------------------------------------------------------------

def test_list_flows_excludes_template():
    resp = client.get("/api/flows")
    assert resp.status_code == 200
    ids = [f["id"] for f in resp.json()["items"]]
    assert "_template" not in ids
    assert len(ids) > 0


def test_get_flow_detail_with_extracts():
    flow_id = client.get("/api/flows").json()["items"][0]["id"]
    resp = client.get(f"/api/flows/{flow_id}")
    assert resp.status_code == 200
    data = resp.json()
    assert json.loads(data["content"])["id"] == flow_id
    assert isinstance(data["extracts"], list)


def test_save_invalid_json_rejected():
    flow_id = client.get("/api/flows").json()["items"][0]["id"]
    before = client.get(f"/api/flows/{flow_id}").json()["content"]
    resp = client.put(f"/api/flows/{flow_id}", json={"content": "{not json"})
    assert resp.status_code == 400
    # 原文件未被修改
    after = client.get(f"/api/flows/{flow_id}").json()["content"]
    assert before == after


def test_save_mismatched_id_rejected():
    flow_id = client.get("/api/flows").json()["items"][0]["id"]
    resp = client.put(f"/api/flows/{flow_id}",
                      json={"content": '{"id": "other", "steps": [{"id": "s1", "action": "print"}]}'})
    assert resp.status_code == 400


def test_validate_endpoint():
    flow_id = client.get("/api/flows").json()["items"][0]["id"]
    content = client.get(f"/api/flows/{flow_id}").json()["content"]
    resp = client.post(f"/api/flows/{flow_id}/validate", json={"content": content})
    assert resp.status_code == 200
    assert resp.json()["valid"] is True


# ----------------------------------------------------------------------
# 路径安全（spec: web-admin-server）
# ----------------------------------------------------------------------

def test_output_traversal_rejected():
    for evil in ("../../etc/passwd", ".."):
        resp = client.get("/api/outputs", params={"path": evil})
        assert resp.status_code == 400, evil
        assert resp.json()["error"]["code"] == "bad_request"
    # 双重编码后的 %2F 是字面文件名，不越界（404 目录不存在即安全）
    resp = client.get("/api/outputs", params={"path": "..%2F..%2Fetc%2Fpasswd"})
    assert resp.status_code in (400, 404)


def test_output_download_traversal_rejected():
    resp = client.get("/api/outputs/download", params={"path": "../config.json"})
    assert resp.status_code == 400


def test_output_browse_root():
    resp = client.get("/api/outputs")
    assert resp.status_code == 200
    assert "files" in resp.json()


# ----------------------------------------------------------------------
# schedules（spec: task-scheduler）
# ----------------------------------------------------------------------

def _first_flow_id():
    return client.get("/api/flows").json()["items"][0]["id"]


def test_schedule_crud_lifecycle():
    # 创建
    resp = client.post("/api/schedules", json={
        "name": "测试任务",
        "flow_id": _first_flow_id(),
        "trigger": {"type": "interval", "minutes": 60},
    })
    assert resp.status_code == 200
    sched = resp.json()
    assert sched["next_run_at"]
    sid = sched["id"]

    # 列表
    items = client.get("/api/schedules").json()["items"]
    assert any(s["id"] == sid for s in items)

    # 修改触发方式
    resp = client.put(f"/api/schedules/{sid}",
                      json={"trigger": {"type": "daily", "time": "08:30"}})
    assert resp.status_code == 200
    assert "08:30" in resp.json()["next_run_at"]

    # 停用
    resp = client.put(f"/api/schedules/{sid}", json={"enabled": False})
    assert resp.json()["enabled"] is False

    # 历史（空）
    assert client.get(f"/api/schedules/{sid}/runs").json()["items"] == []

    # 删除
    assert client.delete(f"/api/schedules/{sid}").json()["deleted"] is True
    assert client.get(f"/api/schedules/{sid}").status_code == 404


def test_schedule_unknown_flow_rejected():
    resp = client.post("/api/schedules", json={
        "name": "x", "flow_id": "no_such_flow",
        "trigger": {"type": "interval", "minutes": 5},
    })
    assert resp.status_code == 400


def test_schedule_bad_cron_rejected():
    resp = client.post("/api/schedules", json={
        "name": "x", "flow_id": _first_flow_id(),
        "trigger": {"type": "cron", "expr": "0 8 * * MON#2"},
    })
    assert resp.status_code == 400
    assert "cron" in resp.json()["error"]["message"]


# ----------------------------------------------------------------------
# 观测（spec: run-monitoring）
# ----------------------------------------------------------------------

def test_runs_and_stats():
    resp = client.get("/api/runs", params={"limit": 5})
    assert resp.status_code == 200
    assert "items" in resp.json()

    resp = client.get("/api/stats")
    assert resp.status_code == 200
    data = resp.json()
    assert "flows" in data and "schedules" in data


def test_heals_and_known_issues():
    assert client.get("/api/heals").status_code == 200
    assert client.get("/api/known-issues").status_code == 200


# ----------------------------------------------------------------------
# chat（spec: agent-chat，不实际调用 agent）
# ----------------------------------------------------------------------

def test_chat_agents_from_config():
    resp = client.get("/api/chat/agents")
    assert resp.status_code == 200
    names = [a["name"] for a in resp.json()["items"]]
    assert "openclaw" in names


def test_chat_session_crud():
    resp = client.post("/api/chat/sessions", json={"title": "测试会话"})
    assert resp.status_code == 200
    sid = resp.json()["id"]

    assert any(s["id"] == sid
               for s in client.get("/api/chat/sessions").json()["items"])

    resp = client.get(f"/api/chat/sessions/{sid}/messages")
    assert resp.json()["items"] == []

    resp = client.put(f"/api/chat/sessions/{sid}", json={"title": "改名"})
    assert resp.json()["title"] == "改名"

    assert client.delete(f"/api/chat/sessions/{sid}").json()["deleted"] is True
    assert client.get(f"/api/chat/sessions/{sid}/messages").status_code == 404


def test_chat_unknown_agent_rejected():
    resp = client.post("/api/chat/sessions",
                       json={"title": "x", "agent": "no_such_agent"})
    assert resp.status_code == 400


def test_chat_empty_message_rejected():
    sid = client.post("/api/chat/sessions", json={"title": "t"}).json()["id"]
    resp = client.post(f"/api/chat/sessions/{sid}/messages",
                       json={"content": "  "})
    assert resp.status_code == 400
    client.delete(f"/api/chat/sessions/{sid}")
