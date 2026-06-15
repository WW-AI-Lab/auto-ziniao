# AGENTS.md — Agent 工作守则

本仓库是「紫鸟自动化引擎」：把跑通的紫鸟店铺操作任务沉淀为 0 tokens 可重复执行的流程，异常时自动触发 Agent 自愈。你（Agent）在这个仓库工作时必须遵守以下规则。

## 最高安全规则（违反即严重事故）

**所有浏览器操作只能通过紫鸟 ZClaw bridge 执行，绝对禁止使用本机浏览器。**

- 唯一合法通道：`POST http://127.0.0.1:9481/zclaw/tools/invoke`（认证头 `X-ZClaw-Api-Key`，key 在 `~/.zclaw/config.json`）。工具发现：`GET /zclaw/tools`（免认证）。
- 打开页面只有两种方式：店铺已开用 `visit_page`；未开用 `open_store`（可带 `launchUrl`）。店铺浏览器由紫鸟客户端自行拉起——它是 Chromium 内核，外观像 Chrome，但走店铺独立 IP 环境，**这不是本机浏览器**。
- 禁止：打开 Chrome/Safari/Edge/Firefox/Chromium、使用 Playwright/Selenium/Puppeteer/browser-use、调用 `webbrowser` 模块、`open <url>` 命令。
- 工具名以 `GET /zclaw/tools` 返回为准（当前 20 个），**禁止臆造**（没有 `navigate`/`open_url`/`run_script`/`screenshot` 这类名字）。
- 代码层守卫：`packages/zclaw` 是唯一允许直接访问 ZClaw bridge 的包，路径白名单（仅 `/zclaw/*`）是硬约束，**禁止修改或绕过**。
- bridge 不可达（连接拒绝/超时）= 紫鸟客户端没开，属于环境问题：停止任务并告知用户，不要改代码绕过，不要换浏览器方案。

## 技术栈与运行态

生产入口为 `auto-ziniao` CLI。

- 运行时：Node.js LTS + TypeScript。
- 包管理：`pnpm workspace`。
- 构建/运行：开发用 `tsx`，类型检查用 `tsc --noEmit`，生产构建优先 `tsup`。
- 测试：Vitest。
- Schema：Zod + `zod-to-json-schema`，TypeScript 类型与运行时校验必须同源。
- CLI：`commander`，生产命令为 `auto-ziniao ...`（或 `pnpm auto-ziniao ...`）。
- Web 后端：Fastify + SQLite（`node:sqlite`），默认仅监听 `127.0.0.1`，禁止提供 `0.0.0.0` 绑定开关。
- 前端：React + Vite + TypeScript + antd + `@ant-design/x`，位于 `apps/web`。

TS 代码同样受最高安全规则约束：

- `packages/core` 只能放路径、JSON/JSONL、时间、错误类型等无浏览器副作用能力，只依赖 Node 标准库。
- `packages/schemas` 只能放契约类型、运行时校验、JSON Schema 导出，不得读取 bridge、不得执行 flow。
- `packages/zclaw` 是唯一允许直接访问 `127.0.0.1:9481` 与 `/zclaw/*` 的包；只能访问 `GET /zclaw/tools` 与 `POST /zclaw/tools/invoke`，不得提供本机浏览器 fallback。
- `packages/flow-engine` 只能通过注入的 `FlowToolClient` 或 `packages/zclaw` adapter 调度工具；默认单测和 baseline 必须使用 mock client、临时 data root 和 no-op sleeper。
- `packages/flow-engine` 拥有 `pacing`、`risk`、`confirm`、进程内预算和 `flow_events.jsonl` 事件写入；禁止把这些 flow 策略下沉到 `packages/zclaw` 或绕过 `FlowToolClient`。
- `packages/self-heal` 不得依赖 `packages/zclaw`，不得读取 ZClaw API key，不得直接访问 bridge；默认单测和 baseline 必须使用 mock Agent runner、临时 data root 和固定 clock。
- `packages/cli` 只能做命令行参数解析、命令编排、终端输出和 exit code；不得直接依赖 `packages/zclaw`，不得读取 ZClaw API key，不得直接访问 bridge，不得实现 flow DSL 或 self-heal 业务规则。
- `apps/api` 只能做 WebAdmin HTTP/SSE API、SQLite WebAdmin 自有状态、调度器、静态前端托管和对既有 TS package 的服务编排；不得直接依赖 `packages/zclaw`，不得读取 ZClaw API key，不得直接访问 bridge。
- `apps/web` 只能做 WebAdmin React 前端，通过 same-origin `/api/*` 访问 `apps/api`；不得直接访问 ZClaw bridge、不得读取 ZClaw API key、不得打开本机浏览器或引入浏览器自动化依赖。
- 新增 TS 依赖和源码必须通过安全扫描（`pnpm security:scan`），阻断 `playwright`、`selenium`、`puppeteer`、`browser-use`、`webbrowser`、本机浏览器打开命令和绕过 ZClaw bridge 的可疑路径。

## 你在本仓库的三种工作模式

### 模式 A：沉淀新任务（用户说"把 XX 任务固化/沉淀下来"，或任何 bridge 任务跑通之后主动触发）

**主动触发规则**：凡是通过 bridge 逐步跑通了一个有重复价值的任务（有数据产出/固定操作序列），在结束回合前必须按 ziniao-assistant skill 的沉淀流程（其 `references/flow-distill.md`）沉淀（或一句话提议后立即动手），不要等用户开口——跑通时的选择器、URL、踩坑经验只存在于当前会话，不写盘就会丢失。

