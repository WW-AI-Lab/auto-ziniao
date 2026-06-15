## ADDED Requirements

### Requirement: Pacing policy resolution
系统 SHALL 在 `packages/flow-engine` 中实现 pacing policy resolution。runtime MUST 从内置默认策略、flow 顶层 `pacing` 和 step 级 `pacing` 合并出当前 step 的有效策略，合并顺序 MUST 为 `built-in default < flow.pacing < step.pacing`。runtime MUST 根据 step `risk` 选择默认等待策略；未声明 `risk` 时 MUST 使用 `read` 默认策略并保留 schema warning。

#### Scenario: 合并 step 覆写
- **WHEN** flow 顶层声明 `write.afterMs: 3000`，step 声明 `risk: "write"` 和 `pacing.afterMs: 500`
- **THEN** flow-engine 对该 step 使用 `afterMs: 500`

#### Scenario: 未声明 risk 使用 read 默认
- **WHEN** step 未声明 `risk`
- **THEN** flow-engine 使用 `read` 默认 pacing 策略执行该 step

### Requirement: Pacing wait scheduling
系统 SHALL 在 step 执行前后应用 pacing wait。runtime MUST 在调用 tool/action 前执行 `beforeMs` wait，在 step 成功或失败后按策略执行 `afterMs` wait；等待 MUST 通过注入的 `sleeper` 完成，不得在测试中强制等待真实时间。runtime MUST 为每次 wait 写入 `pacing_wait` event，并包含 wait reason。

#### Scenario: before and after wait
- **WHEN** step 的有效 pacing 为 `beforeMs: 1000`、`afterMs: 2000`
- **THEN** flow-engine 在执行 step 前调用 `sleeper(1000)`，执行后调用 `sleeper(2000)`

#### Scenario: wait event
- **WHEN** flow-engine 执行 pacing wait
- **THEN** `data/logs/flow_events.jsonl` 中追加 `pacing_wait` event，包含 `flow_id`、`step_id`、`wait_ms` 和 `reason`

### Requirement: Critical confirmation runtime
系统 SHALL 在执行 `risk: "critical"` step 前执行确认门槛。若 step 未被运行参数授权，runtime MUST 不调用该 step 的 tool/action，MUST 返回 `status: "failed"`，MUST 设置 `failed_step.step_id`，并 MUST 写入 `confirm_rejected` event。确认拒绝 MUST 不被 `on_fail.retry` 自动重试。

#### Scenario: 未授权 critical step 不执行工具
- **WHEN** mock tool client 运行包含未授权 critical `click_element` 的 flow
- **THEN** mock tool client 不收到 `click_element` 调用，run result 为 failed，并包含 `confirm_rejected`

#### Scenario: 授权 critical step 执行工具
- **WHEN** 运行参数包含 step `confirm.allowParam` 指向的 truthy 值
- **THEN** flow-engine 正常执行该 step 的工具，并继续执行后续步骤

### Requirement: Execution budget and store lock runtime
系统 SHALL 在 `packages/flow-engine` 中实现最小 execution budget 和进程内 store lock。runtime MUST 支持通过 `FlowRunnerOptions` 注入或共享一个 execution registry。registry MUST 能按 flow id 和 store key 跟踪 active run、连续失败次数和当日 run 次数。预算拒绝 MUST 在执行工具前发生，并 MUST 写入 `budget_rejected` event。

#### Scenario: per-flow concurrency reject
- **WHEN** policy 声明 `perFlowConcurrency: 1`，同一 registry 中已有相同 flow id 的 active run
- **THEN** 新 run 返回 `budget_rejected`，不执行任何工具步骤

#### Scenario: store lock release on failure
- **WHEN** run 获取 store lock 后在 step 执行中失败
- **THEN** flow-engine 在返回 failure 前释放该 store lock，并写入 `store_lock_released` event

### Requirement: Flow runtime event writing
系统 SHALL 将 flow runtime event 追加到 `data/logs/flow_events.jsonl`。event writer MUST 使用 `dataRoot`，MUST 自动创建 `logs` 目录，MUST 不写入完整 ZClaw API key、完整 prompt、密码、cookie 或大体积 args。测试 MUST 使用临时 `dataRoot` 并校验事件能被 `FlowRuntimeEventSchema` 解析。

#### Scenario: 写入临时 dataRoot
- **WHEN** 测试传入临时 `dataRoot`
- **THEN** flow-engine 将 `flow_events.jsonl` 写入该临时目录，而不是仓库真实 `data/`

#### Scenario: event schema validation
- **WHEN** flow-engine 写入 pacing、confirm 和 budget event
- **THEN** 测试逐行读取 JSONL，并使用 `FlowRuntimeEventSchema` 校验通过
