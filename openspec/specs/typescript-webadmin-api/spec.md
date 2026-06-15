# typescript-webadmin-api Specification

## Purpose
TBD - created by archiving change add-typescript-webadmin-api. Update Purpose after archive.
## Requirements
### Requirement: WebAdmin API app package and local server
系统 SHALL 新增 TypeScript 应用 `apps/webadmin-api`，用于承载 WebAdmin 后端。该应用 MUST 使用 Fastify 作为 HTTP 服务框架，MUST 默认只监听 `127.0.0.1`，MUST NOT 提供绑定 `0.0.0.0` 的配置或命令行开关。该应用为唯一 WebAdmin 后端。

#### Scenario: local-only server binding
- **WHEN** 用户启动 `apps/webadmin-api`
- **THEN** 服务监听地址为 `127.0.0.1`，并且配置中不存在允许绑定 `0.0.0.0` 的选项

#### Scenario: WebAdmin API is sole backend
- **WHEN** 用户启动 WebAdmin
- **THEN** 通过 `pnpm --filter @ww-ai-lab/auto-ziniao-webadmin-api start` 启动唯一 WebAdmin 后端

### Requirement: WebAdmin API safety boundary
`apps/webadmin-api` SHALL NOT become a browser automation or direct ZClaw bridge outlet. It MUST NOT directly access `127.0.0.1:9481`, `/zclaw/tools`, `/zclaw/tools/invoke`, `ZCLAW_API_KEY` or `~/.zclaw/config.json`; MUST NOT open Chrome/Safari/Edge/Firefox/Chromium; MUST NOT depend on Playwright/Selenium/Puppeteer/browser-use; and MUST NOT provide any local-browser fallback when bridge-dependent execution fails.

#### Scenario: security scan rejects direct bridge access
- **WHEN** `apps/webadmin-api/src` contains direct bridge URL, `/zclaw/tools` path, ZClaw API key reads, or browser automation dependencies
- **THEN** `pnpm security:scan` fails and reports that WebAdmin API must use existing TS execution boundaries

#### Scenario: bridge failure has no browser fallback
- **WHEN** a real run is explicitly started through WebAdmin API and the ZClaw bridge is unavailable
- **THEN** the run fails with an environment error and WebAdmin API does not open any local browser or browser automation tool

### Requirement: Flow management API
WebAdmin API SHALL expose REST endpoints for flow management and flow authoring. It MUST list non-template flows, return flow detail with extract references, provide a flow template response, create new flow definitions from validated content or a server-owned template, validate flow content through `@ww-ai-lab/auto-ziniao-flow-engine`, save valid flow JSON with backup retention, reject invalid saves without mutating the existing flow, read and write extract scripts under the `extracts/` root with normalized allowlist path checks, and accept manual run requests with flow-level duplicate-run protection.

#### Scenario: list flows excludes template
- **WHEN** a client requests the flows list
- **THEN** the response includes repository flow definitions except `_template.json`, with recent run summary when available

#### Scenario: invalid flow save does not mutate file
- **WHEN** a client submits invalid JSON or a flow definition that fails TS flow validation
- **THEN** WebAdmin API returns a validation error and the existing `flows/<flow_id>.json` content remains unchanged

#### Scenario: manual run duplicate is rejected
- **WHEN** a flow already has an accepted running task and another manual run for the same flow is requested
- **THEN** WebAdmin API returns a conflict response or equivalent structured status without starting a second run

#### Scenario: create flow from server template
- **WHEN** a client submits `POST /api/flows` with `{ "id": "sample_flow", "name": "样例流程" }` and no existing `flows/sample_flow.json`
- **THEN** WebAdmin API creates a valid flow definition using a server-owned template, validates it, writes `flows/sample_flow.json`, and returns the created flow id and content

#### Scenario: duplicate flow creation is rejected
- **WHEN** a client submits `POST /api/flows` for an id whose `flows/<id>.json` already exists
- **THEN** WebAdmin API returns a conflict response and does not overwrite the existing file

