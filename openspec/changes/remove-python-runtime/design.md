## Context

当前仓库已完成 M1-M6：`packages/zclaw`、`packages/flow-engine`、`packages/self-heal`、`packages/cli` 和 `apps/webadmin-api` 已存在，且默认验证以离线 mock、临时 data root、固定 clock 和 no-op sleeper 为主。`docs/06-TS迁移进度与路线图.md` 明确 M7 是“Python 依赖清零”，但在它之前还需要完成 WebAdmin 前端整理、双跑切换准备和入口切换。

当前仍保留的 Python 运行面包括：`manager.py`、`engine/*.py`、`webadmin/**/*.py`、`webadmin/requirements.txt`、Python WebAdmin 测试、文档中的 `python3 manager.py` 示例、`scripts/validate-python-flows.ts` 对 Python CLI 的调用，以及 ziniao-assistant skill 的沉淀/自愈说明。M7 需要把这些生产和验证路径全部切到 TS。

关键约束：

- 浏览器操作仍只能通过 ZClaw bridge；不得引入本机浏览器、Playwright、Selenium、Puppeteer 或 browser-use。
- M7 apply 前必须已有前置证据：TS CLI/WebAdmin API 双跑通过、WebAdmin 前端已整理到 `apps/webadmin-frontend` 或等价目标目录、生产入口切换已被前置 change 批准。
- M7 完成后 active tree 不应再保留 Python 源码。若需要归档 Python 实现，只能通过 git tag/branch/release artifact，而不是把 `.py` 文件移动到仓库内。

## Goals / Non-Goals

**Goals:**

- 删除 active tree 中的 Python engine、Python WebAdmin 后端、Python 依赖声明和 Python 验证脚本入口。
- 把日常执行、沉淀、自愈修复、调度、WebAdmin 启动和文档示例统一为 `ziniao` / TS 命令。
- 将 `apps/webadmin-api` 作为 WebAdmin 生产后端，并托管前置阶段整理后的前端 dist。
- 将 baseline 改为 TS-only：typecheck、Vitest、schema export、security scan、CLI smoke、WebAdmin API smoke 和必要的真实 bridge 显式验证。
- 保留历史数据和 flow 资产格式，不迁移 `flows/`、`extracts/`、`data/`、`learnings/`、`heal_templates/` 的长期契约。

**Non-Goals:**

- 不在 M7 中补做 WebAdmin 前端整理或首次双跑验证；这些是前置条件。
- 不改变 ZClaw bridge 协议、工具名或安全白名单。
- 不引入新的浏览器自动化框架、守护服务、数据库或跨模块协议。
- 不把 Python 代码搬到仓库内的归档目录继续维护。
- 不重写 flow DSL 或改变现有 flow JSON 语义。

## Architecture Assessment

### Existing Design Reuse

- `packages/zclaw`：继续作为唯一允许直接访问 `127.0.0.1:9481` 和 `/zclaw/*` 的 TS 包。
- `packages/flow-engine`：继续承载 flow 加载、静态校验、变量解析、条件/分支/goto、工具调度、output 与 run log 写入。
- `packages/self-heal`：继续承载错误分类、known issues、prompt/context rendering、cooldown 和 Agent runner adapter。
- `packages/cli`：从过渡 CLI 升级为生产 CLI，不新增 flow DSL 或 self-heal 业务规则。
- `apps/webadmin-api`：从并行后端升级为生产 WebAdmin 后端，复用既有 SQLite WebAdmin 自有状态、调度器、REST/SSE、chat 和静态托管实现。
- `packages/schemas`：继续作为 flow、runtime data 和 WebAdmin DTO 的唯一 schema 来源。
- `scripts/security-scan.ts`：扩展为 M7 的静态守卫，阻断 Python 源码/依赖/命令回归和浏览器安全边界回归。

### Boundaries and Ownership

