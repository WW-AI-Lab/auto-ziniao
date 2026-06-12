# run-monitoring — 运行观测

## ADDED Requirements

### Requirement: 运行历史查询
系统 SHALL 提供运行历史 API，数据源为 `logs/runs.jsonl`（只读），支持按 flow_id 过滤与分页（倒序）。每条记录至少呈现：flow_id、开始时间、耗时、状态、参数、失败步骤与错误摘要（如有）。

#### Scenario: 查询全部运行历史
- **WHEN** 客户端请求 `GET /api/runs?limit=50`
- **THEN** 返回最近 50 条运行记录，倒序排列

#### Scenario: 按流程过滤
- **WHEN** 客户端请求 `GET /api/runs?flow_id=account_health`
- **THEN** 仅返回该流程的运行记录

### Requirement: 自愈记录查询
系统 SHALL 提供自愈记录 API：列表数据源为 `learnings/heals.jsonl`（只读）；详情 SHALL 可读取 `logs/heals/<heal_id>.json` 的失败上下文与对应提示词 MD。系统 SHALL 同时提供 `learnings/known_issues.json` 的只读查看 API。

#### Scenario: 查看自愈事件列表
- **WHEN** 客户端请求 `GET /api/heals`
- **THEN** 返回自愈触发/跳过事件流，含 flow_id、时间、错误类型、处理结果

#### Scenario: 查看自愈详情
- **WHEN** 客户端请求 `GET /api/heals/<heal_id>`
- **THEN** 返回该次自愈的失败上下文 JSON 与完整提示词内容

### Requirement: 统计概览
系统 SHALL 提供统计 API（口径与 `manager.py stats` 一致）：各 flow 的运行次数、成功率、最近运行时间、自愈触发次数，以及计划任务总数/启用数等 webadmin 自有统计。

#### Scenario: 首页概览
- **WHEN** 客户端请求 `GET /api/stats`
- **THEN** 返回各流程成功率、最近运行、自愈次数与计划任务概况，供前端仪表盘渲染

### Requirement: 产出文件浏览与下载
系统 SHALL 提供 `output/` 目录的文件树浏览 API 与单文件下载 API（路径安全校验遵循 web-admin-server 的要求）。对 CSV/JSON 文本文件 SHALL 支持在线预览（限制返回大小，超限提示下载）。

#### Scenario: 浏览产出目录
- **WHEN** 客户端请求 `GET /api/outputs?path=orders`
- **THEN** 返回该子目录下文件列表（名称、大小、修改时间）

#### Scenario: 预览 CSV 产出
- **WHEN** 客户端请求预览一个 200 KB 的 CSV 文件
- **THEN** 返回文件内容供前端表格化展示

#### Scenario: 大文件提示下载
- **WHEN** 预览请求的文件超过预览大小上限（如 2 MB）
- **THEN** 返回超限提示，客户端改用下载 API 获取完整文件
