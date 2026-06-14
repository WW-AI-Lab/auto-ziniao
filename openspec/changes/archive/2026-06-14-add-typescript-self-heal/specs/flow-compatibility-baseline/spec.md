## MODIFIED Requirements

### Requirement: Baseline validation command
系统 SHALL 提供一个单命令基线验证入口，串联 Python 现状校验、TS schema 校验、fixture/golden 测试、TS flow-engine 离线测试、TS self-heal 离线测试和静态安全扫描。该命令 MUST NOT 执行真实 flow、MUST NOT 调用 `POST /zclaw/tools/invoke`、MUST NOT 启动本机浏览器、MUST NOT 调用真实 OpenClaw/Claude/Cursor Agent CLI。

#### Scenario: 基线验证成功
- **WHEN** 用户执行基线验证命令
- **THEN** Python validate、TS typecheck/test、flow fixture/golden、self-heal 离线测试和安全扫描全部通过

#### Scenario: 不可触发真实浏览器操作
- **WHEN** 基线验证命令运行
- **THEN** 不会调用 `open_store`、`visit_page`、`execute_script` 或任何本机浏览器自动化工具

#### Scenario: 不可触发真实 Agent CLI
- **WHEN** 基线验证命令运行
- **THEN** self-heal 测试使用 mock `AgentRunner`，不会调用真实 OpenClaw/Claude/Cursor 命令

## ADDED Requirements

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
