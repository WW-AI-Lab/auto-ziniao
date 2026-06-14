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
系统 SHALL 只建立迁移第一阶段需要的最小包边界：`packages/core` 与 `packages/schemas`。`packages/core` MUST 仅包含路径、JSON/JSONL、时间、错误类型等无浏览器副作用的共享能力；`packages/schemas` MUST 仅包含契约类型、运行时校验和 JSON Schema 导出能力。

#### Scenario: 无浏览器副作用
- **WHEN** 审查 `packages/core` 与 `packages/schemas`
- **THEN** 不存在对 ZClaw bridge、本机浏览器、Playwright、Selenium、Puppeteer、browser-use 或 Agent CLI 的调用

#### Scenario: 后续包不在本阶段创建
- **WHEN** 检查本 change 的实现范围
- **THEN** 不要求实现 `packages/zclaw`、`packages/flow-engine`、`packages/self-heal`、`packages/cli` 或 `apps/webadmin-api`

### Requirement: 安全扫描进入基线验证
系统 SHALL 提供一个可重复执行的静态安全扫描步骤，阻断新增本机浏览器自动化依赖或绕过 ZClaw bridge 的可疑代码。扫描 MUST 覆盖新增 TS 文件与相关配置。

#### Scenario: 禁止 Playwright 依赖
- **WHEN** 新增 TS workspace 依赖中出现 `playwright`、`selenium`、`puppeteer` 或 `browser-use`
- **THEN** 基线验证失败，并提示本仓库浏览器操作只能通过 ZClaw bridge

#### Scenario: 禁止本机浏览器打开命令
- **WHEN** 新增 TS 源码中出现本机浏览器打开命令或 `webbrowser` 等绕过路径
- **THEN** 基线验证失败，且不得建议改用本机浏览器作为 fallback

