# typescript-webadmin-frontend Specification

## Purpose
TBD - created by archiving change prepare-webadmin-frontend-cutover. Update Purpose after archive.
## Requirements
### Requirement: WebAdmin frontend workspace app
系统 SHALL 提供 TypeScript 前端应用 `apps/webadmin-frontend`，用于承载迁移后的 WebAdmin React 前端。该应用 MUST 复用当前 `webadmin/frontend` 的 React + Vite + TypeScript + antd + `@ant-design/x` 技术栈和页面能力，workspace package name MUST 为 `@ww-ai-lab/auto-ziniao-webadmin-frontend`，构建产物 MUST 输出到 `apps/webadmin-frontend/dist`。

#### Scenario: frontend package builds dist
- **WHEN** 用户执行 WebAdmin frontend build 命令
- **THEN** `apps/webadmin-frontend/dist/index.html` 和静态 assets 被生成

#### Scenario: frontend source is under apps
- **WHEN** 检查 WebAdmin 前端源码位置
- **THEN** React source、public assets、Vite config 和 TS config 位于 `apps/webadmin-frontend`，不再以 `webadmin/frontend` 作为目标态源码目录

### Requirement: WebAdmin frontend API type reuse
WebAdmin frontend SHALL reuse WebAdmin API DTO types from `@ww-ai-lab/auto-ziniao-schemas` for shared API payloads. It MUST NOT maintain independent duplicate definitions for `FlowSummary`、`FlowDetail`、`Schedule`、`ScheduleRun`、`ChatSession`、`ChatMessage`、`ManualRunStatus` and other shared DTOs when equivalent schema types exist. UI-only view models MAY remain local when they do not represent API contracts.

#### Scenario: shared DTO imports from schemas
- **WHEN** frontend API client or pages type shared WebAdmin API responses
- **THEN** they import equivalent DTO types from `@ww-ai-lab/auto-ziniao-schemas` instead of redefining those API contract types locally

#### Scenario: UI-only types stay local
- **WHEN** a type only describes local form state or rendering state
- **THEN** it may remain in the frontend source and does not need a schema export

### Requirement: WebAdmin frontend offline validation
WebAdmin frontend SHALL be included in offline workspace validation. Default validation MUST typecheck and build the frontend without starting ZClaw bridge, without opening any browser, without executing real flow, and without calling real Agent CLI.

#### Scenario: frontend validation is offline
- **WHEN** user runs root validation or frontend validation commands
- **THEN** frontend typecheck/build completes without connecting to `127.0.0.1:9481`, launching a local browser, or calling Agent CLI

#### Scenario: frontend dependencies are scanned
- **WHEN** `pnpm security:scan` runs
- **THEN** dependencies and source under `apps/webadmin-frontend` are scanned for forbidden browser automation packages and direct bridge access

### Requirement: WebAdmin frontend same-origin API access
WebAdmin frontend SHALL access WebAdmin backend through same-origin `/api/*` paths in production. Development proxy MAY target `http://127.0.0.1:9482`, but frontend source MUST NOT directly access ZClaw bridge, read ZClaw API key, or call local browser automation.

#### Scenario: production API paths are same-origin
- **WHEN** frontend code calls WebAdmin REST or SSE APIs
- **THEN** requests use `/api/*` paths suitable for `apps/webadmin-api` static hosting

#### Scenario: no direct ZClaw access
- **WHEN** security scan checks frontend source
- **THEN** no frontend file contains direct `9481`、`/zclaw/tools`、`ZCLAW_API_KEY` or local browser automation fallback

### Requirement: Flow page run history and detail view
WebAdmin frontend SHALL let users inspect past flow executions from the `/flows` page. The flow list MUST provide a history/detail entry for each flow; the history view MUST show status, source, trigger time, duration, params summary, error summary and self-heal summary; and selecting a run MUST show the unified run detail returned by WebAdmin API.

