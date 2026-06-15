## MODIFIED Requirements

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

## ADDED Requirements

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