#### Scenario: extract path traversal is rejected
- **WHEN** a client requests `GET /api/extracts/:name` or `PUT /api/extracts/:name` with a name that resolves outside the `extracts/` root
- **THEN** WebAdmin API rejects the request and does not read or write the target path

#### Scenario: extract can be saved and read
- **WHEN** a client saves `{ "content": "<script>" }` to `PUT /api/extracts/sample.js` and then requests `GET /api/extracts/sample.js`
- **THEN** WebAdmin API returns the same script content and metadata indicating the extract exists

### Requirement: Flow authoring API offline validation
WebAdmin API SHALL test flow authoring endpoints offline. Tests MUST use Fastify injection, temporary repo/data roots and mock runner dependencies; they MUST NOT call real ZClaw bridge, open a store, visit a page, execute a real flow through bridge, or open a local browser.

#### Scenario: authoring tests run offline
- **WHEN** `pnpm test` runs WebAdmin API tests for `POST /api/flows`, `GET /api/flows/template`, `GET /api/extracts/:name` and `PUT /api/extracts/:name`
- **THEN** the tests complete using temporary files and in-process HTTP injection without contacting `127.0.0.1:9481`

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
WebAdmin API SHALL provide chat session/message endpoints and an SSE message-send endpoint. It MUST persist chat sessions and messages in SQLite, expose available chat agent configurations from repository config without leaking secrets, serialize concurrent sends per session, emit structured SSE events, and support mock chat client tests without calling real OpenClaw Gateway, OpenClaw Agent CLI, Claude, Cursor, Feishu, or other external delivery commands. For real WebAdmin chat sends, the API MUST communicate with the local OpenClaw Gateway through RPC and MUST NOT implement the embedded WebAdmin chat by executing `openclaw agent`, `openclaw agent --deliver`, `--channel feishu`, or any external channel delivery path.

#### Scenario: chat session history persists
- **WHEN** a client creates a session, sends a message, and later requests session history
- **THEN** WebAdmin API returns the persisted user and assistant messages with status metadata

#### Scenario: concurrent send is rejected
- **WHEN** a session already has an in-progress send and the client submits another send for the same session
- **THEN** WebAdmin API returns a conflict response and does not launch a second chat RPC task

#### Scenario: SSE event contract
- **WHEN** a chat send request is accepted
- **THEN** WebAdmin API emits structured SSE events for accepted/start, delta or message content, done, error, and heartbeat as applicable

#### Scenario: WebAdmin chat uses OpenClaw Gateway RPC
- **WHEN** WebAdmin API processes a real chat send for an OpenClaw-backed agent
- **THEN** it calls the configured local OpenClaw Gateway RPC client with the session key and message content, persists the assistant result, and does not execute an Agent CLI command

#### Scenario: Gateway failure is reported without delivery fallback
- **WHEN** the configured OpenClaw Gateway is unreachable, times out, or returns an RPC error
- **THEN** WebAdmin API marks the assistant message as failed, emits an SSE error with a clear diagnostic, and does not retry through Feishu or any other external delivery channel

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

### Requirement: WebAdmin OpenClaw Gateway RPC configuration
WebAdmin API SHALL read WebAdmin chat Gateway settings from a WebAdmin-owned config section rather than from self-heal `heal.agents.*.command`. The configuration MUST support a local Gateway endpoint, agent identifier or session scope, and timeout. It MUST provide safe defaults for local development and MUST NOT require Feishu `chatId`, Feishu `openId`, or any external delivery target for embedded WebAdmin chat.

#### Scenario: chat config is separate from self-heal config
- **WHEN** repository config contains both self-heal agent command settings and WebAdmin chat Gateway settings
- **THEN** WebAdmin chat uses the WebAdmin Gateway settings, while self-heal continues to use its own Agent CLI adapter settings

#### Scenario: external delivery target is not required
- **WHEN** a user sends a message in `/chat` with only a local OpenClaw Gateway configured
- **THEN** the message is accepted without requiring Feishu or other external channel targets

