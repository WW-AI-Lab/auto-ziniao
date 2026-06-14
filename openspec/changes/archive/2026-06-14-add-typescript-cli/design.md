## Context

当前仓库的 TS 迁移实际状态是 M1-M4 已完成：`packages/core`、`packages/schemas`、`packages/zclaw`、`packages/flow-engine`、`packages/self-heal` 均已存在，且根级 `package.json` 的 `build`、`typecheck`、`test`、`validate:baseline` 已覆盖这些包。生产入口仍是 `python3 manager.py ...`，其命令包括 `list`、`run`、`run-all`、`retry`、`new`、`validate`、`history`、`enable`、`disable`、`heals`、`stats`、`cron`。

M5 的任务是新增 `packages/cli` 作为 `ziniao ...` 过渡入口。它要复用 M3/M4 的核心能力，形成后续 WebAdmin TS 后端和双跑切换的调用面，但不能提前替换 Python 生产路径。仓库最高安全规则继续适用：所有浏览器操作只能通过 ZClaw bridge，默认验证不得调用真实 `POST /zclaw/tools/invoke`，不得打开本机浏览器，不得调用真实 Agent CLI。

相关活动 change：

- `add-typescript-flow-pacing-policy` 正在规划 TS flow-engine 的操作节奏策略，不迁移 CLI；若该 change 先落地，CLI 应只消费 flow-engine 暴露的能力，不在 CLI 内重复实现 pacing。
- `add-web-admin` 是既有 Python WebAdmin 收尾，不属于 M5 范围；M5 不移动或改造 WebAdmin。

## Goals / Non-Goals

**Goals:**

- 新增 `packages/cli`，提供 `ziniao` 可执行入口。
- 使用 `commander` 解析命令和参数，覆盖当前 Python CLI 的日常命令语义。
- 对接 `@ziniao/flow-engine` 完成 `validate`、`run`、`run-all`、`retry`、`new`、`enable`、`disable`、`list`、`history`、`stats`、`cron` 所需能力。
- 对接 `@ziniao/self-heal`，在 `run` 失败且未传 `--no-heal` 时触发 TS self-heal；测试默认使用 dry-run 或 mock runner。
- 输出稳定 exit code，便于后续 crontab/WebAdmin/CI 使用。
- 将 CLI 纳入 `pnpm typecheck`、`pnpm test`、`pnpm build`、`pnpm validate:baseline` 和 `pnpm security:scan`。
- 更新 `docs/06-TS迁移进度与路线图.md`，记录 M5 proposal 已创建和实际进度。

**Non-Goals:**

- 不修改或替换 `manager.py`、`engine/flow_engine.py`、`engine/self_heal.py`、`engine/zclaw_client.py`。
- 不迁移 WebAdmin 后端/API/调度器或前端目录。
- 不把 crontab 建议、WebAdmin subprocess 或用户生产命令切到 `ziniao`。
- 不执行真实 bridge baseline，不自动打开店铺浏览器，不调用真实 OpenClaw/Claude/Cursor baseline。
- 不新增新的 flow DSL、ZClaw transport、自愈规则或长期数据格式。
- 不实现 OpenClaw 包或 Agent chat。

## Architecture Assessment

### Existing Design Reuse

- `packages/core`
  - 复用 `defaultRepoRoot`、JSON/JSONL 读写、目录创建、错误类型。
  - 如需 CLI 专用 display helper，优先放在 `packages/cli` 内，避免污染 core。
- `packages/schemas`
  - 复用 `FlowDefinition`、`RunLogEntrySchema`、`HealEventSchema`、`KnownIssuesFileSchema` 等契约。
  - CLI 不维护独立 schema。
- `packages/flow-engine`
  - 复用 `loadFlow()`、`validateFlow()`、`parseParams()`、`runFlow()`、`FlowRunResult`。
  - 真实执行由 flow-engine 通过注入 client 或 `packages/zclaw` adapter 调度工具；CLI 不拼接 bridge HTTP 请求。
- `packages/self-heal`
  - 复用 `triggerHeal()`、`buildTriggerInputFromFailure()`、`loadHealConfig()` 和可注入 `AgentRunner`。
  - CLI 只决定是否触发、如何展示结果，不实现 prompt 模板和 cooldown。
- Python CLI
  - 作为行为参考和回滚基线保留；M5 不改 Python 文件。
- 测试模式
  - 继续使用 Vitest、mock tool client、临时 repo/data root、no-op sleeper、fixed clock、mock Agent runner。
  - `pnpm validate:baseline` 仍不得要求紫鸟客户端在线。

### Boundaries and Ownership

- `packages/cli` 拥有：
  - 命令行参数解析、help 文案、终端输出、exit code。
  - 将 CLI 参数映射到 flow-engine/self-heal API。
  - 读取运行历史、自愈事件、flow 列表和 output 摘要所需的只读展示逻辑。
  - `new`、`enable`、`disable` 这类文件级管理命令的最小写入逻辑。
