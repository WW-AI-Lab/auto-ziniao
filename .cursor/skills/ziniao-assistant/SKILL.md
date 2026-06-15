---
name: ziniao-assistant
description: Operate Ziniao Browser (紫鸟) stores via the local ZClaw bridge, and distill completed tasks into repeatable flows. Use when the user wants to list or open Ziniao stores, visit pages, read content, click or input, take screenshots, export data, or run automations — even if they only mention a store name or a task (查订单/导报表) without saying "Ziniao". Also use immediately after a multi-step bridge task succeeds, or when the user says 沉淀/固化/保存流程/save as flow, to persist the verified steps before session context is lost. Tool names come only from GET /zclaw/tools; invoke via POST /zclaw/tools/invoke with an API key (~/.zclaw/config.json or ZCLAW_API_KEY). On bridge failure, stop the turn.
---

# Ziniao Assistant(紫鸟浏览器操作与流程沉淀)

通过本地 ZClaw bridge 操作紫鸟店铺浏览器:列店铺、开店铺、访问页面、读内容、点击输入、截图、导出、自动化。多步任务跑通后,把真机验证过的步骤沉淀为可重复执行的 flow(见「任务跑通后:沉淀」)。

## 硬性约束

- **所有浏览器操作只走 bridge**(`POST {baseUrl}/zclaw/tools/invoke`)。禁止本机浏览器(Chrome/Safari/Edge/Firefox)、Playwright/Selenium/Puppeteer/browser-use、`webbrowser` 模块、`open <url>` 命令。
- **工具名零臆造**:`tool` 字段只能取自 `GET /zclaw/tools` 返回的名字。`navigate`、`open_url`、`goto`、`browse`、`run_script`、`screenshot`、`get_screenshot`、`execute_automation`、`call_store_tool` 等名字**不存在**,不要从通用自动化习惯里猜。打开 URL 只有两种方式:店铺已开用 `visit_page`;未开用 `open_store` + `launchUrl`。
- **禁止创建或运行脚本文件**(`.sh`/`.py`/`.js` 等)来完成任务。临时数据文件允许;flow 与 extract 的沉淀写入只通过 WebAdmin API 完成,不要直接写仓库内 flow/extract 文件。现有工具做不到的事,如实报告限制,不要绕道脚本。
- **遇阻即停**:invoke 连接拒绝/超时无响应、必需工具调用报错导致任务不可行、必需资源缺失(店铺不存在、API key 缺失)时——立即停止并结束回合。不重试同一请求、不读代码诊断、不写「等 bridge 恢复后再执行」的后续计划。bridge 不可达 = 紫鸟客户端没开,属环境问题。

## 调用方式

唯一端点:`POST {baseUrl}/zclaw/tools/invoke`,body 为 `{"tool":"<name>","args":{...}}`。`baseUrl` 取 `ZCLAW_BASE_URL` 或 `ZINIAO_ZCLAW_BASE_URL`,默认 `http://127.0.0.1:9481`。不要调用 `/zclaw/page/visit` 之类的其它路径。

**认证(每个 invoke 必带,缺 key 不要发请求)**:默认用请求头 `X-ZClaw-Api-Key: <key>`;兼容 body 字段 `apiKey` 或 `Authorization: Bearer <key>`。key 解析顺序:本会话用户刚提供的 > 环境变量 `ZCLAW_API_KEY` > `~/.zclaw/config.json` 的 `ZCLAW_API_KEY` 字段。

```bash
curl -X POST http://127.0.0.1:9481/zclaw/tools/invoke \
  -H "Content-Type: application/json" \
  -H "X-ZClaw-Api-Key: $ZCLAW_API_KEY" \
  -d '{"tool":"open_store","args":{"storeName":"Rosehut"}}'
```

