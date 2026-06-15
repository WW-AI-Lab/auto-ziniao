# Flow 沉淀 Skill 与 API 解耦

## 目标
- skill（flow-distill）不再依赖任何文件系统路径或 `pnpm ziniao ...` CLI 命令。
- 所有沉淀操作（创建 flow、上传 extract、校验、运行）走 WebAdmin API。
- 流程规范、模板、检查清单内嵌到 skill 中。
- API、CLI、前端三条入口共用同一后端能力。

## 任务 1：扩展 WebAdmin API —— 新建 flow 与 extract 管理

文件：`apps/api/src/app.ts`、`apps/api/src/security.ts`、`apps/api/src/app.test.ts`

新增端点：
- `POST /api/flows`：创建新 flow。
  - Body: `{ id: string; name?: string; content?: string }`
  - 若 `content` 为空，服务端基于内置模板生成骨架（替换 `__FLOW_ID__`、`__FLOW_NAME__`）。
  - 校验 `id` 合法且 `flows/<id>.json` 不存在。
  - 调用 `validateFlowContent` 后写盘。
- `PUT /api/extracts/:name`：保存/更新 extract 脚本。
  - `name` 限制为 `[A-Za-z0-9_.\-/]+`。
  - 通过 `resolveSafePath` 校验防止路径穿越，只允许写入 `extracts/` 根下。
  - Body: `{ content: string }`。
- `GET /api/extracts/:name`：读取 extract 脚本内容，用于前端编辑或 skill 回填。
- `GET /api/flows/template`：返回模板骨架字符串（便于非 skill 客户端）。

安全：
- 在 `security.ts` 的 `AllowedRoot` 中新增 `extracts`，并扩展 `resolveSafePath` 处理。
- `POST /api/flows` 与 extract 接口复用已有路径穿越防护。

测试：
- `app.test.ts` 新增用例：创建 flow、重复 ID 冲突、创建 extract、路径穿越拒绝、读取 extract。

## 任务 2：更新 schema 类型

文件：`packages/schemas/src/webadmin.ts`

新增并导出类型：
- `CreateFlowRequest` / `CreateFlowResponse`
- `SaveExtractRequest` / `ExtractDetail`
- `FlowTemplateResponse`

更新 `FlowSummarySchema` 与 `FlowDetailSchema` 的 `passthrough` 字段说明（如需新增 `extracts` 可写标志）。

## 任务 3：改造 CLI `ziniao new` 为 API 驱动

文件：`packages/cli/src/index.ts`、`packages/cli/src/index.test.ts`

- `cmdNew` 不再直接读写 `flows/_template.json`。
- 改为向 `http://127.0.0.1:9482/api/flows` 发送 `POST` 请求创建 flow。
- 保留命令行入口与参数不变，失败时按 API 返回的错误提示用户。
- 单测改为 mock HTTP server（如 `nock` 或内建 mock），避免真实写盘。

## 任务 4：前端同步支持创建 flow 与 extract 编辑

文件：`apps/web/src/pages/Flows.tsx`、`apps/web/src/api.ts`

- 在流程列表页新增「创建流程」按钮。
- 弹出表单：`flow_id`、`中文名`；提交后调用 `POST /api/flows`。
- 编辑抽屉中，对 `extracts` 引用提供「创建/编辑」按钮：
  - 若 extract 不存在，调用 `PUT /api/extracts/:name` 创建。
  - 若已存在，调用 `GET /api/extracts/:name` 读取并允许修改后保存。
- `api.ts` 增加 `post<T>`、现有 `put<T>` 已满足需求。

## 任务 5：重写 skill `flow-distill.md`

文件：`.cursor/skills/ziniao-assistant/references/flow-distill.md`

移除所有文件系统/CLI 依赖：
- 删除 `pnpm ziniao new`、`pnpm ziniao validate`、`pnpm ziniao run` 等命令。
- 删除对 `$REPO/docs/03-流程定义规范.md`、`$REPO/flows/_template.json`、`$REPO/flows/*.json` 的引用。

内嵌必要知识：
- 流程 JSON 顶层字段规范（`id/name/version/enabled/params/steps/heal` 等）。
- 步骤字段说明（`tool/action/args/save/validate/on_fail/branch/goto`）。
- 提取脚本规范（IIFE、`return JSON.stringify(...)`、禁止 JS 模板字符串）。
- 检查清单。
- 常用工具名白名单（以 `GET /zclaw/tools` 为准，但保留静态参考列表）。

替换为 API 调用：
- 创建流程：`POST http://127.0.0.1:9482/api/flows`
- 上传 extract：`PUT http://127.0.0.1:9482/api/extracts/<name>`
- 校验流程：`POST http://127.0.0.1:9482/api/flows/<flowId>/validate`
- 运行流程：`POST http://127.0.0.1:9482/api/flows/<flowId>/run`
- 查询运行状态：`GET http://127.0.0.1:9482/api/flow-runs/<token>`
- 推送轨迹：`POST http://127.0.0.1:9482/api/traces`（已有）

沉淀步骤改写：
1. 盘点本会话真实调用序列。
2. 调用 `POST /api/flows` 创建骨架。
3. 按内嵌规范填写 flow，调用 `PUT /api/extracts/:name` 上传对应脚本。
4. 调用 `POST /api/flows/:flowId/validate` 校验。
5. 调用 `POST /api/flows/:flowId/run` 真机跑通（WebAdmin runner 内部仍走 ZClaw bridge）。
6. 通过 `GET /api/outputs` 或 `GET /api/outputs/preview` 确认产出。

## 任务 6：更新 `SKILL.md` 沉淀指引

文件：`.cursor/skills/ziniao-assistant/SKILL.md`

- 第 97 行「读 `references/flow-distill.md` 按其中完整工作流执行」保留。
- 删除或弱化其中对 CLI 命令的直接引用（如存在）。
- 强调沉淀通过 API 完成，不再写盘或调 CLI。

## 任务 7：基线验证

- `pnpm typecheck` 通过。
- `pnpm test` 通过（含新增 API/CLI 测试）。
- `pnpm security:scan` 通过（确保 skill 改造不引入新的文件系统/浏览器绕过）。
- 手动验证：通过前端或 curl 完成一次新建 flow + 上传 extract + 校验 + 运行流程的端到端流程。

## 边界与不变项
- 不修改 `packages/flow-engine` 核心执行逻辑。
- 不修改 `packages/zclaw` 白名单与网络出口。
- 不修改 `packages/self-heal` 自愈触发逻辑。
- 运行流程仍由后端 `createFlowRunner` 统一调度，保证 bridge 安全规则不变。