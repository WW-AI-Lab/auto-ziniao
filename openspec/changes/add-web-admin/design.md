# Design: add-web-admin — 紫鸟自动化引擎极简 Web 管理界面

## Context

本项目是"紫鸟自动化引擎"：以 `flow_engine.py` 为核心，把紫鸟店铺操作沉淀为 0 tokens 可重复执行的 flow JSON，失败时由 `self_heal.py` 调用 Agent CLI 自愈。当前所有日常操作（模式 C：执行/排查）都通过 `manager.py` 命令行完成，调度依赖系统 crontab，与 Agent 的交互依赖 OpenClaw CLI / IDE。

现状约束：

- **最高安全规则**：所有浏览器操作只能经 `zclaw_client.py` → ZClaw bridge（`127.0.0.1:9481/zclaw/*`），路径白名单是硬约束。
- **引擎主体零第三方依赖**：`zclaw_client.py` / `flow_engine.py` / `self_heal.py` / `manager.py` 纯标准库。经用户确认，本变更允许 `webadmin/` 子工程引入成熟轻量框架，但引擎主体不受污染。
- **数据存储**：经用户确认，webadmin 自有数据存 SQLite；引擎既有 JSON/JSONL（`logs/runs.jsonl`、`learnings/*`、`flows/*.json`）保持原格式。
- **无登录**：单机单用户场景，安全边界靠仅监听 `127.0.0.1` 保证。
- `config.json` 已定义三个 agent CLI 命令模板（openclaw / claude / cursor-agent），占位符 `{prompt}` `{prompt_path}` `{session_key}` 等。

## Goals / Non-Goals

**Goals:**

- 一个本机 Web 管理界面，覆盖：flows 查看/编辑/校验/运行、独立计划任务管理、运行与自愈观测、产出浏览、与 Agent 对话（chat 使用 @ant-design/x 组件）。
- Python 后端用成熟轻量框架（FastAPI + uvicorn）保证稳定性与开发效率；自有数据存 SQLite。
- Agent 对话适配层同时支持 OpenClaw gateway（如可达）与 `config.json` 中的 agent CLI（subprocess），SSE 流式回包。
- 独立调度器（非 OpenClaw cron、非 crontab）：interval / daily / cron 三种触发，到点执行 flow，调度历史可查。
- 现有引擎代码与执行语义零修改；ZClaw 安全白名单链路不变。

**Non-Goals:**

- 不做登录/多用户/权限体系（仅回环监听）。
- 不做公网部署、HTTPS、反向代理适配。
- 不替换或迁移既有 crontab 调度与 `manager.py cron` 建议（并存）。
- 不在 Web 后台直接调用 ZClaw bridge（浏览器操作仍只走 flow_engine → zclaw_client 链路）。
- 不重写引擎日志/已知问题库为 SQLite（保持 JSON/JSONL，只读消费）。
- 不做 flow 的可视化拖拽编辑器（v1 提供 JSON 源码编辑 + validate）。

## Architecture Assessment

### Existing Design Reuse

| 现有资产 | 复用方式 |
|---------|---------|
| `flow_engine.py` | 以 Python import 方式复用：`run` / `validate` 的同等逻辑（经 subprocess 调 `python3 flow_engine.py run <id>` 执行，避免在 uvicorn 进程内阻塞与状态污染） |
| `manager.py` 的 list/history/stats 逻辑 | 读同样的数据源（`flows/*.json`、`logs/runs.jsonl`、`learnings/heals.jsonl`），webadmin 内重新实现为只读 API（逻辑简单，不值得为 CLI 输出做适配层） |
| `config.json` `heal.agents` | chat 适配层直接读取该配置作为可用 agent CLI 清单与命令模板，不新增重复配置 |
| `logs/` `output/` `learnings/` | 只读展示与文件下载，不写入 |
| 现有 `docs/` 规范 | flow 编辑器的 validate 防呆复用 `flow_engine.py validate` 同一校验实现 |

无法复用 `http.server` 方案：用户明确要求成熟框架，且 SSE/静态托管/参数校验在 FastAPI 中开发效率与稳定性显著更好。

### Boundaries and Ownership

```
浏览器(本机) ──HTTP/SSE──► webadmin (FastAPI, 127.0.0.1:9482)
                              │
        ┌─────────────────────┼──────────────────────┐
        ▼                     ▼                      ▼
   flows/*.json          scheduler 线程           chat 适配层
   logs/ output/       (SQLite: schedules)     ┌─ OpenClaw gateway (HTTP)
   learnings/(只读)           │                 └─ agent CLI (subprocess)
                              ▼
                    subprocess: python3 flow_engine.py run <id> -p k=v
                              │（既有链路，不变）
                              ▼
                    zclaw_client.py → ZClaw bridge(9481) → 紫鸟店铺浏览器
```

