"""文件访问路径安全校验（spec: web-admin-server）。

所有按相对路径读取文件的 API 必须经 resolve_safe_path：
规范化 + 白名单根目录约束，拒绝 `..` 穿越与符号链接逃逸。
"""

from pathlib import Path

from .settings import ALLOWED_FILE_ROOTS


class PathSecurityError(ValueError):
    """路径越界或非法"""


def resolve_safe_path(root_key: str, rel_path: str) -> Path:
    """把 (白名单根目录键, 相对路径) 解析为安全的绝对路径。

    - root_key 必须是 ALLOWED_FILE_ROOTS 之一（output/logs/flows/extracts）
    - rel_path 解析后必须仍位于对应根目录内（realpath 校验，符号链接也无法逃逸）
    """
    root = ALLOWED_FILE_ROOTS.get(root_key)
    if root is None:
        raise PathSecurityError(f"非法的根目录: {root_key}")

    rel = (rel_path or "").strip().lstrip("/")
    if "\x00" in rel:
        raise PathSecurityError("路径包含非法字符")

    candidate = (root / rel).resolve()
    root_resolved = root.resolve()
    if candidate != root_resolved and root_resolved not in candidate.parents:
        raise PathSecurityError(f"路径越界: {rel_path}")
    return candidate
