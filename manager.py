#!/usr/bin/env python3
"""
紫鸟自动化管理器 — CLI 管理界面。
查看流程、手动执行（支持传参）、重试、校验、脚手架、查看历史与自愈记录。
"""

import json
import sys
from pathlib import Path

SCRIPTS_DIR = Path(__file__).parent
sys.path.insert(0, str(SCRIPTS_DIR))

from flow_engine import (
    list_flows, show_history, run_flow, load_flow, validate_flow, parse_params,
    LOGS_DIR, LEARNINGS_DIR, FLOWS_DIR, ensure_dirs
)


def print_banner():
    print("=" * 60)
    print("  紫鸟自动化引擎 v2.0")
    print("  0 tokens 执行 · 参数化 · 分支控制 · 异常自愈 · 流程固化")
    print("=" * 60)


def cmd_list():
    """列出所有流程及最近运行状态"""
    flows = list_flows()
    if not flows:
        print("没有找到任何流程。请在 flows/ 目录下创建 .json 文件。")
        return

    print(f"\n{'ID':<22} {'名称':<14} {'版本':>4} {'状态':<5} {'调度':<13} {'上次运行':<13} {'结果':<8} {'参数'}")
    print("-" * 110)

    for f in flows:
        flow_id = f["id"]
        history = show_history(flow_id, last=1)
        last_run = history[-1] if history else None

        status = "✅" if f.get("enabled", True) else "⏸"
        last_time = last_run["timestamp"][5:16] if last_run else "-"
        last_result = {"success": "✅ 成功", "failed": "❌ 失败", "error": "💥 异常"}.get(
            last_run["status"], "-") if last_run else "-"
        params = ",".join(f"{k}={v}" for k, v in f.get("params", {}).items()) or "-"

        print(f"{flow_id:<22} {f['name']:<14} v{f.get('version', 1):<3} {status:<5} "
              f"{f.get('schedule', '') or '-':<13} {last_time:<13} {last_result:<8} {params}")

    print()


def cmd_run(flow_id, verbose=False, params=None, heal=True):
    """执行流程"""
    try:
        flow = load_flow(flow_id)
    except FileNotFoundError:
        print(f"❌ 流程不存在: {flow_id}")
        print("   可用流程:")
        for f in list_flows():
            print(f"     - {f['id']} ({f['name']})")
        return 1

    print(f"\n▶ 执行流程: {flow['name']} (v{flow.get('version', 1)})")
    print(f"  描述: {flow.get('description', '-')}")
    print()

    result = run_flow(flow_id, verbose=verbose, params=params, heal=heal)

    print()
    if result.get("status") == "success":
        print("✅ 执行成功")
        data = result.get("data", {})
        for step_id, step_data in data.items():
            text = json.dumps(step_data, ensure_ascii=False, default=str) \
                if isinstance(step_data, dict) else str(step_data)
            if len(text) < 200:
                print(f"  [{step_id}] → {text[:150]}")
    else:
        print(f"❌ 执行失败: {result.get('error', 'unknown')}")
        failed = result.get("failed_step")
        if failed:
            print(f"   失败步骤: {failed.get('step_id')} ({failed.get('tool') or failed.get('action')})")
        heal_info = result.get("heal") or {}
        if heal_info.get("triggered"):
            print(f"   🔧 自愈已触发: {heal_info.get('heal_id')}")
        elif heal_info.get("reason"):
            print(f"   ⊘ 自愈未触发: {heal_info.get('reason')}")

    return 0 if result.get("status") == "success" else 1


def cmd_run_all():
    """执行所有已启用的流程"""
    flows = [f for f in list_flows() if f.get("enabled", True)]
    if not flows:
        print("没有启用的流程")
        return

    print(f"\n▶ 执行 {len(flows)} 个流程...")
    results = {}
    for f in flows:
        print(f"\n{'─' * 50}")
        rc = cmd_run(f["id"])
        results[f["id"]] = "✅" if rc == 0 else "❌"

    print(f"\n{'=' * 50}")
    print("汇总:")
    for fid, status in results.items():
        print(f"  {status} {fid}")


def cmd_validate(flow_id):
    """校验流程定义"""
    try:
        flow = load_flow(flow_id)
    except FileNotFoundError:
        print(f"❌ 流程不存在: {flow_id}")
        return 1
    issues = validate_flow(flow)
    if not issues:
        print(f"✅ {flow_id} 校验通过")
        return 0
    for lv, msg in issues:
        print(f"  {'❌' if lv == 'error' else '⚠️ '} [{lv}] {msg}")
    return 1 if any(lv == "error" for lv, _ in issues) else 0


