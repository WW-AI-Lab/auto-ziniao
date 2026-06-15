## Context

当前 TS 迁移已完成 M1/M2/M3：`packages/core`、`packages/schemas`、`packages/zclaw`、`packages/flow-engine` 已存在，`packages/flow-engine` 已能在 mock tool client 下执行 flow DSL，并具备 `sleeper`、`clock`、`toolClient`、`logger`、临时 `dataRoot` 等可注入测试点。当前活动 change `add-typescript-self-heal` 正在迁移 M4 自愈链路，本 change 不抢占 self-heal 范围。

现有操作节奏能力主要来自 flow 作者手写的 `sleep`、`timeoutMs`、`retry.delayMs` 和 `on_fail.retry.delayMs`。这些能力能解决页面加载等待和失败重试，但无法统一表达 step 风险等级、写操作确认、同店铺串行、每日预算、连续失败熔断或 pacing 事件。`docs/07-操作节奏与流程稳定性规划.md` 已完成研究评估，本 change 将其中可实现的 TS 目标态能力沉淀为 OpenSpec artifacts。

约束：

- 只面向迁移后的 TypeScript 架构。
- 不修改 Python 生产入口：`manager.py`、`engine/flow_engine.py`、`engine/self_heal.py`、`engine/zclaw_client.py` 均不在本 change 内修改。
- 不改变 `packages/zclaw` 职责，不在 ZClaw client 中隐式节流。
- 默认验证离线，不调用真实 ZClaw bridge、不打开店铺浏览器、不调用真实 Agent CLI。
- 新字段必须兼容历史 flow：旧 flow 不声明 pacing 时仍可解析和离线执行。

## Goals / Non-Goals

**Goals:**

- 在 `packages/schemas` 中扩展 flow DSL：`pacing`、step `risk`、step `pacing`、`confirm` 和 runtime event schema。
- 在 `packages/flow-engine` 中实现 TS-only pacing runtime：
  - 合并默认策略、flow 策略和 step 策略；
  - 在工具/action 执行前后通过注入的 `sleeper` 等待；
  - 对 `risk: "critical"` 执行确认门槛；
  - 提供同一进程内的 per-store/per-flow 串行保护和预算拒绝；
  - 记录 pacing/confirm/budget runtime events。
- 增加静态校验和离线测试，确保 pacing 能力在 `pnpm validate:baseline` 中可验证。
- 更新文档，明确这是 TS 目标态能力，不要求 Python 兼容实现。

**Non-Goals:**

- 不给 Python engine 增加 pacing runtime。
- 不迁移 CLI，不替换 `python3 manager.py ...`。
- 不迁移 WebAdmin，不实现 WebAdmin 的确认 UI。
- 不修改 `packages/self-heal`；只保证事件和失败结果可被后续 self-heal 消费。
- 不新增数据库、daemon、外部服务或第三方运行依赖。
- 不实现低层鼠标轨迹、随机鼠标或任何 ZClaw 工具清单之外的工具。
- 不把 pacing 作为默认阻断旧 flow 的强制规则；历史 flow 只产生 warning 或使用保守默认。

## Architecture Assessment

### Existing Design Reuse

- `packages/schemas`
  - 已是 flow DSL 和 runtime data 的唯一 TypeScript schema 来源。
  - 本 change 在这里新增 `PacingPolicySchema`、`StepRiskSchema`、`ConfirmGateSchema`、`FlowRuntimeEventSchema` 等 schema，并保持 `.passthrough()` 和 optional 默认兼容。
- `packages/flow-engine`
  - 已有 `FlowRunner`、`FlowRunnerOptions`、`sleeper`、`clock`、`toolClient`、`dataRoot`、run log 写入和失败 metadata。
  - pacing runtime 应作为执行调度层插入 `executeStep()` 周围，而不是修改每个 ZClaw wrapper。
- `packages/core`
  - 已有 repo root、JSON/JSONL 和错误类型能力。
  - 如需追加 JSONL helper，可放在 core，但不得引入浏览器副作用。
- `packages/zclaw`
  - 继续只负责 bridge transport 和 wrapper。
  - 不维护 pacing 状态、不读取 flow policy、不做隐式等待。
