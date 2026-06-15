# typescript-webadmin-api Specification

## Purpose
TBD - created by archiving change add-typescript-webadmin-api. Update Purpose after archive.
## Requirements
### Requirement: WebAdmin API app package and local server
系统 SHALL 新增 TypeScript 应用 `apps/webadmin-api`，用于承载 M6 WebAdmin 后端。该应用 MUST 使用 Fastify 作为 HTTP 服务框架，MUST 默认只监听 `127.0.0.1`，MUST NOT 提供绑定 `0.0.0.0` 的配置或命令行开关，MUST NOT 替换 `python3 manager.py ...` 生产入口。

#### Scenario: local-only server binding
- **WHEN** 用户启动 `apps/webadmin-api`
- **THEN** 服务监听地址为 `127.0.0.1`，并且配置中不存在允许绑定 `0.0.0.0` 的选项

#### Scenario: Python production entry remains unchanged
- **WHEN** M6 实现完成后用户执行 `python3 manager.py list`
- **THEN** 命令仍通过现有 Python 入口执行，不依赖 `apps/webadmin-api` 构建产物

### Requirement: WebAdmin API safety boundary
`apps/webadmin-api` SHALL NOT become a browser automation or direct ZClaw bridge outlet. It MUST NOT directly access `127.0.0.1:9481`, `/zclaw/tools`, `/zclaw/tools/invoke`, `ZCLAW_API_KEY` or `~/.zclaw/config.json`; MUST NOT open Chrome/Safari/Edge/Firefox/Chromium; MUST NOT depend on Playwright/Selenium/Puppeteer/browser-use; and MUST NOT provide any local-browser fallback when bridge-dependent execution fails.

#### Scenario: security scan rejects direct bridge access
- **WHEN** `apps/webadmin-api/src` contains direct bridge URL, `/zclaw/tools` path, ZClaw API key reads, or browser automation dependencies
- **THEN** `pnpm security:scan` fails and reports that WebAdmin API must use existing TS execution boundaries

#### Scenario: bridge failure has no browser fallback
- **WHEN** a real run is explicitly started through WebAdmin API and the ZClaw bridge is unavailable
- **THEN** the run fails with an environment error and WebAdmin API does not open any local browser or browser automation tool

### Requirement: Flow management API
WebAdmin API SHALL expose REST endpoints for flow management equivalent to the current Python WebAdmin backend. It MUST list non-template flows, return flow detail with extract references, validate flow content through `@ziniao/flow-engine`, save valid flow JSON with backup retention, reject invalid saves without mutating the existing flow, and accept manual run requests with flow-level duplicate-run protection.

#### Scenario: list flows excludes template
- **WHEN** a client requests the flows list
- **THEN** the response includes repository flow definitions except `_template.json`, with recent run summary when available

#### Scenario: invalid flow save does not mutate file
- **WHEN** a client submits invalid JSON or a flow definition that fails TS flow validation
- **THEN** WebAdmin API returns a validation error and the existing `flows/<flow_id>.json` content remains unchanged

#### Scenario: manual run duplicate is rejected
- **WHEN** a flow already has an accepted running task and another manual run for the same flow is requested
- **THEN** WebAdmin API returns a conflict response or equivalent structured status without starting a second run

### Requirement: Monitoring and output API
WebAdmin API SHALL expose read-only monitoring endpoints for current runtime artifacts. It MUST read `data/logs/runs.jsonl`, `learnings/heals.jsonl`, `data/logs/heals/`, `learnings/known_issues.json` and `data/output/` using existing schema-compatible file formats, and MUST protect output/log file access with normalized allowlist path checks.

#### Scenario: run history reads existing JSONL
- **WHEN** a client requests run history with optional flow filter and pagination
- **THEN** WebAdmin API returns schema-compatible run log entries from `data/logs/runs.jsonl` without rewriting the log file

#### Scenario: path traversal is rejected
- **WHEN** a client requests an output or log path containing `..`, encoded traversal, or an absolute path outside allowed roots
- **THEN** WebAdmin API rejects the request and does not read the target file

