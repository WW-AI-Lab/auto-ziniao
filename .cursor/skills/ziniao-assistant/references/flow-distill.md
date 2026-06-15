# 流程沉淀工作流(flow distill)

把「本会话刚跑通的紫鸟任务」固化为可重复执行的 flow。沉淀操作只走 WebAdmin API；不要直接读写仓库文件，不要调用 CLI 创建、校验或运行流程。

WebAdmin API 默认地址：`http://127.0.0.1:9482`。下文用 `{api}` 表示该地址。

## 第 0 步：盘点本会话的地面真值

回顾本会话**实际成功**的 bridge 调用序列：用了哪些工具、什么 args、哪个 URL、哪些选择器、提取脚本最终长什么样、中途哪些尝试失败过。失败原因是 `heal.hints` 的关键素材。

**铁律：flow 里只允许写本会话真机验证过的东西。** 没验证过的选择器、凭印象写的 URL 一律不准进 flow；宁可现在通过 ZClaw bridge 再验证一次。上下文缺失时，优先用 bridge 的 `get_logs` 或 WebAdmin traces API 找回；找不回就重新验证。

成功的任务步骤应尽量推送 trace：

```bash
curl -X POST {api}/api/traces \
  -H "Content-Type: application/json" \
  -d '{"ts":"<ISO 时间>","tool":"<name>","args":{},"ok":true,"note":"<这一步达成了什么>"}'
```

trace API 不可达时，不要改为写本地文件；继续依赖当前会话上下文，并在总结里说明 trace 未记录。

## 第 1 步：创建 flow 骨架

`flow_id` 使用小写英文、数字、下划线或连字符，例如 `orders_overview`。创建请求：

```bash
curl -X POST {api}/api/flows \
  -H "Content-Type: application/json" \
  -d '{"id":"<flow_id>","name":"<中文名>"}'
```

也可以直接提交完整 flow 内容：

```bash
curl -X POST {api}/api/flows \
  -H "Content-Type: application/json" \
  -d '{"id":"<flow_id>","name":"<中文名>","content":"<flow JSON string>"}'
```

如果 API 返回 flow 已存在，不要覆盖；应读取现有 flow detail，判断是更新现有流程还是换新 `flow_id`。

## 第 2 步：填写 flow JSON

必要顶层字段：

```json
{
  "id": "orders_overview",
  "name": "订单概览",
  "version": 1,
  "enabled": true,
  "params": {
    "store_name": ""
  },
  "steps": [],
  "heal": {
    "hints": ""
  }
}
```

硬性要求：

- `params` 至少声明 `store_name`，不得硬编码店铺名、日期或账号环境。
- `steps` 只写本会话真实跑通过的工具调用和内置动作。
- `tool` 字段只能使用 `GET /zclaw/tools` 返回的真实工具名；不要臆造 `navigate`、`open_url`、`run_script` 等名字。
- `storeId`、`targetId` 等运行态字段通常由引擎注入；除非本会话验证明确需要，不要硬编码。
- 关键提取步骤必须配置 `validate`，避免空数据假成功。
- 可能失败的步骤必须配置 `on_fail`：加载慢等瞬时问题用 `retry`，页面结构变化用 `heal` 并写 `context`。
- 有状态差异的页面用 `branch` 覆盖，例如已登录/未登录、有数据/无数据、已是目标状态。
- `heal.hints` 必填：写页面入口、关键选择器、页面结构特征、已知坑、试过失败的选择器、延迟加载和中英文差异。

常用步骤字段：

```json
{
  "id": "step_id",
  "tool": "visit_page",
  "args": {
    "url": "https://example.com",
    "waitUntil": "load"
  },
  "save": "page_state",
  "validate": {
    "not_empty": "page_state"
  },
  "on_fail": {
    "action": "retry",
    "max": 2,
    "context": "page_load_slow"
  },
  "goto": "next_step"
}
```

常用内置动作：

```json
{ "id": "log", "action": "print", "message": "done" }
```

```json
{ "id": "save", "action": "save_json", "filename": "orders/result.json", "data": "${steps.extract.data}" }
```

分支示例：