- 现有验证模式
  - 继续使用 Vitest、mock tool client、fake/no-op sleeper、fixed clock、临时 data root 和安全扫描。
  - `pnpm validate:baseline` 仍不得要求紫鸟客户端在线。

### Boundaries and Ownership

- `packages/schemas` 拥有：
  - flow contract 新字段：顶层 `pacing`、step `risk`、step `pacing`、step `confirm`；
  - runtime event contract：`pacing_wait`、`confirm_rejected`、`budget_rejected`、`store_lock_wait`、`store_lock_acquired`、`store_lock_released`；
  - 静态校验 warning/error code。
- `packages/flow-engine` 拥有：
  - `PacingPolicyResolver`：合并默认、flow、step 策略；
  - `PacingScheduler`：计算 before/after wait 和 jitter；
  - `ConfirmGate`：执行 critical step 的授权检查；
  - `ExecutionBudget`：同进程 run 预算、连续失败阈值和 per-store/per-flow 串行保护；
  - runtime event 写入。
- `packages/flow-engine` 不拥有：
  - ZClaw HTTP transport；
  - Agent 自愈调用；
  - WebAdmin 人工确认 UI；
  - 持久化跨进程锁或调度器。
- 状态所有权：
  - 进程内 store lock 和预算状态由单个 `FlowRunner` 或共享 `FlowExecutionRegistry` 持有。
  - runtime event 追加到 `data/logs/flow_events.jsonl`，以 JSONL 方式兼容现有数据文件风格。
  - `runs.jsonl` 仍是每次 run 的摘要日志，不承载所有 pacing 过程事件。
- 失败、重试、取消：
  - pacing wait 期间使用注入 `sleeper`，本阶段不新增 cancel token。
  - confirm/budget 拒绝作为 flow failure 返回，`failed_step` 标记当前 step。
  - `on_fail.retry` 仍只处理步骤执行失败；confirm/budget 拒绝默认不可通过 retry 绕过。

### Options and Rationale

1. **pacing 放在 `packages/flow-engine` vs `packages/zclaw`**
   - 选择 `packages/flow-engine`。
   - 理由：pacing 依赖 flow、step、risk、params、store key、run state 和验证结果，是执行调度职责，不是 bridge transport 职责。
   - 替代方案：在 ZClaw wrapper 中给 `click()`、`visit()` 等加 sleep。这样对 flow 作者不可见，无法表达 critical confirm，也难以离线测试业务策略。

2. **新增独立事件流 vs 扩展 `runs.jsonl`**
   - 选择新增 `data/logs/flow_events.jsonl`。
   - 理由：一个 run 内可能产生多条 wait/lock/confirm/budget 事件；`runs.jsonl` 是摘要日志，混入过程事件会破坏现有读取习惯。
   - 替代方案：把 events 数组塞进 run result 或 `data_summary`。实现少，但 run log 会膨胀，不利于 WebAdmin 后续按时间线读取。

3. **默认强制所有操作声明 `risk` vs warning 渐进**
   - 选择渐进：缺失 `risk` 给 warning；`critical` 缺 confirm 才 error。
   - 理由：历史 flow 较多，直接强制会阻断迁移后的 baseline；warning 可以推动新 flow 最佳实践。
   - 替代方案：所有 `click_element` / `input_text` 必须声明 `risk`。规范更严格，但会让现有 flow 需要一次性大量修改。

4. **跨进程持久化锁 vs 进程内锁**
   - 选择进程内锁作为本 change 的最小实现。
   - 理由：当前 TS CLI 尚未迁移，WebAdmin 调度未迁移；跨进程锁需要文件锁或 SQLite 协议，超出本 change 目标。
   - 替代方案：直接引入文件锁。能覆盖多进程，但新增锁文件生命周期和异常释放复杂度，应留到 CLI/WebAdmin 调度接入时评估。

