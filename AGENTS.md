# AGENTS.md — Agent 工作守则

本仓库是「紫鸟自动化引擎」：把跑通的紫鸟店铺操作任务沉淀为 0 tokens 可重复执行的流程，异常时自动触发 Agent 自愈。你（Agent）在这个仓库工作时必须遵守以下规则。

## 最高安全规则（违反即严重事故）

**所有浏览器操作只能通过紫鸟 ZClaw bridge 执行，绝对禁止使用本机浏览器。**

- 唯一合法通道：`POST http://127.0.0.1:9481/zclaw/tools/invoke`（认证头 `X-ZClaw-Api-Key`，key 在 `~/.zclaw/config.json`）。工具发现：`GET /zclaw/tools`（免认证）。
- 打开页面只有两种方式：店铺已开用 `visit_page`；未开用 `open_store`（可带 `launchUrl`）。店铺浏览器由紫鸟客户端自行拉起——它是 Chromium 内核，外观像 Chrome，但走店铺独立 IP 环境，**这不是本机浏览器**。
- 禁止：打开 Chrome/Safari/Edge/Firefox/Chromium、使用 Playwright/Selenium/Puppeteer/browser-use、调用 `webbrowser` 模块、`open <url>` 命令。
- 工具名以 `GET /zclaw/tools` 返回为准（当前 20 个），**禁止臆造**（没有 `navigate`/`open_url`/`run_script`/`screenshot` 这类名字）。
- 代码层守卫：`engine/zclaw_client.py` 的 `_request()` 路径白名单（仅 `/zclaw/*`）是硬约束，**禁止修改或绕过**。
- bridge 不可达（连接拒绝/超时）= 紫鸟客户端没开，属于环境问题：停止任务并告知用户，不要改代码绕过，不要换浏览器方案。

## TypeScript 迁移总规则

当前迁移按 OpenSpec 分阶段推进。实施迁移相关任务前，必须先读：

1. `docs/05-TS重构技术蓝图.md`
2. 当前 change 的 `proposal.md`
3. 当前 change 的 `design.md`
4. 当前 change 的 `tasks.md`

迁移按阶段推进，禁止跳阶段：

- **已完成 M1：契约与 TS 骨架**。已建立 TypeScript/Node.js workspace、`packages/core`、`packages/schemas`、schema、fixture/golden、静态验证命令。现有生产入口仍是 `python3 manager.py ...`。
- **已完成 M2：安全出口可用**。已新增 `packages/zclaw`，作为 TypeScript 侧唯一 ZClaw bridge client；默认验证只能使用离线 mock，不得执行真实 flow，不得调用真实 `POST /zclaw/tools/invoke` 做基线测试。
- **已完成 M3：Flow Engine 迁移**。已新增 `packages/flow-engine`，提供 TS 侧 flow loader、静态校验 wrapper、运行时上下文、变量解析、condition/branch/goto、validate、内置 action、mock ZClaw tool dispatch、output 与 run log 兼容写入；默认验证仍为离线 mock，不得调用真实 `POST /zclaw/tools/invoke`。
- **已完成 M4：Self-Heal 迁移**。已新增 `packages/self-heal`，提供 TS 侧错误分类、known issues、prompt/context 生成、cooldown、Agent CLI adapter、dry-run 与离线测试；默认验证不得调用真实 Agent CLI，不得执行真实 flow，不得调用真实 `POST /zclaw/tools/invoke`。
- **已完成 M5：CLI 迁移**。已新增 `packages/cli` 与 `ziniao ...` 过渡入口，兼容当前 `manager.py` 主要命令语义；默认验证仍只能使用离线 mock，不得执行真实 flow，不得调用真实 `POST /zclaw/tools/invoke`，不得调用真实 Agent CLI。
- **已完成 M6：WebAdmin 后端 TS 化**。已新增 `apps/webadmin-api`，提供 Fastify REST/SSE API、SQLite WebAdmin 自有状态、调度器、chat SSE、静态前端 dist 托管、离线测试与安全扫描；默认验证仍只能使用离线 mock，不得执行真实 flow，不得调用真实 `POST /zclaw/tools/invoke`，不得调用真实 Agent CLI。
- **下一阶段：WebAdmin 前端整理与双跑切换准备**。必须先创建新的 OpenSpec proposal/design/tasks/spec；实现范围优先是 `apps/webadmin-frontend`、API 类型复用和双跑验证，不得顺手移除 Python engine 或切换生产入口。
- **当前禁止**迁移或替换 `engine/flow_engine.py`、`engine/self_heal.py`、`manager.py`；未经双跑验证和入口切换 change，不得把生产入口从 `python3 manager.py ...` 切到 TS，不得把当前 Python WebAdmin 生产链路切到 `apps/webadmin-api`。
- **后续顺序**必须是：`packages/zclaw` → `packages/flow-engine` → `packages/self-heal` → `packages/cli` → `apps/webadmin-api` → `apps/webadmin-frontend` 整理 → 双跑切换 → 移除 Python。
- 每个阶段必须先有 OpenSpec proposal/design/tasks/spec，再实现；改变运行契约、目录结构、命令入口或安全边界时，必须同步更新 `AGENTS.md`、README 与 `docs/`。
- 回滚基线：M1 的 TS 工作区应可通过删除根级 Node workspace 文件与 `packages/*` 回到纯 Python 运行形态；回滚后 `python3 manager.py list` 与 `python3 manager.py validate orders_overview` 仍应可运行。

