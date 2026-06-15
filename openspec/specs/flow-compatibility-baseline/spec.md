# flow-compatibility-baseline Specification

## Purpose
TBD - created by archiving change establish-typescript-contract-baseline. Update Purpose after archive.
## Requirements
### Requirement: 当前 flow 全量基线
系统 SHALL 为当前仓库中除 `_template.json` 外的 `flows/*.json` 建立兼容性基线。基线 MUST 覆盖 `account_health`、`inventory_check`、`orders_overview`、`switch_language`、`webadmin_selftest`，并 MUST 记录每个 flow 的 id、version、enabled、params、步骤 id 列表、工具/动作集合、extract 引用和 Python validate 结果摘要。

#### Scenario: 全量 flow 解析通过
- **WHEN** 执行兼容性基线测试
- **THEN** 所有当前 flow 均能被 TypeScript schema 解析，并与 Python `manager.py validate <flow_id>` 的 error/warn 结果保持一致

#### Scenario: 新增 flow 自动纳入动态校验
- **WHEN** 仓库新增一个非 `_` 开头的 `flows/*.json`
- **THEN** 动态兼容性测试会读取并解析该 flow，避免只验证旧 fixture

### Requirement: Extract reference baseline
系统 SHALL 校验 flow 中所有 `@extracts/*.js` 引用均指向仓库内存在的文件。fixture/golden MUST 记录每个 flow 的 extract 依赖清单，但本阶段 MUST NOT 执行这些 JS，也不得打开浏览器验证 DOM。

#### Scenario: extract 文件存在
- **WHEN** `orders_overview` 引用 `@extracts/extract_orders_overview.js`
- **THEN** 兼容性测试确认文件存在，并将其记录为该 flow 的依赖

#### Scenario: extract 文件缺失
- **WHEN** 测试样本引用不存在的 `@extracts/missing.js`
- **THEN** 兼容性测试失败，错误信息包含缺失引用路径

### Requirement: Negative fixtures
系统 SHALL 提供少量非法 flow fixture，用于锁定静态校验错误行为。非法样本 MUST 至少覆盖：缺少 `steps`、重复步骤 id、未知 ZClaw 工具、非法 `on_fail.action`、不存在的跳转目标、未声明的 `params.*` 引用、缺失 extract 文件。

#### Scenario: 未声明参数 warning
- **WHEN** 非法 fixture 中步骤引用 `${params.not_declared}`
- **THEN** TS 校验结果包含 warning，且不把该问题误报为 fatal error

#### Scenario: 未知工具 error
- **WHEN** 非法 fixture 中步骤使用 `tool: "navigate"`
- **THEN** TS 校验结果包含 error，并提示工具名必须以 ZClaw bridge 工具清单为准

### Requirement: Baseline validation command
系统 SHALL 提供一个单命令基线验证入口，串联 Python 现状校验、TS schema 校验、fixture/golden 测试、TS flow-engine 离线测试、TS self-heal 离线测试、TS CLI 离线测试、TS WebAdmin API 离线测试和静态安全扫描。该命令 MUST NOT 执行真实 flow、MUST NOT 调用 `POST /zclaw/tools/invoke`、MUST NOT 启动本机浏览器、MUST NOT 调用真实 OpenClaw/Claude/Cursor Agent CLI。

#### Scenario: 基线验证成功
- **WHEN** 用户执行基线验证命令
- **THEN** Python validate、TS typecheck/test、flow fixture/golden、flow-engine 离线测试、self-heal 离线测试、CLI 离线测试、WebAdmin API 离线测试和安全扫描全部通过

#### Scenario: 不可触发真实浏览器操作
- **WHEN** 基线验证命令运行
- **THEN** 不会调用 `open_store`、`visit_page`、`execute_script` 或任何本机浏览器自动化工具

#### Scenario: 不可触发真实 Agent CLI
- **WHEN** 基线验证命令运行
- **THEN** self-heal、CLI 与 WebAdmin API 测试使用 mock `AgentRunner` 或 dry-run，不会调用真实 OpenClaw/Claude/Cursor 命令

### Requirement: TS flow engine offline parity baseline
系统 SHALL 将 TS flow engine 的离线语义测试纳入兼容性基线。该基线 MUST 覆盖当前 flow 使用到的参数合并、变量解析、condition、branch、goto、validate、内置 action、tool dispatch 映射、run log 和 output 写入。默认基线 MUST 使用 mock tool client 与临时数据目录，MUST NOT 执行真实 flow，MUST NOT 调用真实 ZClaw bridge。