**用户在对话中提供 key 时**(粘贴 key、说「设置 API key 为 xxx」等):把它合并写入 `~/.zclaw/config.json`(Windows: `%USERPROFILE%\.zclaw\config.json`)的 `ZCLAW_API_KEY` 字段——保留文件中其它字段,目录不存在则创建——并立即用新 key 发后续请求,不等重载。首次获取 key、OS 级环境变量配置等低频细节,需要时读本 skill 目录下的 `references/setup.md`。

## 第一步:获取工具白名单

处理任何 bridge 任务前,先 `GET {baseUrl}/zclaw/tools`(免认证)。响应 `{ ret, data }`,`data` 是 `{ name, description, inputSchema }` 数组。把 name 列表作为本会话的 `allowedTools` 留在工作记忆里;每次 invoke 前确认 `tool ∈ allowedTools`,不在就把意图映射到真实工具,而不是发请求。invoke 报 unknown/unsupported tool 时,重新 GET 刷新后重试。

GET 失败(连接拒绝/超时)按「遇阻即停」处理。如必须仅凭静态知识继续,用以下静态白名单(GET 可用时以 GET 为准):

`list_stores`, `resolve_store`, `open_store`, `close_store`, `visit_page`, `get_page_content`, `query_elements`, `click_element`, `input_text`, `scroll_page`, `take_screenshot`, `wait_for_element`, `wait_for_navigation`, `execute_script`, `run_automation`, `extract_data`, `prepare_agent`, `get_logs`, `download_file`, `debug_compare_lists`

## 工具参考

args 中 `?` 表示可选;`storeId`/`targetId` 等按 `GET /zclaw/tools` 的 inputSchema 为准。

### 店铺
- **list_stores** — 列店铺。**最多调一次拿数据,禁止循环轮询。** 返回 `{ page, limit, total, items }`,item 仅含 `storeId, storeName, platformName, ip`。args: `page?, limit?, all?, filterKeyword?, storeListType?`
- **resolve_store** — 按精确 storeId 或 storeName 解析,返回 `storeId` 和 `name`。args: `storeId?, storeName?, expectedName?`
- **open_store** — 开店铺,调一次。args: `storeId?, storeName?, expectedName?, launchUrl?, isHeadless?, privacyMode?, windowRatio?`。返回过滤后的 `storeId, name, debugPort, reused` 等。
- **close_store** — 关店铺。args: `storeId`

### 页面与交互
- **visit_page** — 导航并等待。args: `storeId, url, waitUntil?(domcontentloaded|load|networkidle), timeoutMs?, targetId?`
- **get_page_content** — 读页面内容。args: `storeId, format?(text|html|structured), timeoutMs?, targetId?`
- **query_elements** — 按选择器查 DOM。args: `storeId, selector, timeoutMs?, targetId?`
- **click_element** — 点击。args: `storeId, selector, waitForNavigation?, timeoutMs?, targetId?`
- **input_text** — 输入文本。args: `storeId, selector, text, clear?, submit?, timeoutMs?, targetId?`
- **scroll_page** — 滚动。args: `storeId, x?, y?, selector?, behavior?(auto|smooth), timeoutMs?, targetId?`
- **take_screenshot** — 截图。args: `storeId, fullPage?, path?, timeoutMs?, targetId?`
- **wait_for_element** — 等选择器出现。args: `storeId, selector, timeoutMs?, targetId?`
- **wait_for_navigation** — 等导航完成。args: `storeId, timeoutMs?, targetId?`

### 自动化与工具
- **execute_script** — 页内 JS(仅用于 DOM 提取等页内逻辑,不做流程编排)。args: `storeId, script, timeoutMs?, targetId?`
- **run_automation** — 多步流程。args: `steps`(`{ type, ... }` 数组)
- **extract_data** — 提取元数据/页面状态;`mode=running` 列已启动店铺(仅 `storeId, storeName, debugPort, wsUrl`)。args: `mode?(store|running|plugin|page), storeId?, payload?`
- **prepare_agent** — 准备 agent 资源
- **download_file** — 写文件到下载目录。args: `content, filename`
- **get_logs** — 读 bridge 日志
- **debug_compare_lists** — 调试:对比 account/list 与 store/list。args: `limit?`

