## Context

当前 TS 迁移已完成 M1/M2：`packages/core`、`packages/schemas`、`packages/zclaw` 已存在，`packages/zclaw` 是 TypeScript 侧唯一 ZClaw bridge client。Python `engine/flow_engine.py` 仍是生产 flow 执行入口，承担 flow 加载、参数合并、变量解析、condition/branch/goto、validate、内置动作、工具步骤、run log、output 写入和 self-heal 触发。

M3 的目标是新增 `packages/flow-engine`，复刻 Python flow engine 的核心执行语义，为后续 `packages/cli` 和 WebAdmin 切换做准备。该阶段必须保持生产入口不变，默认验证不得调用真实 bridge；真实 ZClaw 双跑只能作为显式人工验证任务。

## Goals / Non-Goals

**Goals:**

- 新增 `packages/flow-engine`，提供 TS flow 加载、静态校验和执行核心。
- 复用 `packages/schemas` 的 flow schema 和静态契约，避免重复定义 DSL。
- 复用 `packages/zclaw` 的 client，确保 TS flow engine 不直接访问 `9481` 或 `/zclaw/*`。
- 实现 Python engine 已有的核心 DSL 语义：参数、变量、condition、branch、goto、validate、on_fail.retry/skip/branch/abort/障碍记录。
- 实现内置 action：`sleep`、`save_json`、`save_csv`、`print`、`assert`、`fail`、`branch`、`goto`、`close_store`。
- 实现工具步骤接入、extract 文件读取、run log 写入和 output 写入。
- 建立离线 mock 测试、golden/parity 测试和显式低风险 flow 真机双跑验证任务。

**Non-Goals:**

- 不迁移 `engine/self_heal.py` 或 Agent 调用；`on_fail.action: "heal"` 在本阶段只记录失败现场并由上层未来 self-heal 接管。
- 不新增 `packages/cli`，不提供 `ziniao ...` 命令。
- 不替换 `python3 manager.py ...` 生产入口。
- 不迁移 WebAdmin 后端、前端或调度器。
- 不把真实 bridge run 加入 `pnpm validate:baseline`。
- 不移除 Python engine。

## Architecture Assessment

### Existing Design Reuse

- `packages/core`：
  - repo path、JSON/JSONL 读取、时间、错误类型；
  - 可扩展写 JSON/JSONL helper，但不把 flow-specific 逻辑放入 core。
- `packages/schemas`：
  - `FlowDefinition`、`FlowStep`、`parseFlowDefinition()`、`validateFlowContract()`；
  - `RunLogEntrySchema` 作为写入格式兼容检查；
  - condition/action/tool 常量。
- `packages/zclaw`：
  - `ZClawClient` 与 wrapper；
  - flow-engine 只通过注入的 ZClaw client interface 调用工具，不直接拼 HTTP。
- Python `engine/flow_engine.py`：
  - 作为行为参考，不直接共享代码；
  - 需要按现有 flow 的真实使用路径建立 parity tests。
- M1/M2 测试模式：
  - Vitest；
  - `pnpm typecheck` / `pnpm test` / `pnpm build` / `pnpm validate:baseline`；
  - security scan。

### Boundaries and Ownership

- `packages/flow-engine` 拥有：
  - flow 文件加载；
  - validate wrapper；
  - flow run context；
  - variable/condition/branch/goto/validate runtime semantics；
  - internal action execution；
  - output file writing；
  - run log appending；
  - tool step dispatch to injected ZClaw client.
- `packages/flow-engine` 不拥有：
  - ZClaw HTTP transport；
  - API key loading；
  - self-heal prompt/Agent/cooldown/known issues；
  - CLI command parsing；
  - WebAdmin API scheduling/locking。
- 调用关系：
  - `packages/flow-engine` depends on `@ziniao/core`、`@ziniao/schemas`、`@ziniao/zclaw`；
  - `packages/zclaw` MUST NOT depend on `packages/flow-engine`；
  - `packages/core` / `packages/schemas` MUST NOT depend on `packages/flow-engine`；
  - future `packages/cli` MAY call `packages/flow-engine`。
- 状态所有权：
  - `FlowRunner` owns per-run `context`、`storeId`、`targetId`、`failedStep`、`currentStep`；
  - run log belongs to `data/logs/runs.jsonl`；
  - output belongs to `data/output/`；
  - extract scripts remain in `extracts/` and are read as text, not executed by Node.
- 错误职责：
  - validation errors fail before run；
  - step errors obey `on_fail`；
  - flow-level retry obeys `retry.maxAttempts`；
  - `heal` action records failure metadata but does not invoke Agent；
  - cleanup can call `close_store` through ZClaw client when configured, but must be skippable in mock tests.

### Options and Rationale

1. **直接翻译 Python class vs 分层 TS modules**
   - 选择分层 TS modules：loader、validator、variables、conditions、actions、runner、logs/output。
   - 理由：Python 文件较大，直接翻译会把 IO、runtime、tool dispatch、validation 混在一起；分层有利于单测和后续 CLI/WebAdmin 复用。
   - 替代方案：单文件 `FlowRunner` 直译。短期快，但后续难维护。

2. **依赖具体 `ZClawClient` vs 注入最小 client interface**
   - 选择注入最小 `FlowToolClient` interface，默认 adapter 使用 `packages/zclaw`。
   - 理由：默认测试必须离线，mock client 是必要边界；同时生产路径仍可使用真实 `ZClawClient`。
   - 替代方案：runner 内直接 new `ZClawClient`。会让测试更难，也容易在 baseline 中误连真实 bridge。

