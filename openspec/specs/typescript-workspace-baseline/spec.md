# typescript-workspace-baseline Specification

## Purpose
TBD - created by archiving change establish-typescript-contract-baseline. Update Purpose after archive.
## Requirements
### Requirement: TypeScript workspace 并行存在
系统 SHALL 新增 TypeScript/Node.js workspace 基线，用于承载后续 `packages/*`，并 MUST 与现有 Python 运行时并行存在。本阶段新增的 workspace MUST NOT 替换 `python3 manager.py`、`engine/*.py` 或 WebAdmin 当前运行入口。

#### Scenario: Python CLI 不受影响
- **WHEN** 实现阶段完成 workspace 初始化后用户执行 `python3 manager.py validate orders_overview`
- **THEN** 命令仍按现有 Python 引擎路径完成校验，不依赖 TS 构建产物

#### Scenario: TS workspace 可独立验证
- **WHEN** 用户安装 Node workspace 依赖并执行 TS 校验命令
- **THEN** typecheck/test/build 在 `packages/*` 范围内运行，不启动 ZClaw bridge、不打开店铺浏览器

### Requirement: 包边界最小化
系统 SHALL 按迁移阶段维护最小 TypeScript 包与应用边界。M1 已建立 `packages/core` 与 `packages/schemas`；M2 已新增 `packages/zclaw`；M3 已新增 `packages/flow-engine`；M4 已新增 `packages/self-heal`；M5 已新增 `packages/cli`；M6 已新增 `apps/webadmin-api`；本阶段 SHALL 在此基础上新增 `apps/webadmin-frontend`。`packages/core` MUST 仅包含路径、JSON/JSONL、时间、错误类型等无浏览器副作用的共享能力；`packages/schemas` MUST 仅包含契约类型、运行时校验和 JSON Schema 导出能力；`packages/zclaw` MUST 是 TS 侧唯一 ZClaw bridge client 包；`packages/flow-engine` MUST 只实现 flow 加载、校验、执行语义、run log/output 和通过 `packages/zclaw` 的工具步骤调度；`packages/self-heal` MUST 只实现错误分类、known issues、prompt/template rendering、cooldown、heal event log 和 Agent CLI adapter；`packages/cli` MUST 只实现命令行参数解析、命令编排、终端输出和 exit code；`apps/webadmin-api` MUST 只实现 WebAdmin HTTP/SSE API、SQLite WebAdmin 自有状态、调度器、静态前端托管和对既有 TS package 的服务编排；`apps/webadmin-frontend` MUST 只实现 WebAdmin React frontend。系统 MUST NOT 在本阶段删除 Python engine、替换 `python3 manager.py` 生产入口或移除 Python WebAdmin 后端。

#### Scenario: core 与 schemas 无浏览器副作用
- **WHEN** 审查 `packages/core` 与 `packages/schemas`
- **THEN** 不存在对 ZClaw bridge、本机浏览器、Playwright、Selenium、Puppeteer、browser-use 或 Agent CLI 的调用

#### Scenario: zclaw 是唯一 TS bridge 出口
- **WHEN** 审查 `packages/*` 与 `apps/*` 中的 TypeScript 源码
- **THEN** 只有 `packages/zclaw` 可以包含受控的 `127.0.0.1:9481`、`/zclaw/tools` 或 `/zclaw/tools/invoke` 访问逻辑，其他包和应用不得直接访问 bridge

#### Scenario: flow-engine 只通过 zclaw 调度工具
- **WHEN** 审查 `packages/flow-engine` 源码
- **THEN** flow-engine 可以依赖 `@ziniao/zclaw` 或注入兼容 tool client，但不得直接拼接 ZClaw bridge HTTP 请求

#### Scenario: self-heal 不访问 bridge
- **WHEN** 审查 `packages/self-heal` 源码
- **THEN** self-heal 不依赖 `@ziniao/zclaw`，不读取 ZClaw API key，不直接访问 bridge，不打开本机浏览器