- `packages/cli` 不拥有：
  - ZClaw bridge transport、API key 读取、工具发现。
  - flow DSL 语义、变量解析、branch/goto、validate、output/run log 写入。
  - self-heal 错误分类、known issues、prompt/context 生成、cooldown、Agent command adapter。
  - WebAdmin server、调度器、SQLite、SSE 或前端构建。
- 失败与 exit code：
  - 参数错误、flow 不存在、静态校验 fatal error、运行失败均返回非 0。
  - `validate` 只有 warning 时返回 0，含 error 时返回非 0。
  - `run --no-heal` 不触发 self-heal。
  - bridge 不可达由 `packages/zclaw`/`flow-engine` 返回结构化错误，CLI 只展示并返回非 0，不 fallback 到本机浏览器。
- 状态所有权：
  - `runs.jsonl`、`data/output/` 仍由 flow-engine 写入。
  - `learnings/heals.jsonl` 与 `data/logs/heals/*` 仍由 self-heal 写入。
  - CLI 的 `retry` 从最近一次 run log 读取 params 后再次调用 `run`。

### Options and Rationale

1. **CLI 直接调用 TS package API vs subprocess 调 `python3 manager.py`**
   - 选择直接调用 TS package API。
   - 理由：M5 是建立 TS 操作入口，若只包 Python subprocess，无法验证 M3/M4 的目标态聚合。
   - 替代方案：先做 Python wrapper，风险低但不会推进迁移。

2. **CLI 直接依赖 `@ziniao/zclaw` vs 只依赖 `flow-engine`**
   - 选择 CLI 不直接依赖 `@ziniao/zclaw`。
   - 理由：保持 `packages/zclaw` 作为 bridge transport，`flow-engine` 作为工具调度所有者，CLI 不应越层访问 bridge 或 API key。
   - 替代方案：CLI 创建 ZClaw client 后注入 flow-engine。实现直接但容易让 CLI 变成第二个 bridge 入口。

3. **`run` 失败后默认触发 self-heal vs 默认 dry-run**
   - 选择对齐 Python 语义：默认触发，`--no-heal` 禁用；测试和 baseline 使用 mock/dry-run。
   - 理由：用户命令语义应兼容 `manager.py run`，但验证不能调用真实 Agent CLI。
   - 替代方案：M5 默认全部 dry-run。更安全但与目标命令语义不一致，后续切换还需再改。

4. **逐字复刻 Python 输出 vs 语义兼容**
   - 选择语义兼容。
   - 理由：终端输出中的 emoji/排版不是长期契约；命令、参数、exit code、数据读写和错误语义才是迁移重点。
   - 替代方案：逐字复刻。测试脆弱，且会绑定 Python CLI 的表现细节。

5. **实现全部命令 vs 先实现核心 run/validate/list**
   - 选择覆盖当前日常命令，但实现保持最小。
   - 理由：M5 的价值是替代 CLI 面，不覆盖 `retry`、`heals`、`stats`、`cron` 会影响后续双跑切换判断。
   - 替代方案：分两阶段。更小但会留下明显迁移缺口。

### Quality Attributes

- **安全性**：安全扫描必须确认 `packages/cli` 不含 direct bridge 访问、本机浏览器打开命令、Playwright/Selenium/Puppeteer/browser-use。
- **可靠性**：命令 exit code 稳定；运行失败、自愈跳过、Agent timeout、flow 不存在、非法参数都有单测。
- **兼容性**：命令名、核心参数和生产数据文件兼容 Python CLI；Python 入口保持可用。
- **可测试性**：CLI handler 设计为可注入 repo root、data root、tool client、agent runner、clock、sleeper；单测不依赖真实环境。
- **可维护性**：CLI 只做编排，避免重复实现 flow/self-heal 逻辑。
- **可观测性**：沿用既有 run log、heal event、output 文件；CLI 不创建新的长期日志格式。
- **可部署性**：新增 `commander` 和 workspace 包，不新增服务、端口、数据库或 native addon。

### Complexity and Exceptions

新增的主要复杂度来自 CLI 命令适配层和测试注入点。该复杂度必要，因为 M5 是从库能力走向用户入口的迁移阶段。控制方式：

- 只新增一个外部依赖 `commander`。
- 不引入 shell wrapper 作为主要实现。
- 不新增 daemon、数据库或端口。
- 通过 mock tool client 和 mock Agent runner 覆盖 run/self-heal。
- 通过安全扫描和精确 `rg` 检查证明 CLI 没有绕过 ZClaw 边界。

## Decisions

