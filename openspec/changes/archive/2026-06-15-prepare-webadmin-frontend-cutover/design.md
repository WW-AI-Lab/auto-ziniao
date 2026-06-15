## Context

M6 已新增 `apps/webadmin-api`，但它仍默认托管 `webadmin/frontend/dist`。当前前端源码在 `webadmin/frontend/`，该目录是旧 Python WebAdmin 子工程的一部分，使用独立 `package-lock.json` 和本地 `node_modules`，不在根级 pnpm workspace 的 build/typecheck/baseline 中。`packages/schemas/src/webadmin.ts` 已经导出 WebAdmin API DTO 类型，但旧前端仍在 `src/api.ts` 里维护本地接口声明。

`remove-python-runtime` 要求 M7 前先完成 `apps/webadmin-frontend` 整理、WebAdmin API 双跑/切换准备和入口切换证据。当前这些证据缺失，所以 M7 不能继续。本 change 负责补齐这些前置条件。

约束：

- 仍遵守最高安全规则：浏览器操作只能通过 ZClaw bridge；前端、WebAdmin API、测试和 baseline 不得引入 Playwright/Selenium/Puppeteer/browser-use，也不得打开本机浏览器。
- 默认验证必须离线：不执行真实店铺 flow，不调用真实 `POST /zclaw/tools/invoke`，不调用真实 Agent CLI。
- 本 change 不删除 `manager.py`、`engine/`、Python WebAdmin 后端，不最终切换生产入口；只准备 M7 所需证据。

## Goals / Non-Goals

**Goals:**

- 将 `webadmin/frontend` 整理为 `apps/webadmin-frontend` workspace app。
- 让前端复用 `@ziniao/schemas` 的 WebAdmin API DTO 类型，减少前后端类型漂移。
- 让 `apps/webadmin-api` 默认托管 `apps/webadmin-frontend/dist`，并保留 missing dist 的结构化响应。
- 将前端 build/typecheck 纳入 root workspace scripts 和 `pnpm validate:baseline`。
- 产出 M7 preflight 可引用的证据：前端构建、API 静态托管 smoke、WebAdmin API route 对比、CLI local-only run/validate 对比、切换与回滚说明。

**Non-Goals:**

- 不删除 Python engine 或 Python WebAdmin 后端。
- 不把 `python3 manager.py ...` 最终替换为 `ziniao ...`；最终删除和文档清零仍属于 `remove-python-runtime`。
- 不重做 WebAdmin UI 体验，不引入新 UI 框架。
- 不在默认 baseline 中执行真实 ZClaw bridge flow 或真实 Agent CLI。
- 不迁移 `data/`、`flows/`、`extracts/`、`learnings/` 的数据格式。

## Architecture Assessment

### Existing Design Reuse

- `webadmin/frontend`：复用现有 React/Vite/TypeScript/antd/`@ant-design/x` 源码、路由、页面和 assets；迁移位置和 workspace 配置，不做 UI 重写。
- `packages/schemas`：复用 `FlowSummary`、`FlowDetail`、`Schedule`、`ScheduleRun`、`ChatSession`、`ChatMessage`、`ManualRunStatus`、`OutputDirectory`、`ChatSseEvent` 等类型。若前端需要缺失字段，优先扩展 schema 包而不是在前端复制类型。
- `apps/webadmin-api`：复用 M6 Fastify app、route tests、静态托管 fallback、SQLite 状态和 mock runner 测试；只改默认 `frontendDist` 和测试覆盖。
- Root workspace：复用 `pnpm-workspace.yaml` 的 `apps/*` 包发现，扩展 root scripts、`tsconfig.base.json` path alias 和 Vitest alias。
- `scripts/security-scan.ts`：复用既有安全扫描，确认新增 frontend app 不引入浏览器自动化依赖或 direct bridge。

### Boundaries and Ownership

- `apps/webadmin-frontend` 拥有 React 页面、Vite build、前端 API client 和静态 assets。它只通过 same-origin `/api/*` 访问 WebAdmin API，不直接访问 ZClaw bridge 或读取本地 secret。
- `apps/webadmin-api` 拥有 HTTP/SSE API、scheduler、SQLite WebAdmin 状态和静态托管。它可以配置/默认读取 `apps/webadmin-frontend/dist`，但不拥有前端源码。
- `packages/schemas` 拥有 API DTO 类型。前端和 WebAdmin API 都应消费同一类型源，避免重复接口。
- 双跑证据由 docs 或 change tasks 记录，作为 `remove-python-runtime` 的 preflight 输入；本 change 不拥有最终 Python 删除。

### Options and Rationale

1. **移动到 `apps/webadmin-frontend` 而不是继续保留 `webadmin/frontend`**
   - 选择理由：路线图和 AGENTS 明确目标目录是 `apps/webadmin-frontend`，M7 需要旧 Python WebAdmin 目录可删除。
   - 替代方案：只把 root scripts 指向 `webadmin/frontend`。该方案无法解除旧 Python WebAdmin 子工程耦合。

2. **直接复用旧前端源码，不重做 UI**
   - 选择理由：本 change 的目标是迁移和切换准备，不是产品重设计；复用可以降低行为漂移。
   - 替代方案：重构页面结构或换 UI 库。该方案风险高且不解决 M7 gate 的核心缺口。