#### Scenario: user opens account_health failure from flow list
- **WHEN** the user clicks the run history or detail action for `account_health` on `/flows`
- **THEN** the UI displays past `account_health` runs including the latest failed run, its failure reason and whether self-heal was triggered, skipped or failed

#### Scenario: run detail shows failed step
- **WHEN** the user selects a failed run whose API detail includes `failed_step`
- **THEN** the UI displays the failed step id, tool/action, error message and failed args when available

#### Scenario: run detail shows success result
- **WHEN** the user selects a successful run whose API detail includes `data_summary` or output references
- **THEN** the UI displays the success summary and safe output references instead of only showing a generic success tag

### Requirement: Schedule page run detail correlation
WebAdmin frontend SHALL let users inspect the full flow execution detail from the `/schedules` page. The expanded schedule run table MUST display schedule trigger status and MUST provide a detail action for entries that include `run_id`; that detail action MUST open the same run detail presentation used by `/flows`.

#### Scenario: user opens scheduled run detail
- **WHEN** the user expands a schedule on `/schedules` and clicks a run with `run_id`
- **THEN** the UI opens the unified run detail and shows the associated flow id, schedule id, status, params, failure details and self-heal status

#### Scenario: schedule preflight failure has no flow detail
- **WHEN** a schedule run failed before a flow execution and has no `run_id`
- **THEN** the UI shows the schedule-level error and does not present a broken flow detail link

### Requirement: Self-heal visibility in execution detail
WebAdmin frontend SHALL explicitly show self-heal status for failed runs. The UI MUST distinguish at least `not_triggered`, `triggered`, `skipped`, `success`, `failed`, `timeout`, `dry_run` and `disabled` states when present in API data; MUST show `heal_id`, `error_type`, Agent name, reason/error, and links or references for heal context and prompt when available; and MUST avoid claiming that self-heal ran when API data says it did not.

#### Scenario: failed run skipped by known issue
- **WHEN** a run detail contains `heal_summary.status = "skipped"` and reason `known_issue_matched`
- **THEN** the UI labels self-heal as skipped by known issue and does not describe it as OpenClaw executed

#### Scenario: failed run triggered OpenClaw
- **WHEN** a run detail contains a triggered self-heal event with `agent = "openclaw"`
- **THEN** the UI displays the agent name, `heal_id`, prompt/context references and final trigger result

### Requirement: Frontend run observability validation
WebAdmin frontend SHALL keep run observability type-safe and offline-validatable. Frontend API types MUST come from `@ww-ai-lab/auto-ziniao-schemas/webadmin`; validation MUST use typecheck/build and MUST NOT start ZClaw bridge, open a browser, execute a real flow or call a real Agent CLI.

#### Scenario: frontend builds with shared run DTOs
- **WHEN** frontend typecheck/build runs after the observability UI is implemented
- **THEN** `/flows` and `/schedules` compile using shared WebAdmin run DTOs from `@ww-ai-lab/auto-ziniao-schemas/webadmin`

### Requirement: Run detail separates flow failure from Agent delivery failure
WebAdmin frontend SHALL show flow execution failure and self-heal Agent delivery failure as separate diagnostic facts in the run detail view. The UI MUST preserve the flow error as the primary failure reason, and MUST show `heal_summary.status` plus Agent diagnostics such as `cli_exit_code`、`cli_stderr`、`timed_out`、`command_missing` or `error` when present.

#### Scenario: Bridge failure with Agent delivery failure
- **WHEN** `/api/runs/:runId` returns `error: "Bridge 连接失败"` and `heal_summary.status: "failed"` with `cli_stderr: "Delivering to Feishu requires target"`
- **THEN** the run detail view displays the flow failure reason separately from the self-heal Agent delivery diagnostic

#### Scenario: no diagnostic fields are hidden cleanly
- **WHEN** `heal_summary` only contains status and path fields
- **THEN** the run detail view does not render empty CLI diagnostic rows

