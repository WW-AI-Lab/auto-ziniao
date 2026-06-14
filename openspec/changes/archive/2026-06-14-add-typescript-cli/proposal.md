## Why

当前 TypeScript 迁移已完成 M1-M4：`packages/core`、`packages/schemas`、`packages/zclaw`、`packages/flow-engine` 和 `packages/self-heal` 已具备目标态核心能力，但用户入口仍停留在 `python3 manager.py ...`。如果不先迁移 CLI，后续 WebAdmin TS 后端、双跑切换和最终去 Python 都缺少稳定的 TypeScript 操作入口。

现在推进 M5 的目标是新增 `packages/cli`，提供 `ziniao ...` 命令并对齐当前 `manager.py` 的日常操作语义，同时继续保留 Python 生产入口。该阶段只建立可验证的 TS CLI 过渡入口，不迁移 WebAdmin，不删除 Python engine，不在默认验证中调用真实 ZClaw bridge 或真实 Agent CLI。

## What Changes

- 新增 `packages/cli`，基于 `commander` 提供 `ziniao ...` CLI。
- 兼容当前 `manager.py` 的主要命令语义：`list`、`run`、`run-all`、`retry`、`new`、`validate`、`history`、`enable`、`disable`、`heals`、`stats`、`cron`。
- CLI 聚合现有 TS 包：
  - `@ziniao/flow-engine` 用于 flow 加载、静态校验、运行、参数解析、output/run log 写入。
  - `@ziniao/self-heal` 用于失败后的自愈触发和 dry-run/离线测试。
  - `@ziniao/core` 与 `@ziniao/schemas` 用于路径、JSON/JSONL 和契约解析。
- root workspace 增加 CLI 构建、类型检查、测试和本地执行入口，但不改变 `python3 manager.py ...` 的生产语义。
- 默认验证继续离线：单测使用 mock tool client、临时 data root、no-op sleeper、mock Agent runner；不得调用真实 `POST /zclaw/tools/invoke`，不得打开店铺浏览器，不得调用真实 OpenClaw/Claude/Cursor。
- 文档更新：`docs/06-TS迁移进度与路线图.md` 记录 M5 proposal 状态和当前实际进度，README/AGENTS 在实现阶段同步 CLI 过渡边界。
- 不做：
  - 不迁移 WebAdmin 后端或前端。
  - 不修改或替换 `engine/flow_engine.py`、`engine/self_heal.py`、`engine/zclaw_client.py`、`manager.py`。
  - 不把 crontab、WebAdmin subprocess 或用户生产入口切到 `ziniao`。
  - 不新增本机浏览器自动化通道或 ZClaw bridge fallback。

## Capabilities

### New Capabilities

- `typescript-cli`: 定义 M5 TypeScript CLI 的命令兼容、包边界、flow/self-heal 聚合、安全限制、离线验证和过渡运行要求。

### Modified Capabilities

- `typescript-workspace-baseline`: 将阶段边界从 M4 扩展到 M5，允许新增 `packages/cli`，并继续禁止 WebAdmin TS 化和 Python 生产入口替换。
- `flow-compatibility-baseline`: 将 `ziniao` CLI 的 validate/run/list/history 等兼容验证纳入离线基线，确保默认 baseline 不触发真实 bridge 或真实 Agent CLI。

## Architecture Impact

- 复用 `packages/flow-engine` 已有 public API：`loadFlow()`、`validateFlow()`、`parseParams()`、`runFlow()`、`createZClawFlowToolClient()` 和注入式 `FlowToolClient`。
- 复用 `packages/self-heal` 已有 public API：错误分类、known issues、prompt/context rendering、cooldown、Agent runner adapter、`triggerHeal()` 和 `buildTriggerInputFromFailure()`。
- CLI 层只负责参数解析、命令编排、终端输出和 exit code，不重新实现 flow DSL、ZClaw transport 或 self-heal 业务规则。
- `packages/cli` 可以依赖 `@ziniao/flow-engine` 与 `@ziniao/self-heal`，但不得直接访问 `127.0.0.1:9481`、`/zclaw/*` 或读取 ZClaw API key；真实工具调度仍必须通过 `flow-engine` 注入或其 ZClaw adapter。
- CLI 引入 `commander`，这是 `docs/05-TS重构技术蓝图.md` 已选定的 CLI 框架；不新增数据库、daemon、端口或 Web 服务。
- 输出兼容优先覆盖人类可用语义和 exit code，不强求逐字复刻 Python CLI 的 emoji/排版。

## Impact

- 代码：新增 `packages/cli`；更新 root `package.json`、`tsconfig.base.json`、`vitest.config.ts`、`scripts/security-scan.ts` 等 workspace 配置（如实现阶段需要）。
- Specs：新增 `typescript-cli`；修改 `typescript-workspace-baseline` 与 `flow-compatibility-baseline`。
- 文档：更新 `docs/06-TS迁移进度与路线图.md`；实现阶段同步 README 与 AGENTS 的 M5 边界。
- 依赖：新增 `commander` 作为 CLI 运行依赖。
- 运行：`python3 manager.py ...` 仍是生产入口；`ziniao ...` 是 M5 过渡入口和后续双跑切换基础。