## 标准工作流

1. **白名单**:`GET /zclaw/tools` → 留存 `allowedTools`。
2. **认证**:解析 API key(见「调用方式」),之后每个 invoke 都带。
3. **店铺**:一次 `list_stores` 或 `resolve_store` 拿 `storeId`——用 item 的 `storeName` 精确匹配,禁止模糊/子串匹配,歧义时问用户——然后一次 `open_store`(用户给了目标 URL 就带 `launchUrl`,省一次导航)。
4. **页面**:店铺已开后访问 URL 只用 `visit_page`;再按需 `get_page_content` / `query_elements` / `click_element` / `input_text` / `take_screenshot` / `download_file`;多步固定操作优先 `run_automation`。
5. **多个同类子项**(多种订单类型/多张报表):逐个访问检查后再下结论,不得从子集推断整体。
6. **失败排查**:用 `get_logs`。
7. **记录轨迹**:每个属于任务本身(非试探)的成功 invoke,通过 `POST http://127.0.0.1:9482/api/traces` 推送一条 JSON(WebAdmin API 本地端口,默认 9482):

```bash
curl -X POST http://127.0.0.1:9482/api/traces \
  -H "Content-Type: application/json" \
  -d '{"ts":"<ISO 时间>","tool":"<name>","args":{...},"ok":true,"note":"<这一步达成了什么>"}'
```

   `args` 按实际发送记录(超长脚本体截为路径或首行)。API 会校验 `tool`/`ok`/`ts` 字段并自动按日期归档到 `data/logs/traces/<YYYY-MM-DD>.jsonl`。若 WebAdmin API 不可达,则跳过记录(不阻断主任务)。这是会话上下文被压缩后,沉淀流程的地面真值。

8. **沉淀(结束回合前的强制检查)**:见下节。

## 任务跑通后:沉淀为 flow

多步 bridge 任务跑通后,**不要直接结束回合**,先判断是否值得沉淀:

- **应当沉淀**:产出数据(报表/订单/库存等)且未来会再查;是固定操作序列(切换设置、批量检查、定期导出);用户说 沉淀/固化/保存流程。
- **不必沉淀**:临时看一眼、探索性诊断、任务失败、已有等价流程(此时通过 WebAdmin API 更新现有 flow 并 version +1,不新建重复流程)。

判断为应当沉淀时:用户在场就先一句话提议并立即动手,不要只提议不动手。然后**读本 skill 目录下的 `references/flow-distill.md`**,按其中的 API-first 工作流执行(创建 flow、上传 extract、校验、运行、确认产出)。不要直接读写仓库内 flow/extract 文件,不要调用 CLI 作为沉淀步骤。刚验证过的 URL、选择器、踩坑经验只存在于本会话,不通过 WebAdmin API 固化就会丢失。

## Gotchas(踩坑速查)

- bridge 在正确的 tab 上操作,但**不会把浏览器窗口置前**——用户看不到窗口跳动是正常现象,不代表没执行。
- ZClaw 响应是**过滤后的**:`list_stores` item 只有 4 个字段,`open_store` 不返回完整店铺详情,不要假设存在其它字段;店铺名只认 `storeName` 字段。
- `open_store`/`visit_page` 返回 400 "Store detail not found":是后端 store/detail API 或其响应形状异常,错误中若带服务端 `msg` 以它为准——不是工具名写错。
- 店铺浏览器是 Chromium 内核、外观像 Chrome,但走店铺独立 IP、由紫鸟客户端拉起,**它不是本机浏览器**。
- API key 轮换后:更新 `~/.zclaw/config.json` 并立即用新 key,无需等待任何重载。
