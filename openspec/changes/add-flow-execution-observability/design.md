## Context

当前 TypeScript 运行态已经具备以下基础：

- `@ziniao/flow-engine` 执行 flow 并写入 `data/logs/runs.jsonl`，失败结果包含 `failed_step` 与 `heal` metadata。
- `@ziniao/self-heal` 能根据失败结果生成 `data/logs/heals/<heal_id>.json`、`data/logs/heals/<heal_id>_prompt.md`，并向 `learnings/heals.jsonl` 写入 triggered/skipped 等事件。
- `packages/cli` 的 `ziniao run` 已在失败后调用 `triggerHeal()`，并支持 `--no-heal` / `--heal-dry-run`。
- `apps/api` 已提供 `/api/runs`、`/api/heals`、`/api/heals/:healId`、`/api/flows/:flowId/run`、`/api/flow-runs/:token`、`/api/schedules/:sid/runs`，并使用 SQLite 管理 schedule 与 chat 状态。
- `apps/web` 的 `/flows` 页面只显示最近运行摘要和当前 manual token 状态；`/schedules` 页面只在展开时显示 `schedule_runs` 摘要。

当前关键缺口是 WebAdmin 执行入口没有形成与 CLI 等价的“失败 -> self-heal -> 可查看诊断”闭环。`apps/api/src/runner.ts` 调用 `runFlow()` 时显式传入 `heal: false`，因此用户在 `/flows` 手动运行失败后看到“失败时引擎将按既有机制自动触发自愈”的提示，但实际不会触发 OpenClaw/Agent。计划任务也只记录 `schedule_runs.error`，缺少与 flow run 日志、失败 step 和 self-heal 事件的关联。

## Goals / Non-Goals

**Goals:**

- 为 WebAdmin 手动运行和计划运行提供统一的执行历史查询与执行详情查看能力。
- 从 `/flows` 和 `/schedules` 两个入口都能查看同一类运行详情：状态、参数、耗时、成功结果摘要、输出引用、失败原因、`failed_step`、self-heal 结果、heal context/prompt 路径和 Agent 事件。
- 让 WebAdmin 默认失败自愈行为与 CLI 一致：除 flow 或请求显式禁用外，失败后触发 `packages/self-heal`，并记录可查询结果。
- 保持最高安全规则：WebAdmin 不直接访问 ZClaw bridge，不打开本机浏览器，不引入 Playwright/Selenium/Puppeteer/browser-use，不调用真实 Agent CLI 参与默认测试。
- 将关键行为纳入 schemas、API 注入测试、frontend typecheck/build 和 baseline 验证。

**Non-Goals:**

- 不新增外部日志系统、消息队列、后台 worker 服务或独立 observability 平台。
- 不改变 flow DSL，不改变 `flows/*.json` 格式，不改变 extract 脚本规范。
- 不把 ZClaw bridge 访问能力移入 `apps/api` 或 `apps/web`。
- 不在默认验证中真实打开紫鸟店铺、访问 bridge、调用本机浏览器或真实 OpenClaw/Claude/Cursor Agent。
- 不做长期日志归档、全文搜索或大型报表分析；本变更只覆盖 WebAdmin 可诊断闭环。

## Architecture Assessment

### Existing Design Reuse

- 复用 `@ziniao/flow-engine` 的 `runFlow()`、失败 metadata、`data/logs/runs.jsonl` 和 `RunLogEntrySchema`，不让 WebAdmin 自己执行 flow DSL。
- 复用 `@ziniao/self-heal` 的 `triggerHeal()`、`buildTriggerInputFromFailure()`、cooldown、known issues、Agent CLI adapter、`learnings/heals.jsonl` 和 heal context/prompt 文件。
- 复用 `apps/api` 已有 Fastify route、SQLite `Storage`、scheduler、safe path、mock runner 测试模式。
- 复用 `@ziniao/schemas/webadmin` 作为前后端共享 DTO 来源，避免 `apps/web` 复制 API 类型。
- 复用 `apps/web` 当前 React + antd 页面结构，在 `/flows` 和 `/schedules` 中增加详情抽屉/子表，不新增前端状态管理库。

### Boundaries and Ownership

