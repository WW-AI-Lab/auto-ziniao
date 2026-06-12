"""测试夹具：SQLite 指向临时目录，避免污染真实数据。"""

import pytest

from webadmin import storage


@pytest.fixture(autouse=True)
def temp_db(tmp_path, monkeypatch):
    monkeypatch.setattr(storage, "DATA_DIR", tmp_path)
    monkeypatch.setattr(storage, "DB_FILE", tmp_path / "test.db")
    monkeypatch.setattr(storage, "_initialized", False)
    yield
