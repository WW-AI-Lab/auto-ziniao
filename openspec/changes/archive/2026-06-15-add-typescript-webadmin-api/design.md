## Context

当前 TS 迁移已完成 M1-M5，仓库已有 `packages/core`、`packages/schemas`、`packages/zclaw`、`packages/flow-engine`、`packages/self-heal` 和 `packages/cli`。`docs/06-TS迁移进度与路线图.md` 明确下一阶段是 M6：新增 `apps/webadmin-api`，把 WebAdmin 后端迁移到 TypeScript。

现有 WebAdmin 后端位于 `webadmin/`，实现了 FastAPI 应用、flows 管理、运行观测、SQLite 调度器、Agent 对话和静态前端托管。它是 M6 的行为参照，但本阶段不能删除它，也不能移动 `webadmin/frontend/`。生产入口仍是 `python3 manager.py ...`，M6 只是为后续双跑切换和 Python 依赖清零准备 TS WebAdmin 后端。

硬约束：

- 所有浏览器操作只能通过 ZClaw bridge；TS 侧只有 `packages/zclaw` 可以直接访问 `127.0.0.1:9481` 与 `/zclaw/*`。
- `apps/webadmin-api` 不得直接访问 bridge、读取 ZClaw API key、打开本机浏览器或引入 Playwright/Selenium/Puppeteer/browser-use。
- 默认验证只能做静态解析、typecheck、单测、安全扫描和 mock/offline baseline；不得真实执行 flow、不得调用真实 `POST /zclaw/tools/invoke`、不得调用真实 Agent CLI。
- Web 后端默认仅监听 `127.0.0.1`，禁止提供 `0.0.0.0` 绑定开关。

## Goals / Non-Goals

**Goals:**

- 新增 `apps/webadmin-api`，以 Fastify + SQLite 实现 TS WebAdmin 后端。
- 覆盖现有 Python WebAdmin 后端核心能力：flows 列表/详情/校验/保存/运行受理、运行与自愈观测、output 浏览、schedules CRUD 与调度历史、调度器、chat sessions/messages 与 SSE、静态前端 dist 托管。
- 复用 `packages/core`、`packages/schemas`、`packages/flow-engine`、`packages/self-heal` 的既有能力，避免在 WebAdmin API 内重复实现 flow DSL、自愈规则或底层文件契约。
- 建立 WebAdmin API 的离线测试与安全扫描，支持临时 repo/data root、mock tool client、mock Agent runner、固定 clock 和 no-op sleeper。
- 更新 OpenSpec specs、路线图和文档，使 M6 的边界、验证和回滚方式可执行。

**Non-Goals:**

- 不删除或改写 `webadmin/` Python 后端。
- 不移动或重构 `webadmin/frontend/`，不创建 `apps/webadmin-frontend`。
- 不替换 `python3 manager.py ...` 生产入口，不接管现有 crontab。
- 不移除 `engine/*.py`，不修改 ZClaw Python 白名单。
- 不提供公网部署、登录、多用户权限、`0.0.0.0` 绑定或反向代理方案。
- 不在 baseline 中真实打开店铺、真实执行 flow、真实调用 ZClaw bridge 或真实调用 OpenClaw/Claude/Cursor Agent CLI。

## Architecture Assessment

### Existing Design Reuse

| 现有资产 | 复用方式 |
| --- | --- |
| `packages/core` | 复用 repo root 定位、路径、JSON/JSONL 读写、错误类型；必要时补齐安全路径 helper。 |
| `packages/schemas` | 复用 flow/runtime data schema；扩展 WebAdmin DTO、schedule、chat、SSE event 和 API response schema。 |
| `packages/flow-engine` | WebAdmin API 通过注入 `FlowToolClient`、`sleeper`、`repoRoot`、`dataRoot` 编排校验和运行；测试默认使用 mock client。 |
| `packages/self-heal` | 运行失败后的自愈编排复用 self-heal；测试默认使用 mock Agent runner 或 dry-run。 |
| `packages/cli` | 作为命令语义参照；WebAdmin API 不复制 CLI 参数解析，但可复用同一底层 package。 |
| `webadmin/api/*` | 作为 REST/SSE 行为对齐参照；M6 不从 Python import，也不删除 Python 实现。 |
| `webadmin/storage.py` 与 `scheduler/*` | 迁移 SQLite 表、触发计算、tick 调度、flow 级锁、防补跑等行为。 |

现有 `packages/schemas/src/webadmin.ts` 已有 schedule/chat 基础 schema，但缺少完整 REST response、flow management DTO、run status、output file、SSE event 和错误响应 schema。M6 应在该包内补齐，而不是在 `apps/webadmin-api` 内定义分叉类型。

### Boundaries and Ownership

```text
浏览器 UI
  │ HTTP/SSE
  ▼
apps/webadmin-api (Fastify, 127.0.0.1 only)
  ├─ REST/SSE route layer
  ├─ service layer: flows / monitoring / schedules / chat / static
  ├─ SQLite DAO: schedules / schedule_runs / chat_sessions / chat_messages / meta
  ├─ scheduler loop + flow-level locks
  ├─ @ziniao/flow-engine (injected tool client; real mode can use its adapter)
  └─ @ziniao/self-heal (mock/dry-run by default in tests)
       │
       ▼
packages/zclaw is the only TS direct bridge client when real flow execution is explicitly used
```

