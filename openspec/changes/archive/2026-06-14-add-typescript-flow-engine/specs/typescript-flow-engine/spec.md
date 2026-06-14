## ADDED Requirements

### Requirement: Flow loading and validation
系统 SHALL 提供 TypeScript flow engine 包 `packages/flow-engine`，用于加载、解析和校验现有 `flows/*.json`。该包 MUST 复用 `packages/schemas` 的 `FlowDefinition` schema 与静态校验能力，MUST 不重复维护 flow DSL schema，MUST 不修改当前 flow 文件格式。

#### Scenario: 加载当前 flow
- **WHEN** 调用 TS flow engine 加载 `orders_overview`
- **THEN** 系统从 `flows/orders_overview.json` 读取 flow，解析为 `FlowDefinition`，并保留 `params`、`steps`、`retry`、`heal.hints` 和 `@extracts/*.js` 引用

#### Scenario: 静态校验失败
- **WHEN** flow 中存在重复 step id、未知工具、非法 `on_fail.action` 或缺失 extract 文件
- **THEN** TS flow engine 返回结构化 validation issues，并且不执行任何 step

### Requirement: Runtime context and control flow
系统 SHALL 实现与 Python flow engine 兼容的 runtime context 与控制流语义。运行时 MUST 合并 flow 默认参数与调用方参数，忽略 `_` 开头的参数说明字段；MUST 支持 `${params.x}`、`${step_save.path}`、`${date}`、`${datetime}`、`${timestamp}` 变量解析；MUST 支持 step `condition`、`action: "branch"`、step `branch`、`action: "goto"`、step `goto`、`on_fail.action: "branch"` 与 `end` 目标；MUST 提供最大执行次数保护以阻断分支死循环。

#### Scenario: 参数覆盖默认值
- **WHEN** flow 默认 `params.store_name` 为空，调用方传入 `{ "store_name": "测试店铺" }`
- **THEN** `${params.store_name}` 解析为 `"测试店铺"`，且 `_comment` 不作为可传参数参与运行

#### Scenario: branch 跳转
- **WHEN** `switch_language` 的 `check_need_switch` 分支 condition 命中 `report_no_switch`
- **THEN** TS flow engine 跳转到 `report_no_switch`，随后按 step `goto` 跳到 `close_store`

#### Scenario: 防止死循环
- **WHEN** flow 分支反复跳回已执行 step 并超过最大执行次数
- **THEN** TS flow engine 中止运行，并返回包含疑似分支死循环的失败信息

### Requirement: Validation rules and built-in actions
系统 SHALL 实现当前 flow DSL 的 validate 规则与内置 action。validate MUST 支持 `path`、`not_empty`、`min_rows`、`require_fields`、`contains`。内置 action MUST 支持 `sleep`、`save_json`、`save_csv`、`print`、`assert`、`fail`、`branch`、`goto`、`close_store`。`sleep` MUST 可在测试中注入 no-op sleeper；`save_json` 与 `save_csv` MUST 将相对 filename 写入 `data/output/`；`save_csv` MUST 使用 UTF-8 with BOM 兼容现有 Python 行为。

#### Scenario: validate require_fields
- **WHEN** step validate 声明 `{ "not_empty": true, "require_fields": ["url"] }` 且结果缺少 `url`
- **THEN** TS flow engine 返回 validation failure，并记录失败 step id

#### Scenario: save_json 输出
- **WHEN** step 执行 `action: "save_json"` 且 `filename` 为 `orders_${date}.json`
- **THEN** TS flow engine 将解析后的 JSON 写入 `data/output/orders_<date>.json`，并返回 `filePath`

#### Scenario: assert 失败
- **WHEN** step 执行 `action: "assert"` 且 `check: "eq"` 不成立
- **THEN** TS flow engine 抛出断言失败并按 step `on_fail` 规则处理

### Requirement: ZClaw tool dispatch
系统 SHALL 通过 `packages/zclaw` 或注入的兼容 tool client 执行工具步骤。`packages/flow-engine` MUST NOT 直接访问 `127.0.0.1:9481`、`/zclaw/tools` 或 `/zclaw/tools/invoke`。工具步骤 MUST 支持当前 Python engine 的特殊映射：`list_stores`、`open_store`、`visit_page`、`execute_script`、`click_element`、`take_screenshot`、`wait_for_element`、`close_store`，其他合法工具 MUST 通过通用 `invoke()` 调用。`execute_script` 的 `@extracts/*.js` 引用 MUST 读取文件文本并做变量替换，但 MUST NOT 在 Node 进程中执行 extract JS。

#### Scenario: mock tool client 离线执行
- **WHEN** 测试使用 mock tool client 运行包含 `open_store` 和 `execute_script` 的 flow
- **THEN** TS flow engine 不连接真实 bridge，并且 mock client 收到与 Python engine 等价的工具名与参数

#### Scenario: open_store 参数选择
- **WHEN** `open_store` step 未显式提供 `storeId` 或 `storeName`，但调用参数包含 `store_name`
- **THEN** TS flow engine 将 `storeName` 传给 tool client；若参数不存在且已有 `stores.items`，则按 `store_selector: "first"` 使用第一个 `storeId`

#### Scenario: 禁止直接 bridge 访问
- **WHEN** 扫描 `packages/flow-engine` 源码
- **THEN** 不存在直接访问 `9481`、`/zclaw/tools` 或 `/zclaw/tools/invoke` 的代码

### Requirement: Run result, log, and output compatibility
系统 SHALL 生成与 Python flow engine 兼容的 run result、run log 和 output 文件。成功结果 MUST 包含 `{ "status": "success", "data": ... }`；失败结果 MUST 包含 `status`、`error` 和 `failed_step`。运行日志 MUST 追加到 `data/logs/runs.jsonl`，字段 MUST 兼容 `RunLogEntrySchema` 与 Python `log_run()`：`flow_id`、`timestamp`、`status`、`duration_ms`、`error`、`params`、`data_summary`。默认测试 MUST 使用临时 repo/data root，避免污染真实历史数据。

#### Scenario: 成功日志
- **WHEN** TS flow engine 成功运行一个只含 `print`、`sleep`、`save_json` 的本地 flow
- **THEN** `runs.jsonl` 新增一条 `status: "success"` 记录，且该记录能被 `RunLogEntrySchema` 解析

#### Scenario: 失败现场
- **WHEN** tool step 或 validate 失败且最终未恢复
- **THEN** run result 包含 `failed_step.step_id`、`tool` 或 `action`、解析后的 `args`、`heal_context` 和错误摘要

### Requirement: Offline baseline and explicit double-run validation
系统 SHALL 将 TS flow engine 纳入离线 baseline 验证，但默认 baseline MUST NOT 执行真实 flow、MUST NOT 调用真实 `POST /zclaw/tools/invoke`、MUST NOT 要求紫鸟客户端在线。低风险 flow 真机双跑 MUST 是显式验证任务，必须记录命令、参数、输出位置和 Python/TS 差异。

#### Scenario: baseline 离线通过
- **WHEN** 用户执行 `pnpm validate:baseline`
- **THEN** TS flow engine 的测试使用 mock tool client、临时 output/log 目录和 no-op sleeper 完成，不连接真实 ZClaw bridge

#### Scenario: 显式双跑
- **WHEN** 用户确认紫鸟客户端在线并选择低风险 flow 后执行真机双跑验证
- **THEN** Python 与 TS 的运行状态、关键 output 和 run log 摘要被比较并记录；若 bridge 不可达，验证停止并报告环境问题，不改用本机浏览器
