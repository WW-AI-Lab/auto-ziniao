# Auto Ziniao

Auto Ziniao 是一个基于紫鸟 ZClaw bridge 的店铺操作流程引擎。它把已经跑通的店铺操作沉淀为可传参、可校验、可重复执行的 flow；执行异常时可按配置触发 Agent CLI 自愈，并把修复经验回写为已知问题。

> 安全边界：所有浏览器操作只能通过紫鸟 ZClaw bridge 在紫鸟店铺浏览器内执行。项目不提供本机 Chrome、Safari、Firefox、Playwright、Selenium、Puppeteer 或 browser-use fallback。

## 安装

```bash
npm install -g @ww-ai-lab/auto-ziniao
```

本仓库开发模式：

```bash
pnpm install
pnpm auto-ziniao --help
```

前置条件：

- Node.js >= 22
- pnpm 10.x（仓库开发）
- 下载安装紫鸟浏览器最新支持 OpenClaw 的版本，并保持紫鸟客户端已启动
- 必须先在紫鸟开发者平台申请/生成紫鸟助手 key；其他安装、配置和使用方法见 [紫鸟助手官方指南](https://open.ziniao.com/ziniaoAssistant)
- 安装 `ziniao-assistant` skill；本仓库已在 `skills/ziniao-assistant` 归档最终版本，可复制到所用 Agent 的 skills 目录，或按官方指南安装
- ZClaw bridge 监听 `127.0.0.1:9481`
- 紫鸟助手 key 只放在本机环境变量或 `~/.zclaw/config.json`

`~/.zclaw/config.json` 示例：

```json
{
  "ZCLAW_API_KEY": "<your-zclaw-api-key>"
}
```

## 快速开始

```bash
# 查看流程
auto-ziniao list

# 静态校验流程
auto-ziniao validate orders_overview

# 执行流程，参数不要硬编码真实店铺名到 flow 文件
auto-ziniao run orders_overview -p store_name=<store_name> -v --no-heal

# 查看运行历史与统计
auto-ziniao history
auto-ziniao stats
```

在源码仓库中也可以使用：

```bash
pnpm auto-ziniao list
pnpm auto-ziniao run orders_overview -p store_name=<store_name> -v --no-heal
```

## WebAdmin

WebAdmin 提供本机管理界面：流程查看、编辑、运行、计划任务、运行观测、自愈记录和 Agent 对话。

```bash
cp config.example.json config.json
pnpm web:build
pnpm api
```

默认访问 `http://127.0.0.1:9482`。服务只监听 `127.0.0.1`，不提供 `0.0.0.0` 绑定开关。

## 已包含流程

| 流程 | 说明 | 参数 |
| --- | --- | --- |
| `account_health` | 账户状况评级、政策合规检查 | `store_name` |
| `inventory_check` | 商品库存与在售状态 | `store_name` |
| `orders_overview` | 订单概览 | `store_name` |
| `switch_language` | 站点语言检测与切换 | `target_lang`, `store_name` |
| `webadmin_selftest` | 本地自测 flow，不调用 ZClaw bridge | `greeting` |

## 常用命令

```bash
auto-ziniao list
auto-ziniao validate <flow_id>
auto-ziniao run <flow_id> [-p k=v]... [-v] [--no-heal]
auto-ziniao retry <flow_id>
auto-ziniao new <flow_id> [中文名]
auto-ziniao heals
auto-ziniao cron
```

## 开发验证

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm schemas:export -- --check
pnpm security:scan
pnpm validate:baseline
```

`pnpm validate:baseline` 只能执行静态解析、typecheck、单测、构建、schema 检查和安全扫描；不得真实调用 ZClaw bridge 或打开本机浏览器。

## 目录

```text
packages/cli/            auto-ziniao CLI
packages/zclaw/          唯一 ZClaw bridge 网络出口
packages/flow-engine/    Flow Engine
packages/self-heal/      自愈触发器
packages/core/           共享基础工具
packages/schemas/        契约类型与运行时校验
apps/api/                WebAdmin 后端
apps/web/                WebAdmin 前端
flows/                   flow 定义
extracts/                页面提取脚本
heal_templates/          自愈提示词模板
learnings/               已知问题库
docs/                    架构、开发和安全文档
```

## 文档

- [开发者指南](docs/development.md)
- [配置说明](docs/configuration.md)
- [安全模型](docs/security-model.md)
- [WebAdmin 手册](docs/webadmin.md)
- [架构设计](docs/02-架构设计.md)
- [流程定义规范](docs/03-流程定义规范.md)
- [自愈机制与提示词模板](docs/04-自愈机制与提示词模板.md)
- [操作节奏与流程稳定性规划](docs/07-操作节奏与流程稳定性规划.md)

## License

MIT