- CLI 入口所有权：`packages/cli` 拥有用户命令面、terminal 输出、exit code 和 crontab 建议；真实执行仍委托 `packages/flow-engine` 和 `packages/self-heal`。
- WebAdmin 所有权：`apps/webadmin-api` 拥有 HTTP/SSE API、WebAdmin SQLite 表、scheduler、chat 状态和静态前端托管；不直接访问 bridge，不读取 ZClaw API key。
- Runtime 数据所有权：`packages/flow-engine` 写 `data/logs/runs.jsonl` 和 `data/output/`；`packages/self-heal` 写 `data/logs/heals/*` 和 `learnings/heals.jsonl`；WebAdmin 只读取/编排这些文件，不重新定义格式。
- 安全所有权：`packages/zclaw` 拥有 bridge 请求；`scripts/security-scan.ts` 拥有跨仓静态边界检查；文档和 skill 必须反映同一边界。
- 回滚所有权：删除 Python 后，回滚不再依赖 active tree 内 Python fallback；必须通过 git tag/branch 恢复 M7 前状态，或回退到入口切换前的 release。

### Options and Rationale

1. **直接删除 Python active tree，而不是保留兼容 wrapper**
   - 选择理由：目标是“完全不存在 Python 代码”。保留 `manager.py` wrapper 会继续要求 Python runtime，不符合 M7。
   - 替代方案：保留 `manager.py` 作为提示用户改用 `ziniao` 的 shim。该方案仍保留 `.py`，不满足目标。

2. **把 Python 归档到 git tag/branch，而不是仓库内 `archive/`**
   - 选择理由：active tree 清零更可验证，`git ls-files` 可以作为静态门禁。
   - 替代方案：移动到 `archive/python/`。该方案会让仓库仍含 Python 代码，并可能被误用。

3. **baseline 用 TS golden/fixtures 取代 Python 对比**
   - 选择理由：M7 后无法再执行 Python CLI；Python 对比证据必须在前置双跑阶段冻结。
   - 替代方案：继续保留 `scripts/validate-python-flows.ts`。该方案破坏 Python 清零目标。

4. **WebAdmin 生产切换到 `apps/webadmin-api`，不新增第二个 Node 服务**
   - 选择理由：M6 已建立 Fastify API、SQLite 状态、scheduler 和 static serving，复用成本最低。
   - 替代方案：新增 `apps/webadmin-server` 或 NestJS 服务。该方案引入额外生命周期和迁移风险，没有当前必要性。

### Quality Attributes

- **安全**：安全扫描必须确认除 `packages/zclaw` 外无 direct bridge；无浏览器自动化依赖；无本机浏览器打开命令；无 Python fallback。
- **可靠性**：删除 Python 前必须有前置双跑和入口切换证据；删除后通过 TS CLI smoke、WebAdmin API injection/smoke、schema export 和静态扫描验证。
- **可维护性**：单一 TS 运行栈减少文档、命令和测试双写；OpenSpec specs 同步更新为 TS-only。
- **可观测性**：继续使用现有 run/heal/output 文件格式，WebAdmin 观测 API 不迁移历史数据。
- **可测试性**：默认 baseline 继续离线；真实 bridge flow 只作为显式人工确认验证，不进入默认 baseline。
- **可部署性**：Node/pnpm 成为唯一运行依赖；WebAdmin 由 `apps/webadmin-api` 启动并托管前端 dist。

### Complexity and Exceptions

本变更不引入新服务、新存储或新协议。主要复杂度来自破坏性删除和操作面切换。控制方式：

- 用前置 evidence gate 防止在双跑不足时删除 Python。
- 用 `git ls-files` 和安全扫描验证 active tree 中无 Python 源码、`requirements.txt`、Python CLI 调用和 Python WebAdmin 文档入口。
- 用 OpenSpec spec delta 明确从“并行/过渡”切到“TS-only 生产”的行为变化。
- 回滚通过 git tag/branch，而不是仓库内 Python fallback。

## Decisions

1. **M7 apply 必须先检查前置 change 状态和证据**
   - 选择：tasks 中加入阻断项，要求确认 WebAdmin 前端整理、双跑切换和入口切换已完成。
   - 替代：在 M7 中顺手补做前置阶段。拒绝，因为会扩大 blast radius，且违反当前阶段顺序。

2. **删除 Python 文件优先于改成弃用提示**
   - 选择：删除 `manager.py`、`engine/` 和 Python WebAdmin 后端。
   - 替代：保留弃用 shim。拒绝，因为 M7 明确要求 Python 代码清零。

