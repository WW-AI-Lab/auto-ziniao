## MODIFIED Requirements

### Requirement: TypeScript workspace 并行存在
系统 SHALL 将 TypeScript/Node.js workspace 作为 M7 后唯一生产运行与验证基线。Workspace MUST 承载 `packages/*`、`apps/webadmin-api` 和前置阶段整理后的 `apps/webadmin-frontend`；MUST NOT 要求 `python3 manager.py`、`engine/*.py`、Python WebAdmin 或 Python 虚拟环境存在。M7 后默认验证和生产 smoke MUST 通过 TS 命令完成。

#### Scenario: TS CLI is production validation path
- **WHEN** M7 实现完成后用户执行生产 CLI smoke
- **THEN** `ziniao validate orders_overview` 按 TS 引擎路径完成校验，不依赖 Python 构建产物或 Python runtime

#### Scenario: TS workspace 可独立验证
- **WHEN** 用户安装 Node workspace 依赖并执行 TS 校验命令
- **THEN** typecheck/test/build 在 `packages/*` 和 `apps/*` 范围内运行，不启动 ZClaw bridge、不打开店铺浏览器

### Requirement: 包边界最小化
系统 SHALL 按 M7 后 TS-only 目标维护最小 TypeScript 包与应用边界。`packages/core` MUST 仅包含路径、JSON/JSONL、时间、错误类型等无浏览器副作用的共享能力；`packages/schemas` MUST 仅包含契约类型、运行时校验和 JSON Schema 导出能力；`packages/zclaw` MUST 是 TS 侧唯一 ZClaw bridge client 包；`packages/flow-engine` MUST 只实现 flow 加载、校验、执行语义、run log/output 和通过 `packages/zclaw` 或注入 tool client 的工具步骤调度；`packages/self-heal` MUST 只实现错误分类、known issues、prompt/template rendering、cooldown、heal event log 和 Agent CLI adapter；`packages/cli` MUST 只实现生产 CLI 命令编排；`apps/webadmin-api` MUST 只实现 WebAdmin HTTP/SSE API、SQLite WebAdmin 自有状态、调度器、静态前端托管和对既有 TS package 的服务编排。系统 MUST NOT 保留 Python engine、Python WebAdmin 后端或 Python production fallback。

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

#### Scenario: Python runtime fallback is absent
- **WHEN** 检查 M7 后 workspace 边界
- **THEN** 不存在 `manager.py`、`engine/`、Python WebAdmin 后端或调用 Python CLI 的 fallback

### Requirement: 安全扫描进入基线验证
系统 SHALL 提供一个可重复执行的静态安全扫描步骤，阻断新增本机浏览器自动化依赖、绕过 ZClaw bridge 的可疑代码以及 M7 后 Python runtime 回归。扫描 MUST 覆盖 tracked TS/JS/JSON/Markdown/source 配置、`packages/*`、`apps/*`、`scripts/*`、README、AGENTS、docs 和 Agent skills。扫描 MUST 将 `packages/zclaw` 识别为唯一允许直接访问 ZClaw bridge 的 TS 包，并 MUST 阻断 Python production fallback。

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

#### Scenario: Python runtime regression is blocked
- **WHEN** tracked files 新增 `.py`、`requirements.txt`、Python subprocess 调用或 `python3 manager.py` 文档示例
- **THEN** 基线验证失败，并提示 M7 后生产与验证路径必须使用 TS 命令