## 技术栈与框架约束

### 当前运行态

- Python 引擎主体（`manager.py`、`engine/*.py`）保持标准库实现，不得引入 `requests`、Playwright、Selenium、Puppeteer、browser-use 等第三方依赖。
- `webadmin/` 是隔离子工程，当前允许 FastAPI + uvicorn + SQLite，禁止引擎主体 import `webadmin` 或其第三方依赖。
- `webadmin/frontend/` 当前是 React + Vite + TypeScript + antd + `@ant-design/x` 子工程，运行期由 WebAdmin 后端托管构建产物。

### TS 目标态

- 运行时：Node.js LTS + TypeScript。
- 包管理：`pnpm workspace`。
- 构建/运行：开发用 `tsx`，类型检查用 `tsc --noEmit`，生产构建优先 `tsup`。
- 测试：Vitest。
- Schema：Zod + `zod-to-json-schema`，TypeScript 类型与运行时校验必须同源。
- CLI：`commander`，目标命令为 `ziniao ...`，兼容当前 `manager.py` 命令语义。
- Web 后端：迁移目标为 Fastify + SQLite，默认仅监听 `127.0.0.1`，禁止提供 `0.0.0.0` 绑定开关。
- SQLite：优先 `better-sqlite3`；如 native addon 风险不可接受，再评估 `node:sqlite` 或 `sqlite3`。M6 当前因 pnpm 禁用 native build script 导致 `better-sqlite3` binding 不可用，已按设计回退到 Node 24 内置 `node:sqlite`。
- 前端：保留 React + Vite + TypeScript + antd + `@ant-design/x`，迁移后位于 `apps/webadmin-frontend`。

TS 代码同样受最高安全规则约束：

