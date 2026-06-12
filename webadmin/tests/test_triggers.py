"""触发计算单测（spec: task-scheduler / 任务 3.1）。"""

from datetime import datetime

import pytest

from webadmin.scheduler.triggers import (
    TriggerError, compute_next_run, parse_cron, validate_trigger,
)


# ----------------------------------------------------------------------
# interval
# ----------------------------------------------------------------------

def test_interval_next():
    after = datetime(2026, 6, 12, 10, 0, 30)
    nxt = compute_next_run({"type": "interval", "minutes": 60}, after)
    assert nxt == datetime(2026, 6, 12, 11, 0, 0)


@pytest.mark.parametrize("bad", [
    {"type": "interval"},
    {"type": "interval", "minutes": 0},
    {"type": "interval", "minutes": -5},
    {"type": "interval", "minutes": "60"},
])
def test_interval_invalid(bad):
    with pytest.raises(TriggerError):
        validate_trigger(bad)


# ----------------------------------------------------------------------
# daily
# ----------------------------------------------------------------------

def test_daily_today():
    after = datetime(2026, 6, 12, 8, 0)
    nxt = compute_next_run({"type": "daily", "time": "08:30"}, after)
    assert nxt == datetime(2026, 6, 12, 8, 30)


def test_daily_crosses_to_tomorrow():
    after = datetime(2026, 6, 12, 9, 0)
    nxt = compute_next_run({"type": "daily", "time": "08:30"}, after)
    assert nxt == datetime(2026, 6, 13, 8, 30)


def test_daily_exact_time_goes_tomorrow():
    after = datetime(2026, 6, 12, 8, 30)
    nxt = compute_next_run({"type": "daily", "time": "08:30"}, after)
    assert nxt == datetime(2026, 6, 13, 8, 30)


@pytest.mark.parametrize("bad", ["8:3", "24:00", "12:60", "abc", ""])
def test_daily_invalid(bad):
    with pytest.raises(TriggerError):
        validate_trigger({"type": "daily", "time": bad})


# ----------------------------------------------------------------------
# cron 解析
# ----------------------------------------------------------------------

def test_cron_star():
    parsed = parse_cron("* * * * *")
    assert parsed[0] == set(range(60))
    assert parsed[4] == set(range(7))


def test_cron_step_range_list():
    parsed = parse_cron("*/15 9-18 1,15 * 1-5")
    assert parsed[0] == {0, 15, 30, 45}
    assert parsed[1] == set(range(9, 19))
    assert parsed[2] == {1, 15}
    assert parsed[4] == {1, 2, 3, 4, 5}


def test_cron_sunday_7_normalized():
    parsed = parse_cron("0 0 * * 7")
    assert parsed[4] == {0}


@pytest.mark.parametrize("bad", [
    "0 8 * *",            # 字段数不足
    "0 8 * * MON",        # 不支持英文名
    "0 8 * * 1#2",        # 不支持 #
    "60 * * * *",         # 分越界
    "* 24 * * *",         # 时越界
    "* * 0 * *",          # 日越界
    "* * * 13 *",         # 月越界
    "@daily",             # 不支持宏
    "*/0 * * * *",        # 步长 0
    "5-1 * * * *",        # 区间反向
])
def test_cron_invalid(bad):
    with pytest.raises(TriggerError):
        validate_trigger({"type": "cron", "expr": bad})


# ----------------------------------------------------------------------
# cron next_run 计算
# ----------------------------------------------------------------------

def test_cron_next_simple():
    after = datetime(2026, 6, 12, 10, 5)
    nxt = compute_next_run({"type": "cron", "expr": "30 14 * * *"}, after)
    assert nxt == datetime(2026, 6, 12, 14, 30)


def test_cron_next_crosses_day():
    after = datetime(2026, 6, 12, 15, 0)
    nxt = compute_next_run({"type": "cron", "expr": "30 14 * * *"}, after)
    assert nxt == datetime(2026, 6, 13, 14, 30)


def test_cron_weekday():
    # 2026-06-12 是周五；下一个周一 = 06-15
    after = datetime(2026, 6, 12, 12, 0)
    nxt = compute_next_run({"type": "cron", "expr": "0 9 * * 1"}, after)
    assert nxt == datetime(2026, 6, 15, 9, 0)


def test_cron_month_end():
    # 6 月没有 31 日 → 跳到 7 月 31 日
    after = datetime(2026, 6, 12, 0, 0)
    nxt = compute_next_run({"type": "cron", "expr": "0 0 31 * *"}, after)
    assert nxt == datetime(2026, 7, 31, 0, 0)


def test_cron_feb_29():
    # 2026 非闰年 → 2 月 29 日下一次在 2028
    after = datetime(2026, 6, 12, 0, 0)
    nxt = compute_next_run({"type": "cron", "expr": "0 0 29 2 *"}, after)
    assert nxt == datetime(2028, 2, 29, 0, 0)


def test_cron_dom_dow_union():
    # 标准 cron：日与周都受限时取并集。
    # 2026-06-12（周五）之后：13 日（周六，命中日）早于下周一 15 日
    after = datetime(2026, 6, 12, 12, 0)
    nxt = compute_next_run({"type": "cron", "expr": "0 9 13 * 1"}, after)
    assert nxt == datetime(2026, 6, 13, 9, 0)


def test_cron_minute_boundary():
    # 当前分钟不触发，至少下一分钟
    after = datetime(2026, 6, 12, 10, 30)
    nxt = compute_next_run({"type": "cron", "expr": "* * * * *"}, after)
    assert nxt == datetime(2026, 6, 12, 10, 31)