```json
{
  "id": "branch_has_data",
  "branch": {
    "cases": [
      {
        "condition": { "left": "${steps.extract.rows}", "op": "not_empty" },
        "goto": "save_result"
      }
    ],
    "default": "report_empty"
  }
}
```

## 第 3 步：编写并上传 extract

页面提取 JS 必须外置为 extract，并由 WebAdmin API 保存。extract 内容要求：

- IIFE 包裹。
- `return JSON.stringify(...)`。
- 禁止 JS 模板字符串 `` `${}` ``，避免与 flow 变量语法冲突。
- 文本匹配兼容中英文页面。
- 输出字段稳定、可校验，不要返回整页噪音。

示例：

```javascript
(() => {
  const rows = Array.from(document.querySelectorAll("table tbody tr")).map((row) => {
    const cells = Array.from(row.querySelectorAll("td")).map((cell) => cell.textContent.trim());
    return {
      order_id: cells[0] || "",
      status: cells[1] || "",
      amount: cells[2] || ""
    };
  });
  return JSON.stringify({ rows });
})();
```

上传：

```bash
curl -X PUT {api}/api/extracts/<name>.js \
  -H "Content-Type: application/json" \
  -d '{"content":"<extract script>"}'
```

flow 中引用：

```json
{
  "id": "extract_orders",
  "tool": "execute_script",
  "args": {
    "script": "@extracts/<name>.js"
  },
  "save": "orders",
  "validate": {
    "path": "orders.rows",
    "not_empty": true
  },
  "on_fail": {
    "action": "heal",
    "context": "orders_table_structure_changed"
  }
}
```

## 第 4 步：保存、校验、运行

保存完整 flow：

```bash
curl -X PUT {api}/api/flows/<flow_id> \
  -H "Content-Type: application/json" \
  -d '{"content":"<flow JSON string>"}'
```

校验：

```bash
curl -X POST {api}/api/flows/<flow_id>/validate \
  -H "Content-Type: application/json" \
  -d '{"content":"<flow JSON string>"}'
```

真机运行：

```bash
curl -X POST {api}/api/flows/<flow_id>/run \
  -H "Content-Type: application/json" \
  -d '{"params":{"store_name":"<店铺名>"}}'
```

查询运行状态：

```bash
curl {api}/api/flow-runs/<token>
```

运行失败时，不要在流程外包重试脚本；flow-engine 和 self-heal 会按 flow 定义处理。若 ZClaw bridge 不可达，停止真机验证并告知用户这是环境问题，不要改用本机浏览器或 browser automation。

## 第 5 步：确认产出

列出产出：

```bash
curl "{api}/api/outputs?path=<dir>"
```

预览产出：

```bash
curl "{api}/api/outputs/preview?path=<file>"
```

产出必须正确、非空、字段稳定。若没有产出或产出为空，不算沉淀完成；回到 flow/extract 修正并重新校验、运行。

## 沉淀检查清单

```text
- [ ] 只使用本会话真实跑通的 URL、选择器、工具和 args
- [ ] params 声明至少包含 store_name，无硬编码店铺名/日期
- [ ] extract 通过 WebAdmin API 保存，IIFE，return JSON.stringify(...)
- [ ] extract 不使用 JS 模板字符串
- [ ] 关键提取步骤有 validate
- [ ] 可能失败步骤有 on_fail
- [ ] 页面状态差异用 branch 覆盖
- [ ] heal.hints 写入本次探索真实经验
- [ ] POST /api/flows/:flowId/validate 通过
- [ ] POST /api/flows/:flowId/run 真机跑通
- [ ] GET /api/outputs 或 /api/outputs/preview 确认产出正确
```

## 边界

- 沉淀只通过 WebAdmin API 写入和读取 flow/extract。
- 禁止创建额外 `.sh`、`.py`、`.js` 执行脚本绕过 flow-engine。
- 禁止使用本机浏览器、Playwright、Selenium、Puppeteer、browser-use 或任何 ZClaw bridge 之外的浏览器方案。
- WebAdmin API 不可达时，停止沉淀写入并报告环境问题；不要回退到直接文件写入或 CLI。
