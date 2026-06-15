## 1. Workspace 与依赖基线

- [x] 1.1 更新 `pnpm-workspace.yaml`、root `package.json`、`tsconfig.base.json` 和 `vitest.config.ts`，让 `apps/webadmin-api` 进入 workspace、build、typecheck、test 和 baseline 路径。
- [x] 1.2 创建 `apps/webadmin-api` 应用骨架（`package.json`、`tsconfig.json`、`src/`、测试入口），使用 Fastify，默认 host 固定为 `127.0.0.1`。
- [x] 1.3 验证 `better-sqlite3` 在当前 Node/pnpm 环境可安装、typecheck 和 test；如不可接受，记录原因并切换到 `sqlite3` 或可用的 `node:sqlite`。
- [x] 1.4 实现 WebAdmin API 的配置读取与启动入口，明确不提供 `0.0.0.0` 绑定开关，不修改 `manager.py` 生产入口。

## 2. Schema 与共享契约

- [x] 2.1 扩展 `packages/schemas/src/webadmin.ts`，补齐 flow summary/detail、manual run status、output file entry、SSE event、统一错误响应、API list/page response 等 DTO。
- [x] 2.2 为新增 WebAdmin DTO 添加 Vitest schema 测试，覆盖历史兼容字段、扩展字段 passthrough、错误响应不包含 secret/stack 的约束。
- [x] 2.3 更新 JSON Schema export 与 baseline 检查，确保 WebAdmin DTO 与 TypeScript/Zod 同源。

## 3. SQLite 存储与调度基础

- [x] 3.1 实现 `apps/webadmin-api` SQLite DAO：`meta`、`schedules`、`schedule_runs`、`chat_sessions`、`chat_messages`，启用 WAL、busy timeout 和 schema version。
- [x] 3.2 迁移 trigger 计算能力：支持 `interval`、`daily`、五字段 `cron` 子集，覆盖非法表达式、跨日、月末、错过不补跑等测试。
- [x] 3.3 实现 in-process scheduler loop、flow-level lock、run timeout、状态记录和异常恢复；默认测试使用 fixed clock、mock runner、临时 SQLite。

## 4. Flows、运行与观测 API

- [x] 4.1 实现统一 Fastify app factory、错误响应、request context、依赖注入入口（repoRoot/dataRoot/toolClient/agentRunner/sleeper/clock）。
- [x] 4.2 实现 flows API：列表、详情、extract 引用解析、validate、保存前备份、非法保存不落盘、手动 run 受理与状态查询。
- [x] 4.3 手动 run 通过 `@ziniao/flow-engine` 编排，测试默认注入 mock tool client、no-op sleeper 和临时 data root；不得在默认测试连接真实 ZClaw bridge。
- [x] 4.4 实现 monitoring API：运行历史、自愈列表/详情、known issues、stats、output 文件树/预览/下载。
- [x] 4.5 实现路径安全 helper，限制 output/log/static 访问到 allowlist 根目录，覆盖 `..`、编码变体、绝对路径越界测试。

## 5. Schedules API 与 Chat SSE

- [x] 5.1 实现 schedules CRUD、enable/disable、trigger 校验、next_run_at、调度历史分页 API，并复用 scheduler/DAO。
- [x] 5.2 实现 chat sessions/messages API 和可用 agent 清单，读取配置时不得泄露 token、secret 或 ZClaw API key。
- [x] 5.3 实现 chat SSE send endpoint：accepted/start、delta、done、error、heartbeat 事件，同会话并发发送返回 409。
- [x] 5.4 Chat 测试使用 mock Agent runner，覆盖成功、失败、timeout、客户端断开后消息落库，不调用真实 OpenClaw/Claude/Cursor。

## 6. Static Serving 与旧前端兼容

- [x] 6.1 实现 `webadmin/frontend/dist` 静态托管和 SPA fallback；`/api/*` 不命中时返回结构化 404。
- [x] 6.2 覆盖 frontend dist 存在与缺失两种测试；缺失 dist 时 API 仍可用且返回清晰状态。
- [x] 6.3 确认 M6 不移动 `webadmin/frontend/`，不创建 `apps/webadmin-frontend`，不删除 Python `webadmin/`。

## 7. 安全扫描与基线验证

- [x] 7.1 扩展 `scripts/security-scan.ts` 覆盖 `apps/*`，阻断 direct bridge URL/path、ZClaw API key 读取、本机浏览器打开命令和浏览器自动化依赖。
- [x] 7.2 执行精确边界检查：`rg -n "9481|/zclaw/tools|ZCLAW_API_KEY|\\.zclaw" apps/webadmin-api/src` 只能无命中或命中明确允许的测试断言。
- [x] 7.3 验证 `pnpm --filter @ziniao/webadmin-api typecheck`、`pnpm --filter @ziniao/webadmin-api test`、`pnpm typecheck`、`pnpm test`、`pnpm build`、`pnpm security:scan`。
- [x] 7.4 验证 `pnpm validate:baseline` 不执行真实 flow、不调用真实 `POST /zclaw/tools/invoke`、不调用真实 Agent CLI、不启动本机浏览器。

## 8. 文档、路线图与回滚验证

- [x] 8.1 更新 `docs/06-TS迁移进度与路线图.md`，记录 M6 实施状态、边界、验收命令和仍未切换生产入口。
- [x] 8.2 更新 README 或相关 docs，说明 TS WebAdmin API 的启动方式、端口、仅回环监听、安全边界、与 Python WebAdmin 并行关系。
- [x] 8.3 更新 `AGENTS.md` 中 TS 迁移阶段状态与 `apps/webadmin-api` 修改约束（如实现完成后需要同步）。
- [x] 8.4 回滚验证：删除或隔离 `apps/webadmin-api` 及 M6 workspace 配置后，`python3 manager.py list` 与 `python3 manager.py validate orders_overview` 仍可运行。
- [x] 8.5 执行 `openspec validate add-typescript-webadmin-api --strict` 并修复所有 OpenSpec 格式或规格问题。
