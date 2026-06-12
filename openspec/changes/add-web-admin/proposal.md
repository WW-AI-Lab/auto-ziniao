# Proposal: add-web-admin — 紫鸟自动化引擎极简 Web 管理界面

## Why

目前本项目（紫鸟 OpenClaw 自动化引擎）的所有操作都依赖命令行：执行流程要 `manager.py run`，查看历史要 `manager.py history`，调度依赖系统 crontab，与 Agent 的交互要通过 OpenClaw CLI 或 IDE。这对非终端用户不友好，也无法集中查看流程、运行记录、自愈情况和产出。

需要一个极简的 Web 前后端管理界面，把"执行流程 / 管理流程 JSON / 计划任务 / 与 Agent 对话"集中到一个本机页面里，使紫鸟店铺自动化任务的日常操作（模式 C）不再依赖终端。

## What Changes

- **新增 Python Web 后台**（`webadmin/` 子工程）：引入成熟轻量 Web 框架（FastAPI + uvicorn，具体选型理由见 design.md）实现 REST API、SSE 与静态资源服务，仅监听 `127.0.0.1`（无登录，靠本机回环保证安全边界）。
- **新增 Agent 对话后端**：对接 OpenClaw gateway（HTTP）或 `config.json` 中已配置的 agent CLI（openclaw / claude / cursor-agent），提供会话式 chat API（SSE 流式输出），供前端聊天界面使用。
- **新增独立计划任务管理**：自有调度器（非 OpenClaw cron、非系统 crontab），支持 interval / 每日定时 / cron 表达式三种触发方式，任务定义持久化到 SQLite，到点调用 `flow_engine` 执行 flow，并记录调度历史。
- **新增 flows 查看与管理 API**：列出 / 查看 / 编辑（标准 JSON）/ 校验（复用 `manager.py validate` 逻辑）/ 手动运行 / 查看运行历史、自愈记录、统计与 `output/` 产出。
- **新增前端单页应用**（`webadmin/frontend/`，React + Vite + antd，chat 部分使用 `@ant-design/x` 组件）：流程列表与 JSON 编辑器、计划任务管理、运行/自愈/产出查看、Agent 聊天页。构建产物（`dist/`）由 Python 后台直接静态托管，运行期零 Node 依赖。
- **不修改**现有引擎代码的执行语义：`flow_engine.py`、`zclaw_client.py`、`self_heal.py` 保持原样被复用；ZClaw bridge 白名单安全规则不受影响（Web 后台不直接碰浏览器，所有浏览器操作仍走既有引擎链路）。

## Capabilities

### New Capabilities

（`openspec/specs/` 当前为空，以下均为新增）

- `web-admin-server`: 本机 Web 服务——标准库 HTTP server、REST API 框架约定、静态资源托管、仅回环监听、统一错误响应。
- `agent-chat`: Agent 对话能力——会话管理、消息发送、对接 OpenClaw gateway 或 agent CLI 的适配层、SSE 流式回包、会话历史持久化。
- `task-scheduler`: 独立计划任务——任务 CRUD、三种触发方式（interval / daily / cron）、启用停用、到点执行 flow、调度历史与并发防重。
- `flow-management`: 流程管理——flows 列表/详情/JSON 编辑保存（带 validate 防呆）/手动运行（带参数）/extracts 关联查看。
- `run-monitoring`: 运行观测——运行历史（logs/runs.jsonl）、自愈记录（learnings/heals.jsonl、logs/heals/）、统计、output 产出文件浏览与下载。
- `admin-frontend`: 前端界面——SPA 页面结构、各功能页交互要求、chat 页使用 @ant-design/x 组件、无登录。

### Modified Capabilities

（无——现有引擎行为不变，仅被新模块调用）

## Architecture Impact

- **复用现有模块**：`flow_engine.py`（运行/校验 flow）、`config.json`（heal.agents 的 CLI 命令模板直接复用为 chat agent 配置来源）、`logs/runs.jsonl`、`learnings/*`、`output/`（只读展示）。Web 后台是现有三态闭环之上的"操作面板"，不引入新的执行路径。
- **零第三方依赖约束的边界扩展**：经用户确认，`webadmin/` 后台作为独立子工程引入成熟轻量框架（FastAPI + uvicorn），用独立 `requirements.txt` 管理，**不污染**引擎主体——`zclaw_client.py` / `flow_engine.py` / `self_heal.py` / `manager.py` 仍保持纯标准库，可在无 webadmin 依赖的环境下独立运行。前端是独立 Node 子工程（仅构建期需要 npm），构建产物由后台托管，运行期不需要 Node。需在 design.md 说明隔离方式。
- **安全边界**：无登录 ⇒ 必须仅监听 `127.0.0.1`；后台不得新增任何直接访问浏览器的网络出口，所有浏览器操作仍只经 `zclaw_client.py` 白名单通道。
- **调度并存**：新调度器与既有 crontab 建议（`manager.py cron`）并存，互不接管；同一 flow 的并发执行需防重（引擎层无锁，调度器层加锁）。
- **新增数据存储**：webadmin 自有数据（计划任务定义、调度历史、chat 会话与消息）统一存入 SQLite（`webadmin/data/webadmin.db`，标准库 `sqlite3`）；引擎既有的 JSON/JSONL 文件（`logs/runs.jsonl`、`learnings/*`、`flows/*.json`）保持原格式只读/读写访问，不迁移。

## Impact

- 新增代码：`webadmin/`（FastAPI 应用：api/scheduler/chat/storage 模块 + `requirements.txt`）、`webadmin/frontend/`（React 子工程及 `dist/` 构建产物）。
- 修改：`README.md` / `docs/`（新增 Web 管理界面使用说明）；`manager.py` 可选增加 `web` 子命令启动后台。
- 不修改：`zclaw_client.py`、`flow_engine.py`、`self_heal.py`、`flows/*.json`、`extracts/*.js`。
- 新依赖：Python 侧仅 webadmin 子工程（fastapi、uvicorn，独立 `requirements.txt`）；前端构建期（react、antd、@ant-design/x、vite）。引擎主体保持零依赖。
- 系统影响：本机新增一个监听端口（默认 `127.0.0.1:9482`，避开 ZClaw bridge 的 9481）。