Ownership:

- `apps/webadmin-api` owns HTTP API shape, service orchestration, SQLite WebAdmin-owned tables, scheduler loop, chat session state, API logs and static asset serving.
- `packages/schemas` owns API DTO/runtime validation types shared with future frontend and tests.
- `packages/flow-engine` owns flow DSL parsing, validation, tool dispatch abstraction, output writing and run log append.
- `packages/self-heal` owns known issues, prompt/context rendering, cooldown and Agent runner abstraction.
- Long-term files remain in their current owners: `flows/`, `extracts/`, `data/logs/`, `data/output/`, `learnings/` are not migrated into SQLite.

Failure and lifecycle:

- Flow validation errors return structured 400; invalid save must not mutate existing flow files.
- Manual run and scheduled run share flow-level locks. Duplicate run for the same flow returns 409 or schedule `skipped`.
- Scheduler tick recomputes `next_run_at` into the future; missed triggers are not backfilled.
- SSE client disconnect does not kill an already accepted chat/run task; status/history endpoints remain the source of truth.
- API process shutdown stops accepting new tasks and requests scheduler shutdown; already tracked child async work should settle or be marked failed/timeout.

### Options and Rationale

**HTTP framework：Fastify（选定） vs Hono/Express/NestJS**

Fastify 类型和 schema 生态更适合本地 API + SSE + 静态托管，复杂度低于 NestJS，类型约束强于 Express。Hono 更轻，但本项目是 Node 本地服务和 SQLite 场景，Fastify 的插件、hook 和测试体验更稳。

**SQLite driver：优先 `better-sqlite3`，保留替代评估**

`better-sqlite3` 同步 API 简单，适合本地单用户工具，调度器和 API 请求量低，配合 WAL/busy timeout 足够。风险是 native addon 安装；如果安装或 CI 环境不可接受，实施时应退回 `sqlite3` 或 Node 版本允许时评估 `node:sqlite`。该取舍必须在 tasks 中设置依赖安装验证点。

**运行 flow：进程内调用 TS flow-engine（选定） vs 调 `ziniao` 子进程**

M6 的目标是 TS WebAdmin 后端能力，优先直接调用 `@ziniao/flow-engine`，这样可以注入 mock tool client、临时 data root 和 no-op sleeper，测试可控；真实运行时仍通过 flow-engine 的合法 adapter 间接到 `packages/zclaw`。子进程调用 `ziniao` 隔离性更强，但会把参数解析和错误映射绕回 CLI，API 更难做结构化状态与测试注入。后续若需要更强隔离，可在 WebAdmin service 层增加 runner adapter，不改变 route contract。

**Agent 对话：复用 self-heal Agent runner 抽象 + WebAdmin chat adapter**

`packages/self-heal` 的 `AgentRunner` 可复用命令执行、timeout、mock runner 思路，但 chat 是会话式消息，不应污染 self-heal 的 prompt/cooldown 语义。M6 在 `apps/webadmin-api` 内实现 chat service，读取 `config.json` agent command 模板，默认测试用 mock runner；如后续需要 OpenClaw gateway HTTP adapter，应放在独立 adapter 中并保持可禁用。

**调度器：轻量 in-process scheduler（选定） vs 独立 worker 进程**

当前 WebAdmin 是单机单用户管理端，in-process scheduler 足够并与 Python 现状接近。独立 worker 会增加生命周期、锁和部署复杂度，不适合 M6。调度状态持久化到 SQLite，tick 只负责发现到期任务和提交执行。

### Quality Attributes

- **安全**：Fastify 只监听 `127.0.0.1`；无配置允许 `0.0.0.0`；路径访问必须做 normalize + allowlist；`apps/webadmin-api` 不直接访问 `9481`、`/zclaw/tools` 或 ZClaw API key；安全扫描覆盖 `apps/*`。
- **可靠性**：SQLite 使用 WAL 和 busy timeout；scheduler loop 捕获异常并继续 tick；flow-level lock 防止同一 flow 并发；任务超时后记录失败。
- **可维护性**：route 层、service 层、DAO、scheduler、chat adapter 分层；DTO 在 `packages/schemas` 维护，避免 API 与前端未来类型分叉。
- **可测试性**：默认 Vitest 使用临时 repo/data root、mock tool client、mock Agent runner、fixed clock；API 通过 Fastify inject 测试，不需要监听真实端口。
- **可观测性**：API 返回统一错误结构；scheduler run、manual run、chat message 均有可查询状态；WebAdmin 自身日志写入 data/logs 或 stdout。
- **可部署性**：workspace scripts 一次性 build/typecheck/test；`apps/webadmin-api` 可通过 dev script 本地启动；前端 dist 托管继续读取 `webadmin/frontend/dist`。