1. 先用 ziniao-assistant skill 真机跑通任务（探索阶段允许逐步调用 bridge 工具，每个成功的 invoke 按 skill 约定追加到 `data/logs/traces/<日期>.jsonl`）。
2. 跑通后执行 `pnpm auto-ziniao new <flow_id> <中文名>` 创建脚手架。
3. 按 `docs/03-流程定义规范.md` 填写流程，硬性要求：
   - 声明 `params`（至少 `store_name`），不得硬编码店铺名/日期；
   - 提取 JS 外置到 `extracts/<名称>.js`，IIFE 包裹，`return JSON.stringify(...)`，禁用 JS 模板字符串 `` `${}` ``；
   - 关键提取步骤配 `validate`（防空数据假成功）；
   - 可能失败的步骤配 `on_fail`：瞬时问题（加载慢）用 `retry`，页面结构问题用 `heal` 并标注 `context` 错误类型；
   - 有状态差异的场景用 `branch` 写多分支（如已登录/未登录、有数据/无数据、已是目标状态）；
   - **必须**填写 `heal.hints`：页面入口、关键选择器、页面结构特征、已知坑——这是给未来自愈 Agent 的提示词素材。
4. 验收：`pnpm auto-ziniao validate <flow_id>` 通过 → `pnpm auto-ziniao run <flow_id> -v --no-heal` 真机跑通 → 检查 `data/output/` 产出正确。
5. 复杂流程可追加 `heal_templates/<flow_id>/<error_type>.md` 定制自愈提示词。

### 模式 B：自愈修复（你被 self-heal 的提示词唤起）

1. 读提示词中的失败上下文（`data/logs/heals/<heal_id>.json`）、流程定义、截图。
2. 通过 ZClaw bridge 复现诊断（截图/读 DOM/试选择器）。
3. 修复 `flows/<id>.json` 或 `extracts/*.js`（version +1），**不要**修改引擎代码来掩盖流程问题。
4. 验证：`pnpm auto-ziniao validate <id>` → `pnpm auto-ziniao run <id> -v --no-heal` 必须真实跑通。
5. 固化：把修复写入 `learnings/known_issues.json`（pattern 取错误信息中稳定子串，`resolved: true`）。
6. 通知用户：根因、修复内容、验证结果。

### 模式 C：日常操作（执行/排查）

- 执行：`pnpm auto-ziniao run <flow> [-p k=v]...`；重试：`pnpm auto-ziniao retry <flow>`。
- 排查：`pnpm auto-ziniao history` / `pnpm auto-ziniao heals` / `pnpm auto-ziniao stats`；bridge 日志用 `get_logs` 工具。
- WebAdmin：`pnpm api`（开发模式）或 `node apps/api/dist/index.js`（生产）。
- 多个同类子项（多种订单类型/报表）要逐个检查，不得从子集推断整体。

## 仓库地图

| 路径 | 作用 | 修改约束 |
|------|------|----------|
| `packages/cli/` | 生产 `auto-ziniao` CLI 入口 | 不得直接访问 bridge；命令编排只能 |
| `packages/zclaw/` | 唯一 ZClaw bridge 网络出口 | 白名单禁止动 |
| `packages/flow-engine/` | Flow Engine（加载/校验/执行） | 修流程问题时不要改它 |
| `packages/self-heal/` | 自愈触发器 | 模板尽量放文件，少改内置 |
| `packages/core/` | 共享基础工具 | 只允许无浏览器副作用能力 |
| `packages/schemas/` | 契约、运行时校验、JSON Schema 导出 | 不得执行 flow、不得调用 bridge |
| `apps/api/` | WebAdmin 后端 | 不得直接访问 bridge；托管 `apps/web/dist` |
| `apps/web/` | WebAdmin 前端 | 复用 `packages/schemas` API 类型 |
| `config.example.json` | 自愈 Agent CLI/冷却/告警示例 | 不得包含真实 token 或外部通知目标 |
| `config.json` | 本机配置（gitignore） | 用户级配置，改前确认 |
| `flows/*.json` | 沉淀的流程（`_template.json` 是模板） | 改后必须 validate + 真机验证 |
| `extracts/*.js` | 页面提取 JS | IIFE；禁模板字符串 |
| `heal_templates/` | 自愈提示词模板 | 可按流程加子目录定制 |
| `learnings/known_issues.json` | 已知问题库（0 tokens 修复路径） | 修复后必须回写 |
| `data/` | 运行时数据（logs/output/backups/webadmin.db） | 只读，勿手工编辑 |
| `scripts/` | 安全扫描等自动化脚本 | 不得绕过安全边界 |
| `docs/` | 架构与规范文档 | 架构变更需同步更新 |

## 通用约定

- 所有文档、注释、提示词使用中文。
- `list_stores` 只调一次拿数据，不要循环轮询；`open_store` 一次即可。
- 流程失败时引擎已自动处理自愈触发，不要在流程外再包一层重试脚本。
- 临时数据文件允许，**禁止创建额外的可执行脚本文件**来绕过引擎完成任务（与 ziniao-assistant skill 的约定一致）。
- 基线验证命令只能做静态解析、typecheck、单测和安全扫描；不得执行 `open_store`、`visit_page`、`execute_script` 或 `POST /zclaw/tools/invoke`。
- 仓库内不应存在 `.py` 源文件或 `requirements.txt`。
