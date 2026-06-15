## 1. Shared Contracts

- [x] 1.1 在 `packages/schemas/src/webadmin.ts` 新增 `CreateFlowRequestSchema`、`CreateFlowResponseSchema`、`SaveExtractRequestSchema`、`ExtractDetailSchema`、`FlowTemplateResponseSchema` 及对应 TypeScript types。
- [x] 1.2 从 `packages/schemas/src/index.ts` 导出新增 WebAdmin authoring DTO，并确认 `apps/web/src/api.ts` 可从 `@ziniao/schemas/webadmin` 复用类型。
- [x] 1.3 更新 `packages/schemas/scripts/export-json-schema.ts` 或相关导出配置，使 `packages/schemas/json-schema/webadmin-api.schema.json` 包含新增 DTO。
- [x] 1.4 为新增 DTO 补充 `packages/schemas/src/webadmin.test.ts` 单测，覆盖 create flow、extract detail、template response 和 JSON Schema export。

## 2. WebAdmin API Authoring Endpoints

- [x] 2.1 在 `apps/api/src/app.ts` 增加 `GET /api/flows/template`，返回服务端拥有的 flow 模板骨架字符串。
- [x] 2.2 在 `apps/api/src/app.ts` 增加 `POST /api/flows`，校验 `id`、处理 `name/content`、拒绝重复 flow、调用现有 flow validation 后写入 `flows/<id>.json`。
- [x] 2.3 在 `apps/api/src/app.ts` 增加 `GET /api/extracts/:name` 与 `PUT /api/extracts/:name`，复用 `resolveSafePath` 限制只读写 `extracts/` 根下文件。
- [x] 2.4 保持 `apps/api/src/security.ts` 的 `AllowedRoot` 和 `resolveSafePath` 作为唯一路径防护入口；如发现现有实现已包含 `extracts`，只补测试和调用，不扩大 allowlist。
- [x] 2.5 在 `apps/api/src/app.test.ts` 增加 Fastify injection 测试：flow 创建成功、重复 ID conflict、invalid content 不写盘、template 返回、extract 保存读取、extract 路径穿越拒绝。
- [x] 2.6 确认 API tests 使用临时 repo/data root、mock runner，不调用真实 ZClaw bridge、本机浏览器或 Agent CLI。

## 3. CLI API-Driven `ziniao new`

- [x] 3.1 在 `packages/cli/src/index.ts` 将 `cmdNew` 改为调用 `http://127.0.0.1:9482/api/flows`，请求体使用 shared `CreateFlowRequest` 语义。
- [x] 3.2 保留 `ziniao new <flow_id> [name]` 参数、成功提示和 exit code 语义；API 不可达或返回错误时输出可执行提示，例如启动 `pnpm api`。
- [x] 3.3 移除 `cmdNew` 对 `flows/_template.json` 和 `flows/<flow_id>.json` 的直接读写 fallback，避免双路径实现。
- [x] 3.4 在 `packages/cli/src/index.test.ts` 增加 mock HTTP 测试，覆盖创建成功、API conflict、API unavailable，断言 CLI 不写真实 `flows/`。

## 4. WebAdmin Frontend Flow Authoring

- [x] 4.1 在 `apps/web/src/api.ts` 导出新增 DTO type alias，并复用现有 `get/post/put` helper。
- [x] 4.2 在 `apps/web/src/pages/Flows.tsx` 增加「创建流程」入口和表单，提交 `POST /api/flows` 后刷新列表并展示 API 错误。
- [x] 4.3 在 flow 编辑抽屉中将 extract 引用从只读展示改为可创建/编辑：读取 `GET /api/extracts/:name`，保存 `PUT /api/extracts/:name`。
- [x] 4.4 保持前端请求为 same-origin `/api/*`，不引入 direct ZClaw bridge、API key、filesystem 或 browser automation 访问。

## 5. Skill 解耦

- [x] 5.1 重写 `.cursor/skills/ziniao-assistant/references/flow-distill.md`，移除 `$REPO` 文件路径、repo-local docs/template 引用和 `pnpm ziniao ...` CLI 命令依赖。
- [x] 5.2 在 `flow-distill.md` 内嵌沉淀必需的最小 flow 契约：顶层字段、步骤字段、extract JS 规范、`validate`、`on_fail`、`branch`、`heal.hints` 和检查清单。
- [x] 5.3 将沉淀步骤改为 WebAdmin API：`POST /api/flows`、`PUT /api/extracts/:name`、`POST /api/flows/:flowId/validate`、`POST /api/flows/:flowId/run`、`GET /api/flow-runs/:token`、`GET /api/outputs` 或 `GET /api/outputs/preview`。
- [x] 5.4 更新 `.cursor/skills/ziniao-assistant/SKILL.md` 的「任务跑通后:沉淀为 flow」段落，强调通过 API 沉淀，不要求 Agent 读写 repo-local flow/extract 文件或调用 CLI。
- [x] 5.5 对 skill 文档做静态检查，确认不再出现 `pnpm ziniao new`、`pnpm ziniao validate`、`pnpm ziniao run`、`$REPO/docs/03-流程定义规范.md`、`$REPO/flows/_template.json` 作为沉淀要求。

## 6. Architecture Verification

- [x] 6.1 运行 `pnpm typecheck`，确认 API、CLI、schemas、frontend 类型一致。
- [x] 6.2 运行 `pnpm test`，确认新增 DTO、API authoring、CLI HTTP 行为测试通过。
- [x] 6.3 运行 `pnpm security:scan`，确认没有引入 Playwright/Selenium/Puppeteer/browser-use、本机浏览器打开命令或 direct ZClaw bridge 访问。
- [x] 6.4 运行 `openspec validate decouple-flow-skill-api --strict`，确认 proposal/design/specs/tasks 可解析且 spec delta 有效。
- [x] 6.5 可选手动 smoke：启动 `pnpm api`，通过 curl 或前端完成创建 flow、上传 extract、validate、run、查询 run status、预览 output；若 ZClaw bridge 不可达，记录为环境阻塞，不使用本机浏览器 fallback。
- [x] 6.6 记录回滚确认：CLI 可回退旧 `cmdNew`、skill 可回退旧文档，API 新端点无数据库迁移；已创建 flow/extract 作为普通 repo 数据文件人工处理。
