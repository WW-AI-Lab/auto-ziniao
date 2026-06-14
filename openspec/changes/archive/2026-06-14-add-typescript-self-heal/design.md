## Context

当前 TS 迁移已完成 M1/M2/M3：`packages/core`、`packages/schemas`、`packages/zclaw`、`packages/flow-engine` 已存在，`packages/flow-engine` 已能在离线 mock client 下返回失败结果、`failed_step` 和 `heal` metadata。生产运行仍由 `python3 manager.py ...`、`engine/flow_engine.py` 和 `engine/self_heal.py` 负责。

M4 的目标是新增 `packages/self-heal`，把 Python `engine/self_heal.py` 中的自愈触发链路迁移为 TypeScript 包能力。该包后续会被 `packages/cli` 或 WebAdmin API 接入，但本阶段只提供可测试的库 API、dry-run 和离线验证，不改变生产入口。

关键约束：

- 所有浏览器操作仍只能通过紫鸟 ZClaw bridge；M4 自身不得直接访问 bridge，也不得引入本机浏览器自动化依赖。
- 默认验证必须离线，不执行真实 flow、不调用真实 `POST /zclaw/tools/invoke`、不实际调用 OpenClaw/Claude/Cursor Agent CLI。
- `config.json` 是用户级配置，M4 实现应只读取并兼容，不在实现中自动改写。
- `data/logs/heals/*.json`、`data/logs/heals/*_prompt.md`、`learnings/heals.jsonl`、`learnings/known_issues.json` 是长期数据契约，必须保持 Python 兼容。

## Goals / Non-Goals

**Goals:**

- 新增 `packages/self-heal`，提供错误分类、known issues 命中、prompt/context 生成、模板渲染、冷却频控和 Agent CLI adapter。
- 复用 `packages/core` 的路径、JSON/JSONL、时间和错误基础能力；必要时只新增无浏览器副作用的文件 helper。
- 复用 `packages/schemas` 的 `HealContextSchema`、`HealEventSchema`、`KnownIssuesFileSchema` 和 flow/runtime 类型；必要时做兼容扩展。
- 接受 `packages/flow-engine` 的失败 metadata 作为输入，支持从 `FlowRunFailure` 或等价结构生成 heal trigger input。
- 支持 dry-run：生成 heal context 和 prompt 文件，但不检查冷却、不调用 Agent CLI。
- 支持可注入 `clock`、`agentRunner`、`logger` 和 repo/data root，保证单测离线、确定、无真实副作用。
- 将 self-heal 纳入 `pnpm typecheck`、`pnpm test`、`pnpm build`、`pnpm validate:baseline` 和 `pnpm security:scan`。

**Non-Goals:**

- 不迁移 `packages/cli`，不提供 `ziniao ...` 生产命令。
- 不替换 `python3 manager.py ...`、`engine/flow_engine.py` 或 `engine/self_heal.py`。
- 不迁移 WebAdmin 后端、API、调度器或前端。
- 不执行真实 Agent CLI 调用作为默认测试或 baseline。
- 不在 `packages/self-heal` 中直接访问 ZClaw bridge 或读取 ZClaw API key。
- 不自动写入或修改 `learnings/known_issues.json` 的修复记录；修复沉淀仍由被唤起的 Agent 在自愈闭环中完成。

## Architecture Assessment

### Existing Design Reuse

- `packages/core`
  - 已有 `findRepoRoot()`、`defaultRepoRoot`、`readJsonFile()`、`readJsonLinesFile()`、`nowIso()`、`ZiniaoError`。
  - M4 可在 core 中补充通用 `writeJsonFile()`、`appendJsonLine()`、`ensureDir()`，但不得放入自愈业务逻辑。
- `packages/schemas`
  - 已有 `HealContextSchema`、`HealEventSchema`、`KnownIssuesFileSchema`、`FlowDefinition`。
  - 如需要增加字段，必须保持 `.passthrough()` 和历史可选字段兼容，不改变已有数据格式。
- `packages/flow-engine`
  - M3 已返回 `failed_step`、`heal_context`、`store_id`、`target_id`、`error`。
  - M4 只消费这些 metadata，不让 flow-engine 依赖 self-heal，避免循环依赖。
- Python `engine/self_heal.py`
  - 作为兼容行为参考：错误分类、模板查找顺序、`_SafeDict` 风格占位符保留、prompt 结构、cooldown/max_per_day、Agent command placeholder、`learnings/heals.jsonl` 事件字段。
- 现有验证模式
  - 使用 Vitest、临时 data root、固定 clock、mock runner。
  - `pnpm validate:baseline` 仍串联 Python validate、TS typecheck/test/build、schema export 和 security scan。

### Boundaries and Ownership