- `packages/flow-engine` 仍拥有 flow 执行、step 控制流、工具调度和 `runs.jsonl` 写入；它不依赖 `packages/self-heal`。
- `packages/self-heal` 仍拥有错误分类、prompt/context、cooldown、known issues 和 Agent adapter；它不访问 ZClaw bridge。
- `apps/api` 拥有 WebAdmin 执行编排、SQLite correlation index、REST 聚合查询和 scheduler 触发记录；它只通过 `@ziniao/flow-engine` 和 `@ziniao/self-heal` 公开 API 间接使用能力。
- `apps/web` 只展示 same-origin `/api/*` 返回的数据，不读取本地文件，不访问 bridge，不执行 Agent。
- `data/logs/runs.jsonl` 和 `learnings/heals.jsonl` 是历史事实来源；SQLite 新增的 WebAdmin run index 只负责关联 WebAdmin 发起的 manual/schedule run 与 JSONL/self-heal 产物。
- 并发控制沿用当前 flow-level running lock。计划任务触发时如果 flow 正在运行，记录 skipped/conflict 状态并写入可查询 run index。

### Options and Rationale

**选项 A：只让前端直接读取现有 `/api/runs` 与 `/api/heals`。**

- 优点：实现最少。
- 缺点：无法稳定关联 manual token、schedule run、run log 和 heal event；历史详情缺少 `result.failed_step`；当前 WebAdmin 仍不会触发 self-heal。
- 结论：不足以解决用户问题。

**选项 B：修改 `@ziniao/flow-engine`，给 `runs.jsonl` 增加 `run_id`、`source`、`schedule_id` 等字段。**

- 优点：单一日志来源更完整。
- 缺点：flow-engine 会承载 WebAdmin 来源概念，跨越模块边界；历史日志兼容和 CLI 行为变更风险更大。
- 结论：暂不采用。可在未来需要跨入口统一 run id 时再规划。

**选项 C：在 `apps/api` SQLite 中新增轻量 run correlation index，并在查询时合并 `runs.jsonl`、`heals.jsonl`、heal context/prompt。**

- 优点：贴合 WebAdmin 自有状态所有权；不改变 flow DSL 和 flow-engine 日志兼容；能解决 schedule/manual 关联；测试可完全离线。
- 缺点：WebAdmin 发起前的历史 `runs.jsonl` 只能以 best-effort 方式展示，缺少 WebAdmin run id 和 heal 关联。
- 结论：采用。该 index 是 WebAdmin 的查询辅助状态，不替代底层 JSONL 历史。

### Quality Attributes

- 安全：所有默认测试使用 mock `FlowToolClient`、mock `AgentRunner`、临时 data root、固定 clock 和 no-op sleeper；`pnpm security:scan` 必须继续阻断 direct bridge、本机浏览器和 forbidden browser automation 依赖。
- 可靠性：每次 WebAdmin run 都先创建 running index，完成后原子更新为 success/failed/error/skipped，并尽量记录 `result`、`failed_step`、`heal_result`。即使 `triggerHeal()` 失败，也保留原始 flow 失败详情。
- 性能：列表接口分页读取；`runs.jsonl` 可延续现有 slice/filter 策略，本变更不引入全量扫描之外的新重负载。详情接口按单个 run id 读取并合并相关事件。
- 可维护性：run detail DTO 定义在 `packages/schemas/src/webadmin.ts`；前端只 import schema types；API 聚合逻辑集中在 `apps/api`。
- 可观测性：UI 显示“是否触发 self-heal”和“如果没有触发，为什么没有触发”，避免只显示“失败”。
- 可测试性：API 使用 Fastify injection；scheduler 使用 fake clock；self-heal 使用 mock runner；frontend 使用 typecheck/build，不启动浏览器。
- 可部署性：不新增服务和外部依赖；SQLite schema 通过 `CREATE TABLE IF NOT EXISTS`/版本迁移兼容既有 `webadmin.db`。

### Complexity and Exceptions

本变更唯一新增的持久状态是 WebAdmin SQLite run correlation index，例如 `flow_runs` 表或等价表。新增原因是现有 `runs.jsonl` 没有稳定 run id/source/schedule correlation，`schedule_runs` 又没有完整 flow result/self-heal detail；如果强行只用 JSONL，会导致用户从 `/schedules` 无法稳定跳到对应失败详情。

控制方式：

- index 只保存 WebAdmin 发起 run 的关联字段和结果快照，不接管 `flow-engine` 日志事实来源。
- schema 字段使用可扩展 JSON 文本存储 `params`、`result`、`failed_step`、`heal_result`，避免为 flow data 建复杂关系模型。
- 详情 API 以 index 为主，best-effort 合并 `runs.jsonl` 和 `heals.jsonl`；历史 JSONL 无 index 时仍可在 flow 历史列表中展示摘要。
- 回滚时可停止读取新表，旧 `runs.jsonl`、`heals.jsonl`、`schedule_runs` 仍可继续工作。

## Decisions

