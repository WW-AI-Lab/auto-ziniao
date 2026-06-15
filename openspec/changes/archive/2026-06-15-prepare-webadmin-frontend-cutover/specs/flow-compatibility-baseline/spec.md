## ADDED Requirements

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