- `packages/core` 只能放路径、JSON/JSONL、时间、错误类型等无浏览器副作用能力，只依赖 Node 标准库。
- `packages/schemas` 只能放契约类型、运行时校验、JSON Schema 导出，不得读取 bridge、不得执行 flow。
- `packages/zclaw` 是 TS 侧唯一允许直接访问 `127.0.0.1:9481` 与 `/zclaw/*` 的包；只能访问 `GET /zclaw/tools` 与 `POST /zclaw/tools/invoke`，不得提供本机浏览器 fallback。
- `packages/flow-engine` 只能通过注入的 `FlowToolClient` 或 `packages/zclaw` adapter 调度工具；默认单测和 baseline 必须使用 mock client、临时 data root 和 no-op sleeper。
- `packages/self-heal` 不得依赖 `packages/zclaw`，不得读取 ZClaw API key，不得直接访问 bridge；默认单测和 baseline 必须使用 mock Agent runner、临时 data root 和固定 clock，dry-run 只生成 `data/logs/heals/<heal_id>.json` 与 `data/logs/heals/<heal_id>_prompt.md`，不得调用真实 OpenClaw/Claude/Cursor。
- `packages/cli` 只能做命令行参数解析、命令编排、终端输出和 exit code；不得直接依赖 `packages/zclaw`，不得读取 ZClaw API key，不得直接访问 bridge，不得实现 flow DSL 或 self-heal 业务规则。真实工具调度只能通过 `packages/flow-engine`，自愈只能通过 `packages/self-heal`。如果 `add-typescript-flow-pacing-policy` 后续落地，CLI 只消费 flow-engine 暴露的 pacing 能力，不在 CLI 内重复实现 pacing。
- `apps/webadmin-api` 只能做 WebAdmin HTTP/SSE API、SQLite WebAdmin 自有状态、调度器、静态前端托管和对既有 TS package 的服务编排；不得直接依赖 `packages/zclaw`，不得读取 ZClaw API key，不得直接访问 bridge，不得实现 flow DSL 或 self-heal 业务规则；默认单测和 baseline 必须使用 mock tool client、mock Agent runner、临时 data root、固定 clock 和 no-op sleeper。
- 新增 TS 依赖和源码必须通过安全扫描，阻断 `playwright`、`selenium`、`puppeteer`、`browser-use`、`webbrowser`、本机浏览器打开命令和绕过 ZClaw bridge 的可疑路径。

## 你在本仓库的三种工作模式

### 模式 A：沉淀新任务（用户说"把 XX 任务固化/沉淀下来"，或任何 bridge 任务跑通之后主动触发）

**主动触发规则**：凡是通过 bridge 逐步跑通了一个有重复价值的任务（有数据产出/固定操作序列），在结束回合前必须按 ziniao-assistant skill 的沉淀流程（其 `references/flow-distill.md`）沉淀（或一句话提议后立即动手），不要等用户开口——跑通时的选择器、URL、踩坑经验只存在于当前会话，不写盘就会丢失。

1. 先用 ziniao-assistant skill 真机跑通任务（探索阶段允许逐步调用 bridge 工具，每个成功的 invoke 按 skill 约定追加到 `data/logs/traces/<日期>.jsonl`）。
2. 跑通后执行 `python3 manager.py new <flow_id> <中文名>` 创建脚手架。
3. 按 `docs/03-流程定义规范.md` 填写流程，硬性要求：
   - 声明 `params`（至少 `store_name`），不得硬编码店铺名/日期；
   - 提取 JS 外置到 `extracts/<名称>.js`，IIFE 包裹，`return JSON.stringify(...)`，禁用 JS 模板字符串 `` `${}` ``；
   - 关键提取步骤配 `validate`（防空数据假成功）；
   - 可能失败的步骤配 `on_fail`：瞬时问题（加载慢）用 `retry`，页面结构问题用 `heal` 并标注 `context` 错误类型；
   - 有状态差异的场景用 `branch` 写多分支（如已登录/未登录、有数据/无数据、已是目标状态）；
   - **必须**填写 `heal.hints`：页面入口、关键选择器、页面结构特征、已知坑——这是给未来自愈 Agent 的提示词素材。
4. 验收：`python3 manager.py validate <flow_id>` 通过 → `python3 manager.py run <flow_id> -v --no-heal` 真机跑通 → 检查 `data/output/` 产出正确。
5. 复杂流程可追加 `heal_templates/<flow_id>/<error_type>.md` 定制自愈提示词。

### 模式 B：自愈修复（你被 engine/self_heal.py 的提示词唤起）

1. 读提示词中的失败上下文（`data/logs/heals/<heal_id>.json`）、流程定义、截图。
2. 通过 ZClaw bridge 复现诊断（截图/读 DOM/试选择器）。
3. 修复 `flows/<id>.json` 或 `extracts/*.js`（version +1），**不要**修改引擎代码来掩盖流程问题。
4. 验证：`python3 manager.py validate <id>` → `python3 manager.py run <id> -v --no-heal` 必须真实跑通。
5. 固化：把修复写入 `learnings/known_issues.json`（pattern 取错误信息中稳定子串，`resolved: true`）。
6. 通知用户：根因、修复内容、验证结果。