1. **由 `apps/api` 负责 WebAdmin self-heal 编排，而不是让 `flow-engine` 直接调用 self-heal。**
   - 理由：`flow-engine` 现有边界是不依赖 `self-heal`，失败只产出 metadata；CLI 已证明“调用方编排 self-heal”是现有模式。
   - 替代方案：在 `flow-engine` 内部依赖 `self-heal`。该方案会扩大引擎职责并增加测试/安全边界复杂度。

2. **新增 WebAdmin run correlation index，而不是改变 `runs.jsonl` 为主存储。**
   - 理由：需要关联 manual token、schedule id、schedule run id、run result 和 heal id；SQLite 已是 WebAdmin 自有状态存储。
   - 替代方案：修改 `RunLogEntrySchema` 强制写 `run_id`。该方案会影响 CLI、历史日志和 flow-engine 兼容性。

3. **API 提供统一 run detail DTO，前端从 `/flows` 与 `/schedules` 复用同一个详情组件。**
   - 理由：用户关心的是一次执行的诊断，不应因入口不同而看到不同信息。
   - 替代方案：分别在两个页面做局部展示。该方案会复制 UI 和字段解释，容易再次出现“计划任务只显示摘要”的问题。

4. **self-heal 状态必须显式表达 triggered/skipped/success/failed/dry-run/disabled。**
   - 理由：用户需要知道“是否实现了自动调用 OpenClaw/Agent”，只展示失败文本不足以诊断。
   - 替代方案：只链接到 `heals.jsonl`。该方案要求用户理解底层日志，不适合 WebAdmin。

## Risks / Trade-offs

- [Risk] 历史 `runs.jsonl` 没有 run id，无法 100% 关联旧运行与旧 heal event。-> Mitigation：旧历史以 flow/timestamp/status 摘要展示；只有 WebAdmin 新发起的 run 承诺完整详情关联。
- [Risk] self-heal Agent 真实调用可能耗时，阻塞 WebAdmin run 完成状态。-> Mitigation：本阶段延续 CLI 同步触发语义，并记录 timeout/error；未来如需异步 Agent run，可单独提出后台任务 change。
- [Risk] SQLite result snapshot 过大。-> Mitigation：只保存诊断所需字段和截断摘要，完整输出仍通过 `data/output/` 与 `runs.jsonl` 查看。
- [Risk] API 同时合并 JSONL、SQLite 和 heal 文件，逻辑复杂。-> Mitigation：把聚合逻辑集中在 `apps/api` 的 run history/detail helper，并用 injection tests 覆盖 success、failed、skipped、heal triggered、heal skipped、schedule correlation。
- [Risk] WebAdmin 默认触发真实 Agent CLI 可能出乎用户预期。-> Mitigation：遵循 CLI 默认语义，并支持显式禁用；默认测试用 mock runner，不调用真实 Agent。

## Migration Plan

1. 扩展 `packages/schemas/src/webadmin.ts` 的 run history/detail DTO 与 JSON Schema 导出。
2. 扩展 `apps/api/src/storage.ts`，新增 WebAdmin run index 表和 CRUD/list helper；兼容旧 DB。
3. 重构 `apps/api/src/runner.ts`，将 manual run 的 token 状态、flow 执行结果、自愈结果写入 index；失败时复用 `triggerHeal()`。
4. 调整 `apps/api/src/scheduler.ts`，为每次 schedule tick 创建/更新同一类 run index，并让 `schedule_runs` 能关联到 flow run id。
5. 扩展 REST API：flow history、run detail、schedule run detail 和 manual token 查询返回统一 DTO。
6. 更新 `/flows` 与 `/schedules` 前端页面，复用执行详情展示组件。
7. 补充离线测试与 baseline 验证。

回滚策略：

- 若 WebAdmin 新详情能力有问题，可回滚 API route/UI 使用，保留旧 `/api/runs`、`/api/heals`、`/api/schedules/:sid/runs` 摘要能力。
- SQLite 新表是附加状态；删除或忽略新表不影响 `data/logs/runs.jsonl`、`learnings/heals.jsonl`、flow 文件和输出文件。
- 如 self-heal 默认触发出现问题，可通过 WebAdmin runner 配置或请求参数临时禁用，并保留失败详情查询。

## Open Questions

- WebAdmin 是否需要在 UI 暴露“本次运行禁用 self-heal / heal dry-run”选项？本变更先保证默认行为与 CLI 一致，显式选项可在实现时按最小范围决定。
- 对旧 `runs.jsonl` 是否需要一次性回填 SQLite run index？本变更倾向不回填，只做 best-effort 展示，避免迁移复杂度。
