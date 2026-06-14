## MODIFIED Requirements

### Requirement: Baseline validation command
系统 SHALL 提供一个单命令基线验证入口，串联 Python 现状校验、TS schema 校验、fixture/golden 测试、TS flow-engine 离线测试、TS self-heal 离线测试、TS CLI 离线测试和静态安全扫描。该命令 MUST NOT 执行真实 flow、MUST NOT 调用 `POST /zclaw/tools/invoke`、MUST NOT 启动本机浏览器、MUST NOT 调用真实 OpenClaw/Claude/Cursor Agent CLI。

#### Scenario: 基线验证成功
- **WHEN** 用户执行基线验证命令
- **THEN** Python validate、TS typecheck/test、flow fixture/golden、flow-engine 离线测试、self-heal 离线测试、CLI 离线测试和安全扫描全部通过

#### Scenario: 不可触发真实浏览器操作
- **WHEN** 基线验证命令运行
- **THEN** 不会调用 `open_store`、`visit_page`、`execute_script` 或任何本机浏览器自动化工具

#### Scenario: 不可触发真实 Agent CLI
- **WHEN** 基线验证命令运行
- **THEN** self-heal 与 CLI 测试使用 mock `AgentRunner`，不会调用真实 OpenClaw/Claude/Cursor 命令

## ADDED Requirements

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

#### Scenario: CLI does not replace Python baseline
- **WHEN** M5 baseline 执行完成
- **THEN** `python3 manager.py list` 与 `python3 manager.py validate orders_overview` 仍作为生产入口兼容验证保留
