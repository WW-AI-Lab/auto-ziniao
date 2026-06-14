## MODIFIED Requirements

### Requirement: 包边界最小化
系统 SHALL 按迁移阶段维护最小 TypeScript 包边界。M1 已建立 `packages/core` 与 `packages/schemas`；M2 已新增 `packages/zclaw`；M3 SHALL 仅在此基础上新增 `packages/flow-engine`。`packages/core` MUST 仅包含路径、JSON/JSONL、时间、错误类型等无浏览器副作用的共享能力；`packages/schemas` MUST 仅包含契约类型、运行时校验和 JSON Schema 导出能力；`packages/zclaw` MUST 是 TS 侧唯一 ZClaw bridge client 包；`packages/flow-engine` MUST 只实现 flow 加载、校验、执行语义、run log/output 和通过 `packages/zclaw` 的工具步骤调度。除本阶段明确允许的 `packages/flow-engine` 外，系统 MUST NOT 创建或实现 `packages/self-heal`、`packages/cli`、`apps/webadmin-api` 或替换 WebAdmin 运行链路。

#### Scenario: core 与 schemas 无浏览器副作用
- **WHEN** 审查 `packages/core` 与 `packages/schemas`
- **THEN** 不存在对 ZClaw bridge、本机浏览器、Playwright、Selenium、Puppeteer、browser-use 或 Agent CLI 的调用

#### Scenario: zclaw 是唯一 TS bridge 出口
- **WHEN** 审查 `packages/*` 中的 TypeScript 源码
- **THEN** 只有 `packages/zclaw` 可以包含受控的 `127.0.0.1:9481`、`/zclaw/tools` 或 `/zclaw/tools/invoke` 访问逻辑，其他包不得直接访问 bridge

#### Scenario: flow-engine 只通过 zclaw 调度工具
- **WHEN** 审查 `packages/flow-engine` 源码
- **THEN** flow-engine 可以依赖 `@ziniao/zclaw` 或注入兼容 tool client，但不得直接拼接 ZClaw bridge HTTP 请求

#### Scenario: 后续包不在本阶段创建
- **WHEN** 检查本 change 的实现范围
- **THEN** 不要求实现 `packages/self-heal`、`packages/cli` 或 `apps/webadmin-api`
