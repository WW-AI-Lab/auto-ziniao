#!/usr/bin/env python3
"""仓库根入口 — 转发到 engine.manager，保持 `python3 manager.py <命令>` 全套用法不变。

引擎实现见 engine/ 包（flow_engine / self_heal / zclaw_client / manager）。
"""

from engine.manager import main

if __name__ == "__main__":
    main()
