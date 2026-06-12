# Tasks: add-web-admin

## 1. 探测与脚手架

- [x] 1.1 真机探测 OpenClaw gateway 本地 HTTP API（端点、鉴权、是否支持流式），结论记录到 `openspec/changes/add-web-admin/notes-gateway.md`（决定 OpenClawGatewayAdapter 的实现方式或确认回退 CLI）
- [x] 1.2 创建 `webadmin/` 包骨架（`__main__.py`、`app.py`、`requirements.txt` 锁定 fastapi/uvicorn 版本）与 `webadmin/frontend/` Vite + React + TypeScript 脚手架（含 antd、@ant-design/x 依赖）
- [x] 1.3 实现 SQLite 存储层 `webadmin/storage.py`：建库建表（`meta`/`schedules`/`schedule_runs`/`chat_sessions`/`chat_messages`，WAL + busy_timeout）、schema 版本号、轻量 DAO
- [x] 1.4 实现服务入口：uvicorn 仅绑定 `127.0.0.1`，端口读 `config.json` 的 `webadmin.port`（默认 9482）；统一错误响应结构与日志（`logs/webadmin.log` 轮转）

## 2. 后端 API — flows 与观测

- [x] 2.1 实现路径安全校验工具（规范化 + 白名单根目录 `output/` `logs/` `flows/` `extracts/`，拒绝越界）及其单测
- [x] 2.2 实现 flows API：列表（排除 `_template.json`，关联 `logs/runs.jsonl` 最近状态）、详情（含 `@extracts/*.js` 引用内容）
- [x] 2.3 实现 flow 保存 API：JSON 解析 → 复用 `flow_engine.validate_flow` 同一校验实现（进程内 import，纯函数无副作用；比 subprocess 方案可校验未落盘内容）→ 备份至 `flows/.backup/`（保留 5 份）→ 写入；校验失败拒绝写入并返回具体错误
- [x] 2.4 实现 flow 手动运行 API：subprocess 调 `python3 flow_engine.py run <id> -p k=v`，flow 级进程内锁、30 分钟超时、受理标识 + 状态查询
- [x] 2.5 实现观测 API：运行历史（`logs/runs.jsonl` 倒序分页/按 flow 过滤）、自愈列表与详情（`learnings/heals.jsonl` + `logs/heals/`）、known_issues 只读、stats 概览（口径对齐 `manager.py stats`）
- [x] 2.6 实现 output 浏览/预览/下载 API（预览大小上限 2 MB，超限提示下载）

## 3. 后端 API — 计划任务调度

- [x] 3.1 实现触发计算模块 `webadmin/scheduler/triggers.py`：interval / daily / cron 五字段子集（`*` `*/n` `a-b` `a,b`）的 next_run_at 计算与配置校验，配 pytest 单测（含边界：月末、跨日、非法表达式）
- [x] 3.2 实现 schedules CRUD API：创建/列表/详情/修改/删除/启用停用，校验 flow_id 存在与触发配置合法
- [x] 3.3 实现调度器线程：≤30s tick 扫描启用任务、到点 subprocess 执行 flow（与 2.4 共用 flow 锁）、错过不补跑、线程异常自动恢复
- [x] 3.4 实现调度历史：每次触发（success/failed/timeout/skipped）写 `schedule_runs`，提供按任务分页查询 API

## 4. 后端 API — Agent 对话

- [x] 4.1 实现 chat 适配层：统一 `send(session, message) -> 事件流` 协议；`CliAgentAdapter`（asyncio subprocess，命令模板/超时取 `config.json` `heal.agents`，chat 场景去投递）；`OpenClawGatewayAdapter`（按 1.1 探测结论实现 /v1/chat/completions SSE，含可达性探测与自动回退 CLI）
- [x] 4.2 实现会话 API：sessions CRUD 与历史消息查询，落 SQLite
- [x] 4.3 实现消息发送 API（SSE）：增量/完成/错误三类事件 + 心跳；同会话串行（进行中再发返回 409）；客户端断开不中断任务，回复照常落库；可用 agent 清单 API（来源 `config.json`）

## 5. 前端实现

- [ ] 5.1 搭建 SPA 框架：antd 布局 + 侧边导航 + react-router（五页面：概览/流程/计划任务/运行与自愈/对话），dev 模式 proxy 到 9482，构建产物输出 `webadmin/frontend/dist/`
- [ ] 5.2 概览页：调用 `/api/stats` 渲染各 flow 成功率、最近运行、自愈次数、计划任务概况
- [ ] 5.3 流程管理页：列表、JSON 编辑器（按 design 决策实测体积后选 monaco 或 textarea+校验）、保存错误展示、extracts 只读查看、按 `params` 声明自动生成参数表单的运行对话框与运行状态跟踪
- [ ] 5.4 计划任务页：任务 CRUD 表单（三种触发方式、cron 语法说明）、启用停用、下次运行时间与最近结果展示、调度历史展开
- [ ] 5.5 运行与自愈记录页：运行历史（过滤/分页）、自愈详情抽屉（失败上下文+提示词）、known_issues 列表、output 目录树 + CSV/JSON 预览与下载
- [ ] 5.6 Agent 对话页：@ant-design/x 的 `Conversations`/`Bubble`/`Sender` + `useXAgent`/`useXChat` 接 SSE；会话新建/切换/删除、agent 选择、流式渲染、失败状态、历史加载
- [ ] 5.7 执行生产构建并将 `dist/` 提交入库；后端接通静态托管与 SPA 回退路由

## 6. Architecture Verification

- [x] 6.1 安全验证：netstat 确认仅监听 `127.0.0.1.9482`，经局域网 IP（192.168.163.24:9482）访问连接失败；路径穿越用例（`../../etc/passwd`、编码变体）返回 400；静态检查 `webadmin/` 源码无对 `9481`/`/zclaw/` 的直接调用
- [x] 6.2 隔离验证：系统 python3（无 fastapi）运行 `manager.py list` 与 `flow_engine.py validate` 正常；引擎四个主模块无 `import webadmin`
- [x] 6.3 并发与一致性验证：自测 flow 运行中再次发起运行返回 409；保存非法 JSON 返回 400 且原文件 md5 不变；连续保存 6 次备份仅保留 5 份
- [x] 6.4 chat 链路集成验证：gateway 端点未启用（404）→ 自动回退 CLI，真实消息「收到」成功返回并落库；CLI 超时/非零退出/命令缺失用例下发 error 事件且子进程被终止（pytest 覆盖）；SSE 客户端 2 秒断线后回复仍完整落库。（gateway 可达场景因本机端点默认关闭且不擅自修改用户 `openclaw.json` 未实测，适配器已按探测结论实现，启用配置后自动切换）
- [x] 6.5 调度端到端验证：1 分钟 interval 任务真实触发 2 次（success，~10s 耗时），调度历史正确；停服 2 分钟重启后 next_run_at 重算为未来时间、错过触发不补跑
- [ ] 6.6 回滚验证：停止服务并删除 `webadmin/` 后，引擎 CLI 全功能正常（list/run/validate/history）
- [x] 6.7 文档同步：README 增加 Web 管理界面章节（安装、启动、端口、"勿改绑 0.0.0.0"与"接入调度的 flow 移除 crontab 条目"警告）；`docs/02-架构设计.md` 增补 webadmin 模块图

