## Why

`docs/05-TS重构技术蓝图.md` 已经明确最终目标：将紫鸟自动化引擎从 Python 运行时迁移到 TypeScript/Node.js，并保持现有 flow 资产、ZClaw 安全边界、自愈闭环、WebAdmin 与 OpenClaw 集成能力兼容。这个目标跨度很大，若直接迁移 `zclaw_client.py`、`flow_engine.py`、`self_heal.py` 与 WebAdmin，最容易出现 flow DSL 行为漂移、日志格式不兼容或安全出口被绕过。

第一个提案只建立迁移基线：把当前 Python 实现中已经稳定的契约冻结为 TypeScript 可复用的 schema、fixture 与验证命令，让后续 ZClaw client、Flow Engine、自愈和 WebAdmin 迁移都先对齐同一份契约。这样可以按蓝图分阶段推进，而不是一次性完成所有工作。

## What Changes

- 新增 TypeScript/Node.js workspace 基础骨架，用于承载后续 `packages/*` 与验证命令；本阶段不替换现有 `python3 manager.py` 入口。
- 新增 `packages/schemas` 契约包，定义并校验现有 flow definition、flow step、运行日志、自愈记录、known issues、WebAdmin 调度/chat 数据形态。
- 新增现有 flow 的兼容性 fixture/golden 基线，覆盖 `flows/*.json`、`@extracts/*.js` 引用、变量引用、branch/goto、validate、on_fail 与 output 文件名规则。
- 新增最小 `packages/core` 基础能力边界，只承载路径、JSON/JSONL、时间、错误类型等无浏览器副作用的共享工具。
- 新增验证命令与测试约定，要求 TypeScript schema 能解析当前仓库 flow，并与 Python `manager.py validate` 的关键结果保持一致。
- 明确非目标：不迁移 ZClaw client、不执行真实紫鸟浏览器操作、不迁移 Flow Engine 执行器、不迁移 Self-Heal、不迁移 WebAdmin API、不移除 Python。

## Capabilities

### New Capabilities

- `typescript-workspace-baseline`: TypeScript/Node.js monorepo 基线、包边界、开发命令与不影响现有 Python 入口的并行运行约束。
- `flow-contract-schemas`: 当前 flow DSL、运行日志、自愈记录、known issues 与相关数据文件的 TypeScript schema 契约。
- `flow-compatibility-baseline`: 现有 flow 资产的 fixture/golden 兼容性基线，作为后续 TS 引擎迁移的回归标准。

### Modified Capabilities

（无。`openspec/specs/` 当前没有已归档 specs；本 change 只新增基线能力，不修改 `add-web-admin` 未归档 change 的要求。）

## Architecture Impact

- 复用当前事实来源：`docs/03-流程定义规范.md`、`docs/05-TS重构技术蓝图.md`、`engine/flow_engine.py`、`engine/zclaw_client.py`、`engine/self_heal.py`、`engine/manager.py`、`flows/*.json`、`extracts/*.js`。
- 与进行中的 `add-web-admin` change 并行：本 change 不改变 WebAdmin 现有 Python/FastAPI 实现，也不接管其未完成前端任务；只为未来迁移提供共享类型与验证基础。
- 安全边界继续沿用现有最高规则：浏览器操作只能经 ZClaw bridge，且本阶段不新增任何浏览器自动化实现或本机浏览器依赖。
- 依赖影响仅限 Node/TypeScript 开发与测试工具链；Python 引擎主体仍保持当前运行方式。
- 当前仓库缺少 `openspec/project.md` 与 `openspec/AGENTS.md`，实际 OpenSpec 上下文来自 `openspec/config.yaml` 与根目录 `AGENTS.md`。

## Impact

- 可能新增：`package.json`、`pnpm-workspace.yaml`、`tsconfig.base.json`、`packages/core/`、`packages/schemas/`、`test/fixtures/`、`test/golden/`。
- 可能修改：README 或 `docs/05-TS重构技术蓝图.md` 的阶段状态说明（仅在实现阶段需要）。
- 不修改：`engine/zclaw_client.py` 的 `_request()` 白名单、现有 `flows/*.json`、`extracts/*.js`、`manager.py` 命令语义、WebAdmin 运行路径。
- 验证命令将同时包含 Python 现状校验与 TS schema/test 校验，确保新基线不破坏现有执行路径。
