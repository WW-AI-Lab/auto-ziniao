# flow-management — 流程管理

## ADDED Requirements

### Requirement: flows 列表与详情
系统 SHALL 提供 flows 列表 API（读取 `flows/*.json`，排除 `_template.json`），返回每个 flow 的 id、名称、版本、参数声明、schedule 字段与最近一次运行状态（关联 `logs/runs.jsonl`）。详情 API SHALL 返回完整 flow JSON 原文，并列出其引用的 `extracts/*.js` 文件内容（只读）。

#### Scenario: 列出全部流程
- **WHEN** 客户端请求 `GET /api/flows`
- **THEN** 返回所有沉淀流程的摘要列表，不包含 `_template.json`

#### Scenario: 查看流程详情与关联提取脚本
- **WHEN** 客户端请求 `GET /api/flows/orders_overview`
- **THEN** 返回完整 JSON 定义，以及该流程步骤中 `@extracts/xxx.js` 引用对应的脚本内容

### Requirement: flow JSON 编辑保存（带校验防呆）
系统 SHALL 提供 flow JSON 的保存 API。保存前 MUST 依次通过：JSON 语法解析、`flow_engine.py validate` 同等校验；任一失败 MUST 拒绝写入并返回具体错误。保存成功 MUST 先将原文件备份至 `flows/.backup/<flow_id>.<timestamp>.json`（每个 flow 保留最近 5 份），再写入新内容。

#### Scenario: 保存合法修改
- **WHEN** 客户端提交通过校验的 flow JSON
- **THEN** 原文件已备份，新内容写入 `flows/<id>.json`，响应返回成功

#### Scenario: 保存非法 JSON
- **WHEN** 提交的内容无法通过 JSON 解析或 validate 校验
- **THEN** 返回 HTTP 400 与具体校验错误，原文件保持不变

### Requirement: 手动运行 flow
系统 SHALL 提供手动运行 API：`POST /api/flows/<id>/run`，body 可携带参数键值对（对应 CLI `-p k=v`）。运行 MUST 经 subprocess 调用 `python3 flow_engine.py run`，与调度器共用同一 flow 级锁。API SHALL 立即返回运行受理标识，运行状态与输出 SHALL 可经后续 API 查询（或经 SSE 跟踪实时日志）。

#### Scenario: 带参数运行
- **WHEN** 客户端 `POST /api/flows/orders_overview/run`，body 为 `{"params": {"store_name": "某店铺"}}`
- **THEN** 子进程以 `-p store_name=某店铺` 启动，客户端可凭受理标识查询运行状态直至结束

#### Scenario: 重复运行被锁拒绝
- **WHEN** 同一 flow 已在运行中时再次请求运行
- **THEN** 返回 HTTP 409，提示运行中

#### Scenario: 运行失败不重复包装重试
- **WHEN** 手动运行的 flow 失败
- **THEN** webadmin 不在引擎外追加重试；自愈由引擎内部既有机制处理，API 如实返回失败状态
