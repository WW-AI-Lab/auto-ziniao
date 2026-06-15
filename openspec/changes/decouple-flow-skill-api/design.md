## Context

本仓库已完成 TypeScript 迁移，生产入口是 `ziniao` CLI，WebAdmin 后端位于 `apps/api`，前端位于 `apps/web`，shared DTO 位于 `packages/schemas`。最高安全边界要求所有真实浏览器操作只能通过 ZClaw bridge 间接执行，且 `packages/zclaw` 是唯一允许直接访问 `127.0.0.1:9481` 和 `/zclaw/*` 的包。

当前 `.cursor/skills/ziniao-assistant/references/flow-distill.md` 仍要求 Agent 读取 repo-local 文档和模板、执行 `pnpm ziniao new/validate/run`、写入 `flows/` 与 `extracts/`。这会让 skill 同时承担流程规范知识、文件系统布局知识和 CLI 操作知识。随着 WebAdmin API 已经提供 flow detail、validate、save、run、output、trace 等能力，沉淀入口应转为 API-first。

相关 stakeholder:
- Agent/skill 使用者：需要稳定、少上下文依赖的沉淀流程。
- WebAdmin 前端用户：需要可视化创建 flow 与编辑 extract。
- CLI 用户：需要保留 `ziniao new` 的日常入口，但不再复制模板写盘逻辑。
- 后端/flow-engine：继续拥有 flow 校验、保存、运行和安全边界。

## Goals / Non-Goals

**Goals:**
- 让 flow 沉淀 skill 不再依赖仓库文件系统路径、repo-local docs/template 或 `pnpm ziniao ...` CLI 命令。
- 通过 `apps/api` 提供 flow authoring 能力：创建 flow、读取模板、读写 extract、复用 validate/run/output/traces。
- 让 API、CLI、前端三条入口共用同一后端能力和 shared DTO。
- 保持 ZClaw bridge 安全边界不变，不增加本机浏览器或 browser automation fallback。
- 用 tests/specs 把路径穿越、重复 flow、非法 extract name、离线验证和安全扫描纳入验收。

**Non-Goals:**
- 不重写 `packages/flow-engine` 的执行器、DSL、参数解析或 self-heal 行为。
- 不修改 `packages/zclaw` bridge 白名单、认证方式或网络出口。
- 不把 WebAdmin API 变成直接 bridge client。
- 不引入新数据库表保存 flow/extract；flow JSON 与 extract JS 仍是 repo 数据文件，由 API 统一写盘。
- 不要求本 change 完成真实店铺业务 flow 的沉淀；真实 bridge 端到端只作为手动 smoke。

## Architecture Assessment

### Existing Design Reuse

- `apps/api/src/app.ts` 已有 `GET /api/flows`、`GET /api/flows/:flowId`、`POST /api/flows/:flowId/validate`、`PUT /api/flows/:flowId`、`POST /api/flows/:flowId/run`、`GET /api/flow-runs/:token`、`GET /api/outputs`、`GET /api/outputs/preview`、`POST /api/traces`。本设计扩展同一 Fastify app，而不是新增服务。
- `apps/api/src/security.ts` 已有 `AllowedRoot = "output" | "logs" | "flows" | "extracts" | "static"` 和 `resolveSafePath`，extract CRUD 复用该路径防护。
- `validateFlowContent` 已经通过 `@ziniao/flow-engine` 校验 flow JSON；创建 flow 和保存 flow 复用同一校验路径。
- `packages/schemas/src/webadmin.ts` 已经承载 `FlowSummary`、`FlowDetail`、`ManualRunStatus` 等 DTO；新增 authoring DTO 放在同一文件并通过 `packages/schemas/src/index.ts` 导出。
- `apps/web/src/api.ts` 已有 `get/post/put/del` helper 和 shared DTO import；前端新增能力复用这些 helper。
- CLI 当前 `cmdNew` 是局部文件写盘逻辑；改造时保留 commander command 和 exit code 语义，只替换实现来源。
- 默认验证复用 `pnpm typecheck`、`pnpm test`、`pnpm security:scan`，不启动 ZClaw bridge。

### Boundaries and Ownership

