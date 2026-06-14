## Why

M1 已完成 TypeScript workspace、`packages/core`、`packages/schemas`、flow schema/golden 与静态安全扫描，现有生产入口仍由 `python3 manager.py ...` 承担。下一阶段需要先迁移最关键的安全出口：ZClaw bridge client。只有把 TS 侧唯一网络出口、路径白名单、API key 读取、错误分类与工具封装固定下来，后续 `packages/flow-engine` 才能在不扩大安全风险的前提下逐步接入。

本 change 对齐 `docs/05-TS重构技术蓝图.md` 的 M2「安全出口可用」。目标是建立可单测、可静态扫描、可回滚的 `packages/zclaw`，但不执行真实 flow，不调用 ZClaw bridge 做基线测试，也不替换 Python `engine/zclaw_client.py`。

## What Changes

- 新增 `packages/zclaw`，作为 TypeScript 侧唯一 ZClaw bridge client 包。
- 实现 ZClaw 配置读取契约：默认 `http://127.0.0.1:9481`，API key 优先来自 `ZCLAW_API_KEY`，其次来自 `~/.zclaw/config.json`。
- 实现低层 HTTP client 的安全边界：只允许访问 `/zclaw/*`，高级封装最终只能调用 `GET /zclaw/tools` 与 `POST /zclaw/tools/invoke`。
- 提供 `getTools()`、`invoke()` 与最小高级封装：`listStores()`、`openStore()`、`closeStore()`、`visit()`、`executeScript()`、`screenshot()`、`click()`、`waitElement()`。
- 增加结构化错误类型，明确区分配置缺失、非法路径、bridge 不可达、HTTP 错误、bridge 返回错误、工具调用失败和超时。
- 扩展测试与安全扫描，确保 `packages/zclaw` 不引入 Playwright/Selenium/Puppeteer/browser-use，不打开本机浏览器，不绕过 ZClaw bridge。
- 不修改 `manager.py`、`engine/*.py`、`flows/*.json`、`extracts/*.js`、WebAdmin 或生产运行命令。

## Capabilities

### New Capabilities

- `typescript-zclaw-client`: 定义 TypeScript ZClaw client 的配置读取、安全白名单、工具发现、工具调用、高级封装、错误分类和离线测试要求。

### Modified Capabilities

- `typescript-workspace-baseline`: workspace 包边界从 M1 的 `packages/core`、`packages/schemas` 扩展到 M2 的 `packages/zclaw`，同时继续保持 Python CLI 不受影响，并将新包纳入 `pnpm validate:baseline`。

## Architecture Impact

- 复用现有 `packages/core` 的错误、路径和 JSON helper；复用 `packages/schemas` 中已固化的 ZClaw 工具名常量，不重复维护工具名集合。
- 新增 `packages/zclaw` 是跨后续阶段复用的基础设施，后续 `packages/flow-engine`、`packages/cli` 会依赖它；WebAdmin API 不应直接访问 ZClaw bridge。
- 现有 Python `engine/zclaw_client.py` 的 `_request()` 路径白名单是行为参考与硬约束，本 change 不修改也不绕过它。
- 测试以 mock HTTP server 或 mock fetch 为主，不依赖本地紫鸟客户端在线，不调用真实 `POST /zclaw/tools/invoke`。
- 安全扫描需要允许 `packages/zclaw` 内部出现唯一受控的 `/zclaw/` 与 `9481` 访问，同时继续禁止其他包直接访问 bridge。

## Impact

- 代码：新增 `packages/zclaw`，更新根 `package.json` scripts、`pnpm-workspace.yaml`、`tsconfig.base.json` 或相关 package 配置，按需更新 `scripts/security-scan.ts` 与测试文件。
- Specs：新增 `openspec/specs/typescript-zclaw-client`，修改 `openspec/specs/typescript-workspace-baseline`。
- 文档：按需更新 `README.md`、`docs/05-TS重构技术蓝图.md`、`AGENTS.md` 中的 M2 状态与验证命令。
- 运行：不改变 `python3 manager.py ...` 生产入口，不要求 ZClaw bridge 在线即可完成基线验证。
