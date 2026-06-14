## 1. Package Scaffold

- [x] 1.1 创建 `packages/zclaw/package.json`、`packages/zclaw/tsconfig.json` 和 `packages/zclaw/src/index.ts`，包名使用 workspace 内部命名并只依赖 `@ziniao/core`、`@ziniao/schemas` 与 Node 标准库。
- [x] 1.2 更新 root `package.json` 的 `build`、`typecheck`、`test` 或相关 scripts，把 `packages/zclaw` 纳入现有 TS 验证链路，不改变 `python3 manager.py ...` 入口。
- [x] 1.3 确认 `pnpm-workspace.yaml` 与 `tsconfig.base.json` 不需要新增运行时例外；如需调整，仅限支持 `packages/zclaw` 构建。

## 2. Configuration and Errors

- [x] 2.1 实现 ZClaw 配置读取：默认 `http://127.0.0.1:9481`，支持 `ZCLAW_API_KEY`、`ZCLAW_BASE_URL` 与 `~/.zclaw/config.json`，并保证环境变量优先。
- [x] 2.2 实现 `ZClawError` 或专用错误类型，覆盖 `zclaw_config_missing`、`zclaw_path_forbidden`、`zclaw_bridge_unavailable`、`zclaw_http_error`、`zclaw_response_error`、`zclaw_tool_error`、`zclaw_timeout`。
- [x] 2.3 添加配置读取单测，覆盖环境变量优先、配置文件 fallback、base URL trim、API key 缺失和错误信息不泄露 key。

## 3. Request and Invoke Core

- [x] 3.1 实现底层 request helper：只接收 path，发送前拒绝非 `/zclaw/` path，并只使用 Node 内置 `fetch` 与 `AbortController`。
- [x] 3.2 实现 `getTools()`，只调用 `GET /zclaw/tools`，并解析工具名或工具描述列表。
- [x] 3.3 实现 `invoke(tool, args, timeoutMs)`，只调用 `POST /zclaw/tools/invoke`，自动注入 `storeId` / `targetId` 且不覆盖显式参数。
- [x] 3.4 添加 request/invoke 单测，覆盖 path 白名单、请求 body、header、成功响应、`ret != 0`、`data.ok === false`、HTTP 非 2xx、bridge 不可达和 timeout。

## 4. High-Level Wrappers

- [x] 4.1 实现 `listStores()`、`openStore()`、`closeStore()`，保持与 Python client 的参数语义一致，并在 `openStore()` 成功后更新 client `storeId`。
- [x] 4.2 实现 `visit()`、`executeScript()`、`screenshot()`、`click()`、`waitElement()`，所有 wrapper 最终只调用 `invoke()`。
- [x] 4.3 添加 wrapper 映射单测，确认只使用 `list_stores`、`open_store`、`close_store`、`visit_page`、`execute_script`、`take_screenshot`、`click_element`、`wait_for_element`，不出现 `navigate`、`open_url`、`run_script` 或 `screenshot` 等臆造工具名。
- [x] 4.4 添加返回值兼容单测，覆盖 `executeScript()` 对 JSON 字符串结果的解析、`screenshot()` 返回文件路径、`listStores()` 返回 items。

## 5. Security Baseline

- [x] 5.1 更新 `scripts/security-scan.ts`，允许 `packages/zclaw` 的受控 request helper 出现 `9481`、`/zclaw/tools`、`/zclaw/tools/invoke`，继续阻断其他包和 scripts 的直接 bridge 访问。
- [x] 5.2 扩展安全扫描或测试覆盖：新增禁止依赖 Playwright/Selenium/Puppeteer/browser-use、本机浏览器打开命令和非 `packages/zclaw` bridge 访问的回归用例或等价检查。
- [x] 5.3 运行 `pnpm security:scan`，确认 `packages/zclaw` 可以通过 allowlist，且 `packages/core`、`packages/schemas` 仍不能直接访问 bridge。

## 6. Documentation and Validation

- [x] 6.1 更新 `README.md`、`docs/05-TS重构技术蓝图.md` 和 `AGENTS.md`，记录 M2 范围、验证命令、禁止真实 bridge baseline 测试和后续顺序。
- [x] 6.2 运行 `pnpm typecheck`、`pnpm test`、`pnpm build`、`pnpm validate:baseline`，确认默认验证不要求紫鸟客户端在线，不调用真实 `POST /zclaw/tools/invoke`。
- [x] 6.3 运行 Python 兼容验证：`python3 manager.py list` 与 `python3 manager.py validate orders_overview`，确认生产入口仍不依赖 TS ZClaw client。
- [x] 6.4 运行静态边界检查，确认除 `packages/zclaw` 外，`packages/core`、`packages/schemas`、`scripts` 中没有直接访问 `9481` 或 `/zclaw/` 的代码。
- [x] 6.5 运行 `openspec validate add-typescript-zclaw-client --strict` 并修复所有问题。
- [x] 6.6 做回滚演练或记录等价验证：移除/隔离 `packages/zclaw` 与 root script 改动后，Python `manager.py` 仍可 `list` 和 `validate orders_overview`。