- `apps/api` owns authoring writes：创建 `flows/<flowId>.json`、保存 extract、备份 flow、校验 flow 内容、返回模板。它可以读写 repo 数据文件，但必须通过安全路径和 schema 校验。
- `packages/schemas` owns contracts：新增请求/响应 DTO 与 JSON Schema 导出，不读文件、不执行 flow、不访问 bridge。
- `packages/cli` owns command orchestration：`ziniao new` 只解析参数、调用本地 WebAdmin API、展示结果；不得直接读模板、写 flow、读 ZClaw key 或访问 bridge。
- `apps/web` owns UI：只通过 same-origin `/api/*` 调用 API；不直接访问 filesystem、bridge 或 API key。
- `ziniao-assistant` skill owns agent-facing workflow guidance：内嵌必要 flow DSL、extract、validate、run、output checklist，并通过 WebAdmin API 执行沉淀；不得要求 Agent 读取 repo-local docs/template 或执行 CLI。
- 失败与重试职责：
  - flow authoring API 对 invalid JSON、invalid flow、duplicate ID、path traversal 返回结构化错误，不自动重试。
  - flow run 的并发、timeout、bridge unavailable 仍由 existing runner/flow-engine 处理。
  - skill 对 WebAdmin API 不可达应停止沉淀并报告环境问题，不切换到文件系统或 CLI fallback。

### Options and Rationale

**选择方案：WebAdmin API 作为唯一 flow authoring 后端。**
- 理由：已存在 API app、path allowlist、flow validation、runner、output/traces routes；扩展成本低且边界清晰。
- 替代方案 A：让 skill 继续写文件并调用 CLI。缺点是耦合 repo layout，无法给前端和 CLI 共用能力，且容易绕过 API 安全检查。
- 替代方案 B：新增独立 skill-authoring service。缺点是增加部署和生命周期复杂度，当前复杂度不需要新服务。
- 替代方案 C：把 authoring 能力放进 `packages/flow-engine`。缺点是 flow-engine 会混入文件管理、HTTP/API 语义和 WebAdmin 行为，破坏执行层职责。

**选择方案：`ziniao new` 调用 `http://127.0.0.1:9482/api/flows`。**
- 理由：保留用户入口，同时消除 CLI 的模板写盘职责。
- 替代方案：保留 CLI 本地写盘作为 fallback。缺点是形成双实现，skill/CLI/API 行为会漂移，因此不采用。
- 代价：CLI 新建 flow 需要 WebAdmin API 可用；失败时给出启动 API 的明确提示。

**选择方案：flow 模板由 API 内置或服务端加载后输出，不让 skill 读取模板文件。**
- 理由：skill 只依赖 API 契约；模板实现可以在 API 内部演进。
- 替代方案：skill 内嵌完整 JSON 模板。缺点是模板变更会造成 skill 文档漂移，且前端/CLI 无法共用。

### Quality Attributes

- 安全：所有 authoring 路径通过 `flowId`/extract name validation 和 `resolveSafePath`；不改变 ZClaw bridge 访问边界；`pnpm security:scan` 必须继续阻断 forbidden browser automation 和 direct bridge access。
- 可靠性：flow 创建前必须校验 ID、冲突和 flow 内容；保存 extract 前必须防路径穿越；validate/run 继续复用 existing runner。
- 可维护性：API/CLI/frontend/skill 共用 DTO 和 API contract，减少模板、规范和错误语义重复。
- 可测试性：API 通过 Fastify injection + temp repo/data root 测试；CLI 通过 mock HTTP server 或 injectable fetch 测试；frontend 至少 typecheck/build；skill 文档通过静态扫描验证禁止 CLI/filesystem 引用回归。
- 可部署性：无新服务、无新数据库、无新外部依赖；只要求 WebAdmin API 本地端口维持 `127.0.0.1:9482`。
- 可观测性：继续使用 `POST /api/traces` 记录成功 bridge invoke；flow run status 和 output 通过 existing API 查询。

### Complexity and Exceptions

本变更新增的是 API surface 和 DTO，不新增外部服务、存储或协议。跨模块复杂度来自“同一 authoring 能力被 API、CLI、前端、skill 复用”，控制方式是：
- API contract 先落到 `packages/schemas`；
- API tests 覆盖写盘、安全和错误语义；
- CLI tests 只验证 HTTP 调用和错误展示；
- skill 文档只描述 API workflow，不保留文件系统/CLI fallback；
- 回滚时可以恢复旧 `cmdNew` 和旧 skill 文档，但 API 新端点可保留为兼容能力。