5. **confirm gate 用 CLI 交互 vs 参数授权**
   - 选择参数授权：例如 `confirm.allowParam: "allow_critical"`，运行参数显式为 truthy 才允许执行。
   - 理由：本阶段不迁移 CLI，也不实现 WebAdmin UI；参数授权可离线测试、可被未来 CLI/WebAdmin 复用。
   - 替代方案：在 flow-engine 中读取 stdin 交互确认。会污染库层职责，也难以在 baseline 中稳定测试。

6. **jitter 默认启用 vs 默认关闭**
   - 选择 schema 支持 jitter，但默认关闭或在测试中使用 deterministic random。
   - 理由：baseline 需要确定性；jitter 的用途是错峰和避免同一时刻触发，不应破坏可复现性。
   - 替代方案：默认开启随机 jitter。更接近真实调度，但测试和复盘更困难。

### Quality Attributes

- **可靠性**：critical confirm、budget reject、lock release、after wait、failure path 都要有单测；确认/预算拒绝不得被 `on_fail.retry` 隐式绕过。
- **可测试性**：所有等待使用 injected `sleeper`；时间使用 injected `clock`；jitter 使用可注入 random 或固定 seed；文件写入使用临时 `dataRoot`。
- **可维护性**：pacing public API 小面化，优先内部类或纯函数；schema 是唯一契约来源。
- **可观测性**：`flow_events.jsonl` 记录事件类型、flow id、step id、store id/name、wait ms、reason、policy profile、run id。
- **性能**：pacing 仅在执行步骤前后计算，避免复杂调度队列；JSONL 追加为轻量 IO。
- **兼容性**：旧 flow 不声明 pacing 仍能解析和执行；新增字段 optional；baseline 不触发真实 bridge。
- **部署性**：不新增 daemon、端口、数据库或 native addon；回滚只需删除 TS 包内改动和文档/spec。

### Complexity and Exceptions

本 change 新增 `PacingPolicyResolver`、`PacingScheduler`、`ConfirmGate`、`ExecutionBudget` 和 runtime event schema，属于跨模块共享能力，但复杂度是必要的：它把已经在文档中识别的操作节奏风险收敛到 TS flow-engine 的可测试执行层，避免后续 CLI/WebAdmin/self-heal 各自实现。

控制方式：

- 不新增第三方依赖。
- 不新增数据库或外部服务。
- 不修改 Python 生产链路。
- 不在 `packages/zclaw` 放业务状态。
- 先做进程内锁和离线测试，持久化锁留到 CLI/WebAdmin 接入阶段。
- 所有新增行为都有 schema、单测和 baseline 覆盖。

## Decisions

1. `risk` 枚举使用 `read`、`navigate`、`write`、`critical`。
   - 替代方案：按工具名隐式推断风险。当前选择让业务含义显式可审计，并允许同一个工具在不同页面语义下有不同风险。

2. 顶层 `pacing` 与 step `pacing` 都是 optional，合并顺序为 `built-in default < flow.pacing < step.pacing`。
   - 替代方案：只允许全局策略。当前选择允许关键步骤覆写更长等待或确认门槛。

3. `critical` 默认要求确认，确认由 `confirm.allowParam` 或标准参数 `allow_critical` 授权。
   - 替代方案：只要 flow 声明 `critical` 就允许执行。当前选择避免高影响步骤无人值守执行。

4. 事件流文件为 `data/logs/flow_events.jsonl`，事件 schema 放在 `packages/schemas`。
   - 替代方案：复用 `learnings/heals.jsonl` 或 `runs.jsonl`。当前选择保持 self-heal 事件和 run 摘要职责清晰。

5. 同店铺串行先做进程内实现，默认 key 为 `storeId`，缺失时用 `params.store_id`、`params.store_name` 或 `"unknown"`。
   - 替代方案：立刻使用 SQLite/file lock。当前选择避免在未迁移 CLI/WebAdmin 前引入跨进程锁复杂度。

6. pacing runtime 默认只在 TS flow-engine 生效；Python 引擎不兼容实现。
   - 替代方案：同步给 Python 做最小支持。用户已明确本方案只针对迁移后的 TS 架构，且 Python 即将被后续迁移替代。

## Risks / Trade-offs

