# 架构文档已迁移

> 本文件原为早期架构规划（v1），已于 2026-06-12 完成架构评审与升级（v2），内容由 `docs/` 目录下的正式文档取代。早期规划中的设计承诺（参数化、分支、validate、自愈模板外置、config.json 等）均已在 v2 中落地实现。

## 请阅读

| 文档 | 内容 |
|------|------|
| [README.md](README.md) | 快速开始与常用命令 |
| [AGENTS.md](AGENTS.md) | Agent 工作守则（沉淀规范 + 最高安全规则） |
| [docs/01-项目评审报告.md](docs/01-项目评审报告.md) | v1 问题评审与 v2 优化说明 |
| [docs/02-架构设计.md](docs/02-架构设计.md) | 当前架构：三态闭环、模块职责、数据流 |
| [docs/03-流程定义规范.md](docs/03-流程定义规范.md) | flow JSON 规范与沉淀 Checklist |
| [docs/04-自愈机制与提示词模板.md](docs/04-自愈机制与提示词模板.md) | 自愈链路、模板定制、Agent CLI 配置 |

## 最高安全规则

**所有浏览器操作只能通过紫鸟 ZClaw bridge（`127.0.0.1:9481/zclaw/*`）在紫鸟店铺浏览器内执行，绝对禁止使用本机浏览器（Chrome/Safari/Edge/Firefox）或 Playwright/Selenium/Puppeteer 等框架。**代码层面由 `zclaw_client.py` 的路径白名单强制保证。