## Decisions

1. **API owns flow/extract authoring writes.**
   - 选择：在 `apps/api` 增加 `POST /api/flows`、`GET /api/flows/template`、`GET /api/extracts/:name`、`PUT /api/extracts/:name`。
   - 替代：CLI/skill 直接写文件。
   - 理由：集中校验和路径防护，并让前端、CLI、skill 复用。

2. **`ziniao new` 不提供 local file fallback。**
   - 选择：WebAdmin API 不可达时返回非 0，并提示启动 API。
   - 替代：API 不可达时继续使用 `flows/_template.json`。
   - 理由：fallback 会保留双路径实现，无法实现完全解耦。

3. **新增 shared DTO，而不是前端/CLI 本地类型。**
   - 选择：`CreateFlowRequest`、`CreateFlowResponse`、`SaveExtractRequest`、`ExtractDetail`、`FlowTemplateResponse` 等由 `@ziniao/schemas` 导出。
   - 替代：每个调用方定义本地 interface。
   - 理由：保持契约同源，便于 JSON Schema 导出和回归测试。

4. **skill 内嵌必要规范，但不内嵌 repo-local 路径。**
   - 选择：flow DSL、extract JS 规范、validate/run/output checklist 写在 `flow-distill.md`，执行动作走 API。
   - 替代：继续引用 `docs/03-流程定义规范.md` 和 `flows/_template.json`。
   - 理由：Agent 使用 skill 时不需要读取 repo 文件即可完成沉淀。

## Risks / Trade-offs

- [Risk] `ziniao new` 依赖 WebAdmin API 后，未启动 API 的用户会遇到新失败模式。 -> Mitigation: CLI 错误提示包含 `pnpm api` 启动建议；API tests 和 CLI tests 覆盖 unavailable/error response。
- [Risk] API 写 extract 可能引入路径穿越或覆盖非 extract 文件风险。 -> Mitigation: name regex + `resolveSafePath` + root allowlist + traversal tests。
- [Risk] skill 内嵌规范可能与 `docs/03-流程定义规范.md` 漂移。 -> Mitigation: 只内嵌沉淀必需的稳定子集；schema/engine 仍是校验真相；tasks 加静态 review。
- [Risk] 现有 specs 的历史包名与当前目录名不同，实施时可能改错路径。 -> Mitigation: tasks 明确使用 `apps/api`、`apps/web` 当前目录，并验证 package names/scripts。
- [Risk] API、CLI、前端并行改动造成 DTO 不一致。 -> Mitigation: shared schemas 先改，随后 API/CLI/frontend 编译和单测验证。

## Migration Plan

1. 扩展 `packages/schemas` DTO 和 JSON Schema 导出。
2. 扩展 `apps/api` authoring API，并补 Fastify injection 测试。
3. 改造 `packages/cli` 的 `ziniao new`，补 mock HTTP 测试。
4. 扩展 `apps/web` 流程页创建 flow 与 extract 编辑能力。
5. 重写 `flow-distill.md` 与 `SKILL.md` 沉淀说明。
6. 运行 `pnpm typecheck`、`pnpm test`、`pnpm security:scan`。
7. 可选手动 smoke：启动 `pnpm api`，通过 curl 或前端完成创建 flow、上传 extract、validate、run、outputs preview。

回滚策略：
- 回滚 CLI 改造和 skill 文档即可恢复旧工作流。
- API 新端点若已发布，可保留为兼容端点；若必须回滚，删除端点和 DTO 后重新生成 JSON Schema。
- 不涉及数据库迁移，无需数据回滚。已创建的 flow/extract 是普通 repo 数据文件，可按人工 review 删除。

## Open Questions

- `POST /api/flows` 生成模板时应使用完全内置模板，还是读取 `flows/_template.json` 后由 API 封装？实施阶段优先选择内置最小模板；若需要保留历史模板格式，可在 API 内部读取但不暴露给 skill。
- CLI 是否需要可配置 WebAdmin API base URL？初始实现可固定 `http://127.0.0.1:9482`，如已有 repo 配置模式再复用，不新增公开配置。
