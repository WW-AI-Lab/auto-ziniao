## MODIFIED Requirements

### Requirement: 当前 flow 全量基线
系统 SHALL 为当前仓库中除 `_template.json` 外的 `flows/*.json` 建立 TS-only 兼容性基线。基线 MUST 覆盖 `account_health`、`inventory_check`、`orders_overview`、`switch_language`、`webadmin_selftest` 以及新增非模板 flow，并 MUST 记录每个 flow 的 id、version、enabled、params、步骤 id 列表、工具/动作集合、extract 引用和 TS validate 结果摘要。M7 后基线 MUST NOT 调用 Python `manager.py validate`。

#### Scenario: 全量 flow 解析通过
- **WHEN** 执行兼容性基线测试
- **THEN** 所有当前 flow 均能被 TypeScript schema 和 TS flow-engine validate 解析，并且不需要 Python runtime

#### Scenario: 新增 flow 自动纳入动态校验
- **WHEN** 仓库新增一个非 `_` 开头的 `flows/*.json`
- **THEN** 动态兼容性测试会读取并解析该 flow，避免只验证旧 fixture

### Requirement: Baseline validation command
系统 SHALL 提供一个单命令 TS-only 基线验证入口，串联 TS schema 校验、fixture/golden 测试、TS flow-engine 离线测试、TS self-heal 离线测试、TS CLI 离线测试、TS WebAdmin API 离线测试、TS WebAdmin frontend 构建或等价前置产物检查、schema export 和静态安全扫描。该命令 MUST NOT 执行真实 flow、MUST NOT 调用 `POST /zclaw/tools/invoke`、MUST NOT 启动本机浏览器、MUST NOT 调用真实 OpenClaw/Claude/Cursor Agent CLI、MUST NOT 调用 Python runtime。

#### Scenario: 基线验证成功
- **WHEN** 用户执行基线验证命令
- **THEN** TS typecheck/test、flow fixture/golden、flow-engine 离线测试、self-heal 离线测试、CLI 离线测试、WebAdmin API 离线测试、schema export 和安全扫描全部通过

#### Scenario: 不可触发真实浏览器操作
- **WHEN** 基线验证命令运行
- **THEN** 不会调用 `open_store`、`visit_page`、`execute_script` 或任何本机浏览器自动化工具

#### Scenario: 不可触发真实 Agent CLI
- **WHEN** 基线验证命令运行
- **THEN** self-heal、CLI 与 WebAdmin API 测试使用 mock `AgentRunner` 或 dry-run，不会调用真实 OpenClaw/Claude/Cursor 命令

#### Scenario: 不可调用 Python runtime
- **WHEN** 基线验证命令运行
- **THEN** 不会执行 `python`、`python3`、`manager.py`、`engine/*.py` 或 Python WebAdmin 后端

### Requirement: TS and Python validation agreement
系统 SHALL 在 M7 前保留已归档的 Python/TS 双跑和 validate agreement 证据，并在 M7 后以 TS flow-engine validate、golden fixtures 和离线语义测试作为默认兼容性基线。M7 后系统 MUST NOT 运行 Python `manager.py validate <flow_id>`；若需要审计历史差异，MUST 查阅前置双跑记录或 git 历史。

#### Scenario: archived agreement evidence exists
- **WHEN** M7 preflight gate 检查兼容性证据
- **THEN** 能定位前置阶段记录的 Python/TS CLI validate、local-only run 和 WebAdmin 双跑摘要

#### Scenario: TS validate is default after removal
- **WHEN** M7 后对当前所有非模板 `flows/*.json` 运行兼容性基线
- **THEN** 基线只调用 TS flow-engine validate，并返回稳定 error/warn code

#### Scenario: 非法 fixture code
- **WHEN** TS flow-engine validate 处理 unknown tool、missing target、invalid on_fail、missing extract、duplicate step id fixture
- **THEN** 返回稳定 code，供后续 CLI 和 WebAdmin 展示复用

### Requirement: Explicit low-risk double-run record
系统 SHALL 在 M7 前置阶段保留显式低风险 flow 双跑验证记录。双跑验证 MUST 与默认 baseline 分离；执行前 MUST 确认是否需要真实 ZClaw bridge、测试店铺参数和人工安全边界。执行后 MUST 记录 Python/TS 的命令、参数、状态、output 路径和差异摘要。M7 后默认 baseline MUST NOT 再依赖 Python 双跑。

#### Scenario: local-only flow double-run record is available
- **WHEN** M7 preflight 检查不依赖 ZClaw bridge 的 `webadmin_selftest` 或等价本地 flow 双跑
- **THEN** 能找到 Python 与 TS 均完成运行的输出状态和 run log 摘要

#### Scenario: real bridge flow double-run record is available or explicitly deferred
- **WHEN** M7 preflight 检查需要打开店铺浏览器的低风险 flow 双跑
- **THEN** 记录显示验证只通过 ZClaw bridge 执行，或因 bridge 不可达/用户未确认店铺参数而被明确记录为环境阻塞