### Requirement: Unified flow run history API
WebAdmin API SHALL expose a unified flow run history API for manual and scheduled flow executions. The API MUST support filtering by `flow_id`, `schedule_id`, `source`, `status`, `limit` and `offset`; MUST return newest entries first; MUST include `run_id`, `flow_id`, `source`, `schedule_id`, `schedule_run_id`, `params`, `status`, `started_at`, `finished_at`, `duration_ms`, `error`, `failed_step`, `data_summary`, `output_refs` and `heal_summary` when available; and MUST preserve backward-compatible summaries for historical entries that only exist in `data/logs/runs.jsonl`.

#### Scenario: filter runs for a flow
- **WHEN** a client requests `/api/flows/account_health/runs?limit=20`
- **THEN** WebAdmin API returns the latest `account_health` manual and scheduled runs with status, duration, error summary and heal summary when available

#### Scenario: historical JSONL entry without WebAdmin index
- **WHEN** `data/logs/runs.jsonl` contains an older `account_health` failure that has no WebAdmin SQLite correlation row
- **THEN** WebAdmin API still returns a history item for that run with a stable synthetic id and marks detail-only fields that are unavailable as null or empty

#### Scenario: pagination and filters are applied
- **WHEN** a client requests `/api/runs?flow_id=account_health&source=schedule&status=failed&limit=10&offset=10`
- **THEN** WebAdmin API returns at most 10 matching scheduled failed runs after the first 10 newest matches

### Requirement: Flow run detail API
WebAdmin API SHALL expose a run detail API that returns the complete diagnostic view for a single flow execution. The detail MUST include the run history fields plus the persisted flow result snapshot, `failed_step` metadata, resolved self-heal result, matching heal events from `learnings/heals.jsonl`, heal context/prompt paths, and safe links to output files when available. Missing files MUST be represented as unavailable status instead of causing a server error.

#### Scenario: failed manual run detail includes root diagnostics
- **WHEN** a manual `account_health` run fails at an extract step and the client requests `/api/runs/<run_id>`
- **THEN** WebAdmin API returns the failure error, `failed_step.step_id`, `failed_step.tool` or `failed_step.action`, failed args when available, and the flow-engine heal metadata

#### Scenario: heal detail is merged into run detail
- **WHEN** a failed run triggered self-heal and `learnings/heals.jsonl` contains an event for the run's `heal_id`
- **THEN** the run detail includes the self-heal status, `heal_id`, `error_type`, `agent`, `prompt_path`, `heal_log_path`, skip or failure reason, and a resolvable `/api/heals/:healId` reference

#### Scenario: missing heal files do not break run detail
- **WHEN** the run index references a `heal_id` but the corresponding heal context file has been deleted
- **THEN** WebAdmin API returns the run detail with heal file availability set to false and does not fail the whole request

### Requirement: WebAdmin run self-heal orchestration
WebAdmin API SHALL trigger self-heal for failed manual and scheduled runs using `@ww-ai-lab/auto-ziniao-self-heal` when the flow and request have not explicitly disabled heal and the failure is triggerable. This orchestration MUST match CLI semantics for validation failures, flow-level `on_fail_final.heal: false`, known issue hits, cooldown, Agent runner failure and timeout. Default tests MUST use a mock `AgentRunner` and MUST NOT call a real OpenClaw, Claude, Cursor or other Agent CLI.

#### Scenario: failed manual run triggers mock self-heal
- **WHEN** a WebAdmin manual flow run fails with a triggerable `failed_step` in an offline API test using a mock `AgentRunner`
- **THEN** WebAdmin API records the run as failed, calls `triggerHeal()`, stores the returned `heal_id` and self-heal status, and writes/returns a run detail that shows self-heal was triggered

#### Scenario: flow disables self-heal
- **WHEN** a flow run fails and its definition contains `on_fail_final.heal: false`
- **THEN** WebAdmin API records the run failure and marks self-heal as skipped because the flow disabled it