### Requirement: Bridge-down template points to current TS retry entrypoint
The repository SHALL keep the global `bridge_down` self-heal template aligned with the current TypeScript CLI entrypoint. The template MUST instruct the Agent/user to retry with `pnpm auto-ziniao retry <flow_id>` or an equivalent current `pnpm auto-ziniao` command, and MUST NOT reference removed Python commands such as `manager.py retry`.

#### Scenario: template uses pnpm auto-ziniao retry
- **WHEN** `heal_templates/bridge_down.md` is inspected
- **THEN** it references `pnpm auto-ziniao retry {flow_id}` and does not reference `manager.py`

### Requirement: WebAdmin frontend flow authoring UI
WebAdmin frontend SHALL provide UI controls on the flows page to create a flow and edit extract scripts referenced by a flow. The UI MUST call same-origin `/api/*` endpoints, MUST reuse equivalent DTO types from `@ww-ai-lab/auto-ziniao-schemas`, and MUST NOT access ZClaw bridge, local filesystem paths, ZClaw API key, or local browser automation.

#### Scenario: create flow from flows page
- **WHEN** 用户在流程管理页输入 `flow_id` 和中文名并提交创建
- **THEN** frontend calls `POST /api/flows` with the form values, refreshes the flow list on success, and displays structured API errors on failure

#### Scenario: edit referenced extract
- **WHEN** 用户在 flow 编辑抽屉中打开一个 extract 引用
- **THEN** frontend calls `GET /api/extracts/:name` to load content and `PUT /api/extracts/:name` to save changes

#### Scenario: frontend authoring remains same-origin
- **WHEN** security scan checks frontend source after adding flow authoring UI
- **THEN** frontend source contains no direct `127.0.0.1:9481`、`/zclaw/tools`、`ZCLAW_API_KEY` or local browser automation fallback

### Requirement: Metadata-driven Agent selector
WebAdmin frontend SHALL render the chat Agent selector entirely from backend Agent metadata. The frontend MUST NOT hard-code supported Agent names, CLI commands, adapter-specific options or type-specific business logic for OpenClaw、codex、Claude Code or future Agents.

#### Scenario: new backend Agent appears without frontend code change
- **WHEN** `/api/chat/agents` returns a new available Agent item with standard metadata
- **THEN** the chat selector displays and can select that Agent without frontend source changes for that Agent type

#### Scenario: unavailable Agent is shown generically
- **WHEN** an Agent item has `available: false` and diagnostic text
- **THEN** the frontend shows the unavailable state using generic metadata and prevents sending with that Agent

### Requirement: Chat Agent choice is remembered
WebAdmin frontend SHALL persist Agent selection through WebAdmin API. Changing the active session Agent MUST update the session and request default preference persistence; creating a new session MUST rely on the API-provided default/effective Agent instead of frontend-only local defaults.

#### Scenario: selected Agent is next default
- **WHEN** the user selects Claude Code in the chat selector
- **THEN** the next new chat session defaults to Claude Code if the backend still marks it available

#### Scenario: reload uses backend default
- **WHEN** the chat page reloads after the user selected codex
- **THEN** the page fetches backend Agent metadata/default and uses codex for new sessions if still available

### Requirement: Frontend remains API-only
WebAdmin frontend SHALL access Agent data only through same-origin WebAdmin API and shared schemas. It MUST NOT read repo config, inspect local PATH, execute local commands, access ZClaw bridge, open local browsers or import browser automation dependencies.

#### Scenario: frontend builds with shared DTOs
- **WHEN** frontend typecheck/build runs
- **THEN** Agent selector code compiles using shared WebAdmin DTO types

#### Scenario: security scan finds no local execution
- **WHEN** `pnpm security:scan` inspects frontend source
- **THEN** no frontend file invokes Agent CLI, opens local browser or accesses ZClaw bridge

