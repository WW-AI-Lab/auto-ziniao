# web-admin-server — 本机 Web 服务

## ADDED Requirements

### Requirement: 服务仅监听本机回环地址
webadmin 服务 SHALL 基于 FastAPI + uvicorn 实现，且 MUST 仅绑定 `127.0.0.1`（默认端口 9482，可经 `config.json` 的 `webadmin.port` 覆盖）。服务 MUST NOT 提供绑定 `0.0.0.0` 的配置开关。

#### Scenario: 默认启动
- **WHEN** 用户执行 `python3 -m webadmin` 启动服务
- **THEN** 服务监听 `127.0.0.1:9482`，本机浏览器可访问，局域网内其他主机不可访问

#### Scenario: 自定义端口
- **WHEN** `config.json` 中配置了 `webadmin.port: 9500` 并启动服务
- **THEN** 服务监听 `127.0.0.1:9500`

### Requirement: 静态前端托管与 SPA 回退
服务 SHALL 托管 `webadmin/frontend/dist/` 下的前端构建产物，并对非 `/api/` 前缀的未知路径返回 `index.html`（SPA history 路由回退）。

#### Scenario: 访问根路径
- **WHEN** 浏览器访问 `http://127.0.0.1:9482/`
- **THEN** 返回前端 `index.html`，页面正常加载

#### Scenario: 前端路由深链接
- **WHEN** 浏览器直接访问 `http://127.0.0.1:9482/flows/orders_overview`
- **THEN** 返回 `index.html`，由前端路由渲染对应页面

### Requirement: 统一 API 约定与错误响应
所有 API SHALL 以 `/api/` 为前缀，请求/响应均为 JSON（SSE 端点除外）。错误响应 MUST 使用统一结构 `{"error": {"code": <string>, "message": <string>}}` 并配合正确的 HTTP 状态码（400 参数错误 / 404 不存在 / 409 冲突 / 500 内部错误）。

#### Scenario: 资源不存在
- **WHEN** 客户端请求 `GET /api/flows/not_exist`
- **THEN** 返回 HTTP 404，body 为 `{"error": {"code": "not_found", "message": ...}}`

#### Scenario: 参数校验失败
- **WHEN** 客户端创建计划任务时缺少必填字段
- **THEN** 返回 HTTP 400 或 422，body 含可读的中文错误信息

### Requirement: 文件访问路径安全校验
所有按路径读取/下载文件的 API MUST 将请求路径规范化后校验其位于允许的根目录（`output/`、`logs/`、`flows/`、`extracts/`）之内，拒绝包含 `..` 或解析后越界的路径。

#### Scenario: 路径穿越攻击
- **WHEN** 客户端请求 `GET /api/files/download?path=../../etc/passwd`
- **THEN** 返回 HTTP 400，不读取任何白名单外文件

### Requirement: webadmin 不直接访问 ZClaw bridge
webadmin 进程 MUST NOT 直接向 ZClaw bridge（`127.0.0.1:9481`）发起任何请求；所有浏览器相关操作 MUST 通过既有链路（subprocess 调用 `flow_engine.py`，其内部经 `zclaw_client.py`）完成。

#### Scenario: 代码审查约束
- **WHEN** 审查 `webadmin/` 代码
- **THEN** 不存在对 `9481` 端口或 `/zclaw/` 路径的直接 HTTP 调用

### Requirement: 引擎主体零依赖不受污染
引擎主体（`zclaw_client.py`、`flow_engine.py`、`self_heal.py`、`manager.py`）MUST NOT import `webadmin` 包或其第三方依赖；webadmin 依赖 SHALL 独立维护在 `webadmin/requirements.txt`。

#### Scenario: 未安装 webadmin 依赖的环境
- **WHEN** 在未执行 `pip install -r webadmin/requirements.txt` 的环境运行 `python3 manager.py list`
- **THEN** 命令正常工作，无 ImportError