#### Scenario: cli 只做命令编排
- **WHEN** 审查 `packages/cli` 源码
- **THEN** CLI 不直接访问 bridge、不读取 ZClaw API key、不实现 flow DSL 或 self-heal 业务规则，只通过 `@ziniao/flow-engine` 和 `@ziniao/self-heal` 编排命令

#### Scenario: webadmin-api 只做 Web 服务编排
- **WHEN** 审查 `apps/webadmin-api` 源码
- **THEN** WebAdmin API 不直接访问 bridge、不读取 ZClaw API key、不实现 flow DSL 或 self-heal 业务规则，只通过既有 TS packages 编排 WebAdmin 后端能力

#### Scenario: webadmin-frontend 只做 Web 前端
- **WHEN** 审查 `apps/webadmin-frontend` 源码
- **THEN** WebAdmin frontend 只通过 same-origin `/api/*` 调用 WebAdmin API，不直接访问 ZClaw bridge、不读取 ZClaw API key、不调用本机浏览器自动化

#### Scenario: Python production entry remains unchanged
- **WHEN** 检查本阶段实现范围
- **THEN** `manager.py`、`engine/` 和 Python WebAdmin 后端仍存在，最终删除留给 `remove-python-runtime`

### Requirement: 安全扫描进入基线验证
系统 SHALL 提供一个可重复执行的静态安全扫描步骤，阻断新增本机浏览器自动化依赖或绕过 ZClaw bridge 的可疑代码。扫描 MUST 覆盖新增 TS 文件、相关配置、`packages/*` 和 `apps/*`。扫描 MUST 将 `packages/zclaw` 识别为唯一允许直接访问 ZClaw bridge 的 TS 包，并 MUST 继续阻断其他包、应用、scripts 或配置中的未授权 bridge 访问。

#### Scenario: 禁止 Playwright 依赖
- **WHEN** 新增 TS workspace 依赖中出现 `playwright`、`selenium`、`puppeteer` 或 `browser-use`
- **THEN** 基线验证失败，并提示本仓库浏览器操作只能通过 ZClaw bridge

#### Scenario: 禁止本机浏览器打开命令
- **WHEN** 新增 TS 源码中出现本机浏览器打开命令或 `webbrowser` 等绕过路径
- **THEN** 基线验证失败，且不得建议改用本机浏览器作为 fallback

#### Scenario: 限制直接 bridge 访问范围
- **WHEN** `packages/core`、`packages/schemas`、`packages/flow-engine`、`packages/self-heal`、`packages/cli`、`apps/webadmin-api`、未来业务包或 `scripts` 中出现直接访问 `9481`、`/zclaw/tools` 或 `/zclaw/tools/invoke` 的代码
- **THEN** 基线验证失败；只有 `packages/zclaw` 的受控 request helper 可以通过扫描

#### Scenario: WebAdmin API 禁止读取 ZClaw API key
- **WHEN** `apps/webadmin-api` 中出现读取 `ZCLAW_API_KEY` 或 `~/.zclaw/config.json` 的代码
- **THEN** 安全扫描失败，并提示 WebAdmin API 必须通过 flow-engine/CLI 编排边界间接执行真实工具步骤

### Requirement: WebAdmin frontend baseline inclusion
系统 SHALL 将 `apps/webadmin-frontend` 纳入 root workspace build/typecheck/baseline。默认 baseline MUST validate frontend without real ZClaw bridge, real flow execution, local browser launch, or real Agent CLI.

#### Scenario: root build includes frontend
- **WHEN** 用户执行 root `pnpm build`
- **THEN** `apps/webadmin-frontend` 与既有 packages/apps 一同完成构建

#### Scenario: root typecheck includes frontend
- **WHEN** 用户执行 root `pnpm typecheck`
- **THEN** `apps/webadmin-frontend` 与既有 packages/apps 一同完成类型检查

#### Scenario: baseline includes frontend
- **WHEN** 用户执行 `pnpm validate:baseline`
- **THEN** frontend build/typecheck、WebAdmin API tests、schema export and security scan all run without real bridge or local browser automation

