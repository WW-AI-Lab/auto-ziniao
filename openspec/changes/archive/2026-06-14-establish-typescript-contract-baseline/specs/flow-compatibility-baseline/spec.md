# flow-compatibility-baseline — Flow 兼容性基线

## ADDED Requirements

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
系统 SHALL 提供一个单命令基线验证入口，串联 Python 现状校验、TS schema 校验、fixture/golden 测试和静态安全扫描。该命令 MUST NOT 执行真实 flow、MUST NOT 调用 `POST /zclaw/tools/invoke`、MUST NOT 启动本机浏览器。

#### Scenario: 基线验证成功
- **WHEN** 用户执行基线验证命令
- **THEN** Python validate、TS typecheck/test、flow fixture/golden 和安全扫描全部通过

#### Scenario: 不可触发真实浏览器操作
- **WHEN** 基线验证命令运行
- **THEN** 不会调用 `open_store`、`visit_page`、`execute_script` 或任何本机浏览器自动化工具
