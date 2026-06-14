## Context

当前仓库是 Python 运行时的紫鸟自动化引擎：`engine/zclaw_client.py` 是唯一 ZClaw bridge 网络出口，`engine/flow_engine.py` 负责 flow DSL 解析、执行、分支、校验、日志和自愈触发，`engine/self_heal.py` 负责失败分类、提示词和 Agent CLI 调用，`manager.py` 提供稳定 CLI。已有 flow 资产位于 `flows/*.json`，提取脚本位于 `extracts/*.js`，运行/自愈历史长期写入 `data/logs/` 与 `learnings/`。

`docs/05-TS重构技术蓝图.md` 的完整目标包含核心引擎、WebAdmin 后端、CLI、自愈与 OpenClaw 集成迁移。这个 change 是第一阶段基线，不替换任何运行路径，只建立后续迁移必须依赖的 TypeScript 工作区、schema 契约和兼容性验证。

约束：

- 所有浏览器操作只能通过 ZClaw bridge，禁止本机浏览器、Playwright、Selenium、Puppeteer、browser-use。
- `engine/zclaw_client.py` 的 `_request()` 白名单不能修改或绕过。
- 当前 Python CLI 与 WebAdmin 仍可继续工作。
- 当前 `openspec/specs/` 为空，`add-web-admin` 是未完成 change，不作为已归档能力修改。

## Goals / Non-Goals

**Goals:**

- 建立 TypeScript/Node.js workspace，使 TS 包可与现有 Python 运行时并行存在。
- 建立 `packages/schemas`，把 flow DSL 与长期数据文件契约前置为运行时校验和 TS 类型。
- 建立 `packages/core` 的最小边界，承载路径、JSON/JSONL、时间和错误类型等无浏览器副作用能力。
- 将当前 flow 资产转成 fixture/golden 基线，验证 TS schema 与 Python `validate_flow` 对关键行为的理解一致。
- 为后续 ZClaw client、Flow Engine、自愈、WebAdmin 迁移提供可复用验证入口。

**Non-Goals:**

- 不迁移 `engine/zclaw_client.py`、`engine/flow_engine.py`、`engine/self_heal.py` 或 `manager.py`。
- 不调用真实 ZClaw bridge，不打开店铺浏览器，不执行 `manager.py run` 真机流程。
- 不修改现有 `flows/*.json` 或 `extracts/*.js` 的业务内容。
- 不迁移 WebAdmin 后端、前端或调度器。
- 不移除 Python，也不把 README 主命令切到 TS。

## Architecture Assessment

### Existing Design Reuse

- Flow DSL 来源：`docs/03-流程定义规范.md` 与 `engine/flow_engine.py::validate_flow`。
- 工具名与动作集合来源：`KNOWN_TOOLS`、`KNOWN_ACTIONS`、`ON_FAIL_ACTIONS`。
- 资产样本来源：当前 `flows/*.json` 与其引用的 `extracts/*.js`。
- 数据文件契约来源：`log_run()`、`self_heal.py` 的 known issues / heals 记录、`webadmin/` 现有 SQLite 数据模型。
- 验证方式复用：继续运行 `python3 manager.py validate <flow_id>` 作为 Python 现状基准，TS 测试只做静态解析与 golden 对比。

### Boundaries and Ownership

- `typescript-workspace-baseline` 拥有根级 Node workspace 配置、脚本命令和包边界规则。
- `flow-contract-schemas` 拥有 schema、类型导出、默认值和兼容性解析；它不得读取 bridge、不得执行 flow。
- `flow-compatibility-baseline` 拥有 fixture/golden 生成与断言；它可以读取仓库 flow/extract/log 样本，但不得改写运行时数据。
- `packages/core` 只能提供无副作用基础设施；任何 ZClaw HTTP、Agent CLI、WebAdmin server 都不属于本 change。
- 失败处理：schema 校验返回结构化错误；测试命令失败即阻断后续迁移。运行时重试、取消、超时仍归 Python 引擎所有。

### Options and Rationale

选择方案：先建 `packages/schemas` 与 fixture/golden，再迁移执行器。

- 优点：先冻结兼容契约，后续迁移每个模块都有回归标准。
- 代价：短期会同时存在 Python 与 TS 两套描述，但 TS 只做校验，不参与执行。

替代方案 A：直接迁移 `packages/zclaw`。

- 不采用原因：ZClaw 是最高安全边界，缺少 schema/golden 前先写 client 容易把行为与安全验证混在一起。

替代方案 B：直接迁移 Flow Engine。

- 不采用原因：branch/goto、变量解析、validate、on_fail 细节较多，先没有契约基线会让行为漂移难以定位。