#### Scenario: 当前 flow 语义离线覆盖
- **WHEN** 执行 TS flow engine 兼容性测试
- **THEN** `orders_overview`、`inventory_check`、`account_health`、`switch_language` 和 `webadmin_selftest` 中出现的 DSL 语义均有离线测试或 golden 覆盖

#### Scenario: baseline 不触发真实 bridge
- **WHEN** 用户执行 `pnpm validate:baseline`
- **THEN** flow engine 测试不会调用 `open_store`、`visit_page`、`execute_script` 的真实 bridge 实现，也不会启动本机浏览器

### Requirement: TS and Python validation agreement
系统 SHALL 对比 TS flow engine 静态校验与 Python `manager.py validate <flow_id>` 的结果。对于当前有效 flow，TS 与 Python MUST 都返回无 fatal error；对于非法 fixture，TS MUST 返回稳定 error/warn code，并且不得把未声明参数 warning 误报为 fatal error。

#### Scenario: 当前 flow validate agreement
- **WHEN** 对当前所有非模板 `flows/*.json` 运行 Python validate 和 TS flow-engine validate
- **THEN** 两者均不返回 fatal error，并且结果摘要记录在测试输出或 golden 中

#### Scenario: 非法 fixture code
- **WHEN** TS flow-engine validate 处理 unknown tool、missing target、invalid on_fail、missing extract、duplicate step id fixture
- **THEN** 返回稳定 code，供后续 CLI 和 WebAdmin 展示复用

### Requirement: Explicit low-risk double-run record
系统 SHALL 为 M3 提供显式低风险 flow 双跑验证记录。双跑验证 MUST 与默认 baseline 分离；执行前 MUST 确认是否需要真实 ZClaw bridge、测试店铺参数和人工安全边界。执行后 MUST 记录 Python/TS 的命令、参数、状态、output 路径和差异摘要。

#### Scenario: local-only flow double-run
- **WHEN** 双跑选择不依赖 ZClaw bridge 的 `webadmin_selftest` 或等价本地 flow
- **THEN** Python 与 TS 均完成运行，输出状态和 run log 摘要可比较

#### Scenario: real bridge flow double-run
- **WHEN** 双跑选择需要打开店铺浏览器的低风险 flow
- **THEN** 验证只通过 ZClaw bridge 执行；若 bridge 不可达或用户未确认店铺参数，验证停止并记录为环境阻塞

### Requirement: TS self-heal offline baseline
系统 SHALL 将 TS self-heal 的离线测试纳入兼容性基线。该基线 MUST 覆盖错误分类、known issues 命中、模板优先级、prompt/context 写入、cooldown/max_per_day、Agent runner mock、flow-engine failure metadata 输入和安全边界。默认测试 MUST 使用临时 repo/data root、固定 clock 和 mock runner。

#### Scenario: self-heal dry-run baseline
- **WHEN** 执行 self-heal dry-run 测试
- **THEN** 测试在临时 data root 中生成 heal context 与 prompt，并且不会调用真实 Agent CLI

#### Scenario: self-heal compatibility files
- **WHEN** self-heal 测试写入 heal context、prompt 和 `learnings/heals.jsonl`
- **THEN** 这些文件的字段能被 `packages/schemas` 中对应 runtime schema 解析

#### Scenario: self-heal safety scan
- **WHEN** 执行 `pnpm security:scan`
- **THEN** 扫描确认 `packages/self-heal` 不包含本机浏览器自动化依赖、未授权 direct bridge 访问或真实 bridge fallback

### Requirement: TS CLI offline compatibility baseline
系统 SHALL 将 `ziniao` CLI 的离线兼容测试纳入基线。该基线 MUST 覆盖 `list`、`validate`、`run --no-heal`、`run` failure with mock self-heal、`run-all`、`retry`、`new`、`enable`、`disable`、`history`、`heals`、`stats` 和 `cron` 的核心语义。默认测试 MUST 使用临时 repo/data root、mock tool client、no-op sleeper、fixed clock 和 mock Agent runner，MUST NOT 连接真实 ZClaw bridge 或真实 Agent CLI。

