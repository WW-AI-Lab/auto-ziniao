## Why

TS 迁移已完成 M1-M5：契约、ZClaw client、flow-engine、self-heal 和 `ziniao` CLI 都已具备过渡能力，但 WebAdmin 后端仍是 `webadmin/` 下的 FastAPI + uvicorn 子工程。只要 WebAdmin 运行路径仍依赖 Python，项目就不能进入后续“Python 依赖清零”阶段。

按 `docs/06-TS迁移进度与路线图.md`，下一阶段 M6 应新增 `apps/webadmin-api`，把 WebAdmin 后端能力迁移到 TypeScript/Node.js，同时保持现有生产入口 `python3 manager.py ...` 不变，并且不迁移前端、不移除 Python engine、不切换最终运行入口。

## What Changes

- 新增 TypeScript WebAdmin 后端应用 `apps/webadmin-api`，使用 Fastify + SQLite，默认只监听 `127.0.0.1`。
- 迁移现有 Python WebAdmin 后端的核心能力：flows 管理、运行观测、计划任务调度、Agent 对话 SSE、静态前端 dist 托管。
- WebAdmin API 不直接访问 ZClaw bridge，不读取 ZClaw API key，不打开本机浏览器；真实工具调度只能通过既有 TS flow-engine / CLI 编排边界间接发生。
- 新增或复用 WebAdmin DTO schema，保证 API 输入输出、运行日志、调度记录和 chat 事件可被 TypeScript schema 校验。
- 扩展 workspace、build/typecheck/test/baseline 和安全扫描，使 `apps/webadmin-api` 进入默认验证范围。
- 保留 `webadmin/` Python 后端和 `webadmin/frontend/` 当前前端位置；本阶段不移动前端到 `apps/webadmin-frontend`，不替换 `python3 manager.py ...` 生产入口。
- 不执行真实 flow、不调用真实 `POST /zclaw/tools/invoke`、不调用真实 Agent CLI 作为默认验证；M6 默认测试使用 mock runner、mock tool client、临时 data root 和固定 clock。

## Capabilities

### New Capabilities

- `typescript-webadmin-api`: 覆盖 `apps/webadmin-api` 的 Fastify 服务、REST/SSE API、SQLite 存储、调度器、静态前端托管、安全边界和离线验证要求。

### Modified Capabilities

- `typescript-workspace-baseline`: M6 允许新增 `apps/webadmin-api`，并要求 workspace scripts、package 边界和安全扫描覆盖 `apps/*`。
- `flow-compatibility-baseline`: 基线验证需要纳入 WebAdmin API 离线测试，并继续禁止真实 flow、真实 bridge、真实 Agent CLI 和本机浏览器。
- `flow-contract-schemas`: 如 WebAdmin API 需要新增或补齐 DTO/runtime schema，必须继续保持 TypeScript 类型、运行时校验与 JSON Schema 同源。

## Architecture Impact

- 复用现有 TS 包：`packages/core` 提供路径、JSON/JSONL 和文件工具；`packages/schemas` 提供 flow、runtime data、WebAdmin DTO schema；`packages/flow-engine` 提供 flow 加载、校验和执行语义；`packages/self-heal` 提供自愈 dry-run/触发编排；`packages/cli` 保持 CLI 入口能力但不被 WebAdmin 复制业务规则。
- 复用现有 Python WebAdmin 行为作为迁移参照：`webadmin/api/*`、`webadmin/storage.py`、`webadmin/scheduler/*`、`webadmin/chat/*` 是功能对齐对象，但不会在 M6 中删除。
- 新增 `apps/webadmin-api` 会引入 Fastify、SQLite driver 和 SSE/static serving 能力；需要在 design 中评估 `better-sqlite3` 与替代方案的 native addon 风险。
- WebAdmin API 拥有自己的 SQLite 数据模型（计划任务、调度历史、chat 会话/消息），但不迁移 `flows/`、`extracts/`、`data/logs/`、`data/output/` 和 `learnings/` 的长期文件契约。
- 安全扫描必须继续阻断 Playwright/Selenium/Puppeteer/browser-use、本机浏览器打开命令、未授权 direct bridge 访问，并明确只有 `packages/zclaw` 可直接访问 ZClaw bridge。

## Impact

- 新增：`apps/webadmin-api/`、相关 Vitest 测试、Fastify/SQLite 配置、WebAdmin API schema 或 adapter。
- 修改：`package.json`、`pnpm-workspace.yaml`、`tsconfig.base.json`、`vitest.config.ts`、`scripts/security-scan.ts`、`packages/schemas` 中必要的 WebAdmin DTO/runtime schema、`docs/06-TS迁移进度与路线图.md` 与相关 README/docs。
- 不修改或不替换：`engine/flow_engine.py`、`engine/self_heal.py`、`engine/zclaw_client.py`、`manager.py`、`webadmin/frontend/` 位置、`python3 manager.py ...` 生产入口。
- 新依赖：Fastify 及本地 SQLite driver；不得引入浏览器自动化依赖或公网绑定配置。
