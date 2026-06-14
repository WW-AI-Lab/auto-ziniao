## MODIFIED Requirements

### Requirement: 包边界最小化
系统 SHALL 按迁移阶段维护最小 TypeScript 包边界。M1 已建立 `packages/core` 与 `packages/schemas`；M2 已新增 `packages/zclaw`；M3 已新增 `packages/flow-engine`；M4 已新增 `packages/self-heal`；M5 SHALL 在此基础上仅新增 `packages/cli`。`packages/core` MUST 仅包含路径、JSON/JSONL、时间、错误类型等无浏览器副作用的共享能力；`packages/schemas` MUST 仅包含契约类型、运行时校验和 JSON Schema 导出能力；`packages/zclaw` MUST 是 TS 侧唯一 ZClaw bridge client 包；`packages/flow-engine` MUST 只实现 flow 加载、校验、执行语义、run log/output 和通过 `packages/zclaw` 的工具步骤调度；`packages/self-heal` MUST 只实现错误分类、known issues、prompt/template rendering、cooldown、heal event log 和 Agent CLI adapter；`packages/cli` MUST 只实现命令行参数解析、命令编排、终端输出和 exit code。除 M5 明确允许的 `packages/cli` 外，系统 MUST NOT 创建或实现 `apps/webadmin-api`、移动 WebAdmin 前端、替换 WebAdmin 运行链路或替换 Python 生产入口。

#### Scenario: core 与 schemas 无浏览器副作用
- **WHEN** 审查 `packages/core` 与 `packages/schemas`
- **THEN** 不存在对 ZClaw bridge、本机浏览器、Playwright、Selenium、Puppeteer、browser-use 或 Agent CLI 的调用

#### Scenario: zclaw 是唯一 TS bridge 出口
- **WHEN** 审查 `packages/*` 中的 TypeScript 源码
- **THEN** 只有 `packages/zclaw` 可以包含受控的 `127.0.0.1:9481`、`/zclaw/tools` 或 `/zclaw/tools/invoke` 访问逻辑，其他包不得直接访问 bridge

#### Scenario: flow-engine 只通过 zclaw 调度工具
- **WHEN** 审查 `packages/flow-engine` 源码
- **THEN** flow-engine 可以依赖 `@ziniao/zclaw` 或注入兼容 tool client，但不得直接拼接 ZClaw bridge HTTP 请求

#### Scenario: self-heal 不访问 bridge
- **WHEN** 审查 `packages/self-heal` 源码
- **THEN** self-heal 不依赖 `@ziniao/zclaw`，不读取 ZClaw API key，不直接访问 bridge，不打开本机浏览器

#### Scenario: cli 只做命令编排
- **WHEN** 审查 `packages/cli` 源码
- **THEN** CLI 不直接访问 bridge、不读取 ZClaw API key、不实现 flow DSL 或 self-heal 业务规则，只通过 `@ziniao/flow-engine` 和 `@ziniao/self-heal` 编排命令

#### Scenario: 后续 WebAdmin 包不在本阶段创建
- **WHEN** 检查 M5 change 的实现范围
- **THEN** 不要求实现 `apps/webadmin-api`、`apps/webadmin-frontend` 迁移或替换 WebAdmin 运行链路