### Requirement: SQLite-backed schedules and scheduler
WebAdmin API SHALL manage schedules in SQLite-owned tables and run an in-process scheduler for WebAdmin-owned tasks. It MUST support schedule CRUD, enable/disable, trigger types `interval`、`daily` and five-field `cron`, `next_run_at` calculation, schedule run history, flow-level locks, timeout/failure/skipped status, and missed-trigger no-backfill behavior.

#### Scenario: schedule trigger validation
- **WHEN** a client creates or updates a schedule with invalid trigger configuration
- **THEN** WebAdmin API rejects the request and does not persist the invalid schedule

#### Scenario: due schedule runs once
- **WHEN** an enabled schedule reaches `next_run_at`
- **THEN** the scheduler accepts one run, records a `schedule_runs` entry, and updates the next run time into the future

#### Scenario: missed schedule is not backfilled
- **WHEN** WebAdmin API restarts after one or more missed trigger times
- **THEN** the scheduler recalculates the next run time into the future and does not replay all missed runs

### Requirement: Agent chat API and SSE events
WebAdmin API SHALL provide chat session/message endpoints and an SSE message-send endpoint. It MUST persist chat sessions and messages in SQLite, expose available agent configurations from repository config without leaking secrets, serialize concurrent sends per session, emit structured SSE events, and support mock Agent runner tests without calling real OpenClaw/Claude/Cursor commands.

#### Scenario: chat session history persists
- **WHEN** a client creates a session, sends a message, and later requests session history
- **THEN** WebAdmin API returns the persisted user and assistant messages with status metadata

#### Scenario: concurrent send is rejected
- **WHEN** a session already has an in-progress send and the client submits another send for the same session
- **THEN** WebAdmin API returns a conflict response and does not launch a second agent task

#### Scenario: SSE event contract
- **WHEN** a chat send request is accepted
- **THEN** WebAdmin API emits structured SSE events for accepted/start, delta or message content, done, error, and heartbeat as applicable

### Requirement: Static frontend dist serving
WebAdmin API SHALL serve the migrated frontend build output from `apps/webadmin-frontend/dist` and provide SPA fallback for non-API routes. Missing frontend dist MUST return an API-readable status instead of failing server startup. The application MAY allow tests or explicit config to inject another dist path, but the default repo-local production path MUST be `apps/webadmin-frontend/dist`.

#### Scenario: migrated frontend dist served
- **WHEN** `apps/webadmin-frontend/dist/index.html` exists and a client requests `/`
- **THEN** WebAdmin API returns the built frontend entrypoint and serves its static assets

#### Scenario: missing frontend dist keeps API available
- **WHEN** `apps/webadmin-frontend/dist` is absent
- **THEN** WebAdmin API still starts and returns a clear status for frontend requests while REST/SSE API endpoints remain available

### Requirement: WebAdmin API offline validation
WebAdmin API SHALL provide offline unit/integration tests and baseline validation. Tests MUST use Fastify injection or equivalent in-process requests, temporary repo/data root, mock tool client, mock Agent runner, fixed clock and no-op sleeper. Default validation MUST NOT open a store, visit a page, execute script through real bridge, call `POST /zclaw/tools/invoke`, or call real Agent CLI.

#### Scenario: API tests run offline
- **WHEN** `pnpm test` or `pnpm validate:baseline` runs WebAdmin API tests
- **THEN** tests do not require ZClaw bridge, purple-bird client, local browser, or real Agent CLI

#### Scenario: baseline includes WebAdmin API
- **WHEN** root baseline validation is executed
- **THEN** WebAdmin API typecheck, tests, build and security scan are included in the default verification path

### Requirement: WebAdmin cutover evidence
WebAdmin API SHALL provide M7 preflight evidence that the TypeScript WebAdmin backend can serve the migrated frontend and cover the current core WebAdmin API surface offline. Evidence MUST include route/injection tests or smoke output for flows, monitoring, schedules, chat SSE, static frontend present, static frontend missing, and local-only manual run behavior.

#### Scenario: WebAdmin API smoke evidence exists
- **WHEN** implementation finishes this change
- **THEN** tasks or docs record the commands and results for WebAdmin API tests/smoke covering core routes and static frontend serving

#### Scenario: evidence does not require real bridge
- **WHEN** WebAdmin API smoke evidence is generated
- **THEN** it uses mock tool client, mock Agent runner, temporary data root or local-only flow and does not call real ZClaw bridge