3. **默认 baseline 是否跑真实 flow**
   - 选择不跑真实 flow。真实双跑作为显式命令/任务，需要用户确认紫鸟客户端在线。
   - 理由：最高安全规则要求 bridge 不可达时停止；默认 baseline 必须能离线、可重复。
   - 替代方案：CI/本地默认跑真实 flow。不可控且可能打开店铺浏览器。

4. **self-heal 是否并入 M3**
   - 选择不并入。M3 只记录失败现场和 heal intent，后续 M4 迁移 self-heal。
   - 理由：self-heal 涉及 known issues、prompt、Agent CLI、cooldown 和截图，范围独立且风险高。

### Quality Attributes

- **安全**：flow-engine 不能直接访问 bridge；真实 run 只能经 `packages/zclaw`；security scan 必须阻断 direct bridge。
- **可靠性**：步骤失败、retry、skip、branch、abort 和 validate failure 都要有 deterministic tests。
- **兼容性**：当前 flow 文件不修改即可被 TS engine 加载；output/log 格式兼容 Python。
- **可测试性**：核心语义用 mock tool client；sleep 使用可注入 sleeper 避免测试等待；时间使用可注入 clock 固定 golden。
- **可维护性**：模块边界清晰，为后续 CLI/WebAdmin 提供稳定 API。
- **可部署性**：不新增服务、不新增数据库、不改变生产入口。

### Complexity and Exceptions

`packages/flow-engine` 是跨后续阶段复用的核心基础设施，复杂度不可避免。控制方式：

- API 面只提供 loader、validator、runner 与少量 types；
- 默认实现只覆盖当前 Python engine 已有语义，不新增 DSL；
- 对 self-heal 只记录失败上下文，不触发 Agent；
- 对真实 bridge 双跑设置显式验证任务，不进入 baseline；
- 回滚可通过删除 `packages/flow-engine` 和恢复 root scripts 完成。

## Decisions

1. `packages/flow-engine` 新增最小 public API：
   - `loadFlow(flowId | filePath)`
   - `validateFlow(flow | unknown)`
   - `createFlowRunner(options)`
   - `runFlow(flowId | flow, options)`
   - `parseParams(pairs)`
2. `FlowRunner` 使用 dependency injection：
   - `toolClient`：mock 或 `ZClawClient` adapter；
   - `clock`：`now/date/timestamp`；
   - `sleeper`：测试中 no-op；
   - `logger`：默认 console，测试中 capture。
3. `runFlow()` 返回结构兼容 Python：
   - success：`{ status: "success", data }`
   - failed/error：`{ status, error, failed_step, heal }`
4. `on_fail.action: "heal"` 不触发 Agent。本阶段行为等价于记录失败现场并失败返回，M4 接管 Agent self-heal。
5. output 写入默认限定在 `data/output/`，相对 filename resolve 到该目录；绝对路径只用于兼容现有 Python 语义，但必须有测试覆盖。
6. `execute_script` 的 `@extracts/*.js` 只读取文本并做变量替换，然后交给 `packages/zclaw.executeScript()`；Node 不执行 extract JS。
7. 低风险真机双跑首选 `webadmin_selftest` 或另一个不触发真实 bridge 的 dry/local flow；真实 bridge flow 需要用户确认环境和参数后人工触发。

## Risks / Trade-offs

- [Risk] 一次迁移完整 runtime 语义过大 -> Mitigation：tasks 分层，先离线语义，再 tool dispatch，再 log/output，再双跑。
- [Risk] TS engine 与 Python 行为漂移 -> Mitigation：用当前 flow golden、Python validate agreement、变量/branch/validate/action parity tests。
- [Risk] 默认测试误触发真实 bridge -> Mitigation：mock tool client、security scan、baseline 不含真实 run。
- [Risk] self-heal 缺失导致 TS run 失败后行为不同 -> Mitigation：明确 M3 non-goal，返回 heal intent/failed_step，M4 继续迁移。
- [Risk] output/log 写入污染真实数据 -> Mitigation：测试使用 temp repo/data root；真实双跑任务单独检查输出并可清理。
- [Risk] run log schema 与 Python 不兼容 -> Mitigation：写入后用 `RunLogEntrySchema` 解析，并与 Python log 字段做 golden 对比。

## Migration Plan

1. 新增 `packages/flow-engine` scaffold，接入 workspace scripts。
2. 实现 loader/validator/parseParams，与 Python validate 和 M1 schema 兼容。
3. 实现 variable/context/condition/branch/goto/max execution guard。
4. 实现 validate rules 与内置 actions，测试使用 temp output root。
5. 实现 tool dispatch adapter，默认通过 `packages/zclaw`，测试使用 mock client。
6. 实现 run log/output 写入并用 schema/golden 验证。
7. 更新 security scan 和 docs。
8. 跑离线验证：`pnpm typecheck`、`pnpm test`、`pnpm build`、`pnpm validate:baseline`、`openspec validate add-typescript-flow-engine --strict`。
9. 显式执行低风险双跑验证，记录命令、参数、输出和差异。若需要真实 bridge，先确认紫鸟客户端和测试店铺可用。

回滚方式：删除 `packages/flow-engine`，恢复 root scripts、`tsconfig.base.json`、`vitest.config.ts` 和安全扫描到 M2 状态。由于生产入口未切换，回滚后 `python3 manager.py list` 与 `python3 manager.py validate orders_overview` 仍应可运行。

## Open Questions

- 低风险真机双跑默认选择哪个 flow：`webadmin_selftest` 可验证内置动作但不覆盖 bridge；真实 bridge flow 需要用户提供可安全执行的 `store_name` 或确认使用默认第一店铺。
- M3 是否提供临时开发脚本运行 TS engine。默认不新增 CLI；如实现需要，可只在 tests 中调用 public API，不添加用户入口。
