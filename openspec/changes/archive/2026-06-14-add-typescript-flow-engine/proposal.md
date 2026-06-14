## Why

M1 已完成 TS 契约与骨架，M2 已完成 TS 侧唯一 ZClaw bridge client。下一步必须迁移 flow 执行语义，否则 TypeScript 仍只能做静态校验，不能替代 Python `engine/flow_engine.py` 承担核心执行。M3 的目标是建立 `packages/flow-engine`，把现有 flow DSL 的加载、静态校验、变量解析、条件/分支/跳转、validate、内置动作、工具步骤、run log 和 output 写入迁移到 TS。

本 change 继续遵守小步快跑：先让 TS flow engine 在 mock ZClaw client 下完成离线语义验证，再安排显式人工触发的低风险 flow 真机双跑验证。生产入口仍是 `python3 manager.py ...`，本阶段不迁移 CLI、自愈或 WebAdmin。

## What Changes

- 新增 `packages/flow-engine`，作为 TypeScript 侧 flow DSL 执行核心包。
- 实现 flow 加载与 TS 版静态校验入口，复用 `packages/schemas` 的 schema 与 `validateFlowContract()`。
- 实现参数合并、变量解析、内置时间变量、上下文读写和步骤 `save` 语义。
- 实现 condition、branch、goto、on_fail.branch、最大执行步数保护和跳转目标解析。
- 实现 validate 规则：`not_empty`、`min_rows`、`require_fields`、`contains`、`path`。
- 实现内置 action：`sleep`、`save_json`、`save_csv`、`print`、`assert`、`fail`、`branch`、`goto`、`close_store`。
- 接入 `packages/zclaw` 执行工具步骤，包括 `list_stores`、`open_store`、`visit_page`、`execute_script`、`click_element`、`take_screenshot`、`wait_for_element`、`close_store` 和通用 tool fallback。
- 实现 run log 写入 `data/logs/runs.jsonl` 与 output 写入 `data/output/`，保持 Python 现有格式兼容。
- 增加离线单测、golden/parity 测试和低风险真机双跑验证任务。
- 不替换 `python3 manager.py ...`，不迁移 `engine/self_heal.py`、`packages/cli`、WebAdmin 或 OpenClaw。

## Capabilities

### New Capabilities

- `typescript-flow-engine`: 定义 TS flow engine 的加载、静态校验、执行语义、变量/条件/分支/validate、内置动作、ZClaw tool 接入、run log/output 兼容和验证要求。

### Modified Capabilities

- `typescript-workspace-baseline`: workspace 包边界从 M2 的 `core/schemas/zclaw` 扩展到 M3 的 `packages/flow-engine`，同时继续保持 Python CLI 不受影响。
- `flow-compatibility-baseline`: 基线验证需要纳入 TS flow-engine 的离线语义测试，但默认 baseline 仍不得执行真实 flow 或调用真实 ZClaw bridge。

## Architecture Impact

- 复用 `packages/core`：repo path、JSON/JSONL、时间、错误类型与文件 helper。
- 复用 `packages/schemas`：FlowDefinition 类型、flow contract parser、静态校验、运行日志 schema。
- 复用 `packages/zclaw`：唯一 ZClaw bridge 出口；`packages/flow-engine` 不得直接访问 `9481` 或 `/zclaw/*`。
- Python `engine/flow_engine.py` 是行为参考，尤其是参数合并、变量解析、branch/goto、validate、内置动作、run log 和 output 格式。
- 默认测试使用 mock ZClaw client，不要求紫鸟客户端在线；真机双跑必须是显式任务，不进入 `pnpm validate:baseline` 默认链路。
- 本阶段新增执行核心包，是后续 `packages/cli` 与 WebAdmin 切换的前置基础设施，需要在 design.md 中明确错误、重试、清理、自愈和生产入口边界。

## Impact

- 代码：新增 `packages/flow-engine`，更新 root scripts、`tsconfig.base.json`、`vitest.config.ts`、`scripts/security-scan.ts`（如需）与测试。
- Specs：新增 `typescript-flow-engine`；修改 `typescript-workspace-baseline` 与 `flow-compatibility-baseline`。
- 文档：更新 `docs/05-TS重构技术蓝图.md`、`docs/06-TS迁移进度与路线图.md`、README 和 AGENTS 中的 M3 状态、验证命令与边界。
- 运行：默认仍不改变 `python3 manager.py ...` 生产入口；M3 完成后只具备 TS engine 双跑能力，不自动切换生产。
