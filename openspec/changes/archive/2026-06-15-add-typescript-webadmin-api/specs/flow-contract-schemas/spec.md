## MODIFIED Requirements

### Requirement: Runtime data schemas
系统 SHALL 提供长期数据文件和 WebAdmin API 数据传输对象的 TypeScript schema：`data/logs/runs.jsonl` 运行日志、`learnings/heals.jsonl` 自愈事件、`data/logs/heals/*.json` 失败上下文、`learnings/known_issues.json` 已知问题库，以及 WebAdmin 当前使用和 M6 `apps/webadmin-api` 需要的 schedule、schedule run、chat session、chat message、flow summary/detail、manual run status、output file entry、SSE event 和统一错误响应 DTO。schema MUST 对历史缺失的可选字段提供兼容默认值或可选声明，MUST 继续通过 Zod 与 TypeScript 类型同源维护，并 MUST 可导出 JSON Schema 供未来前端和外部验证复用。

#### Scenario: 解析运行日志
- **WHEN** schema 解析一条由 Python `log_run()` 写入的运行日志
- **THEN** 识别 `flow_id`、`timestamp`、`status`、`duration_ms`、`error`、`params`、`data_summary`，并允许缺失可选字段

#### Scenario: known issue 命中数据
- **WHEN** schema 解析 `learnings/known_issues.json` 中 `resolved: true` 的 issue
- **THEN** 识别 `pattern`、`flow_id`、`step_id`、`root_cause`、`fix`、`fix_applied_at` 和 `resolved`

#### Scenario: WebAdmin schedule DTO
- **WHEN** schema 解析 `apps/webadmin-api` 返回的 schedule 和 schedule run 数据
- **THEN** 识别 `id`、`flow_id`、`params`、`trigger`、`enabled`、`next_run_at`、`latest_run`、`status`、`duration_ms` 和 `error` 等字段，并允许兼容扩展字段

#### Scenario: WebAdmin chat SSE DTO
- **WHEN** schema 解析 WebAdmin chat SSE event
- **THEN** 识别 accepted/start、delta、done、error 和 heartbeat 事件中的类型、session id、message id、content delta、status 和 error 字段

#### Scenario: WebAdmin flow and output DTO
- **WHEN** schema 解析 WebAdmin flow summary/detail、manual run status 或 output file entry 响应
- **THEN** 识别 flow id、name、version、enabled、params、extract references、running 状态、run token/status、文件路径、大小和预览元数据

#### Scenario: WebAdmin error response DTO
- **WHEN** schema 解析 WebAdmin API 的错误响应
- **THEN** 识别稳定 `error.code`、`error.message` 和可选 `error.details`，且不得要求包含堆栈或本地 secret
