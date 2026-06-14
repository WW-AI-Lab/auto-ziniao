## MODIFIED Requirements

### Requirement: 包边界最小化
系统 SHALL 按迁移阶段维护最小 TypeScript 包边界。M1 已建立 `packages/core` 与 `packages/schemas`；M2 SHALL 仅在此基础上新增 `packages/zclaw`。`packages/core` MUST 仅包含路径、JSON/JSONL、时间、错误类型等无浏览器副作用的共享能力；`packages/schemas` MUST 仅包含契约类型、运行时校验和 JSON Schema 导出能力；`packages/zclaw` MUST 是 TS 侧唯一 ZClaw bridge client 包。除本阶段明确允许的 `packages/zclaw` 外，系统 MUST NOT 创建或实现 `packages/flow-engine`、`packages/self-heal`、`packages/cli`、`apps/webadmin-api` 或替换 WebAdmin 运行链路。

#### Scenario: core 与 schemas 无浏览器副作用
- **WHEN** 审查 `packages/core` 与 `packages/schemas`
- **THEN** 不存在对 ZClaw bridge、本机浏览器、Playwright、Selenium、Puppeteer、browser-use 或 Agent CLI 的调用

#### Scenario: zclaw 是唯一 TS bridge 出口
- **WHEN** 审查 `packages/*` 中的 TypeScript 源码
- **THEN** 只有 `packages/zclaw` 可以包含受控的 `127.0.0.1:9481`、`/zclaw/tools` 或 `/zclaw/tools/invoke` 访问逻辑，其他包不得直接访问 bridge

#### Scenario: 后续包不在本阶段创建
- **WHEN** 检查本 change 的实现范围
- **THEN** 不要求实现 `packages/flow-engine`、`packages/self-heal`、`packages/cli` 或 `apps/webadmin-api`

### Requirement: 安全扫描进入基线验证
系统 SHALL 提供一个可重复执行的静态安全扫描步骤，阻断新增本机浏览器自动化依赖或绕过 ZClaw bridge 的可疑代码。扫描 MUST 覆盖新增 TS 文件与相关配置。扫描 MUST 将 `packages/zclaw` 识别为唯一允许直接访问 ZClaw bridge 的 TS 包，并 MUST 继续阻断其他包、scripts 或配置中的未授权 bridge 访问。

#### Scenario: 禁止 Playwright 依赖
- **WHEN** 新增 TS workspace 依赖中出现 `playwright`、`selenium`、`puppeteer` 或 `browser-use`
- **THEN** 基线验证失败，并提示本仓库浏览器操作只能通过 ZClaw bridge

#### Scenario: 禁止本机浏览器打开命令
- **WHEN** 新增 TS 源码中出现本机浏览器打开命令或 `webbrowser` 等绕过路径
- **THEN** 基线验证失败，且不得建议改用本机浏览器作为 fallback

#### Scenario: 限制直接 bridge 访问范围
- **WHEN** `packages/core`、`packages/schemas`、未来业务包或 `scripts` 中出现直接访问 `9481`、`/zclaw/tools` 或 `/zclaw/tools/invoke` 的代码
- **THEN** 基线验证失败；只有 `packages/zclaw` 的受控 request helper 可以通过扫描
