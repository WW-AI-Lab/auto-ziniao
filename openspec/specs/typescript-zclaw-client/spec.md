# typescript-zclaw-client Specification

## Purpose
TBD - created by archiving change add-typescript-zclaw-client. Update Purpose after archive.
## Requirements
### Requirement: ZClaw client configuration
系统 SHALL 提供 TypeScript ZClaw client 配置读取能力。默认 base URL MUST 为 `http://127.0.0.1:9481`；API key MUST 优先读取环境变量 `ZCLAW_API_KEY`，其次读取 `~/.zclaw/config.json` 中的 `ZCLAW_API_KEY`；base URL MAY 从 `ZCLAW_BASE_URL` 或配置文件读取，但最终请求仍 MUST 只允许 `/zclaw/*` path。配置错误或 API key 缺失 MUST 以结构化错误报告，错误信息 MUST NOT 包含真实 key 值。

#### Scenario: 环境变量优先
- **WHEN** 环境变量 `ZCLAW_API_KEY` 与 `~/.zclaw/config.json` 同时存在不同值
- **THEN** client 使用环境变量中的 key，并且不会在日志或错误信息中输出该 key

#### Scenario: API key 缺失
- **WHEN** 用户创建 invoke-capable client 且环境变量与配置文件都没有 API key
- **THEN** 系统抛出结构化配置错误，提示设置 `ZCLAW_API_KEY` 或 `~/.zclaw/config.json`

### Requirement: ZClaw endpoint whitelist
系统 SHALL 在 TypeScript ZClaw client 的底层 request helper 中强制路径白名单。该 helper MUST 在拼接 base URL 与发送 HTTP 请求之前拒绝任何不以 `/zclaw/` 开头的 path。默认允许的 bridge HTTP 行为 MUST 限定为 `GET /zclaw/tools` 与 `POST /zclaw/tools/invoke`；不得提供访问任意 URL 或任意本机浏览器的 fallback。

#### Scenario: 拒绝非 ZClaw path
- **WHEN** 调用底层 request helper 访问 `/api/debug`、`http://example.com` 或空 path
- **THEN** 请求不会发出，并返回 `zclaw_path_forbidden` 类型错误

#### Scenario: 工具发现 path
- **WHEN** 用户调用 `getTools()`
- **THEN** client 只发送 `GET /zclaw/tools`，并将响应中的工具对象解析为工具名列表或工具描述列表

#### Scenario: 工具调用 path
- **WHEN** 用户调用 `invoke("list_stores", {"all": true})`
- **THEN** client 只发送 `POST /zclaw/tools/invoke`，请求 body 包含 `tool` 与 `args`

### Requirement: ZClaw invoke and wrappers
系统 SHALL 提供 `invoke(tool, args, timeoutMs)` 与最小高级封装：`listStores()`、`openStore()`、`closeStore()`、`visit()`、`executeScript()`、`screenshot()`、`click()`、`waitElement()`。所有高级封装 MUST 最终调用 `invoke()`，并 MUST 使用 `packages/schemas` 中已定义的 ZClaw 工具名。`invoke()` MUST 自动注入 client 上的 `storeId` 与 `targetId`，但 MUST NOT 覆盖调用方显式传入的 `args.storeId` 或 `args.targetId`。

#### Scenario: 自动注入 storeId 和 targetId
- **WHEN** client 已设置 `storeId: "s1"` 与 `targetId: "t1"`，并调用 `invoke("execute_script", {"script": "return 1"})`
- **THEN** 发送给 bridge 的 `args` 包含 `storeId: "s1"` 与 `targetId: "t1"`

#### Scenario: 显式参数不被覆盖
- **WHEN** client 已设置 `storeId: "s1"`，但调用 `invoke("close_store", {"storeId": "s2"})`
- **THEN** 发送给 bridge 的 `args.storeId` 仍为 `"s2"`

#### Scenario: openStore 更新 client 状态
- **WHEN** `openStore()` 收到 bridge 返回数据中包含 `storeId`
- **THEN** client 后续调用默认使用该 `storeId`

#### Scenario: wrapper 映射到合法工具
- **WHEN** 调用 `visit()`、`executeScript()`、`screenshot()`、`click()` 或 `waitElement()`
- **THEN** 它们分别映射到 `visit_page`、`execute_script`、`take_screenshot`、`click_element`、`wait_for_element`，且不会使用 `navigate`、`open_url`、`run_script` 或 `screenshot` 等臆造工具名

### Requirement: ZClaw error handling
系统 SHALL 为 TS ZClaw client 提供结构化错误分类。错误 MUST 至少覆盖：`zclaw_config_missing`、`zclaw_path_forbidden`、`zclaw_bridge_unavailable`、`zclaw_http_error`、`zclaw_response_error`、`zclaw_tool_error`、`zclaw_timeout`。错误对象 MUST 可携带 `tool`、HTTP status、bridge 原始响应摘要或 cause，但 MUST NOT 暴露 API key。

#### Scenario: bridge 不可达
- **WHEN** 本地 bridge 连接拒绝或 DNS/网络层失败
- **THEN** client 抛出 `zclaw_bridge_unavailable`，并且不会建议改用本机浏览器

#### Scenario: bridge 返回 ret 非 0
- **WHEN** `POST /zclaw/tools/invoke` 返回 JSON 中 `ret` 不为 `0`
- **THEN** client 抛出 `zclaw_response_error`，错误中包含 tool 名和响应摘要

#### Scenario: 工具返回 ok false
- **WHEN** invoke 响应的 `data.ok` 为 `false`
- **THEN** client 抛出 `zclaw_tool_error`，错误中包含 tool 名和工具错误摘要

#### Scenario: 请求超时
- **WHEN** 请求超过调用方提供的 `timeoutMs`
- **THEN** client 通过 `AbortController` 取消请求并抛出 `zclaw_timeout`

### Requirement: Offline validation for ZClaw client
系统 SHALL 使用离线测试验证 TS ZClaw client。默认 test/build/typecheck/baseline 命令 MUST NOT 要求紫鸟客户端在线，MUST NOT 调用真实 `POST /zclaw/tools/invoke`，MUST NOT 打开店铺浏览器或本机浏览器。

#### Scenario: baseline 离线通过
- **WHEN** 用户在未启动紫鸟客户端的环境中执行 `pnpm validate:baseline`
- **THEN** ZClaw client 的单测使用 mock fetch 或测试 server 完成，不连接真实 `127.0.0.1:9481`

#### Scenario: 禁止浏览器自动化依赖
- **WHEN** `packages/zclaw` 或其测试新增 `playwright`、`selenium`、`puppeteer`、`browser-use` 或本机浏览器打开命令
- **THEN** 安全扫描失败，并提示浏览器操作只能通过 ZClaw bridge