def cmd_new(flow_id, name=None):
    """从模板创建新流程（沉淀脚手架）"""
    ensure_dirs()
    flow_file = FLOWS_DIR / f"{flow_id}.json"
    if flow_file.exists():
        print(f"❌ 流程已存在: {flow_file}")
        return 1
    template_file = FLOWS_DIR / "_template.json"
    if not template_file.exists():
        print(f"❌ 模板不存在: {template_file}")
        return 1
    content = template_file.read_text(encoding="utf-8")
    content = content.replace("__FLOW_ID__", flow_id)
    content = content.replace("__FLOW_NAME__", name or flow_id)
    flow_file.write_text(content, encoding="utf-8")
    print(f"✅ 已创建流程: {flow_file}")
    print("   下一步:")
    print("   1. 编辑流程定义（URL、步骤、validate、heal.hints）")
    print(f"   2. 创建提取脚本: extracts/{flow_id}.js（IIFE 包裹）")
    print(f"   3. 校验: python3 manager.py validate {flow_id}")
    print(f"   4. 试跑: python3 manager.py run {flow_id} -v")
    return 0


def cmd_history(flow_id=None, last=15):
    """查看运行历史"""
    entries = show_history(flow_id, last=last)
    if not entries:
        print("没有运行记录")
        return

    print(f"\n{'时间':<20} {'流程':<22} {'状态':<8} {'耗时':>8} {'错误'}")
    print("-" * 95)
    for e in entries:
        status_icon = {"success": "✅", "failed": "❌", "error": "💥"}.get(e["status"], "❓")
        duration = f"{e['duration_ms']:.0f}ms" if e.get("duration_ms") else "-"
        error = (e.get("error") or "")[:50]
        print(f"{e['timestamp']:<20} {e['flow_id']:<22} {status_icon} {e['status']:<6} {duration:>8} {error}")

    print()


