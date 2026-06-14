# flow-contract-schemas — Flow 与运行数据契约

## ADDED Requirements

### Requirement: Flow definition schema
系统 SHALL 提供 TypeScript 运行时 schema 与类型定义，用于解析当前 `flows/*.json` 的 flow definition。schema MUST 覆盖顶层字段 `id`、`name`、`version`、`enabled`、`schedule`、`description`、`retry`、`params`、`steps`、`on_success`、`on_fail_final`、`heal`，并 MUST 将 `_` 开头的 `params` key 视为注释字段，不参与参数声明校验。

#### Scenario: 解析当前 flow
- **WHEN** schema 解析 `flows/orders_overview.json`
- **THEN** 解析成功，并保留 `store_name` 参数、步骤数组、`heal.hints` 和 `@extracts/extract_orders_overview.js` 引用

#### Scenario: 缺少 steps
- **WHEN** schema 解析缺少非空 `steps` 数组的 flow
- **THEN** 返回结构化校验错误，不产生可执行 flow contract

### Requirement: Flow step schema
系统 SHALL 提供 flow step schema，覆盖 ZClaw `tool` 步骤与内置 `action` 步骤。schema MUST 识别当前合法工具名、内置动作、`save`、`condition`、`validate`、`on_fail`、`goto`、`branch`、`args.script` 的 `@extracts/*.js` 引用，并 MUST 保留未知字段以兼容历史 flow，但对未知工具名和非法 `on_fail.action` 报错。

#### Scenario: 合法工具步骤
- **WHEN** schema 解析使用 `execute_script` 且 `args.script` 为 `@extracts/extract_inventory.js` 的步骤
- **THEN** 步骤校验通过，并记录该步骤依赖的 extract 文件路径

#### Scenario: 非法 on_fail action
- **WHEN** schema 解析 `on_fail.action` 为未定义值的步骤
- **THEN** 返回校验错误，错误信息包含步骤 id 与非法 action

### Requirement: Branch, goto, condition, validate contracts
系统 SHALL 在 schema 或 schema 辅助校验中表达现有 flow DSL 的静态契约：步骤 id 唯一，`goto`、`action: goto`、`branch.cases[].goto`、`branch.default`、`on_fail.target` MUST 指向已有步骤 id 或 `end`；condition 类型 MUST 覆盖 `eq`、`ne`、`contains`、`not_contains`、`starts_with`、`is_true`、`is_false`、`gt`、`lt`、`is_empty`、`not_empty`；validate MUST 覆盖 `not_empty`、`min_rows`、`require_fields`、`contains`、`path`。

#### Scenario: 跳转目标存在
- **WHEN** schema 辅助校验解析 `switch_language` 中跳转到 `report_no_switch`、`click_settings` 和 `close_store` 的分支
- **THEN** 校验通过，因为所有目标步骤均存在

#### Scenario: 跳转目标不存在
- **WHEN** flow 步骤声明 `goto: "missing_step"`
- **THEN** 校验失败，错误信息指出跳转目标不存在

### Requirement: Runtime data schemas
系统 SHALL 提供长期数据文件的 TypeScript schema：`data/logs/runs.jsonl` 运行日志、`learnings/heals.jsonl` 自愈事件、`data/logs/heals/*.json` 失败上下文、`learnings/known_issues.json` 已知问题库，以及 WebAdmin 当前使用的 schedule/chat 数据 DTO。schema MUST 对历史缺失的可选字段提供兼容默认值或可选声明。

#### Scenario: 解析运行日志
- **WHEN** schema 解析一条由 Python `log_run()` 写入的运行日志
- **THEN** 识别 `flow_id`、`timestamp`、`status`、`duration_ms`、`error`、`params`、`data_summary`，并允许缺失可选字段

#### Scenario: known issue 命中数据
- **WHEN** schema 解析 `learnings/known_issues.json` 中 `resolved: true` 的 issue
- **THEN** 识别 `pattern`、`flow_id`、`step_id`、`root_cause`、`fix`、`fix_applied_at` 和 `resolved`

### Requirement: JSON Schema export
系统 SHALL 提供从 TypeScript schema 导出 JSON Schema 的能力，以便未来 WebAdmin 编辑器、Agent 工具或外部验证器复用同一契约。导出能力 MUST 与 TypeScript 类型同源，避免手写 JSON Schema 与运行时校验分叉。

#### Scenario: 导出 flow JSON Schema
- **WHEN** 用户执行 schema 导出命令
- **THEN** 系统生成 flow definition JSON Schema，并且该 schema 能用于校验当前 `flows/*.json`
