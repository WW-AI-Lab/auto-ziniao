## 1. Schema and Data Model

- [x] 1.1 扩展 `packages/schemas/src/webadmin.ts`，新增或补齐 `FlowRunHistoryItem`、`FlowRunDetail`、`HealSummary`、`OutputRef` 等共享 DTO，并确保 `ManualRunStatus`、`ScheduleRun` 可携带 `run_id` 与 heal 摘要。
- [x] 1.2 更新 `packages/schemas/scripts/export-json-schema.ts`，导出新增 WebAdmin run observability schema。
- [x] 1.3 为新增 DTO 补充 `packages/schemas/src/webadmin.test.ts` 单测，覆盖 success、failed、schedule source、missing detail、heal skipped/triggered/failed。
- [x] 1.4 扩展 `apps/api/src/storage.ts` 的 SQLite schema，新增 WebAdmin run correlation index 表或等价结构，字段覆盖 `run_id`、`source`、`flow_id`、`schedule_id`、`schedule_run_id`、params、状态、时间、结果快照、失败 step、heal result。
- [x] 1.5 为 storage helper 增加 create/update/get/list 方法，支持按 `flow_id`、`schedule_id`、`source`、`status`、`limit`、`offset` 查询，并保持旧 DB 可自动迁移。

## 2. API Run Execution and Self-Heal Orchestration

- [x] 2.1 重构 `apps/api/src/runner.ts`，让 manual run 在开始时创建 run index，完成后更新 status、duration、error、result snapshot、failed_step 和 data summary。
- [x] 2.2 将 WebAdmin runner 的失败自愈编排调整为与 CLI 一致：默认允许 heal，显式禁用时跳过，validation failure 和 flow-level disabled 不触发 Agent。
- [x] 2.3 在 WebAdmin runner 中复用 `@ziniao/self-heal` 的 `buildTriggerInputFromFailure()` 与 `triggerHeal()`，并把 `TriggerHealResult` 写入 run index。
- [x] 2.4 保证 runner 默认测试通过 mock `FlowToolClient`、mock `AgentRunner`、临时 data root、固定 clock 和 no-op sleeper 完成，不调用真实 ZClaw bridge 或真实 Agent CLI。
- [x] 2.5 明确 duplicate run 语义：同一 flow 已运行时，manual run 返回 conflict；schedule 触发记录 skipped/conflict 并可在历史中查看。

## 3. API History and Detail Routes

- [x] 3.1 扩展 `/api/runs`，支持 `flow_id`、`schedule_id`、`source`、`status`、`limit`、`offset` 过滤，并合并 WebAdmin run index 与历史 `data/logs/runs.jsonl`。
- [x] 3.2 新增或扩展 `/api/runs/:runId`，返回统一 run detail，包含 result snapshot、`failed_step`、`heal_summary`、heal events、heal context/prompt 可用性和输出引用。
- [x] 3.3 新增 `/api/flows/:flowId/runs` 或等价 route，返回指定 flow 的统一执行历史，供 `/flows` 页面直接查看。
- [x] 3.4 扩展 `/api/flow-runs/:token`，让当前 manual token 状态与持久 run detail 保持一致，完成后仍可通过 `run_id` 查询。
- [x] 3.5 扩展 `/api/schedules/:sid/runs`，为已执行 flow 的计划触发返回 `run_id`、flow status、error summary 和 heal summary；未启动 flow 的预检失败保留 schedule-level error。
- [x] 3.6 为 heal/output 文件引用使用现有 normalized allowlist path check，缺失文件返回可用性状态，不让 detail API 整体失败。

## 4. Scheduler Integration

- [x] 4.1 调整 `apps/api/src/scheduler.ts`，每次 due schedule 触发时通过统一 runner 执行并记录 WebAdmin run index。
- [x] 4.2 扩展 `schedule_runs` 写入逻辑，保存可关联的 `run_id` 或等价引用，同时保留 schedule-level `status`、`duration_ms`、`error`。
- [x] 4.3 补充 scheduler 单测，覆盖成功执行、flow 失败并触发 heal、flow 已运行导致 skipped/conflict、触发配置非法导致未创建 flow run。

