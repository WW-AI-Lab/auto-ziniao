# typescript-webadmin-frontend Specification

## Purpose
TBD - created by archiving change prepare-webadmin-frontend-cutover. Update Purpose after archive.
## Requirements
### Requirement: WebAdmin frontend workspace app
系统 SHALL 提供 TypeScript 前端应用 `apps/webadmin-frontend`，用于承载迁移后的 WebAdmin React 前端。该应用 MUST 复用当前 `webadmin/frontend` 的 React + Vite + TypeScript + antd + `@ant-design/x` 技术栈和页面能力，workspace package name MUST 为 `@ziniao/webadmin-frontend`，构建产物 MUST 输出到 `apps/webadmin-frontend/dist`。

#### Scenario: frontend package builds dist
- **WHEN** 用户执行 WebAdmin frontend build 命令
- **THEN** `apps/webadmin-frontend/dist/index.html` 和静态 assets 被生成

#### Scenario: frontend source is under apps
- **WHEN** 检查 WebAdmin 前端源码位置
- **THEN** React source、public assets、Vite config 和 TS config 位于 `apps/webadmin-frontend`，不再以 `webadmin/frontend` 作为目标态源码目录

### Requirement: WebAdmin frontend API type reuse
WebAdmin frontend SHALL reuse WebAdmin API DTO types from `@ziniao/schemas` for shared API payloads. It MUST NOT maintain independent duplicate definitions for `FlowSummary`、`FlowDetail`、`Schedule`、`ScheduleRun`、`ChatSession`、`ChatMessage`、`ManualRunStatus` and other shared DTOs when equivalent schema types exist. UI-only view models MAY remain local when they do not represent API contracts.

#### Scenario: shared DTO imports from schemas
- **WHEN** frontend API client or pages type shared WebAdmin API responses
- **THEN** they import equivalent DTO types from `@ziniao/schemas` instead of redefining those API contract types locally

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

