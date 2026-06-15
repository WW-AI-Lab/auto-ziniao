## ADDED Requirements

### Requirement: WebAdmin production backend
系统 SHALL 将 `apps/webadmin-api` 作为 M7 后 WebAdmin 生产后端。WebAdmin 启动、调度、Agent chat、运行观测、flow 管理和静态前端托管 MUST 由 TypeScript WebAdmin API 承载；MUST NOT 依赖 FastAPI、uvicorn、`webadmin/**/*.py` 或 `webadmin/requirements.txt`。

#### Scenario: WebAdmin starts from TS app
- **WHEN** 用户启动 WebAdmin 生产服务
- **THEN** 服务从 `apps/webadmin-api` 的 TS 构建产物或 workspace script 启动，不调用 `python3 -m webadmin`

#### Scenario: FastAPI backend is absent
- **WHEN** 检查 M7 后 tracked files
- **THEN** 不存在 FastAPI WebAdmin 后端源码、Python WebAdmin tests 或 `webadmin/requirements.txt`

## MODIFIED Requirements

### Requirement: WebAdmin API app package and local server
系统 SHALL 提供 TypeScript 应用 `apps/webadmin-api`，用于承载 M7 后 WebAdmin 生产后端。该应用 MUST 使用 Fastify 作为 HTTP 服务框架，MUST 默认只监听 `127.0.0.1`，MUST NOT 提供绑定 `0.0.0.0` 的配置或命令行开关，MUST NOT 依赖 Python WebAdmin 或 `python3 manager.py ...` 生产入口。

#### Scenario: local-only server binding
- **WHEN** 用户启动 `apps/webadmin-api`
- **THEN** 服务监听地址为 `127.0.0.1`，并且配置中不存在允许绑定 `0.0.0.0` 的选项

#### Scenario: Python production entry is not required
- **WHEN** M7 实现完成后用户启动 WebAdmin API 或请求 flows 列表
- **THEN** 命令通过 TS WebAdmin 后端执行，不依赖 `python3 manager.py`、`engine/*.py` 或 Python WebAdmin 构建产物

### Requirement: Static frontend dist serving
WebAdmin API SHALL serve the M7 production frontend build output from the finalized TS frontend dist path and provide SPA fallback for non-API routes. The dist path MUST come from the prior WebAdmin frontend consolidation stage, and missing frontend dist MUST return an API-readable status instead of failing server startup. M7 MUST NOT serve from a Python-owned WebAdmin backend.

#### Scenario: finalized frontend dist served
- **WHEN** the finalized frontend dist `index.html` exists and a client requests `/`
- **THEN** WebAdmin API returns the built frontend entrypoint and serves its static assets

#### Scenario: missing frontend dist keeps API available
- **WHEN** the finalized frontend dist is absent
- **THEN** WebAdmin API still starts and returns a clear status for frontend requests while REST/SSE API endpoints remain available
