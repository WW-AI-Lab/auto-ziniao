## ADDED Requirements

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