- `webadmin/` 拥有：SQLite 数据库（schedules、schedule_runs、chat_sessions、chat_messages）、自身 API/调度/聊天逻辑。
- 引擎拥有：flows、extracts、logs、output、learnings 的数据语义；webadmin 对 flows 是读写（编辑器），对其余目录只读。
- 失败/重试/自愈职责仍在引擎内（`flow_engine.py` 失败自动触发 `self_heal.py`）；webadmin **不**在外层再包重试（遵守 AGENTS.md 约定）。
- 并发：调度器对同一 flow 加进程内锁防重；手动运行与调度运行共用同一锁。chat 每会话串行（同一会话同时只允许一个进行中消息）。
- 超时：flow 子进程默认 30 分钟超时；agent CLI 超时取 `config.json` 中各 agent 的 `timeout_sec`。
- 资源释放：SSE 连接断开时不中断后端任务（flow/agent 继续跑完并落库），前端重连后可拉取历史。

### Options and Rationale

**后端框架**：FastAPI + uvicorn（选定）vs Flask vs Bottle。FastAPI 自带 pydantic 参数校验、原生 async 便于 SSE 流式与 subprocess 管理、生态成熟；Flask 需要额外组件做 SSE 与校验；Bottle 过于精简。依赖数可控（fastapi + uvicorn 两个直接依赖）。

**数据存储**：SQLite（用户指定）。标准库 `sqlite3` 即可驱动，无额外依赖；WAL 模式支持调度线程与 API 线程并发读写。不引入 ORM（SQLAlchemy 等）——表只有 4 张、查询简单，手写 SQL + 轻量 DAO 足够，减少依赖面。

**flow 执行方式**：subprocess（选定）vs 进程内 import 调用。subprocess 隔离性好（flow 卡死不拖垮 web 服务）、与 cron/手工执行路径完全一致（日志、自愈触发行为相同）；进程内调用虽省一次进程开销，但 `flow_engine.py` 是为 CLI 设计的同步阻塞代码，在 async 服务内调用需要线程池包装且共享全局状态有风险。

**chat 对接**：适配器模式，两个实现——`OpenClawGatewayAdapter`（OpenClaw gateway 的本地 HTTP API，能流式则流式）与 `CliAgentAdapter`（按 `config.json` agents 命令模板 subprocess 调用，整段返回后模拟分块下发）。默认探测 gateway 可达性，不可达回退 CLI；前端可手动选择 agent。理由：用户要求"对接 OpenClaw gateway 或其他 agent cli"，两者接口差异大，适配器统一为 `send(session, message) -> 流式事件` 协议。

**调度器**：自研轻量线程调度器（选定）vs APScheduler。自研：单线程 tick（每 30s 扫描 SQLite 中启用任务，计算 next_run_at，到点提交执行）；逻辑 < 200 行，无额外依赖，行为可控可测。APScheduler 功能过剩且引入持久化 jobstore 概念与 SQLite 表设计冲突。cron 表达式解析自实现五字段子集（分 时 日 月 周，支持 `*` `*/n` `a-b` `a,b`），不支持的写法 validate 时报错。

**前端**：Vite + React + TypeScript + antd v5 + @ant-design/x（选定）。chat 页用 @ant-design/x 的 `Bubble`、`Sender`、`Conversations`、`useXAgent`/`useXChat` 等组件（用户指定）；管理页用 antd Table/Form/Modal；JSON 编辑用 `@monaco-editor/react`（或退化为 antd Input.TextArea + 格式化校验，构建体积优先时再决策）。构建产物 `webadmin/frontend/dist/` 由 FastAPI `StaticFiles` 托管，运行期零 Node。

### Quality Attributes

- **安全**：uvicorn 显式绑定 `127.0.0.1`；不开启 CORS 通配；文件下载 API 做路径规范化校验（只允许 `output/` `logs/` 白名单根目录内，拒绝 `..` 穿越）；webadmin 全程不直接发起对 ZClaw bridge 的请求。
- **可靠性**：调度器线程崩溃自动重启（守护循环包 try/except + 告警日志）；SQLite WAL + busy_timeout；flow 子进程超时强杀并记失败。
- **可观测性**：webadmin 自身日志写 `logs/webadmin.log`（标准 logging，轮转）；调度历史落 SQLite 可在前端查看。
- **可测试性**：调度计算（next_run_at、cron 解析）、chat 适配层、路径校验为纯函数/独立模块，配 pytest 单测；API 层用 FastAPI TestClient。
- **可部署性**：`webadmin/requirements.txt` + `python3 -m webadmin`（或 `manager.py web`）一键启动；前端构建产物入库，用户无需装 Node。

