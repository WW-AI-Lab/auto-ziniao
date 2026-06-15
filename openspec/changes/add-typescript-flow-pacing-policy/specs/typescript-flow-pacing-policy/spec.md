## ADDED Requirements

### Requirement: Flow pacing policy contract
系统 SHALL 定义迁移后 TypeScript flow 的 pacing policy 契约。flow 顶层 `pacing` MUST 支持 `profile`、`jitter`、`limits`、`defaults` 和 `budgets`；step 级 `pacing` MUST 能覆写当前步骤的 `beforeMs`、`afterMs`、`timeoutMs`、`requiresConfirm` 和 `reason`；step 级 `risk` MUST 支持 `read`、`navigate`、`write`、`critical`。未声明 pacing 的历史 flow MUST 使用兼容默认值并可继续解析。

#### Scenario: 历史 flow 未声明 pacing
- **WHEN** TS schema 解析当前 `flows/orders_overview.json`
- **THEN** 解析成功，并为 runtime 提供兼容默认 pacing policy

#### Scenario: step 覆写 pacing
- **WHEN** flow 顶层声明 `pacing.defaults.write.afterMs: 3000`，某个 step 声明 `risk: "write"` 且 `pacing.afterMs: 1000`
- **THEN** runtime 对该 step 使用 `afterMs: 1000`，而不是 flow 默认的 `3000`

### Requirement: Risk-aware confirmation gate
系统 SHALL 为 `risk: "critical"` 的步骤提供确认门槛。critical 步骤 MUST 默认要求 `confirm` 配置或显式豁免；runtime MUST 在执行该步骤前检查确认授权。确认授权 MUST 可通过 `confirm.allowParam` 指向的运行参数表达；未配置 `allowParam` 时 MUST 使用标准参数 `allow_critical`。确认拒绝 MUST 产生结构化 failure，且不得调用该 step 的 ZClaw tool 或 action。

#### Scenario: critical step 被授权
- **WHEN** step 声明 `risk: "critical"`、`confirm.allowParam: "allow_submit"`，且运行参数包含 `{ "allow_submit": true }`
- **THEN** flow-engine 允许执行该 step，并继续应用该 step 的 pacing policy

#### Scenario: critical step 未授权
- **WHEN** step 声明 `risk: "critical"`，但运行参数未包含 truthy 的 `allow_critical` 或 `confirm.allowParam`
- **THEN** flow-engine 在调用工具前返回 `confirm_rejected` failure，并记录当前 `step_id`

### Requirement: Pacing runtime events
系统 SHALL 为 TS flow-engine 产生的 pacing、确认和预算决策记录结构化 runtime event。事件 MUST 至少覆盖 `pacing_wait`、`confirm_rejected`、`budget_rejected`、`store_lock_wait`、`store_lock_acquired`、`store_lock_released`。事件 MUST 包含 `timestamp`、`run_id`、`flow_id`、`step_id`、`event`，并在可用时包含 `store_id`、`store_name`、`risk`、`wait_ms`、`reason`、`profile`。事件 MUST 追加到 `data/logs/flow_events.jsonl`，并能被 `packages/schemas` 的 runtime event schema 解析。

#### Scenario: 记录 pacing wait
- **WHEN** flow-engine 在 `risk: "write"` 的 step 后等待 3000ms
- **THEN** `data/logs/flow_events.jsonl` 追加一条 `event: "pacing_wait"` 且 `wait_ms: 3000` 的事件

#### Scenario: 记录确认拒绝
- **WHEN** critical step 因缺少授权被拒绝
- **THEN** `data/logs/flow_events.jsonl` 追加一条 `event: "confirm_rejected"` 的事件，并且该事件通过 schema 校验

### Requirement: Execution budgets and store serialization
系统 SHALL 在 TS flow-engine 中提供最小执行预算与同店铺串行保护。runtime MUST 支持 per-store concurrency、per-flow concurrency、max consecutive failures、max run per day 的 policy 字段；首版实现 MAY 只在同一 Node 进程内生效，但 MUST 对外暴露清晰的 policy rejection failure 和 runtime event。预算或锁拒绝 MUST 不调用目标 step 的工具。

#### Scenario: 同店铺串行
- **WHEN** 两个 run 在同一进程内使用相同 `storeId` 或 `params.store_name`，且 policy 声明 `perStoreConcurrency: 1`
- **THEN** 第二个 run 必须等待锁释放或返回结构化 `budget_rejected`，不得并发执行同店铺工具步骤

#### Scenario: 连续失败熔断
- **WHEN** 同一 flow 在同一 runtime registry 中连续失败次数达到 `maxConsecutiveFailures`
- **THEN** 后续 run 在执行第一个工具步骤前返回 `budget_rejected`，并记录 failure reason

### Requirement: Deterministic offline pacing verification
系统 SHALL 支持确定性的离线 pacing 测试。runtime MUST 允许注入 `sleeper`、`clock` 和 deterministic random 或关闭 jitter；默认 baseline MUST 使用 mock tool client、fake sleeper、fixed clock 和临时 `dataRoot`。离线测试 MUST NOT 调用真实 `POST /zclaw/tools/invoke`，MUST NOT 打开店铺浏览器，MUST NOT 调用真实 Agent CLI。

#### Scenario: fake sleeper 验证等待
- **WHEN** 测试运行包含 `beforeMs: 1000` 和 `afterMs: 2000` 的 flow
- **THEN** fake sleeper 记录 `[1000, 2000]`，测试不等待真实时间

#### Scenario: baseline 不触发真实 bridge
- **WHEN** 用户执行 `pnpm validate:baseline`
- **THEN** pacing 测试使用 mock tool client 完成，不连接 `127.0.0.1:9481`