3. **前端类型从 `@ziniao/schemas` 导入**
   - 选择理由：WebAdmin API DTO 已在 schemas 包中，复用能减少 API 漂移。
   - 替代方案：继续本地 interface。该方案会让前置整理完成后仍保留类型分叉。

4. **WebAdmin API 默认托管新 dist，并保留可注入 `frontendDist`**
   - 选择理由：默认路径要体现目标态，测试仍需要注入临时 dist 验证 missing/present 分支。
   - 替代方案：同时扫描两个 dist 路径。该方案会掩盖迁移遗漏，M7 删除旧目录时风险更大。

### Quality Attributes

- **安全**：前端 app 不引入浏览器自动化依赖，不直接访问 bridge，不读取 ZClaw key；安全扫描覆盖 `apps/*`。
- **可靠性**：保留 WebAdmin API missing dist 响应，避免前端构建缺失导致 API 不可用。
- **可维护性**：前端进入 pnpm workspace，依赖和 scripts 统一管理；API DTO 由 schemas 统一导出。
- **可测试性**：前端 build/typecheck、WebAdmin API injection tests、CLI local-only smoke 和 docs evidence 都可重复运行。
- **可部署性**：生产启动仍由 `apps/webadmin-api` 托管静态 dist；前端 build 产物路径固定为 `apps/webadmin-frontend/dist`。

### Complexity and Exceptions

不新增后端服务、数据库或协议。新增的是一个 workspace app 边界，但它来自已有前端子工程迁移。控制方式：

- 迁移时只复制/移动前端源码和配置，不重写页面。
- Root scripts 明确纳入 frontend build/typecheck。
- WebAdmin API tests 同时覆盖 missing dist 和新 dist。
- 回滚可以恢复 `webadmin/frontend` 目录和 WebAdmin API 的旧 `frontendDist` 默认路径。

## Decisions

1. **前端 app 名称为 `@ziniao/webadmin-frontend`**
   - 替代：继续使用 package name `frontend`。拒绝，因为 workspace 内名称需要明确归属，避免和其他前端包冲突。

2. **使用 Vite 当前配置并将 dev proxy 指向 `127.0.0.1:9482`**
   - 替代：新增 BFF 或开发代理服务。拒绝，因为 `apps/webadmin-api` 已是本地 API 服务。

3. **root `pnpm validate:baseline` 包含前端构建/类型检查**
   - 替代：只在前端目录手工运行。拒绝，因为 M7 preflight 需要可重复证据。

4. **双跑以离线和 local-only 为默认**
   - 替代：把真实 bridge flow 双跑纳入默认验证。拒绝，因为默认 baseline 不得打开店铺浏览器；真实 bridge 验证必须显式人工确认。

## Risks / Trade-offs

- [前端依赖版本与 root TS 版本不一致] -> 保留前端 package 内必要 devDependencies，先用 package-local build 验证，再逐步统一。
- [前端本地 interface 与 schema 类型不完全一致] -> 先复用可覆盖的 DTO 类型，缺口通过 `packages/schemas` 扩展或在前端定义 UI-only 类型，并在 tasks 中记录。
- [静态 dist 路径切换导致 API root 返回缺失提示] -> WebAdmin API tests 覆盖新 dist present/missing 两种路径。
- [误以为本 change 已完成 M7] -> README/AGENTS/路线图明确本 change 只解除 M7 preflight 阻塞，不删除 Python。
- [旧 `webadmin/frontend` 残留造成混淆] -> 实现完成后文档指向 `apps/webadmin-frontend`；旧目录是否删除由 tasks 根据迁移完整性处理，但不得删除 Python 后端。

## Migration Plan

1. 新建 `apps/webadmin-frontend`，迁移旧前端源码、public assets、Vite/TS/ESLint/package 配置。
2. 更新 package name、workspace scripts、root build/typecheck/baseline。
3. 修改前端 API client 复用 `@ziniao/schemas` DTO 类型，补齐缺失类型。
4. 修改 `apps/webadmin-api` 默认 `frontendDist` 为 `apps/webadmin-frontend/dist`，更新 tests。
5. 执行前端 build/typecheck、WebAdmin API tests、root baseline、安全扫描。
6. 记录双跑/切换证据：Python WebAdmin 当前链路、TS WebAdmin API injection/smoke、CLI local-only validate/run、真实 bridge defer 原因（如未显式确认环境）。
7. 更新 README、AGENTS、`docs/06-TS迁移进度与路线图.md`，说明 M7 preflight 可继续检查这些证据。
8. 回滚：恢复 root scripts 与 WebAdmin API `frontendDist` 默认路径，删除或隔离 `apps/webadmin-frontend`，继续使用 `webadmin/frontend/dist`。

## Open Questions

1. 旧 `webadmin/frontend` 目录是否在本 change 中删除，还是等 M7 删除整个 Python WebAdmin 目录时一并清理；建议本 change 完成迁移后删除旧前端源码，但不删除 Python WebAdmin 后端。
2. 是否需要真实 bridge flow 双跑作为 M7 前置硬要求；当前路线图允许在未确认紫鸟客户端/店铺参数时记录为环境阻塞。