### Complexity and Exceptions

新增项及其必要性：

- **新依赖 fastapi/uvicorn（仅 webadmin 子工程）**：用户明确要求成熟框架。控制方式：依赖只写入 `webadmin/requirements.txt`，引擎主体四个模块不 import webadmin 任何内容；验证方式：在未安装 webadmin 依赖的环境跑 `python3 manager.py list` 仍正常；回滚方式：删除 `webadmin/` 目录即可完全移除，引擎不受影响。
- **新存储 SQLite**：用户指定。仅存 webadmin 自有数据，不迁移引擎数据；回滚删库即可。
- **新协议 SSE**：chat 流式与运行日志跟踪需要；FastAPI 原生支持，复杂度低。
- **前端 Node 子工程**：实现 @ant-design/x 聊天界面的唯一合理路径；构建产物入库使运行期零 Node。

## Decisions

1. **FastAPI + uvicorn 作为后端框架**。替代：Flask（SSE/校验需额外组件）、Bottle（过简）、继续 http.server（用户已否决）。
2. **SQLite 单库四表**（`schedules` / `schedule_runs` / `chat_sessions` / `chat_messages`），标准库 sqlite3 + 手写 SQL，不用 ORM。替代：JSON 文件（用户已否决）、SQLAlchemy（依赖过重）。
3. **flow 执行走 subprocess 调 `flow_engine.py`**，与 cron/手工路径一致，自愈行为不变。替代：进程内 import（隔离差、阻塞 async loop）。
4. **chat 适配器双实现 + 自动探测回退**：OpenClaw gateway 优先，不可达回退 `config.json` agents CLI。替代：只做 CLI（丢失 gateway 流式体验）、只做 gateway（用户环境可能未开 gateway）。
5. **自研线程调度器 + 五字段 cron 子集**。替代：APScheduler（依赖+概念过重）、系统 crontab（无法网页管理、与"独立计划任务"需求不符）。
6. **前端构建产物入库**（`webadmin/frontend/dist/` 提交到仓库）。替代：要求用户本地 npm build（提高使用门槛，违背"极简"目标）。
7. **端口默认 `127.0.0.1:9482`**，与 ZClaw bridge 的 9481 相邻但不冲突，可通过 `config.json` 新增 `webadmin.port` 覆盖。

## Risks / Trade-offs

- [无登录 + 本机端口] -> 仅绑定 127.0.0.1，文档明确警告不得改绑 0.0.0.0；API 不提供任意路径文件读取。
- [flow 编辑器误存坏 JSON 破坏既有流程] -> 保存前强制 `flow_engine.py validate`，失败拒绝写入；保存时自动备份原文件至 `flows/.backup/<id>.<ts>.json`（保留最近 5 份）。
- [调度与 crontab 双调度导致同一 flow 并发执行] -> 调度器层 flow 级锁只能防 webadmin 内部并发；文档要求用户对接入 webadmin 调度的 flow 移除 crontab 条目（无法技术强制，记入 README 注意事项）。
- [OpenClaw gateway API 形态不确定（版本差异）] -> 适配器隔离 + 探测失败自动回退 CLI；gateway 适配实现放在实施阶段先做接口探测（Open Question 1）。
- [agent CLI 长耗时阻塞] -> asyncio subprocess + 超时；SSE 心跳防代理断连；同会话串行防止并发 CLI 进程堆积。
- [前端 dist 入库导致仓库膨胀] -> 锁定依赖、关闭 sourcemap、单次构建产物约 1-2 MB，可接受；后续若膨胀改为 release 附件分发。
- [uvicorn/fastapi 与未来 Python 版本兼容] -> requirements.txt 锁定已验证版本范围。

## Migration Plan

纯新增，无数据迁移。

1. 实施合入后：`pip install -r webadmin/requirements.txt`（建议 venv），`python3 -m webadmin` 启动，浏览器访问 `http://127.0.0.1:9482`。
2. SQLite 库首次启动自动建表（schema 版本号存 `meta` 表，便于后续演进）。
3. 回滚：停止 webadmin 进程并删除 `webadmin/` 目录；引擎、flows、日志完全不受影响。

## Open Questions

1. OpenClaw gateway 本地 HTTP API 的具体端点与鉴权方式需在实施第一步真机探测（`openclaw` CLI 版本相关）；探测结论写入适配器实现。若 gateway 无可用 HTTP API，则 OpenClaw 也走 CLI 适配器（`config.json` 已有命令模板），不影响整体设计。
2. JSON 编辑器选 monaco（约 +3 MB 构建体积）还是轻量 textarea + 校验，在前端实施时按体积实测决定；spec 只约束"可编辑 + 保存前校验"。
