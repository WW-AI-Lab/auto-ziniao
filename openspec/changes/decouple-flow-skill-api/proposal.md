## Why

当前 `ziniao-assistant` 的 flow 沉淀流程仍依赖仓库文件系统布局、`pnpm ziniao ...` CLI 命令和 `flows/_template.json`、`docs/03-流程定义规范.md` 等本地文件引用。这个模式会让 skill 与 repo-local 实现细节耦合：Agent 需要知道如何写盘、如何调用 CLI、如何找到模板和规范，一旦目录、命令或前端入口演进，skill 就会漂移。

M1-M7 TypeScript 迁移完成后，WebAdmin API 已经成为流程管理、运行、监控和前端托管的统一入口。现在应把“创建 flow、管理 extract、校验、运行、确认产出”的沉淀能力上收到 WebAdmin API，让 skill、CLI、前端三条入口复用同一后端能力，降低重复实现和安全边界绕过风险。

## What Changes

- 新增 WebAdmin API 能力：创建 flow、返回 flow 模板、读写 extract 脚本，并复用现有 flow 校验、运行和输出查询 API。
- 扩展 shared schemas，导出 flow 创建、模板、extract 读写相关 DTO，供 API、CLI、前端和未来 Agent 工具复用。
- 改造 `ziniao new`：保留命令语义，但不再直接读取模板和写入 flow 文件，改为调用本地 WebAdmin API 创建 flow。
- 扩展 WebAdmin 前端：流程页支持创建 flow，并支持对 flow detail 中的 extract 引用进行创建、读取、编辑和保存。
- 重写 `.cursor/skills/ziniao-assistant/references/flow-distill.md`：移除文件系统路径、repo-local docs/template 引用和 CLI 命令依赖，改为内嵌必要流程规范并通过 WebAdmin API 完成沉淀。
- 更新 `.cursor/skills/ziniao-assistant/SKILL.md` 中的沉淀入口说明，明确 flow 沉淀通过 WebAdmin API 完成。
- 不修改 `packages/zclaw` bridge 白名单，不引入本机浏览器 fallback，不改变 `packages/flow-engine` 核心执行语义。

## Capabilities

### New Capabilities
- `flow-distillation-skill`: 约束 flow 沉淀 skill 的 API-first 工作流、内嵌规范、trace 记录、校验运行和无文件系统/CLI 依赖边界。

### Modified Capabilities
- `typescript-webadmin-api`: 增加 flow 创建、flow 模板读取、extract 读写管理 API，并保持本地-only、安全路径和离线测试约束。
- `flow-contract-schemas`: 增加 WebAdmin flow 创建、模板、extract 读写 DTO，并继续由 Zod 与 TypeScript 同源导出。
- `typescript-cli`: 调整 `ziniao new` 的行为来源，从直接文件管理改为 WebAdmin API 驱动，同时保留命令参数、错误语义和安全边界。
- `typescript-webadmin-frontend`: 增加前端 flow 创建和 extract 编辑能力，继续通过 same-origin `/api/*` 使用 shared DTO。

## Architecture Impact

- 复用现有模块边界：`apps/api` 继续作为 WebAdmin 后端，`packages/schemas` 继续承载 DTO 契约，`packages/cli` 只做命令编排，`apps/web` 只通过 same-origin `/api/*` 访问后端。
- API 写盘仍由 `apps/api` 内部负责，并复用 `resolveSafePath`、`validateFlowContent`、`backupFlow`、`createFlowRunner` 等现有能力；不会让 skill、前端或 CLI 直接写 `flows/`、`extracts/`。
- `packages/flow-engine` 仍是 flow 校验和运行的事实执行层；本变更只调整入口与管理能力，不改变 flow DSL 执行模型。
- `packages/zclaw` 仍是唯一 ZClaw bridge 网络出口；WebAdmin API 不直接访问 `127.0.0.1:9481` 或 `/zclaw/*`，真实运行仍通过既有 runner 间接执行。
- 现有 specs 中存在 `apps/webadmin-api` / `apps/webadmin-frontend` 的历史命名，当前代码实际位于 `apps/api` / `apps/web`。本 change 的实现以当前代码目录为准，并在 specs/tasks 中加入验证，避免命名漂移造成误改。

## Impact

- API: `apps/api/src/app.ts`、`apps/api/src/security.ts`、`apps/api/src/app.test.ts`
- Shared contracts: `packages/schemas/src/webadmin.ts`、`packages/schemas/src/index.ts`、`packages/schemas/json-schema/webadmin-api.schema.json`
- CLI: `packages/cli/src/index.ts`、`packages/cli/src/index.test.ts`
- Frontend: `apps/web/src/api.ts`、`apps/web/src/pages/Flows.tsx`
- Skill docs: `.cursor/skills/ziniao-assistant/SKILL.md`、`.cursor/skills/ziniao-assistant/references/flow-distill.md`
- Validation: `pnpm typecheck`、`pnpm test`、`pnpm security:scan`，以及使用 WebAdmin API 的本地端到端沉淀 smoke。