3. **把 `ziniao` 定为唯一 CLI 命令面**
   - 选择：文档、crontab、skill、README、AGENTS 全部使用 `ziniao`。
   - 替代：同时保留 `python3 manager.py` 与 `ziniao`。拒绝，因为会保留双栈心智负担和误用路径。

4. **安全扫描承担 Python 回归门禁**
   - 选择：扩展 `scripts/security-scan.ts` 检查 tracked `.py`、`requirements.txt`、Python subprocess 和旧命令引用。
   - 替代：仅靠人工 review。拒绝，因为 M7 的目标可以静态验证，应该自动阻断回归。

## Risks / Trade-offs

- [前置双跑证据不足导致删除后才发现 TS 行为差异] -> M7 第一批任务必须检查并记录前置证据；缺失时停止 apply。
- [外部 crontab 或本地别名仍调用 `python3 manager.py`] -> 文档和 CLI `cron` 输出切换到 `ziniao`，tasks 加入人工检查和迁移说明。
- [Agent skill 仍生成 Python 命令] -> 同步 `.cursor/skills/ziniao-assistant/` 和 `.codex/skills/`，并用 `rg` 验证旧命令消失。
- [删除 Python WebAdmin 后前端静态路径不一致] -> 依赖前置 `apps/webadmin-frontend` 整理；M7 只切生产托管路径并 smoke。
- [需要紧急回滚但 active tree 无 Python] -> 在删除前创建/确认 git tag 或清晰记录恢复点；回滚通过 git，不通过仓库内 fallback。
- [安全扫描误报 `.venv` 或历史 dist] -> 扫描以 `git ls-files` 或受控目录为准，忽略 untracked/local dependency folders。

## Migration Plan

1. **Preflight gate**
   - 检查 `openspec status` 和相关 archived changes，确认前端整理、双跑切换和入口切换已经完成。
   - 记录 M7 前恢复点：当前 commit、tag 或 branch。
   - 运行当前 TS baseline，确认删除前 TS 路径健康。

2. **Command and validation cutover**
   - 更新 root scripts，移除 `validate:python`，让 baseline 只运行 TS 验证。
   - 更新 `packages/cli` 的描述、`cron` 输出和测试，去除 Python 过渡提示。
   - 更新 specs 中仍声明 Python 生产入口保留的要求。

3. **WebAdmin cutover**
   - 确认 `apps/webadmin-api` 托管整理后的 frontend dist。
   - 删除 Python FastAPI WebAdmin 后端与 tests。
   - 保留 `data/webadmin.db` 等运行数据文件兼容。

4. **Python active tree removal**
   - 删除 `manager.py`、`engine/`、`webadmin/**/*.py`、`webadmin/requirements.txt`、Python 相关 cache/test 配置。
   - 删除或替换 `scripts/validate-python-flows.ts`。
   - 同步 README、AGENTS、docs、skills 和 crontab 示例。

5. **Verification**
   - 运行 `pnpm typecheck`、`pnpm test`、`pnpm build`、`pnpm schemas:export -- --check`、`pnpm security:scan`、`pnpm validate:baseline`。
   - 运行 `pnpm ziniao list`、`pnpm ziniao validate orders_overview`、低风险 local-only flow smoke。
   - WebAdmin API 启动或 injection smoke，确认 REST/SSE/静态托管可用。
   - `git ls-files` 验证无 tracked `.py`、`requirements.txt` 和旧 Python 命令入口。

6. **Rollback**
   - 若 M7 实施中失败且尚未提交，恢复本 change 修改或回到 M7 前 branch。
   - 若 M7 已提交，回滚该提交或从 M7 前 tag/branch 恢复。
   - 不在 active tree 内保留 Python fallback。

## Open Questions

1. 前置“入口切换”change 的名称和归档证据路径需要在 apply 时确认。
2. `apps/webadmin-frontend` 的最终 dist 路径由前置阶段决定；M7 只消费该路径。
3. 是否需要为旧 `python3 manager.py` 用户提供一段 release note 或迁移脚本；若提供，必须是非 Python 实现。