## 5. Frontend Experience

- [x] 5.1 更新 `apps/web/src/api.ts`，从 `@ziniao/schemas/webadmin` 导入并导出新增 run history/detail DTO，避免本地重复类型。
- [x] 5.2 在 `/flows` 页面增加每个 flow 的运行历史入口，支持加载 `/api/flows/:flowId/runs` 并展示状态、来源、时间、耗时、参数摘要、错误摘要和 self-heal 摘要。
- [x] 5.3 实现可复用 run detail 展示组件或抽屉，展示成功结果、输出引用、失败 step、错误、运行参数、heal status、`heal_id`、Agent、reason/error、prompt/context 引用。
- [x] 5.4 在 `/schedules` 页面扩展展开表，展示 `run_id` 详情入口；没有 `run_id` 的 schedule preflight failure 只展示 schedule-level 错误。
- [x] 5.5 修正 `/flows` 当前“失败时引擎将按既有机制自动触发自愈”的展示逻辑，只在 API 返回 self-heal 状态时准确说明 triggered/skipped/failed/disabled。
- [x] 5.6 确保长错误、长参数、长 prompt/path 在移动和桌面宽度下不溢出，详情视图可滚动且不遮挡操作按钮。

## 6. Self-Heal Metadata

- [x] 6.1 检查 `packages/self-heal` 的 `TriggerHealResult` 与 `learnings/heals.jsonl` 事件字段，补齐 WebAdmin 需要的 correlation/status 字段且不泄漏 secrets。
- [x] 6.2 对 Agent command missing、timeout、non-zero exit、known issue、cooldown、disabled config 等路径补充单测，确保 WebAdmin 能得到稳定 reason/error。
- [x] 6.3 保持 `packages/self-heal` 不依赖 `@ziniao/zclaw`、不读取 ZClaw API key、不直接访问 bridge、不打开本机浏览器。

## 7. API and Integration Tests

- [x] 7.1 为 `apps/api/src/app.test.ts` 或新增测试补充 Fastify injection 覆盖：run list filters、flow-specific history、run detail success、run detail failure、historical JSONL fallback。
- [x] 7.2 补充 manual run failure + mock self-heal 集成测试，验证 `heal_id`、prompt/context path、event merge 和 UI-facing status。
- [x] 7.3 补充 schedule run correlation 测试，验证 `/api/schedules/:sid/runs` 能跳转到 `/api/runs/:runId`。
- [x] 7.4 补充 path traversal/missing file 测试，验证 heal/output 引用不会越界读取，缺失文件不会导致 500。

## 8. Validation and Rollback Checks

- [x] 8.1 运行 `pnpm --filter @ziniao/schemas test`、`pnpm --filter @ziniao/schemas build`，确认共享 DTO 与 JSON Schema 导出通过。
- [x] 8.2 运行 `pnpm --filter @ziniao/api test`、`pnpm --filter @ziniao/api build` 或当前 package 实际脚本，确认 API 注入测试和构建通过。
- [x] 8.3 运行 `pnpm --filter @ziniao/web test`（如存在）、`pnpm --filter @ziniao/web build` 或当前 frontend 实际脚本，确认前端 typecheck/build 通过。
- [x] 8.4 运行 `pnpm security:scan`，确认没有 direct bridge、本机浏览器、Playwright/Selenium/Puppeteer/browser-use。
- [x] 8.5 运行 `pnpm validate:baseline`，确认默认验证不访问 `127.0.0.1:9481`、不打开本机浏览器、不调用真实 Agent CLI。
- [x] 8.6 运行 `openspec validate add-flow-execution-observability --strict`，确认 proposal/spec/design/tasks 格式与 delta requirements 有效。
- [x] 8.7 记录回滚检查：禁用或忽略新增 SQLite run index 后，旧 `/api/runs`、`/api/heals`、`/api/schedules/:sid/runs` 摘要能力仍可工作，`runs.jsonl` 与 `heals.jsonl` 不被破坏。