替代方案 C：从 WebAdmin 迁移开始。

- 不采用原因：当前 `add-web-admin` 仍在进行中，且 WebAdmin 不是 TS 清零 Python 依赖的最小风险入口。

### Quality Attributes

- 安全：本 change 不新增浏览器控制能力；静态检查 MUST 防止引入 Playwright/Selenium/Puppeteer/browser-use 或本机浏览器打开命令。
- 可靠性：所有当前 flow MUST 通过 TS schema 解析，并保留 Python validate 基准输出。
- 可维护性：schema 是后续包共享契约，新增字段必须默认可选或有兼容默认值。
- 可测试性：Vitest 覆盖合法/非法 flow、未声明参数 warning、缺失 extracts、非法跳转、非法工具名。
- 可部署性：Node workspace 的存在不得影响 `python3 manager.py list/validate`。

### Complexity and Exceptions

本 change 会引入 Node/TypeScript 开发依赖，这是为后续迁移不可避免的基础设施复杂度。控制方式：

- 只在根 workspace 和 `packages/*` 引入，不让 Python 引擎 import TS 产物。
- 不新增运行期服务、数据库、队列或浏览器依赖。
- 所有新增脚本必须是本地校验/构建用途，不成为生产执行路径。
- 回滚时删除新增 TS workspace 文件和 packages 即可恢复到纯 Python 运行形态。

## Decisions

1. 使用 `pnpm workspace` 作为 monorepo 基线。替代方案是 npm workspace；不选 npm 的原因是后续多包内部引用和过滤执行会更多，pnpm workspace 更清晰。若团队环境没有 pnpm，实现阶段可先用 `corepack` 固定版本。
2. 使用 Zod 作为 schema 源，配合 JSON Schema 导出。替代方案是 TypeBox 或手写 JSON Schema；不选手写的原因是类型与运行时校验会分叉，不利于后续前后端共享。
3. fixture/golden 从当前仓库资产生成或复制，作为版本化测试输入。替代方案是测试直接读取 `flows/`；不选直接读取作为唯一方式的原因是未来 flow 变更会让迁移基线不稳定，但实现阶段可以保留一条“当前 flows 全量解析”动态测试。
4. TypeScript 阶段先做静态校验，不实现执行语义。替代方案是先实现变量解析/条件求值；本阶段只允许实现为 schema 辅助校验需要的纯函数，完整执行器留给后续 change。
5. Python CLI 保持事实基准。替代方案是立即新增 `ziniao validate`；不选的原因是 CLI 迁移属于后续阶段，过早新增用户入口会造成双入口语义混乱。

## Risks / Trade-offs

- [Risk] schema 与 Python `validate_flow` 不一致 -> Mitigation: golden 中记录 Python validate 结果，TS 测试明确区分 error/warn。
- [Risk] fixture 过旧导致后续迁移只兼容旧样本 -> Mitigation: 同时保留读取当前 `flows/*.json` 的全量解析测试。
- [Risk] Node 依赖污染 Python 引擎主体 -> Mitigation: 引擎主体不得 import 新包，验证 `python3 manager.py validate` 仍在无 TS 构建产物依赖下运行。
- [Risk] 新工具链引入本机浏览器自动化依赖 -> Mitigation: 静态扫描 `playwright|selenium|puppeteer|browser-use|webbrowser|open ` 并在 tasks 中列为阻断项。
- [Risk] `add-web-admin` 与 TS workspace 路径调整冲突 -> Mitigation: 本 change 不移动 `webadmin/`，只新增根 workspace 与 `packages/*`。

## Migration Plan

1. 建立 workspace 与空包边界，确认 Python CLI 仍可运行。
2. 实现 schema 与兼容默认值，解析当前 flow。
3. 固化 fixture/golden，覆盖现有合法 flow 与少量非法 flow 样本。
4. 增加验证命令：Python validate、TS typecheck、TS test、静态安全扫描。
5. 后续 change 才允许基于这些契约迁移 `packages/zclaw` 与 `packages/flow-engine`。

回滚策略：删除根级 Node workspace 文件、`packages/core`、`packages/schemas` 与新增测试 fixture；现有 Python 运行路径不需要迁移回滚。

## Open Questions

- Node 版本是否固定为当前 LTS，还是按 OpenClaw/本机环境选择最小版本？建议实现阶段在 `package.json` `engines.node` 中固定到团队可用版本。
- schema 是否需要在第一阶段导出 JSON Schema 文件到仓库，还是仅在包内提供生成命令？建议第一阶段提供生成命令，是否提交产物由实现阶段根据 WebAdmin 编辑器需求决定。