def _set_enabled(flow_id, enabled):
    flow_file = FLOWS_DIR / f"{flow_id}.json"
    if not flow_file.exists():
        print(f"❌ 流程不存在: {flow_id}")
        return
    with open(flow_file, encoding="utf-8") as f:
        data = json.load(f)
    data["enabled"] = enabled
    with open(flow_file, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print(f"{'✅ 已启用' if enabled else '⏸ 已禁用'}: {flow_id}")


def cmd_retry(flow_id):
    """重试上次失败的流程"""
    history = show_history(flow_id, last=1)
    if not history:
        print(f"没有 {flow_id} 的运行记录")
        return
    last = history[-1]
    if last["status"] == "success":
        print("✅ 上次运行已成功，无需重试")
        return
    print(f"↻ 上次运行失败于 {last['timestamp']}，错误: {(last.get('error') or 'unknown')[:80]}")
    print("   重新执行（沿用上次参数）...")
    cmd_run(flow_id, params=last.get("params"))


def cmd_heals():
    """查看自愈记录"""
    heals_file = LEARNINGS_DIR / "heals.jsonl"
    if not heals_file.exists():
        print("没有自愈记录")
        return

    entries = []
    with open(heals_file, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                try:
                    entries.append(json.loads(line))
                except json.JSONDecodeError:
                    pass

    if not entries:
        print("没有自愈记录")
        return

    print(f"\n{'时间':<22} {'事件':<10} {'流程':<20} {'步骤':<18} {'类型/原因'}")
    print("-" * 100)
    for e in entries[-20:]:
        ts = str(e.get("timestamp", ""))[:19]
        event = e.get("event", "?")
        detail = e.get("error_type") or e.get("reason", "")
        print(f"{ts:<22} {event:<10} {e.get('flow_id', '?'):<20} "
              f"{e.get('step_id', '?'):<18} {str(detail)[:40]}")

    print()


def cmd_stats():
    """运行统计"""
    all_entries = show_history(last=1000)
    if not all_entries:
        print("没有运行记录")
        return

    total = len(all_entries)
    success = sum(1 for e in all_entries if e["status"] == "success")
    failed = sum(1 for e in all_entries if e["status"] == "failed")
    errors = sum(1 for e in all_entries if e["status"] == "error")

    print(f"\n📊 运行统计 (最近 {total} 次)")
    print(f"  ✅ 成功: {success} ({success / total * 100:.0f}%)")
    print(f"  ❌ 失败: {failed} ({failed / total * 100:.0f}%)")
    print(f"  💥 异常: {errors} ({errors / total * 100:.0f}%)")

    by_flow = {}
    for e in all_entries:
        fid = e["flow_id"]
        by_flow.setdefault(fid, {"total": 0, "success": 0})
        by_flow[fid]["total"] += 1
        if e["status"] == "success":
            by_flow[fid]["success"] += 1

    print("\n按流程:")
    for fid, stats in sorted(by_flow.items()):
        rate = stats["success"] / stats["total"] * 100 if stats["total"] else 0
        print(f"  {fid:<25} {stats['success']}/{stats['total']} ({rate:.0f}%)")

    print()


def cmd_cron_setup():
    """显示 cron 配置建议"""
    flows = [f for f in list_flows() if f.get("enabled") and f.get("schedule")]
    if not flows:
        print("没有配置了调度计划的流程")
        return

    print("\n📅 建议的 crontab 配置:")
    print("  运行: crontab -e")
    print("  添加以下内容:\n")
    for f in flows:
        print(f"  {f['schedule']}  cd {SCRIPTS_DIR} && python3 flow_engine.py run {f['id']} "
              f">> logs/cron_{f['id']}.log 2>&1")
    print()


HELP = """
用法: python3 manager.py <命令> [参数]

命令:
  list                       列出所有流程及状态
  run <flow_id> [-p k=v]...  执行指定流程（-p 可重复传参，--no-heal 禁用自愈）
  run-all                    执行所有已启用流程
  retry <flow_id>            重试上次失败的流程（沿用上次参数）
  new <flow_id> [名称]       从模板创建新流程（沉淀脚手架）
  validate <flow_id>         静态校验流程定义
  history [flow_id]          查看运行历史
  enable/disable <flow_id>   启用/禁用流程
  heals                      查看自愈记录
  stats                      运行统计
  cron                       显示 cron 配置建议

选项:
  -v, --verbose              详细输出
  -p, --param k=v            流程参数（仅 run，可重复）
  --no-heal                  失败时不触发自愈（仅 run）

示例:
  python3 manager.py run switch_language -p target_lang=en-US -p store_name=前行信息
  python3 manager.py new traffic_report 商品流量报告
"""


def main():
    ensure_dirs()
    argv = sys.argv[1:]

    if not argv or argv[0] in ("-h", "--help"):
        print_banner()
        print(HELP)
        return

    cmd = argv[0]
    verbose = "-v" in argv or "--verbose" in argv
    no_heal = "--no-heal" in argv

    # 提取 -p/--param k=v
    param_pairs = []
    rest = []
    i = 1
    while i < len(argv):
        a = argv[i]
        if a in ("-p", "--param") and i + 1 < len(argv):
            param_pairs.append(argv[i + 1])
            i += 2
            continue
        if a not in ("-v", "--verbose", "--no-heal"):
            rest.append(a)
        i += 1
    params = parse_params(param_pairs)

    if cmd == "list":
        cmd_list()
    elif cmd == "run":
        if not rest:
            print("用法: manager.py run <flow_id> [-p k=v]...")
            return
        sys.exit(cmd_run(rest[0], verbose=verbose, params=params, heal=not no_heal))
    elif cmd == "run-all":
        cmd_run_all()
    elif cmd == "retry":
        if not rest:
            print("用法: manager.py retry <flow_id>")
            return
        cmd_retry(rest[0])
    elif cmd == "new":
        if not rest:
            print("用法: manager.py new <flow_id> [名称]")
            return
        sys.exit(cmd_new(rest[0], rest[1] if len(rest) > 1 else None))
    elif cmd == "validate":
        if not rest:
            print("用法: manager.py validate <flow_id>")
            return
        sys.exit(cmd_validate(rest[0]))
    elif cmd == "history":
        cmd_history(rest[0] if rest else None)
    elif cmd == "enable":
        if rest:
            _set_enabled(rest[0], True)
    elif cmd == "disable":
        if rest:
            _set_enabled(rest[0], False)
    elif cmd == "heals":
        cmd_heals()
    elif cmd == "stats":
        cmd_stats()
    elif cmd == "cron":
        cmd_cron_setup()
    else:
        print(f"未知命令: {cmd}")
        print("运行 manager.py --help 查看帮助")


if __name__ == "__main__":
    main()