- `packages/self-heal` 拥有：
  - `classifyError(error, stepId, toolName)`；
  - `checkKnownIssues(input)`；
  - `buildHealPrompt(input)`；
  - `checkCooldown(flowId, stepId, config)`；
  - `triggerHeal(input, options)`；
  - `AgentRunner` / `CommandAgentRunner` abstraction；
  - prompt/context/heal event 文件写入。
- `packages/self-heal` 不拥有：
  - flow 执行、retry、step control 或 output 写入；
  - ZClaw HTTP transport、API key、store browser lifecycle；
  - CLI 参数解析和 WebAdmin API；
  - known issues 修复记录的自动生成。
- 调用关系：
  - `packages/self-heal` may depend on `@ziniao/core`、`@ziniao/schemas` 和 Node 标准库。
  - `packages/self-heal` MUST NOT depend on `@ziniao/zclaw`。
  - `packages/flow-engine` MUST NOT depend on `@ziniao/self-heal` in M4；后续 CLI 聚合两者。
- 状态所有权：
  - heal context 写入 `data/logs/heals/<heal_id>.json`；
  - prompt 写入 `data/logs/heals/<heal_id>_prompt.md`；
  - trigger/skip 事件追加到 `learnings/heals.jsonl`；
  - known issues 只读取 `learnings/known_issues.json`。
- 失败与超时：
  - dry-run 不调用 Agent CLI；
  - real trigger 使用 `AgentRunner`，默认 runner 使用 `child_process.spawn` 或等价 API，并执行 timeout；
  - CLI 不存在、超时、非零 exit code 都返回结构化结果并写入事件。

### Options and Rationale

1. **self-heal 作为独立包 vs 并入 flow-engine**
   - 选择独立 `packages/self-heal`。
   - 理由：自愈涉及 prompt、Agent CLI、cooldown 和长期日志，职责与 flow runtime 不同；独立包可被未来 CLI/WebAdmin 复用。
   - 替代方案：在 `packages/flow-engine` 中直接触发 Agent。短期连接少，但会让默认 flow 测试更容易误触发外部进程，也会形成更重的 runtime 依赖。

2. **直接调用 Agent CLI vs 注入 `AgentRunner`**
   - 选择注入 `AgentRunner`，默认实现再封装真实命令。
   - 理由：baseline 必须离线；mock runner 可以覆盖 command rendering、timeout 和错误路径。
   - 替代方案：在 `triggerHeal()` 中直接 `spawn`。实现更少，但测试不稳定且更难阻止真实调用。

3. **复制 Python prompt 文本 vs 复用仓库模板文件**
   - 选择内置最小 fallback，同时优先读取 `heal_templates/`。
   - 理由：仓库已有模板是可编辑资产；TS 内置只保证模板缺失时仍可生成可用提示词。
   - 替代方案：完整复制 Python 内置模板。兼容性更强，但会增加重复文本和安全扫描误报风险。

4. **self-heal 是否读取 `config.json`**
   - 选择读取并浅合并默认配置，但不写入。
   - 理由：保持 Python 行为兼容；用户配置仍由现有文件管理。
   - 替代方案：只接受调用方传入配置。更纯粹，但后续 CLI 需要重复实现配置加载。

5. **安全扫描处理 prompt 中的 ZClaw 指引**
   - 选择让源码不包含直接 bridge 执行代码；如 prompt 需要提到 ZClaw，只作为自然语言指引并通过扫描规则区分“执行访问”和“静态提示文本”。
   - 替代方案：把所有 ZClaw 指引只放在 `heal_templates/`。扫描更简单，但模板缺失时 fallback prompt 质量下降。

### Quality Attributes

- **安全**：self-heal 不依赖 `@ziniao/zclaw`，不读取 ZClaw API key，不发 HTTP 请求，不引入 Playwright/Selenium/Puppeteer/browser-use；默认测试不调用真实 Agent CLI。
- **可靠性**：错误分类、模板查找、占位符保留、cooldown、daily limit、known issue 命中都必须有确定性单测。
- **兼容性**：输出文件路径、JSON 字段、事件字段、模板优先级和 Agent command placeholder 与 Python 行为保持兼容。
- **可测试性**：所有时间、文件根目录、Agent runner、logger 均可注入；测试使用临时目录。
- **可维护性**：public API 保持小面：分类、known issue、prompt、cooldown、trigger 和 types；避免引入服务或数据库。
- **可部署性**：不新增 daemon、端口、数据库或外部服务；只新增 workspace package。

### Complexity and Exceptions

`packages/self-heal` 是后续 CLI/WebAdmin 切换前的共享能力，新增包是必要复杂度。控制方式：

- 不新增第三方运行依赖；只使用 Node 标准库和已有 workspace 包。
- 不新增服务、存储协议或数据库；继续使用现有 JSON/JSONL 文件。
- 只覆盖 Python 已有自愈语义，不新增新的自愈 DSL。
- 通过 dry-run 和 mock Agent runner 把外部副作用隔离出 baseline。
- 回滚时删除 `packages/self-heal` 并恢复 root scripts/path alias/security scan 即可；Python 生产链路不受影响。

