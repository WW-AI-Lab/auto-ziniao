"""触发方式计算：interval / daily / cron 五字段子集。

cron 支持的语法子集（spec: task-scheduler）：
- `*`、`*/n`、`a-b`、`a,b`（逗号项可混合数字与区间，区间支持 `a-b/n`）
- 五字段顺序：分 时 日 月 周（周 0-7，0 和 7 均为周日）
- 日/周同时受限时按标准 cron 语义取并集
不支持的写法（如 `MON`、`#`、`L`、`@daily`）校验时报错。
"""

import re
from datetime import datetime, timedelta

TRIGGER_TYPES = ("interval", "daily", "cron")

_FIELD_RANGES = [
    ("分", 0, 59),
    ("时", 0, 23),
    ("日", 1, 31),
    ("月", 1, 12),
    ("周", 0, 7),
]


class TriggerError(ValueError):
    """触发配置非法"""


# ----------------------------------------------------------------------
# cron 解析
# ----------------------------------------------------------------------

def _parse_field(expr: str, name: str, lo: int, hi: int) -> set[int]:
    """解析单个 cron 字段为合法值集合。"""
    values: set[int] = set()
    if not expr:
        raise TriggerError(f"cron {name} 字段为空")
    for part in expr.split(","):
        part = part.strip()
        m = re.fullmatch(r"\*(?:/(\d+))?", part)
        if m:
            step = int(m.group(1)) if m.group(1) else 1
            if step < 1:
                raise TriggerError(f"cron {name} 字段步长非法: {part}")
            values.update(range(lo, hi + 1, step))
            continue
        m = re.fullmatch(r"(\d+)-(\d+)(?:/(\d+))?", part)
        if m:
            a, b = int(m.group(1)), int(m.group(2))
            step = int(m.group(3)) if m.group(3) else 1
            if a > b or a < lo or b > hi or step < 1:
                raise TriggerError(f"cron {name} 字段区间非法: {part}（范围 {lo}-{hi}）")
            values.update(range(a, b + 1, step))
            continue
        m = re.fullmatch(r"\d+", part)
        if m:
            v = int(part)
            if v < lo or v > hi:
                raise TriggerError(f"cron {name} 字段越界: {v}（范围 {lo}-{hi}）")
            values.add(v)
            continue
        raise TriggerError(
            f"cron {name} 字段不支持的写法: {part}"
            f"（仅支持 * */n a-b a,b，数字形式）")
    return values


def parse_cron(expr: str) -> list[set[int]]:
    fields = (expr or "").split()
    if len(fields) != 5:
        raise TriggerError(f"cron 表达式必须为五字段（分 时 日 月 周），实际 {len(fields)} 段")
    parsed = []
    for raw, (name, lo, hi) in zip(fields, _FIELD_RANGES):
        vals = _parse_field(raw, name, lo, hi)
        parsed.append(vals)
    # 周字段 7 归一为 0（周日）
    if 7 in parsed[4]:
        parsed[4].discard(7)
        parsed[4].add(0)
    return parsed


def _day_matches(parsed: list[set[int]], dt: datetime,
                 dom_restricted: bool, dow_restricted: bool) -> bool:
    # python weekday(): 周一=0..周日=6 → cron: 周日=0..周六=6
    cron_dow = (dt.weekday() + 1) % 7
    dom_ok = dt.day in parsed[2]
    dow_ok = cron_dow in parsed[4]
    # 标准 cron 语义：日/周都受限时取并集，否则取交集
    if dom_restricted and dow_restricted:
        return dom_ok or dow_ok
    return dom_ok and dow_ok


# ----------------------------------------------------------------------
# 校验与 next_run 计算
# ----------------------------------------------------------------------

def validate_trigger(trigger: dict) -> None:
    """校验触发配置，非法抛 TriggerError。"""
    if not isinstance(trigger, dict):
        raise TriggerError("trigger 必须是对象")
    t = trigger.get("type")
    if t not in TRIGGER_TYPES:
        raise TriggerError(f"trigger.type 必须是 {'/'.join(TRIGGER_TYPES)} 之一")

    if t == "interval":
        minutes = trigger.get("minutes")
        if not isinstance(minutes, int) or minutes < 1:
            raise TriggerError("interval 触发需要正整数 minutes（分钟）")
    elif t == "daily":
        time_str = trigger.get("time", "")
        if not isinstance(time_str, str) or not re.fullmatch(r"\d{1,2}:\d{2}", time_str):
            raise TriggerError("daily 触发需要 time 字段，格式 HH:MM")
        h, m = map(int, time_str.split(":"))
        if h > 23 or m > 59:
            raise TriggerError(f"daily 时间越界: {time_str}")
    elif t == "cron":
        expr = trigger.get("expr", "")
        if not isinstance(expr, str):
            raise TriggerError("cron 触发需要字符串 expr")
        parse_cron(expr)


def compute_next_run(trigger: dict, after: datetime | None = None) -> datetime:
    """计算 after（默认当前时刻）之后的下一次触发时间（分钟精度）。"""
    validate_trigger(trigger)
    after = after or datetime.now()
    base = after.replace(second=0, microsecond=0)
    t = trigger["type"]

    if t == "interval":
        return base + timedelta(minutes=trigger["minutes"])

    if t == "daily":
        h, m = map(int, trigger["time"].split(":"))
        candidate = base.replace(hour=h, minute=m)
        if candidate <= base:
            candidate += timedelta(days=1)
        return candidate

    # cron：按天跳跃 + 天内按 时×分 候选扫描（上限 5 年，覆盖 2/29 等低频表达式）
    expr = trigger["expr"]
    parsed = parse_cron(expr)
    fields = expr.split()
    dom_restricted = fields[2] != "*"
    dow_restricted = fields[4] != "*"
    hours = sorted(parsed[1])
    minutes = sorted(parsed[0])

    day = base.replace(hour=0, minute=0)
    limit = base + timedelta(days=5 * 366)
    while day <= limit:
        if day.month in parsed[3] and _day_matches(parsed, day,
                                                   dom_restricted, dow_restricted):
            for h in hours:
                for m in minutes:
                    candidate = day.replace(hour=h, minute=m)
                    if candidate > base:
                        return candidate
        day += timedelta(days=1)
    raise TriggerError(f"cron 表达式 5 年内无触发点: {expr}")