#### Scenario: CLI command parity offline
- **WHEN** 执行 CLI 离线测试
- **THEN** 当前 Python CLI 的主要命令均有 TypeScript CLI 测试覆盖，且测试断言命令 exit code、关键输出摘要和数据文件读写语义

#### Scenario: CLI run baseline is mock-only
- **WHEN** CLI 测试覆盖 `ziniao run` 或 `ziniao run-all`
- **THEN** 测试只通过 mock tool client 执行，不调用真实 `open_store`、`visit_page`、`execute_script` 或 `POST /zclaw/tools/invoke`

#### Scenario: CLI self-heal baseline is mock-only
- **WHEN** CLI 测试覆盖失败后 self-heal 触发
- **THEN** 测试使用 mock Agent runner 或 dry-run，验证 context/prompt/event 语义，而不调用真实 OpenClaw/Claude/Cursor

#### Scenario: CLI is production baseline (M7 supersedes M5 transition)
- **WHEN** M7 Python 清零完成后执行 baseline
- **THEN** `pnpm ziniao list` 与 `pnpm ziniao validate orders_overview` 作为生产入口验证；Python 入口已移除，历史恢复通过 git（commit `68d7db8a`）

### Requirement: TS WebAdmin API offline baseline
系统 SHALL 将 TS WebAdmin API 的离线测试纳入兼容性基线。该基线 MUST 覆盖 Fastify route/service、WebAdmin DTO schema、SQLite DAO、schedule trigger 计算、scheduler tick、manual run 状态、chat SSE 事件、静态前端托管 fallback 和安全路径校验。默认测试 MUST 使用临时 repo/data root、mock tool client、mock Agent runner、fixed clock 和 no-op sleeper，MUST NOT 连接真实 ZClaw bridge、MUST NOT 执行真实 flow、MUST NOT 调用真实 Agent CLI。

#### Scenario: WebAdmin API route baseline
- **WHEN** 执行 TS WebAdmin API route 测试
- **THEN** flows、monitoring、schedules、chat 和 static fallback 的核心响应均通过 schema-compatible 断言

#### Scenario: WebAdmin API scheduler baseline is offline
- **WHEN** scheduler 相关测试运行
- **THEN** 测试只使用临时 SQLite 数据库、固定 clock 和 mock runner，不会启动真实 flow 或连接 ZClaw bridge

#### Scenario: WebAdmin API chat baseline is mock-only
- **WHEN** chat SSE 测试运行
- **THEN** 测试使用 mock Agent runner 生成事件流，不调用真实 OpenClaw/Claude/Cursor 命令

#### Scenario: WebAdmin API safety scan baseline
- **WHEN** 执行 `pnpm security:scan`
- **THEN** 扫描确认 `apps/webadmin-api` 不包含本机浏览器自动化依赖、未授权 direct bridge 访问、ZClaw API key 读取或真实 bridge fallback

### Requirement: WebAdmin and CLI cutover readiness evidence
系统 SHALL 为 `remove-python-runtime` 的 M7 preflight 提供切换准备证据。证据 MUST 至少包含：`apps/webadmin-frontend` build/typecheck 结果、`apps/webadmin-api` 核心 route/static serving smoke 或 test 结果、`ziniao validate orders_overview` 结果、`ziniao run webadmin_selftest ... --no-heal` local-only 结果，以及 Python WebAdmin/CLI 未在本阶段删除的说明。真实 bridge flow 双跑若未执行，MUST 记录未执行原因和安全边界。

#### Scenario: cutover evidence is recorded
- **WHEN** 本 change 实现完成
- **THEN** `docs/06-TS迁移进度与路线图.md` 或本 change `tasks.md` 记录可供 `remove-python-runtime` preflight 引用的命令、状态和摘要

#### Scenario: local-only CLI smoke is recorded
- **WHEN** 执行 `ziniao validate orders_overview` 和 `ziniao run webadmin_selftest ... --no-heal`
- **THEN** 结果被记录为 TS CLI 切换准备证据，且不要求真实 ZClaw bridge

#### Scenario: real bridge double-run is explicit
- **WHEN** 未执行真实 bridge flow 双跑
- **THEN** 记录原因必须说明缺少紫鸟客户端在线确认、测试店铺参数或低风险真实 flow 选择，且不得改用本机浏览器

