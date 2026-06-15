# 流程沉淀工作流(flow distill)

把「本会话刚跑通的紫鸟任务」固化为 `ziniao-scripts` 仓库里的 flow JSON。沉淀后用 `pnpm ziniao run <flow_id>` 以 0 tokens 重复执行,失败时自动触发自愈。

仓库根目录即当前工作区根（下称 `$REPO`），所有命令在 `$REPO` 下执行。该仓库的 `AGENTS.md` 是最高约束:浏览器操作只走 ZClaw bridge、不改引擎代码、安全扫描阻断回归。

## 第 0 步:盘点本会话的地面真值

回顾本会话**实际成功**的调用序列:用了哪些工具、什么 args、哪个 URL、哪些选择器、提取脚本最终长什么样、中途哪些尝试失败过(失败原因就是 `heal.hints` 的素材)。

**铁律:flow 里只允许写本会话真机验证过的东西。** 没验证过的选择器、凭印象写的 URL 一律不准进 flow——宁可现在通过 bridge 再验证一次。上下文已被压缩、调用细节缺失时,从 `$REPO/data/logs/traces/<日期>.jsonl` 的会话轨迹或 bridge 的 `get_logs` 找回;找不回就重新验证。

## 第 1 步:创建脚手架

```bash
cd "$REPO"
pnpm ziniao new <flow_id> <中文名>
```

`flow_id` 用小写下划线英文(如 `orders_overview`)。命令生成 `flows/<flow_id>.json` 和 `extracts/<flow_id>.js` 骨架。

## 第 2 步:按规范填写 flow

权威规范是 `$REPO/docs/03-流程定义规范.md`(**写之前先读它**),模板参考 `$REPO/flows/_template.json`,已沉淀的 `$REPO/flows/*.json` 是现成范例。硬性要求:

- **参数化**:声明 `params`(至少 `store_name`),不得硬编码店铺名/日期;
- **提取 JS 外置**到 `extracts/<名称>.js`:IIFE 包裹,`return JSON.stringify(...)`,**禁用** JS 模板字符串 `` `${}` ``(与引擎变量语法冲突),文本匹配兼容中英文页面;
- **关键提取步骤配 `validate`**(`not_empty` / `require_fields`),防止空数据假成功;
- **可能失败的步骤配 `on_fail`**:加载慢等瞬时问题用 `retry`,页面结构问题用 `heal` 并标注 `context` 错误类型;
- **有状态差异的场景用 `branch`** 写多分支:已登录/未登录、有数据/无数据、已是目标状态——本会话遇到过的每种页面状态都应有对应分支;
- **`heal.hints` 必填,且现在是写它的唯一时机**:页面入口、关键选择器、页面结构特征、本次探索踩过的坑(哪些选择器试过不行、哪里有延迟加载、哪里中英文不一致)。这些是未来自愈 Agent 的提示词素材,价值最高。

`tool` 字段只能用 bridge 真实存在的工具名(以 `GET /zclaw/tools` 为准)。`storeId`/`targetId` 由引擎自动注入,args 通常不写。

## 第 3 步:验收(不可跳过)

```bash
pnpm ziniao validate <flow_id>          # 结构校验
pnpm ziniao run <flow_id> -v --no-heal  # 真机回归,必须真实跑通
```

然后检查 `$REPO/data/output/` 的产出文件内容正确、非空。三项全部通过才算沉淀完成;任何一项失败就修 flow(version +1)再来,**不要**为了过校验去改引擎代码。

bridge 不可达时:停止真机验证并告知用户,已写好的 flow 保留并标注「待真机验证」。

## 第 4 步:收尾

向用户报告:flow_id、验证结果、产出文件路径、如何重跑(`pnpm ziniao run <flow_id> -p store_name=xxx`)。任务适合定时执行的,提示可在 flow 的 `schedule` 字段配 cron 表达式。复杂流程可追加 `heal_templates/<flow_id>/<error_type>.md` 定制自愈提示词。

## 沉淀检查清单

```
- [ ] ziniao new 创建,按本会话真实跑通的步骤填写
- [ ] params 声明(至少 store_name),无硬编码
- [ ] 提取 JS 外置 extracts/,IIFE,无 JS 模板字符串
- [ ] 关键步骤有 validate
- [ ] 可能失败的步骤有 on_fail(瞬时 retry / 结构 heal)
- [ ] 状态差异用 branch 覆盖
- [ ] heal.hints 写入了本次探索的真实经验
- [ ] validate 通过
- [ ] run -v --no-heal 真机跑通
- [ ] data/output/ 产出正确
```

## 边界

- flow JSON 与 extracts JS 是**数据文件**,写入它们是沉淀的本职;但仍禁止创建 flow 体系之外的 `.sh`/`.py`/`.js` 执行脚本。
- 验证运行一律通过 `pnpm ziniao`(它走 ZClaw bridge);禁止用本机浏览器或 Playwright 等验证。