#### Scenario: known issue skips Agent call
- **WHEN** a failed run matches a resolved entry in `learnings/known_issues.json`
- **THEN** WebAdmin API records self-heal as skipped with reason `known_issue_matched` and does not call the Agent runner

### Requirement: Schedule run correlation with flow run detail
WebAdmin API SHALL correlate each scheduler-triggered execution with a flow run detail. `schedule_runs` MUST retain schedule-level trigger status, while each schedule run that attempted a flow execution MUST expose a `run_id` or equivalent detail reference that resolves through the unified run detail API.

#### Scenario: schedule history links to run detail
- **WHEN** a client requests `/api/schedules/<sid>/runs`
- **THEN** each item that executed a flow includes `run_id`, flow status, duration, error summary and heal summary

#### Scenario: schedule failure before flow execution
- **WHEN** a schedule trigger is invalid or disabled before `runFlow()` starts
- **THEN** WebAdmin API records the schedule failure or skipped state and returns no `run_id` for a flow execution that never happened

#### Scenario: duplicate running flow is visible
- **WHEN** a schedule fires while the same flow already has a running WebAdmin execution
- **THEN** WebAdmin API records a skipped or conflict run entry that is visible in both schedule history and flow run history

### Requirement: WebAdmin run observability offline validation
WebAdmin API SHALL provide offline tests for unified run history, run detail, manual run self-heal, schedule correlation, historical JSONL fallback and path-safe heal/output references. These tests MUST use Fastify injection, temporary repo/data roots, mock tool client, mock Agent runner, fixed clock and no-op sleeper.

#### Scenario: baseline validates observability without bridge
- **WHEN** `pnpm validate:baseline` runs WebAdmin API tests after this change is implemented
- **THEN** the observability tests pass without connecting to `127.0.0.1:9481`, without opening a local browser and without calling a real Agent CLI

### Requirement: Flow run heal summary includes Agent delivery diagnostics
WebAdmin API SHALL expose self-heal Agent delivery diagnostics in flow run status and detail responses when a failed flow run attempted self-heal and the configured Agent runner failed, timed out or was missing. The exposed `heal_summary` MUST include the existing `heal_id`、`error_type`、`agent`、`prompt_path`、`heal_log_path` fields plus safe diagnostic fields such as `cli_exit_code`、`cli_stderr`、`timed_out`、`command_missing` and `error` when available.

#### Scenario: manual run status shows Agent stderr
- **WHEN** a manual WebAdmin run fails and mock `AgentRunner` returns `exitCode: 1` with stderr `Delivering to Feishu requires target`
- **THEN** `/api/flow-runs/:token` returns `heal_summary.status: "failed"` and includes the stderr summary in `heal_summary.cli_stderr` or `heal_summary.error`

#### Scenario: run detail merges heal event diagnostics
- **WHEN** a persisted run references `heal_id` but its stored `heal_summary` lacks `cli_stderr`, and `learnings/heals.jsonl` contains a matching event with `cli_exit_code` and `cli_stderr`
- **THEN** `/api/runs/:runId` returns a `heal_summary` that includes the matching event diagnostics without failing if heal files are missing

#### Scenario: diagnostics do not replace flow error
- **WHEN** a flow fails with `Bridge 连接失败` and the Agent delivery also fails
- **THEN** WebAdmin API preserves the flow `error` as `Bridge 连接失败` and exposes the Agent delivery failure only under `heal_summary`

### Requirement: WebAdmin heal diagnostics remain offline and boundary-safe
WebAdmin API tests for Agent delivery diagnostics SHALL use mock `FlowToolClient` or local non-bridge flows, mock `AgentRunner`, temporary data roots and Fastify injection. Tests MUST NOT connect to `127.0.0.1:9481`, call `/zclaw/tools/invoke`, open a local browser, or call a real OpenClaw/Claude/Cursor command.

#### Scenario: delivery failure test is offline
- **WHEN** API tests cover a mock Agent non-zero exit after a failed flow run
- **THEN** the test completes without real bridge access, real browser automation or real Agent CLI execution

