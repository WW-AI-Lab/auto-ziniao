## Why

`remove-python-runtime` 的 implementation 已被前置 gate 阻塞：仓库尚未完成 `apps/webadmin-frontend` 整理、WebAdmin API 双跑验证和入口切换准备。当前 `apps/webadmin-api` 仍托管 `webadmin/frontend/dist`，旧 Python WebAdmin 后端和旧前端目录仍是生产链路的一部分，M7 不能在这种状态下删除 Python。

本变更用于补齐 M7 前置工作：把现有 React/Vite WebAdmin 前端纳入根级 pnpm workspace，迁移到 `apps/webadmin-frontend`，让 `apps/webadmin-api` 托管新前端 dist，并建立 Python/TS WebAdmin 与 CLI 切换前的双跑/证据记录。完成后，`remove-python-runtime` 可以从 preflight gate 继续推进，但本变更本身不删除 Python engine、不把生产入口最终切到 TS。

## What Changes

- 新增 `apps/webadmin-frontend` workspace app，迁移现有 `webadmin/frontend` 的 React + Vite + TypeScript + antd + `@ant-design/x` 前端源码、public assets、build 配置和 package scripts。
- 让前端 API 类型复用 `packages/schemas` 导出的 WebAdmin DTO 类型，避免在前端维护分叉类型。
- 修改 `apps/webadmin-api` 静态托管逻辑，优先托管 `apps/webadmin-frontend/dist`，并保留 missing dist 的结构化状态响应。
- 在 root workspace scripts 中纳入 `apps/webadmin-frontend` 的 build/typecheck/test 或等价验证，继续保持默认 baseline 离线。
- 建立 WebAdmin Python/TS 双跑与切换准备证据：API route 对比、静态托管 smoke、CLI local-only `webadmin_selftest` 对比、入口切换和回滚说明。
- 更新 README、AGENTS、`docs/06-TS迁移进度与路线图.md`，说明本阶段完成后仍不删除 Python，但 M7 preflight 所需的前端/双跑/切换证据已就绪。

## Capabilities

### New Capabilities

- `typescript-webadmin-frontend`: 覆盖 `apps/webadmin-frontend` 的 workspace app、API 类型复用、构建产物、离线验证和前端迁移边界。

### Modified Capabilities

- `typescript-webadmin-api`: 静态托管从 `webadmin/frontend/dist` 扩展到 `apps/webadmin-frontend/dist`，并增加 WebAdmin 双跑/切换准备要求。
- `typescript-workspace-baseline`: workspace 边界允许新增 `apps/webadmin-frontend`，root build/typecheck/test/baseline 覆盖该 app。
- `flow-compatibility-baseline`: 增加 M7 前置证据要求，包括 CLI local-only 双跑、WebAdmin API 双跑或 route 对比记录。

## Architecture Impact

- 复用现有前端技术栈：React + Vite + TypeScript + antd + `@ant-design/x`，不引入新 UI 框架。
- 复用现有 `apps/webadmin-api`：只调整静态 dist 来源和 smoke/双跑验证，不新增第二个 WebAdmin 后端服务。
- 复用 `packages/schemas`：前端 API DTO 从 schema 包导入或通过 schema 导出类型获得，不在前端复制 WebAdmin DTO。
- 保持安全边界：前端不直接访问 ZClaw bridge，不读取 ZClaw API key，不打开本机浏览器；真实运行仍通过 API/CLI 间接编排。
- 保持阶段边界：本 change 不删除 `manager.py`、`engine/`、Python WebAdmin 后端，不切最终生产入口；它只产出 `remove-python-runtime` 所需的前置证据。

## Impact

- 代码：`apps/webadmin-frontend/`、`apps/webadmin-api/src/*` 静态托管配置、root `package.json`、`pnpm-workspace.yaml`、`tsconfig` references、Vitest 或前端验证配置、`packages/schemas` 类型导出。
- 文档：`README.md`、`AGENTS.md`、`docs/06-TS迁移进度与路线图.md`，以及必要的双跑/切换证据记录。
- OpenSpec：新增 `typescript-webadmin-frontend` spec，更新 `typescript-webadmin-api`、`typescript-workspace-baseline`、`flow-compatibility-baseline`。
- 验证：前端 build/typecheck、WebAdmin API tests、静态托管 smoke、CLI local-only smoke、`pnpm validate:baseline`、`pnpm security:scan`。
