"""紫鸟自动化引擎核心包。

模块职责：
- zclaw_client: 唯一网络出口（ZClaw bridge 客户端，含路径白名单硬约束）
- flow_engine:  流程引擎（参数化、分支、校验、失败追踪）
- self_heal:    自愈触发器（已知问题匹配、冷却、提示词组装、Agent CLI 调用）
- manager:      管理 CLI（由仓库根 manager.py 薄入口转发）
- paths:        全仓路径常量唯一出处
"""