- [Risk] 旧 flow 因新增静态校验产生大量 warning -> Mitigation：warning 不阻断 baseline；文档说明新 flow 必须逐步补齐 `risk`。
- [Risk] 进程内锁无法防止两个独立 Node 进程同时操作同一店铺 -> Mitigation：在 design/tasks 中明确为第一阶段限制；后续 CLI/WebAdmin 接入时评估持久化锁。
- [Risk] 事件文件增长过快 -> Mitigation：事件内容保持摘要，不记录完整 args 或敏感内容；后续 WebAdmin 可做分页读取。
- [Risk] confirm/budget failure 与 `on_fail.retry` 语义冲突 -> Mitigation：把 confirm/budget 拒绝定义为 policy rejection，默认不可 retry；单测覆盖。
- [Risk] jitter 导致测试不稳定 -> Mitigation：默认关闭或测试注入 deterministic random；baseline 不依赖真实时间。
- [Risk] self-heal 后续误把 confirm reject 当成可自动修复错误 -> Mitigation：事件和失败 code 使用 `confirm_rejected` / `budget_rejected`，文档说明 self-heal 不应自动绕过确认。
- [Risk] 新字段被 Python validate 忽略或 passthrough -> Mitigation：本 change 明确不要求 Python 识别；TS schema 负责目标态校验。

## Migration Plan

1. 扩展 `packages/schemas/src/flow.ts`：
   - 新增 `StepRiskSchema`、`PacingPolicySchema`、`StepPacingSchema`、`ConfirmGateSchema`。
   - `FlowDefinitionSchema` 接收顶层 `pacing`。
   - `FlowStepSchema` 接收 `risk`、`pacing`、`confirm`。
   - `validateFlowContract()` 增加 risk/confirm/postcondition warning/error。
2. 扩展 `packages/schemas/src/runtime-data.ts`：
   - 新增 `FlowRuntimeEventSchema` 和类型。
   - 覆盖 pacing/confirm/budget/lock 事件。
3. 扩展 `packages/flow-engine/src/index.ts`：
   - 新增 policy resolver、scheduler、confirm gate、budget/lock registry。
   - 在 step 执行前后应用 wait，并写入 runtime event。
   - 在 critical step 前检查确认参数。
   - confirm/budget 拒绝返回结构化 failure 和 `failed_step`。
4. 增加单测：
   - schema 解析历史 flow；
   - static warning/error；
   - fake sleeper 记录 before/after wait；
   - critical confirm allow/reject；
   - per-store lock 和 budget reject；
   - `flow_events.jsonl` 事件 schema 可解析。
5. 更新 baseline 与安全扫描：
   - `pnpm validate:baseline` 包含新增测试。
   - 确认 `packages/flow-engine` 仍不直接访问 `9481` 或 `/zclaw/*`。
6. 更新文档：
   - `docs/03-流程定义规范.md` 增补 pacing/risk/confirm。
   - `docs/06-TS迁移进度与路线图.md` 说明该 change 是 TS 目标态扩展，不改变 Python。
   - `docs/07-操作节奏与流程稳定性规划.md` 标记 OpenSpec change。
   - README/AGENTS 同步边界。
7. 验证：
   - `pnpm typecheck`
   - `pnpm test`
   - `pnpm build`
   - `pnpm validate:baseline`
   - `pnpm security:scan`
   - `python3 manager.py list`
   - `python3 manager.py validate orders_overview`
   - `openspec validate add-typescript-flow-pacing-policy --strict`

回滚方式：删除本 change 对 `packages/schemas`、`packages/flow-engine`、测试、文档和 root scripts 的修改；删除 `data/logs/flow_events.jsonl` 试运行产物（如有）。Python 生产链路未改，回滚后验证 `python3 manager.py list` 与 `python3 manager.py validate orders_overview`。

## Open Questions

- `flow_events.jsonl` 是否需要在首个实现中接入 WebAdmin 读取。默认不接入，留到 WebAdmin/CLI 后续 change。
- `maxRunPerDay` 是否需要跨进程持久化统计。默认不做，首版只做进程内预算和可观测事件。
- `risk` 缺失 warning 是否应在未来升级为 error。首版不升级，避免破坏历史 flow。
