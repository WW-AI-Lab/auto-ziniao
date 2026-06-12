"""入口：python3 -m webadmin

安全约束（spec: web-admin-server）：仅绑定 127.0.0.1，不提供改绑开关。
端口可经仓库根 config.json 的 webadmin.port 覆盖（默认 9482）。
"""

import uvicorn

from .app import create_app
from .settings import BIND_HOST, get_port


def main() -> None:
    port = get_port()
    print(f"紫鸟自动化引擎 Web 管理界面: http://{BIND_HOST}:{port}")
    uvicorn.run(create_app(), host=BIND_HOST, port=port, log_level="info")


if __name__ == "__main__":
    main()
