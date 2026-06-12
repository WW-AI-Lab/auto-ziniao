#!/usr/bin/env python3
"""
紫鸟自动化流程引擎 — 执行流程定义、参数化、分支跳转、结果校验、异常控制、自愈触发。
0 tokens 运行：不调用任何 AI，纯脚本执行。

核心能力：
- 参数化：flow JSON 的 params 为默认值，CLI -p k=v 覆盖，步骤中用 ${params.k} 引用
- 真实分支：步骤级 goto / branch 动作 / on_fail.branch 均支持跳转到任意步骤 id（或 "end"）
- 结果校验：步骤级 validate（not_empty / min_rows / require_fields / contains）
- 失败追踪：精确记录失败步骤 id / tool / args，失败时自动截图，供自愈 Agent 使用
- 自愈触发：最终失败时调用 self_heal.trigger_heal（含已知问题匹配与冷却）
"""

import json
import time
import csv
import re
import traceback
from datetime import datetime

from .zclaw_client import ZClawClient, ZClawError
from .self_heal import trigger_heal, check_known_issues
from .paths import (
    REPO_ROOT, FLOWS_DIR, EXTRACTS_DIR, OUTPUT_DIR, LOGS_DIR, LEARNINGS_DIR,
)

# ZClaw bridge 的合法工具名（与 GET /zclaw/tools 对齐，validate 用）
KNOWN_TOOLS = {
    "list_stores", "resolve_store", "open_store", "close_store",
    "visit_page", "get_page_content",
    "query_elements", "click_element", "input_text", "scroll_page", "take_screenshot",
    "wait_for_element", "wait_for_navigation",
    "execute_script", "run_automation", "extract_data",
    "prepare_agent", "download_file", "get_logs", "debug_compare_lists",
}

# 引擎内置动作
KNOWN_ACTIONS = {
    "sleep", "save_csv", "save_json", "print", "assert",
    "close_store", "goto", "branch", "fail",
}

ON_FAIL_ACTIONS = {"abort", "retry", "skip", "branch", "heal"}


def ensure_dirs():
    for d in [FLOWS_DIR, EXTRACTS_DIR, OUTPUT_DIR, LOGS_DIR, LEARNINGS_DIR]:
        d.mkdir(parents=True, exist_ok=True)


def now_str():
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def today_str():
    return datetime.now().strftime("%Y-%m-%d")


class FlowError(Exception):
    """流程定义或执行错误"""


class ValidationError(FlowError):
    """步骤结果校验失败"""


def log_run(flow_id, status, duration_ms, error=None, data=None, params=None):
    """追加运行日志"""
    ensure_dirs()
    entry = {
        "flow_id": flow_id,
        "timestamp": now_str(),
        "status": status,
        "duration_ms": round(duration_ms),
        "error": str(error)[:500] if error else None,
    }
    if params:
        entry["params"] = {k: str(v)[:100] for k, v in params.items()}
    if data:
        entry["data_summary"] = {k: str(v)[:200] for k, v in data.items()}
    log_file = LOGS_DIR / "runs.jsonl"
    with open(log_file, "a", encoding="utf-8") as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")