### 模式 C：日常操作（执行/排查）

- 执行：`python3 manager.py run <flow> [-p k=v]...`；重试：`manager.py retry <flow>`。
- 排查：`manager.py history` / `manager.py heals` / `manager.py stats`；bridge 日志用 `get_logs` 工具。
- 多个同类子项（多种订单类型/报表）要逐个检查，不得从子集推断整体。

## 仓库地图

| 路径 | 作用 | 修改约束 |
|------|------|----------|
| `manager.py` | 管理 CLI 入口（转发 `engine/manager.py`，命令不变） | - |
| `engine/zclaw_client.py` | 唯一网络出口（含安全白名单） | 白名单禁止动 |
| `engine/flow_engine.py` | 流程引擎 | 修流程问题时不要改它 |
| `engine/self_heal.py` | 自愈触发器 | 模板尽量放文件，少改内置 |
| `engine/paths.py` | 全仓路径常量唯一出处 | 目录调整需同步文档 |
| `config.json` | 自愈 Agent CLI/冷却/告警 | 用户级配置，改前确认 |
| `flows/*.json` | 沉淀的流程（`_template.json` 是模板） | 改后必须 validate + 真机验证 |
| `extracts/*.js` | 页面提取 JS | IIFE；禁模板字符串 |
| `heal_templates/` | 自愈提示词模板 | 可按流程加子目录定制 |
| `learnings/known_issues.json` | 已知问题库（0 tokens 修复路径） | 修复后必须回写 |
| `data/` | 运行时数据（logs/output/backups/webadmin.db） | 只读，勿手工编辑 |
| `webadmin/` | Web 管理界面（可选子工程） | 引擎主体禁止 import 它 |
| `webadmin/frontend/` | 当前 WebAdmin 前端（React/Vite/TS） | 迁移到 `apps/webadmin-frontend` 前不要擅自移动 |
| `package.json` / `pnpm-workspace.yaml` / `tsconfig.base.json` | TS monorepo 基线 | 不得改变 Python 入口语义 |
| `packages/core/` | TS 共享基础工具 | 只允许无浏览器副作用能力；不得访问 ZClaw |
| `packages/schemas/` | TS 契约、运行时校验、JSON Schema 导出 | 不得执行 flow、不得调用 bridge |
| `packages/zclaw/` | 目标态 ZClaw client | 仅在对应后续 change 中创建/修改；必须是唯一 TS ZClaw 网络出口 |
| `packages/flow-engine/` | 目标态 Flow Engine | 仅在对应后续 change 中创建/修改；必须兼容现有 flow 语义 |
| `packages/self-heal/` | 目标态自愈模块 | 仅在对应后续 change 中创建/修改；必须兼容 known issues 与模板 |
| `packages/openclaw/` | 目标态 OpenClaw/Agent adapter | 不直接依赖 flow-engine |
| `packages/cli/` | 目标态 `ziniao` CLI | 双跑切换完成前不得替换 `python3 manager.py` 生产入口 |
| `apps/webadmin-api/` | 目标态 TS WebAdmin 后端 | 仅在对应后续 change 中创建/修改；不得直接访问 ZClaw bridge |
| `apps/webadmin-frontend/` | 目标态 WebAdmin 前端 | 迁移后复用 `packages/schemas` API 类型 |
| `docs/` | 架构与规范文档 | 架构变更需同步更新 |

## 通用约定

- Python 引擎主体零第三方依赖，新 Python 代码只用标准库；TS/WebAdmin 子工程只能使用本文批准的迁移技术栈。
- 所有文档、注释、提示词使用中文。
- `list_stores` 只调一次拿数据，不要循环轮询；`open_store` 一次即可。
- 流程失败时引擎已自动处理自愈触发，不要在流程外再包一层重试脚本。
- 临时数据文件允许，**禁止创建额外的可执行脚本文件**来绕过引擎完成任务（与 ziniao-assistant skill 的约定一致）。
- 基线验证命令只能做静态解析、typecheck、单测和安全扫描；不得执行 `open_store`、`visit_page`、`execute_script` 或 `POST /zclaw/tools/invoke`。
