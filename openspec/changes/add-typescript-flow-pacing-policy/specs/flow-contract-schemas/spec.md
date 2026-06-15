## ADDED Requirements

### Requirement: Pacing and confirmation schema
系统 SHALL 扩展 flow definition schema 以支持 TS 目标态 pacing 契约。`FlowDefinitionSchema` MUST 接收可选顶层 `pacing`；`FlowStepSchema` MUST 接收可选 `risk`、`pacing` 和 `confirm`。schema MUST 保留未知字段兼容历史 flow，但 MUST 对非法 `risk` 枚举、负数等待时间、非法 `jitter.ratio` 和非法 `confirm` 结构返回结构化校验错误。

#### Scenario: 合法 pacing schema
- **WHEN** schema 解析包含 `pacing.profile: "standard"`、`risk: "write"`、`pacing.afterMs: 1500` 的 flow
- **THEN** 解析成功，并保留这些字段供 TS flow-engine 使用

#### Scenario: 非法 risk
- **WHEN** schema 解析 step 中 `risk: "dangerous"`
- **THEN** 校验失败，错误信息包含该 step id 和非法 risk 值

#### Scenario: 负数等待时间
- **WHEN** schema 解析 step 中 `pacing.beforeMs: -1`
- **THEN** 校验失败，错误信息指出 pacing wait 值必须为非负数

### Requirement: Pacing static validation
系统 SHALL 在 flow contract 辅助校验中提供 pacing 相关 warning/error。`click_element`、`input_text`、`scroll_page`、`run_automation` 等操作类工具步骤未声明 `risk` 时 MUST 返回 warning。`risk: "critical"` 的 step 若缺少 `confirm` 且未显式豁免，MUST 返回 error。`risk: "write"` 或 `risk: "critical"` 的步骤若没有后置验证信号，MUST 返回 warning；后置验证信号包括 step `validate`、step 后紧邻 `assert` action、`wait_for_element`、`wait_for_navigation` 或显式 `pacing.postconditionExempt: true`。

#### Scenario: 操作步骤缺少 risk
- **WHEN** flow 中 `click_element` step 未声明 `risk`
- **THEN** `validateFlowContract()` 返回 warning code `missing_step_risk`

#### Scenario: critical 缺少 confirm
- **WHEN** flow 中 step 声明 `risk: "critical"` 但没有 `confirm` 或豁免
- **THEN** `validateFlowContract()` 返回 error code `critical_requires_confirm`

#### Scenario: write 缺少后置验证
- **WHEN** flow 中 step 声明 `risk: "write"` 且后续没有 validate/assert/wait 或豁免
- **THEN** `validateFlowContract()` 返回 warning code `missing_write_postcondition`

### Requirement: Flow runtime event schema
系统 SHALL 提供 flow runtime event 的 TypeScript schema 和类型定义。该 schema MUST 解析 `data/logs/flow_events.jsonl` 中的 pacing、confirm、budget 和 lock 事件，MUST 允许历史或后续事件携带额外字段，但 MUST 要求 `timestamp`、`run_id`、`flow_id` 和 `event`。事件 schema MUST 导出到 JSON Schema，以供未来 WebAdmin、CLI 或 Agent 工具复用。

#### Scenario: 解析 pacing event
- **WHEN** schema 解析 `{ "event": "pacing_wait", "timestamp": "...", "run_id": "r1", "flow_id": "orders_overview", "step_id": "s1", "wait_ms": 1000 }`
- **THEN** 解析成功，并识别 `wait_ms`

#### Scenario: 缺少必需字段
- **WHEN** schema 解析缺少 `flow_id` 的 runtime event
- **THEN** 解析失败，并返回结构化 schema issue

#### Scenario: JSON Schema export
- **WHEN** 用户执行 schema 导出命令
- **THEN** 导出的 JSON Schema 包含 flow definition 的 pacing 字段和 flow runtime event schema