## Decisions

1. `packages/self-heal` public API：
   - `classifyError(input)`；
   - `checkKnownIssues(input, options)`；
   - `buildHealPrompt(input, options)`；
   - `checkCooldown(input, options)`；
   - `triggerHeal(input, options)`；
   - `createCommandAgentRunner(options)`。
   替代方案是只暴露 `triggerHeal()`，但会降低单测粒度和后续 CLI/WebAdmin 可复用性。

2. `triggerHeal()` 输入使用 self-heal 自己的 `HealTriggerInput`，并提供 helper 从 `FlowRunFailure` metadata 组装。
   替代方案是直接依赖 flow-engine types；当前选择可避免运行时循环依赖，必要时仅使用 type-only import 或结构化兼容。

3. `dryRun` 行为与 Python 保持一致：生成 context 和 prompt，返回 `{ dry_run: true }`，不写 cooldown trigger 事件、不调用 Agent。
   替代方案是 dry-run 也检查 cooldown；但 Python 当前先返回 dry-run，兼容优先。

4. known issue 命中保持 Python 语义：`resolved: true` 且 `pattern in error` 或 `flow_id + step_id` 命中即返回 issue。
   替代方案是要求 pattern 和 step 同时匹配；这会改变 0 tokens 路径行为。

5. Agent command 使用 placeholder 渲染：`{prompt}`、`{prompt_path}`、`{session_key}`、`{flow_id}`、`{heal_id}`，未知 placeholder 保留原样。
   替代方案是固定 OpenClaw 命令；当前选择兼容 `config.json` 中的 openclaw/claude/cursor-agent。

## Risks / Trade-offs

- [Risk] TS prompt 与 Python prompt 细节不一致导致 Agent 修复质量下降 -> Mitigation：复用 `heal_templates/` 优先级，单测覆盖 flow-level template、generic template、内置 fallback，并在文档中记录差异。
- [Risk] security scan 误报 prompt 文本中的 ZClaw 指引 -> Mitigation：扫描规则只阻断可执行 direct bridge 访问，或 prompt 中避免出现会被误判的执行代码片段；测试加入安全扫描。
- [Risk] 默认测试误调用真实 Agent CLI -> Mitigation：`triggerHeal()` 测试默认使用 mock `AgentRunner`，baseline 不使用真实 runner。
- [Risk] cooldown 与 Python 行为漂移 -> Mitigation：用固定 clock 和 JSONL fixture 覆盖同日上限、同 step 冷却期、不同 step 不互相阻塞。
- [Risk] 写入真实 `data/` 污染历史 -> Mitigation：单测使用临时 repo/data root；真实 dry-run 任务单独标注输出路径。
- [Risk] 配置加载暴露敏感命令参数 -> Mitigation：错误与日志只输出命令摘要，不打印完整 prompt 或 secret；不读取 ZClaw key。

## Migration Plan

1. 新增 `packages/self-heal` scaffold，接入 pnpm workspace、`tsconfig.base.json` path alias、`vitest.config.ts` alias 和 root scripts。
2. 实现错误分类、known issues 读取与命中。
3. 实现模板查找、占位符渲染、heal context/prompt 文件写入。
4. 实现 config 读取、cooldown/max_per_day、`learnings/heals.jsonl` 事件写入。
5. 实现 `AgentRunner` 和 command rendering，单测覆盖 success、non-zero exit、timeout、command missing；默认测试使用 mock runner。
6. 增加从 flow-engine failure metadata 组装 trigger input 的 helper 或测试适配。
7. 更新 security scan 和 baseline，确认 self-heal 不直接访问 bridge、不引入浏览器自动化依赖、不真实调用 Agent CLI。
8. 更新文档和路线图，把 M4 标记为进行/完成，并说明 M5 才迁移 CLI。
9. 验证：`pnpm typecheck`、`pnpm test`、`pnpm build`、`pnpm validate:baseline`、`pnpm security:scan`、`python3 manager.py list`、`python3 manager.py validate orders_overview`、`openspec validate add-typescript-self-heal --strict`。

回滚方式：删除 `packages/self-heal`，恢复 root `package.json`、`tsconfig.base.json`、`vitest.config.ts` 和 `scripts/security-scan.ts` 中的 M4 改动，保留 Python 生产链路。回滚后必须验证 `python3 manager.py list` 与 `python3 manager.py validate orders_overview`。

## Open Questions

- TS 内置 fallback prompt 是否需要完整复制 Python `BUILTIN_PREFIX` 和 `BUILTIN_FOOTER`，还是只保留最小可用版本并强制优先使用 `heal_templates/`。
- M4 是否需要提供一个开发用 dry-run demo 命令。默认不新增 CLI；如需要，应只放在测试或后续 M5。