class FlowRunner:
    """流程执行器"""

    def __init__(self, verbose=False, heal=True):
        self.client = ZClawClient(verbose=verbose)
        self.context = {}          # 步骤间共享的变量（save 写入）
        self.verbose = verbose
        self.heal_enabled = heal
        self.store_id = None
        self.target_id = None
        self.current_step = None   # 正在执行的步骤（dict）
        self.failed_step = None    # 最终失败的步骤信息（dict）

    def log(self, msg):
        ts = datetime.now().strftime("%H:%M:%S")
        print(f"[{ts}] {msg}")

    # ------------------------------------------------------------------
    # 流程级执行
    # ------------------------------------------------------------------

    def run_flow(self, flow_def, params=None):
        """执行一个流程定义。params 覆盖 flow JSON 中的 params 默认值。"""
        flow_id = flow_def.get("id", "unknown")
        flow_name = flow_def.get("name", flow_id)
        max_attempts = flow_def.get("retry", {}).get("maxAttempts", 1)
        retry_delay = flow_def.get("retry", {}).get("delayMs", 3000) / 1000

        # 合并参数：flow 默认值 < 调用方传入
        defaults = {k: v for k, v in flow_def.get("params", {}).items()
                    if not k.startswith("_")}
        merged_params = {**defaults, **(params or {})}

        self.log(f"▶ 开始流程: {flow_name} (v{flow_def.get('version', 1)})")
        if merged_params:
            self.log(f"  参数: {json.dumps(merged_params, ensure_ascii=False)}")
        start_time = time.time()

        for attempt in range(1, max_attempts + 1):
            # 每次重试重置上下文（保留参数）
            self.context = {"params": merged_params}
            self.failed_step = None
            try:
                if attempt > 1:
                    self.log(f"  ↻ 重试第 {attempt}/{max_attempts} 次，等待 {retry_delay}s")
                    time.sleep(retry_delay)

                result = self._execute_steps(flow_def.get("steps", []))
                duration = (time.time() - start_time) * 1000
                self.log(f"✅ 流程完成: {flow_name} ({duration:.0f}ms)")
                log_run(flow_id, "success", duration, data=result, params=merged_params)

                if flow_def.get("on_success", {}).get("close_store", True):
                    self._cleanup_store()

                return {"status": "success", "data": result}

            except (ZClawError, FlowError) as e:
                duration = (time.time() - start_time) * 1000
                if attempt < max_attempts:
                    self.log(f"  ⚠ 步骤失败: {e}，准备重试...")
                    continue
                self.log(f"❌ 流程失败: {flow_name}")
                self.log(f"   错误: {e}")
                log_run(flow_id, "failed", duration, error=e, params=merged_params)
                heal_info = self._trigger_self_heal(flow_def, e)
                if flow_def.get("on_fail_final", {}).get("close_store", True):
                    self._cleanup_store()
                return {"status": "failed", "error": str(e), "heal": heal_info,
                        "failed_step": self.failed_step}

            except Exception as e:
                duration = (time.time() - start_time) * 1000
                self.log(f"❌ 未预期错误: {e}")
                traceback.print_exc()
                log_run(flow_id, "error", duration, error=e, params=merged_params)
                heal_info = self._trigger_self_heal(flow_def, e)
                if flow_def.get("on_fail_final", {}).get("close_store", True):
                    self._cleanup_store()
                return {"status": "error", "error": str(e), "heal": heal_info,
                        "failed_step": self.failed_step}

        return {"status": "exhausted", "error": "所有重试均失败"}

    # ------------------------------------------------------------------
    # 步骤级执行（支持分支跳转）
    # ------------------------------------------------------------------

    def _execute_steps(self, steps):
        """执行步骤列表，支持 goto / branch / on_fail.branch 跳转。"""
        id_index = {}
        for i, s in enumerate(steps):
            sid = s.get("id")
            if sid:
                if sid in id_index:
                    raise FlowError(f"步骤 id 重复: {sid}")
                id_index[sid] = i

        results = {}
        i = 0
        executed = 0
        max_exec = max(100, len(steps) * 10)  # 防分支死循环

        while 0 <= i < len(steps):
            step = steps[i]
            step_id = step.get("id", f"step_{i}")
            executed += 1
            if executed > max_exec:
                raise FlowError(f"步骤执行次数超过 {max_exec}，疑似分支死循环，已中止")

            # 条件跳过
            if step.get("condition") and not self._eval_condition(step["condition"]):
                self.log(f"  ⊘ [{step_id}] 条件不满足，跳过")
                i += 1
                continue

            # 分支动作：纯跳转，不执行工具
            if step.get("action") == "branch":
                target = self._eval_branch(step)
                self.log(f"  ⑂ [{step_id}] 分支 → {target or '(顺序继续)'}")
                if target == "end":
                    break
                if target:
                    i = self._resolve_target(target, id_index, step_id)
                    continue
                i += 1
                continue

            if step.get("action") == "goto":
                target = step.get("target")
                self.log(f"  ↪ [{step_id}] goto → {target}")
                if target == "end":
                    break
                i = self._resolve_target(target, id_index, step_id)
                continue

            label = step.get("action") or step.get("tool")
            self.log(f"  → [{step_id}] {label}")
            self.current_step = step

            try:
                result = self._execute_step_with_retry(step)
            except Exception as e:
                on_fail = step.get("on_fail", {})
                fail_action = on_fail.get("action", "abort")

                if fail_action == "skip":
                    self.log(f"    ⊘ 失败但标记为可跳过: {e}")
                    results[step_id] = {"skipped": True, "error": str(e)}
                    i += 1
                    continue

                if fail_action == "branch":
                    target = on_fail.get("target")
                    self.log(f"    ⑂ 失败分支 → {target}")
                    results[step_id] = {"failed": True, "branched_to": target,
                                        "error": str(e)}
                    if target == "end":
                        break
                    i = self._resolve_target(target, id_index, step_id)
                    continue

                # abort / heal（heal 在流程级统一触发，这里记录失败现场）
                self._record_failure(step, e)
                raise

            results[step_id] = result
            save_key = step.get("save")
            if save_key:
                self.context[save_key] = result

            # 结果校验（校验失败按 on_fail 处理，这里直接走 abort 语义）
            try:
                self._validate_result(step, result)
            except ValidationError as e:
                self.log(f"    ✗ 校验失败: {e}")
                self._record_failure(step, e)
                raise

            # 成功后的跳转
            target = None
            if step.get("branch"):
                target = self._eval_branch({"branch": step["branch"]})
            elif step.get("goto"):
                target = step["goto"]
            if target:
                self.log(f"    ↪ 跳转 → {target}")
                if target == "end":
                    break
                i = self._resolve_target(target, id_index, step_id)
                continue

            i += 1

        return results

    def _resolve_target(self, target, id_index, from_step):
        if not target or target not in id_index:
            raise FlowError(f"步骤 {from_step} 的跳转目标不存在: {target}")
        return id_index[target]

    def _eval_branch(self, step):
        """评估分支：cases 里第一个条件成立的 goto，否则 default。

        格式: {"action":"branch", "cases":[{"condition":{...},"goto":"x"}], "default":"y"}
        或步骤内 "branch": {"cases":[...], "default":"y"}
        """
        spec = step.get("branch") or step
        for case in spec.get("cases", []):
            if self._eval_condition(case.get("condition", {})):
                return case.get("goto")
        return spec.get("default")

    def _execute_step_with_retry(self, step):
        """执行单步，处理 on_fail.retry 本地重试。"""
        on_fail = step.get("on_fail", {})
        if on_fail.get("action") != "retry":
            return self._execute_step(step)

        delay = on_fail.get("delayMs", 3000) / 1000
        max_retries = max(1, on_fail.get("maxAttempts", 3))
        last_err = None
        for attempt in range(1, max_retries + 1):
            try:
                return self._execute_step(step)
            except Exception as e:
                last_err = e
                if attempt < max_retries:
                    self.log(f"    ↻ 重试 {attempt}/{max_retries - 1}，等待 {delay}s（{e}）")
                    time.sleep(delay)
        self._record_failure(step, last_err)
        raise last_err

    def _record_failure(self, step, error):
        """记录失败现场，供自愈使用"""
        args = step.get("args", {})
        try:
            args = self._resolve_vars(args)
        except Exception:
            pass
        self.failed_step = {
            "step_id": step.get("id", "unknown"),
            "tool": step.get("tool"),
            "action": step.get("action"),
            "args": args,
            "heal_context": step.get("on_fail", {}).get("context"),
            "error": str(error)[:500],
        }

    # ------------------------------------------------------------------
    # 单步执行
    # ------------------------------------------------------------------

    def _execute_step(self, step):
        if step.get("tool"):
            return self._execute_tool(step)
        if step.get("action"):
            return self._execute_action(step)
        raise FlowError(f"步骤缺少 tool 或 action: {step.get('id')}")

    def _param(self, key, default=None):
        return self.context.get("params", {}).get(key, default)

    def _execute_tool(self, step):
        """执行 ZClaw 工具调用"""
        tool = step["tool"]
        args = self._resolve_vars(step.get("args", {}))

        if tool == "list_stores":
            stores = self.client.list_stores()
            return {"items": stores, "count": len(stores)}

        elif tool == "open_store":
            # 店铺选择优先级: args.storeId/storeName > params.store_id/store_name
            #                > store_selector(first) 从 list_stores 结果取
            if not args.get("storeId") and not args.get("storeName"):
                p_id = self._param("store_id")
                p_name = self._param("store_name")
                if p_id:
                    args["storeId"] = p_id
                elif p_name:
                    args["storeName"] = p_name
                else:
                    stores_data = self.context.get("stores", {})
                    items = stores_data.get("items", []) or self.client.list_stores()
                    if not items:
                        raise ZClawError("没有找到任何店铺")
                    selector = step.get("store_selector", "first")
                    if selector == "first":
                        args["storeId"] = items[0]["storeId"]
                    else:
                        raise FlowError(f"未知的店铺选择策略: {selector}")
            data = self.client.open_store(
                store_id=args.get("storeId"),
                store_name=args.get("storeName"),
                launch_url=args.get("launchUrl"),
            )
            self.store_id = data.get("storeId")
            self.client.store_id = self.store_id
            target = data.get("targetId")
            if target:
                self.target_id = target
                self.client.target_id = target
            return data

        elif tool == "visit_page":
            data = self.client.visit(
                url=args["url"],
                wait_until=args.get("waitUntil", "domcontentloaded"),
                timeout_ms=args.get("timeoutMs", 30000),
            )
            new_target = data.get("data", {}).get("targetId")
            if new_target:
                self.target_id = new_target
                self.client.target_id = new_target
            return data

        elif tool == "execute_script":
            script = args.get("script", "")
            # 支持 @extracts/xxx.js 文件引用（文件内容同样做变量替换）
            if script.startswith("@"):
                script_path = REPO_ROOT / script[1:]
                if not script_path.exists():
                    raise FlowError(f"脚本文件不存在: {script_path}")
                script = self._resolve_var_in_text(
                    script_path.read_text(encoding="utf-8"))
            return self.client.js(script, return_by_value=args.get("returnByValue", True))

        elif tool == "click_element":
            return self.client.click(
                selector=args.get("selector"),
                hint=args.get("hint"),
                wait_for_nav=args.get("waitForNavigation", False),
                timeout_ms=args.get("timeoutMs", 10000),
            )

        elif tool == "take_screenshot":
            path = self.client.screenshot(
                full_page=args.get("fullPage", False),
                format=args.get("format", "png"),
            )
            return {"filePath": path}

        elif tool == "wait_for_element":
            return self.client.wait_element(
                selector=args["selector"],
                timeout_ms=args.get("timeoutMs", 10000),
                state=args.get("state", "visible"),
            )

        elif tool == "close_store":
            return self.client.close_store()

        else:
            # 通用工具调用（storeId/targetId 由 client 自动注入）
            return self.client.invoke(tool, args)

    def _execute_action(self, step):
        """执行内置动作"""
        action = step["action"]

        if action == "sleep":
            seconds = self._resolve_var(step.get("seconds", 1))
            time.sleep(float(seconds))
            return {"slept": seconds}

        elif action == "save_csv":
            data = self._resolve_var(step.get("data"))
            header = self._resolve_var(step.get("header"))
            filename = self._resolve_var(step.get("filename", "output.csv"))
            if not filename.startswith("/"):
                filename = str(OUTPUT_DIR / filename)
            ensure_dirs()
            with open(filename, "w", newline="", encoding="utf-8-sig") as f:
                writer = csv.writer(f)
                if header:
                    writer.writerow(header)
                if isinstance(data, list):
                    for row in data:
                        writer.writerow(row)
            return {"filePath": filename,
                    "rows": len(data) if isinstance(data, list) else 0}

        elif action == "save_json":
            data = self._resolve_var(step.get("data"))
            filename = self._resolve_var(step.get("filename", "output.json"))
            if not filename.startswith("/"):
                filename = str(OUTPUT_DIR / filename)
            ensure_dirs()
            with open(filename, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
            return {"filePath": filename}

        elif action == "print":
            msg = self._resolve_var(step.get("message", ""))
            print(f"    📢 {msg}")
            return {"printed": msg}

        elif action == "assert":
            value = self._resolve_var(step.get("value"))
            expected = self._resolve_var(step.get("expected"))
            check = step.get("check", "eq")
            ok = {
                "eq": lambda: value == expected,
                "ne": lambda: value != expected,
                "gt": lambda: value > expected,
                "contains": lambda: expected in str(value),
                "not_empty": lambda: bool(value) and value not in ("", [], {}),
            }.get(check, lambda: True)()
            if not ok:
                raise AssertionError(
                    f"断言失败({check}): value={str(value)[:100]} expected={expected}")
            return {"asserted": True}

        elif action == "fail":
            # 主动失败（配合分支用于"页面状态异常"等场景，触发 on_fail/自愈）
            raise FlowError(self._resolve_var(step.get("message", "流程主动标记失败")))

        elif action == "close_store":
            return self._cleanup_store()

        else:
            raise FlowError(f"未知动作: {action}")

    # ------------------------------------------------------------------
    # 结果校验
    # ------------------------------------------------------------------

    def _validate_result(self, step, result):
        """按 step.validate 规则校验步骤结果。

        支持: {"path": "products", "not_empty": true, "min_rows": 1,
               "require_fields": ["asin"], "contains": "xx"}
        """
        rules = step.get("validate")
        if not rules:
            return
        data = result
        path = rules.get("path")
        if path:
            for part in path.split("."):
                if isinstance(data, dict):
                    data = data.get(part)
                else:
                    data = None
                    break

        sid = step.get("id", "?")
        if rules.get("not_empty") and (data is None or data == "" or data == [] or data == {}):
            raise ValidationError(f"步骤 {sid} 结果为空 (path={path or '.'})")

        min_rows = rules.get("min_rows")
        if min_rows is not None:
            n = len(data) if isinstance(data, (list, dict, str)) else 0
            if n < min_rows:
                raise ValidationError(
                    f"步骤 {sid} 行数不足: {n} < {min_rows} (path={path or '.'})")

        for field in rules.get("require_fields", []):
            row = data[0] if isinstance(data, list) and data else data
            if not isinstance(row, dict) or row.get(field) is None:
                raise ValidationError(f"步骤 {sid} 缺少必需字段: {field}")

        contains = rules.get("contains")
        if contains and contains not in str(data):
            raise ValidationError(f"步骤 {sid} 结果不包含: {contains}")

    # ------------------------------------------------------------------
    # 自愈
    # ------------------------------------------------------------------

    def _trigger_self_heal(self, flow_def, error):
        """最终失败后触发自愈。返回触发结果摘要（写入运行结果）。"""
        flow_id = flow_def.get("id", "unknown")
        flow_name = flow_def.get("name", flow_id)

        if not self.heal_enabled:
            self.log("  ⊘ 自愈已被命令行禁用 (--no-heal)")
            return {"triggered": False, "reason": "disabled_by_cli"}
        if flow_def.get("on_fail_final", {}).get("heal") is False:
            self.log("  ⊘ 流程禁用了自愈")
            return {"triggered": False, "reason": "disabled_by_flow"}

        failed = self.failed_step or {}
        step_id = failed.get("step_id", "unknown")
        tool_name = failed.get("tool") or failed.get("action") or "unknown"

        # 已知问题：命中则不再烧 tokens
        known_fix = check_known_issues(flow_id, step_id, error)
        if known_fix:
            self.log(f"  📖 命中已知问题: {known_fix.get('pattern', '')[:60]}")
            self.log(f"     修复方案: {known_fix.get('fix', '')[:80]}")
            return {"triggered": False, "reason": "known_issue",
                    "known_fix": known_fix}

        # 失败现场截图（尽力而为）
        screenshot_path = None
        if self.store_id:
            try:
                screenshot_path = self.client.screenshot()
                self.log(f"  📸 失败现场截图: {screenshot_path}")
            except Exception:
                pass

        self.log("  🔧 触发自愈 Agent...")
        try:
            result = trigger_heal(
                flow_id=flow_id,
                flow_name=flow_name,
                step_id=step_id,
                tool_name=tool_name,
                error=error,
                context={
                    "store_id": self.store_id,
                    "target_id": self.target_id,
                    "failed_step": failed,
                    "screenshot": screenshot_path,
                    "params": self.context.get("params", {}),
                    "heal_context": failed.get("heal_context"),
                },
                heal_section=flow_def.get("heal", {}),
            )
            if result.get("success"):
                self.log(f"  ✅ 自愈已触发 (heal_id={result.get('heal_id')})")
            elif result.get("skipped"):
                self.log(f"  ⊘ 自愈跳过: {result.get('reason')}")
            elif result.get("dry_run"):
                self.log(f"  📝 [DRY RUN] 提示词已生成: {result.get('prompt_path')}")
            else:
                self.log(f"  ⚠ 自愈触发失败: {result.get('error', 'unknown')}")
            result["triggered"] = bool(result.get("success"))
            return result
        except Exception as e:
            self.log(f"  ⚠ 自愈调用异常: {e}")
            return {"triggered": False, "error": str(e)}

    def _cleanup_store(self):
        """关闭店铺（安全清理）"""
        if self.store_id:
            try:
                self.client.close_store()
                self.log(f"  🔒 店铺已关闭: {self.store_id}")
            except Exception as e:
                self.log(f"  ⚠ 关闭店铺失败: {e}")
            self.store_id = None
            self.client.store_id = None
        return {"closed": True}

    # ------------------------------------------------------------------
    # 条件与变量
    # ------------------------------------------------------------------

    def _eval_condition(self, condition):
        """评估条件表达式 {type, left, right}"""
        cond_type = condition.get("type", "eq")
        left = self._resolve_var(condition.get("left"))
        right = self._resolve_var(condition.get("right"))

        try:
            if cond_type == "eq":
                return left == right
            if cond_type == "ne":
                return left != right
            if cond_type == "contains":
                return str(right) in str(left)
            if cond_type == "not_contains":
                return str(right) not in str(left)
            if cond_type == "starts_with":
                return str(left).startswith(str(right))
            if cond_type == "is_true":
                return bool(left) and left not in ("false", "False", "0")
            if cond_type == "is_false":
                return not bool(left) or left in ("false", "False", "0")
            if cond_type == "gt":
                return float(left) > float(right)
            if cond_type == "lt":
                return float(left) < float(right)
            if cond_type == "is_empty":
                return left is None or left == "" or left == [] or left == {}
            if cond_type == "not_empty":
                return not (left is None or left == "" or left == [] or left == {})
        except (TypeError, ValueError):
            return False
        return True

    def _resolve_vars(self, obj):
        """递归解析变量引用"""
        if isinstance(obj, str):
            return self._resolve_var(obj)
        if isinstance(obj, dict):
            return {k: self._resolve_vars(v) for k, v in obj.items()}
        if isinstance(obj, list):
            return [self._resolve_vars(v) for v in obj]
        return obj

    def _resolve_var(self, value):
        """解析单个变量引用 ${xxx}（纯引用返回原始类型）"""
        if not isinstance(value, str) or "${" not in value:
            return value

        pure_match = re.match(r'^\$\{([^}]+)\}$', value)
        if pure_match:
            resolved = self._lookup_context(pure_match.group(1))
            if resolved is not None:
                return resolved

        return self._resolve_var_in_text(value)

    def _resolve_var_in_text(self, text):
        """字符串内嵌变量替换（未命中的 ${...} 保留原样，兼容 JS 模板字符串）"""
        def replace_var(match):
            resolved = self._lookup_context(match.group(1))
            return match.group(0) if resolved is None else str(resolved)
        return re.sub(r'\$\{([^}]+)\}', replace_var, text)

    def _lookup_context(self, path):
        """从上下文中查找变量值；内置 date/datetime/timestamp"""
        if path == "date":
            return today_str()
        if path == "datetime":
            return now_str()
        if path == "timestamp":
            return str(int(time.time()))
        parts = path.split(".")
        obj = self.context
        for part in parts:
            if isinstance(obj, dict):
                obj = obj.get(part)
                if obj is None:
                    return None
            elif isinstance(obj, list) and part.isdigit():
                idx = int(part)
                if idx >= len(obj):
                    return None
                obj = obj[idx]
            else:
                return None
        return obj


# ----------------------------------------------------------------------
# 流程加载 / 校验 / 查询
# ----------------------------------------------------------------------

def load_flow(flow_id):
    """加载流程定义"""
    flow_file = FLOWS_DIR / f"{flow_id}.json"
    if not flow_file.exists():
        raise FileNotFoundError(f"流程文件不存在: {flow_file}")
    with open(flow_file, encoding="utf-8") as f:
        return json.load(f)


def validate_flow(flow_def):
    """静态校验流程定义，返回问题列表 [(level, message)]。level: error|warn"""
    issues = []

    def err(msg):
        issues.append(("error", msg))

    def warn(msg):
        issues.append(("warn", msg))

    if not flow_def.get("id"):
        err("缺少 id 字段")
    steps = flow_def.get("steps")
    if not isinstance(steps, list) or not steps:
        err("steps 必须是非空数组")
        return issues

    ids = set()
    for i, step in enumerate(steps):
        sid = step.get("id")
        if not sid:
            warn(f"第 {i} 步缺少 id（跳转将无法指向它）")
            continue
        if sid in ids:
            err(f"步骤 id 重复: {sid}")
        ids.add(sid)

    valid_targets = ids | {"end"}
    params = {k for k in flow_def.get("params", {}) if not k.startswith("_")}

    for step in steps:
        sid = step.get("id", "?")
        tool = step.get("tool")
        action = step.get("action")
        if not tool and not action:
            err(f"步骤 {sid} 缺少 tool 或 action")
        if tool and tool not in KNOWN_TOOLS:
            err(f"步骤 {sid} 使用了未知工具: {tool}（合法工具见 GET /zclaw/tools）")
        if action and action not in KNOWN_ACTIONS:
            warn(f"步骤 {sid} 使用了未知动作: {action}")

        on_fail = step.get("on_fail", {})
        if on_fail:
            fa = on_fail.get("action", "abort")
            if fa not in ON_FAIL_ACTIONS:
                err(f"步骤 {sid} 的 on_fail.action 非法: {fa}")
            if fa == "branch" and on_fail.get("target") not in valid_targets:
                err(f"步骤 {sid} 的 on_fail.target 不存在: {on_fail.get('target')}")

        # 跳转目标
        targets = []
        if step.get("goto"):
            targets.append(step["goto"])
        if action == "goto":
            targets.append(step.get("target"))
        branch = step.get("branch") or (step if action == "branch" else None)
        if branch:
            for case in branch.get("cases", []):
                targets.append(case.get("goto"))
            if branch.get("default"):
                targets.append(branch["default"])
        for t in targets:
            if t not in valid_targets:
                err(f"步骤 {sid} 跳转目标不存在: {t}")

        # @extracts 引用
        script = step.get("args", {}).get("script", "")
        if isinstance(script, str) and script.startswith("@"):
            if not (REPO_ROOT / script[1:]).exists():
                err(f"步骤 {sid} 引用的脚本文件不存在: {script}")

        # ${params.x} 引用检查
        raw = json.dumps(step, ensure_ascii=False)
        for m in re.finditer(r'\$\{params\.([A-Za-z0-9_]+)\}', raw):
            if m.group(1) not in params:
                warn(f"步骤 {sid} 引用了未声明的参数: params.{m.group(1)}")

    return issues


def run_flow(flow_id, verbose=False, params=None, heal=True):
    """运行指定流程"""
    ensure_dirs()
    flow_def = load_flow(flow_id)
    issues = [m for lv, m in validate_flow(flow_def) if lv == "error"]
    if issues:
        raise FlowError("流程定义校验失败: " + "; ".join(issues))
    runner = FlowRunner(verbose=verbose, heal=heal)
    return runner.run_flow(flow_def, params=params)


def list_flows():
    """列出所有流程"""
    ensure_dirs()
    flows = []
    for f in sorted(FLOWS_DIR.glob("*.json")):
        if f.name.startswith("_"):
            continue
        try:
            with open(f, encoding="utf-8") as fh:
                defn = json.load(fh)
            flows.append({
                "id": defn.get("id", f.stem),
                "name": defn.get("name", f.stem),
                "version": defn.get("version", 1),
                "enabled": defn.get("enabled", True),
                "schedule": defn.get("schedule", ""),
                "params": {k: v for k, v in defn.get("params", {}).items()
                           if not k.startswith("_")},
                "file": f.name,
            })
        except Exception:
            flows.append({"id": f.stem, "name": f.stem, "error": "解析失败"})
    return flows


def show_history(flow_id=None, last=10):
    """查看运行历史"""
    log_file = LOGS_DIR / "runs.jsonl"
    if not log_file.exists():
        return []
    entries = []
    with open(log_file, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
                if flow_id and entry.get("flow_id") != flow_id:
                    continue
                entries.append(entry)
            except json.JSONDecodeError:
                continue
    return entries[-last:]


def parse_params(pairs):
    """解析 CLI 传入的 k=v 参数列表"""
    params = {}
    for pair in pairs or []:
        if "=" not in pair:
            raise ValueError(f"参数格式应为 key=value: {pair}")
        k, v = pair.split("=", 1)
        params[k.strip()] = v.strip()
    return params


# CLI 入口统一收敛到仓库根 manager.py（run/list/validate/history 等命令均由其提供）