1. `packages/cli` 的 package name 使用 `@ziniao/cli`，bin 名称使用 `ziniao`。
   - 替代方案：package name 也叫 `ziniao`。当前选择与已有 workspace 包命名一致，同时保留用户命令为 `ziniao`。

2. 使用 `commander` 作为 CLI 框架。
   - 替代方案：手写 `process.argv` parser。当前选择符合技术蓝图，能降低参数解析和 help 文案维护成本。

3. CLI 默认 root 从 `@ziniao/core.defaultRepoRoot` 或 `--repo-root` 测试注入解析。
   - 替代方案：固定 `process.cwd()`。当前选择更适合从 dist/bin、测试目录或后续 WebAdmin subprocess 调用。

4. `new` 命令复用 `flows/_template.json` 并替换 `__FLOW_ID__`、`__FLOW_NAME__`。
   - 替代方案：把模板迁入 TS 代码。当前选择保持现有 flow 脚手架单一来源。

5. `run-all` 初版串行执行 enabled flows。
   - 替代方案：并发执行。当前选择兼容 Python 语义，并避免多店铺/同店铺并发风险。

6. `web` 命令不纳入 M5。
   - 替代方案：提前提供 `ziniao web` 启动当前 Python WebAdmin。当前选择避免在 CLI 迁移阶段耦合 Python WebAdmin；WebAdmin TS 化留到 M6。

## Risks / Trade-offs

- [Risk] CLI 聚合 self-heal 后误调用真实 Agent CLI -> Mitigation：baseline 使用 mock runner；单测覆盖 `--no-heal`、dry-run/mock runner；文档明确真实 Agent 仅在用户显式运行时发生。
- [Risk] `packages/cli` 直接或间接访问 bridge 边界变宽 -> Mitigation：安全扫描禁止 CLI direct bridge 字符串和浏览器自动化依赖；真实工具只通过 flow-engine。
- [Risk] 输出与 Python 不完全一致影响脚本解析 -> Mitigation：M5 只承诺命令、exit code 和数据文件语义；若发现已有脚本依赖文本输出，再在 apply 阶段补兼容 fixture。
- [Risk] `retry` 复用历史 params 时遇到旧日志缺字段 -> Mitigation：用 schema optional/默认兼容，缺 params 时使用空对象并提示。
- [Risk] 活动 `add-typescript-flow-pacing-policy` 修改 flow-engine API -> Mitigation：CLI 使用稳定 public API；若 apply 时 API 已变化，先适配新 public API，不在 CLI 内实现 pacing。
- [Risk] M5 完成后用户误以为生产入口已切换 -> Mitigation：路线图、README、AGENTS 明确 `python3 manager.py ...` 仍是生产入口，`ziniao` 是过渡入口。

## Migration Plan

1. 创建 `packages/cli` workspace 包，配置 `tsconfig.json`、`package.json`、`bin`、构建输出和测试。
2. 实现 CLI command handlers：
   - flow 管理：`list`、`new`、`validate`、`enable`、`disable`。
   - 运行：`run`、`run-all`、`retry`。
   - 观测：`history`、`heals`、`stats`、`cron`。
3. 接入 flow-engine：
   - `parseParams()` 解析 `-p/--param`。
   - `validateFlow()` 展示 issue 并设置 exit code。
   - `runFlow()` 运行 flow，真实用户命令可通过 ZClaw adapter，baseline 只能 mock。
4. 接入 self-heal：
   - `run` 失败且未 `--no-heal` 时组装 `HealTriggerInput` 并调用 `triggerHeal()`。
   - 单测使用 mock runner/dry-run，覆盖 skipped、success、failure。
5. 更新 workspace 配置和安全扫描，将 `packages/cli` 纳入 typecheck/test/build/baseline。
6. 更新文档和路线图，记录 M5 实现进度、验证命令和非目标。
7. 验证：
   - `pnpm typecheck`
   - `pnpm test`
   - `pnpm build`
   - `pnpm validate:baseline`
   - `pnpm security:scan`
   - `python3 manager.py list`
   - `python3 manager.py validate orders_overview`
   - `openspec validate add-typescript-cli --strict`

回滚方式：删除或隔离 `packages/cli`，恢复 root workspace 配置、安全扫描和文档中 M5 改动。Python 生产链路未改，回滚后验证 `python3 manager.py list` 与 `python3 manager.py validate orders_overview`。

## Open Questions

- `ziniao web` 是否应在 M6 WebAdmin TS 化时一次性实现。默认 M5 不做。
- 是否需要为机器消费增加 `--json` 输出。默认 M5 先做人工可读输出，后续 WebAdmin/CI 需要时再扩展。
- `run` 默认真实触发 self-heal 是否需要增加 `--heal-dry-run` 选项。默认实现可保留该选项以方便验证，但生产语义仍与 Python 默认触发保持一致。
