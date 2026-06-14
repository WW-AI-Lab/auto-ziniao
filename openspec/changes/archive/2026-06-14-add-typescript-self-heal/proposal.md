## Why

M1 已完成 TS 契约与 workspace，M2 已完成 TS 侧唯一 ZClaw bridge client，M3 已完成 `packages/flow-engine` 的离线执行语义与失败 metadata。路线图中的下一步是 M4：迁移自愈链路，让 TypeScript 侧具备与 Python `engine/self_heal.py` 对等的错误分类、已知问题命中、提示词生成、冷却频控和 Agent CLI 抽象能力。

现在做 M4 的原因是：如果没有可替代的 TS 自愈模块，后续 `packages/cli` 或 WebAdmin 切换到 TS flow engine 后，失败恢复仍会依赖 Python `engine/self_heal.py`。M4 需要先把自愈能力做成可离线验证、可 dry-run、可由后续 CLI 接入的独立包，同时继续保持生产入口 `python3 manager.py ...` 不变。

## What Changes

- 新增 `packages/self-heal`，作为 TypeScript 侧自愈链路包。
- 实现与 Python `engine/self_heal.py` 兼容的错误分类：`auth_failed`、`timeout`、`element_not_found`、`nav_failed`、`extract_failed`、`bridge_down`、`generic`。
- 实现 `learnings/known_issues.json` 已解决问题命中逻辑，支持 `pattern` 子串匹配和 `flow_id + step_id` 匹配。
- 实现 heal context 与 prompt 文件生成，兼容 `data/logs/heals/<heal_id>.json` 与 `data/logs/heals/<heal_id>_prompt.md`。
- 实现模板查找优先级：`heal_templates/<flow_id>/<error_type>.md`、`heal_templates/<flow_id>/generic.md`、`heal_templates/<error_type>.md`、`heal_templates/generic.md`、内置 fallback。
- 实现 `learnings/heals.jsonl` 事件写入、冷却期和单流程每日上限检查。
- 实现 Agent CLI adapter 抽象，支持 dry-run 和离线单测；默认验证不得实际调用 OpenClaw/Claude/Cursor，也不得执行真实 ZClaw bridge flow。
- 接收 `packages/flow-engine` 的失败 metadata 作为输入契约，但不在本阶段迁移 CLI、不替换 `python3 manager.py ...`、不修改 WebAdmin。
- 更新 workspace scripts、TypeScript path alias、安全扫描、文档和路线图，使 M4 可被 `pnpm validate:baseline` 离线验证。

## Capabilities

### New Capabilities

- `typescript-self-heal`: 定义 TS 自愈模块的错误分类、known issues 命中、prompt/template rendering、heal context 落盘、冷却频控、Agent CLI adapter、dry-run 和离线验证要求。

### Modified Capabilities

- `typescript-workspace-baseline`: workspace 包边界从 M3 的 `core/schemas/zclaw/flow-engine` 扩展到 M4 的 `packages/self-heal`，并继续禁止迁移 CLI、WebAdmin 或替换 Python 生产入口。
- `flow-compatibility-baseline`: 基线验证纳入 TS self-heal 的离线测试与安全扫描，继续保证默认 baseline 不调用真实 ZClaw bridge、不启动店铺浏览器、不调用真实 Agent CLI。

## Architecture Impact

- 复用 `packages/core`：repo root、JSON/JSONL 读取、时间、错误类型与后续可新增的安全文件写入 helper。
- 复用 `packages/schemas`：`HealContextSchema`、`HealEventSchema`、`KnownIssuesFileSchema`、`FlowDefinition` 和运行时数据契约；如实现需要，只做兼容性扩展，不改变历史数据文件格式。
- 复用 `packages/flow-engine` 的失败结果结构：`failed_step`、`heal_context`、`store_id`、`target_id`、`error` 等 metadata 作为 self-heal 输入，不把 self-heal 逻辑倒灌进 flow-engine。
- Python `engine/self_heal.py` 是行为参考，尤其是错误分类关键词、模板优先级、prompt 内容骨架、cooldown/max_per_day、Agent command placeholder 和事件日志格式。
- 安全边界不变：M4 不直接访问 ZClaw bridge，不新增浏览器自动化依赖，不提供本机浏览器 fallback；默认测试使用 mock Agent runner、临时 data root 和固定 clock。
- 生产入口不变：`manager.py`、`engine/self_heal.py`、`engine/flow_engine.py`、WebAdmin 后端/API/调度器本阶段都不替换。

## Impact

- 代码：新增 `packages/self-heal`；更新根级 `package.json`、`tsconfig.base.json`、`vitest.config.ts`、`scripts/security-scan.ts`（如需）和离线测试。
- Specs：新增 `typescript-self-heal`；修改 `typescript-workspace-baseline` 与 `flow-compatibility-baseline`。
- 文档：更新 `docs/05-TS重构技术蓝图.md`、`docs/06-TS迁移进度与路线图.md`、README 和 `AGENTS.md` 中的 M4 状态、验证命令和边界。
- 运行：默认仍不改变 `python3 manager.py ...` 生产入口；M4 完成后只提供 TS self-heal 包能力与 dry-run/离线验证基础。
