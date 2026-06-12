"""路径安全校验单测（spec: web-admin-server / 任务 2.1）。"""

import pytest

from webadmin.security import PathSecurityError, resolve_safe_path
from webadmin.settings import OUTPUT_DIR, FLOWS_DIR


def test_normal_path():
    p = resolve_safe_path("output", "orders/today.csv")
    assert p == (OUTPUT_DIR / "orders" / "today.csv").resolve()


def test_empty_path_is_root():
    assert resolve_safe_path("output", "") == OUTPUT_DIR.resolve()


def test_leading_slash_stripped():
    p = resolve_safe_path("flows", "/orders_overview.json")
    assert p == (FLOWS_DIR / "orders_overview.json").resolve()


@pytest.mark.parametrize("evil", [
    "../../etc/passwd",
    "..",
    "a/../../..",
    "foo/../../../etc/shadow",
])
def test_traversal_rejected(evil):
    with pytest.raises(PathSecurityError):
        resolve_safe_path("output", evil)


def test_unknown_root_rejected():
    with pytest.raises(PathSecurityError):
        resolve_safe_path("etc", "passwd")


def test_null_byte_rejected():
    with pytest.raises(PathSecurityError):
        resolve_safe_path("output", "a\x00b")