### Complexity and Exceptions

- **新增 `apps/*` workspace**：M6 是第一个 app workspace，需要修改 `pnpm-workspace.yaml` 和 root scripts。控制方式：仅包含 `apps/webadmin-api`，不创建 frontend app；验证方式：root `pnpm typecheck/test/build/security:scan/validate:baseline` 覆盖。
- **新增 Fastify/SQLite 依赖**：这是 Web 后端迁移的必要依赖。控制方式：依赖只进入 `apps/webadmin-api/package.json`，不进入 `packages/core`/`schemas`；验证方式：安全扫描检查禁止浏览器自动化和 direct bridge。
- **新增 SQLite schema**：WebAdmin 自有状态需要表结构。控制方式：只迁移 schedules/chat 表，不迁移 engine 长期文件；回滚删除 `apps/webadmin-api` 和新增 TS 配置即可，旧 Python WebAdmin 和 engine 文件不受影响。
- **SSE 协议**：chat 需要流式返回。控制方式：限定事件类型和 schema，测试断言 start/delta/done/error/heartbeat。

## Decisions

1. **创建 `apps/webadmin-api`，不放入 `packages/`**。替代方案是做成 `packages/webadmin-api`，但 Web 后端是可运行应用，拥有端口、SQLite 和静态托管生命周期，归入 `apps/` 更符合路线图。
2. **使用 Fastify**。替代 Hono/Express/NestJS；Fastify 在本地服务、类型、测试和插件能力之间更平衡。
3. **SQLite 优先使用 `better-sqlite3`**。替代 `sqlite3`/`node:sqlite`；同步 API 降低实现复杂度，但 tasks 必须验证 native addon 安装风险，失败则切换替代。
4. **WebAdmin API 直接复用 `@ziniao/flow-engine` 与 `@ziniao/self-heal` 服务能力**。替代调用 CLI 子进程；直接复用更利于 mock 注入和结构化 API 状态，但必须保持 WebAdmin 不直接访问 bridge。
5. **保持 Python WebAdmin 并行存在**。替代直接替换 `webadmin/`；M6 只是 TS 化后端能力，不做生产切换和前端搬迁。
6. **安全扫描扩展到 `apps/`**。替代只扫描 `packages/`；WebAdmin API 是新可运行服务，必须受同等 ZClaw 和浏览器安全边界约束。

## Risks / Trade-offs

- [SQLite native addon 安装失败] -> 实施初期验证 `better-sqlite3` 安装、typecheck、test；若失败，改用 `sqlite3` 或可用的 `node:sqlite` 并记录决策。
- [WebAdmin API 意外成为 direct bridge 出口] -> 安全扫描覆盖 `apps/webadmin-api`，禁止 `9481`、`/zclaw/tools`、`ZCLAW_API_KEY` 和浏览器自动化依赖。
- [与 Python WebAdmin 行为漂移] -> 以现有 `webadmin/api/*` 和 tests 为迁移参照，为核心 API 编写等价测试；M6 不删除 Python 实现，便于人工对比。
- [真实 flow 执行导致 baseline 触发店铺操作] -> 所有默认测试使用 mock tool client 和临时 data root；真实运行只作为后续显式双跑，不进入 baseline。
- [调度器并发导致重复运行] -> flow-level lock + schedule run 状态；同一 flow 并发请求返回 409 或记录 skipped。
- [前端仍在旧目录导致静态托管路径混乱] -> M6 明确继续托管 `webadmin/frontend/dist`，前端搬迁留给后续阶段。

## Migration Plan

1. 新增 `apps/webadmin-api` 和 workspace 配置，完成离线 build/typecheck/test。
2. 补齐 `packages/schemas` WebAdmin API DTO，并让 API route/service 使用同源 schema 校验。
3. 分模块迁移 flows/monitoring/schedules/chat/static 能力，保持 Python WebAdmin 并行存在。
4. 扩展安全扫描和 `pnpm validate:baseline`，确认默认验证不触发真实 bridge、真实 Agent CLI 或本机浏览器。
5. 更新路线图和使用文档，说明 M6 完成后仍未替换生产入口。

回滚方式：删除或隔离 `apps/webadmin-api`，恢复 `package.json`、`pnpm-workspace.yaml`、`tsconfig.base.json`、`vitest.config.ts`、`scripts/security-scan.ts` 和文档中的 M6 改动。回滚后必须验证 `python3 manager.py list` 与 `python3 manager.py validate orders_overview`。

## Open Questions

1. `better-sqlite3` 在当前 Node/pnpm 环境下是否可稳定安装和构建，需要实施第一步验证；失败时使用替代 driver。
2. Chat 是否需要在 M6 同时实现 OpenClaw gateway HTTP adapter，还是先提供 CLI/mock adapter 与 SSE contract；建议 M6 先保证 mock/CLI adapter，gateway adapter 保持可选扩展。
3. 静态前端托管是否只读取 `webadmin/frontend/dist`，还是也支持未来 `apps/webadmin-frontend/dist`；建议 M6 只读当前路径，未来前端迁移 change 再扩展。
