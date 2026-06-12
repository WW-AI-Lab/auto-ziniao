#!/usr/bin/env python3
"""
紫鸟自动化自愈触发器 — 脚本失败时组装上下文、生成提示词、调用 Agent CLI 触发修复。

设计原则：
- 脚本只负责「发现问题 + 组装上下文 + 触发」
- Agent（OpenClaw / Claude Code / Cursor 等，可在 config.json 配置）负责
  「诊断 + 修复 + 验证 + 固化」
- 修复后写入 learnings/known_issues.json，下次同类问题不再触发 Agent（0 tokens）
- 冷却机制防止 cron 反复失败导致的「自愈风暴」烧 tokens

提示词模板查找顺序（支持按流程定制）：
  heal_templates/<flow_id>/<error_type>.md
  heal_templates/<flow_id>/generic.md
  heal_templates/<error_type>.md
  heal_templates/generic.md
  内置默认模板
"""

import json
import subprocess
import time
from datetime import datetime, timedelta
from pathlib import Path

SCRIPTS_DIR = Path(__file__).parent
LOGS_DIR = SCRIPTS_DIR / "logs"
LEARNINGS_DIR = SCRIPTS_DIR / "learnings"
HEAL_LOGS_DIR = LOGS_DIR / "heals"
TEMPLATES_DIR = SCRIPTS_DIR / "heal_templates"
CONFIG_PATH = SCRIPTS_DIR / "config.json"

DEFAULT_CONFIG = {
    "heal": {
        "enabled": True,
        "agent": "openclaw",
        "cooldown_minutes": 60,
        "max_per_day": 5,
        "agents": {
            "openclaw": {
                "command": ["openclaw", "agent",
                            "--session-key", "{session_key}",
                            "--message", "{prompt}",
                            "--deliver", "--channel", "feishu",
                            "--timeout", "300"],
                "timeout_sec": 320
            },
            "claude": {
                "command": ["claude", "-p", "{prompt}",
                            "--allowedTools", "Bash,Read,Write,Edit"],
                "timeout_sec": 600
            },
            "cursor-agent": {
                "command": ["cursor-agent", "-p", "{prompt}"],
                "timeout_sec": 600
            }
        }
    },
    "notify": {"channel": "feishu"}
}


def ensure_dirs():
    for d in [LOGS_DIR, LEARNINGS_DIR, HEAL_LOGS_DIR, TEMPLATES_DIR]:
        d.mkdir(parents=True, exist_ok=True)


def now_str():
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def now_iso():
    return datetime.now().isoformat()


def load_config():
    """加载全局配置（config.json 覆盖默认值，浅合并 heal 一层）"""
    config = json.loads(json.dumps(DEFAULT_CONFIG))  # deep copy
    if CONFIG_PATH.exists():
        try:
            with open(CONFIG_PATH, encoding="utf-8") as f:
                user = json.load(f)
            for key, val in user.items():
                if isinstance(val, dict) and isinstance(config.get(key), dict):
                    for k2, v2 in val.items():
                        if k2 == "agents" and isinstance(v2, dict):
                            config[key]["agents"].update(v2)
                        else:
                            config[key][k2] = v2
                else:
                    config[key] = val
        except Exception as e:
            print(f"  ⚠ config.json 解析失败，使用默认配置: {e}")
    return config


# ============================================================
# 错误分类
# ============================================================

def classify_error(error_str, step_id="", tool_name=""):
    """根据错误信息分类失败类型，决定使用哪个提示词模板"""
    error_lower = (str(error_str) or "").lower()
    step_id = step_id or ""
    tool_name = tool_name or ""

    if any(k in error_lower for k in ["401", "403", "api key", "auth", "unauthorized",
                                      "missing bearer"]):
        return "auth_failed"
    if any(k in error_lower for k in ["timeout", "timed out", "超时"]):
        return "timeout"
    if any(k in error_lower for k in ["not found", "no element", "selector", "hint",
                                      "未找到", "校验失败", "行数不足", "结果为空"]):
        return "element_not_found"
    if tool_name == "visit_page" or "nav" in step_id:
        return "nav_failed"
    if tool_name == "execute_script" or "extract" in step_id:
        return "extract_failed"
    if any(k in error_lower for k in ["连接失败", "connection refused", "bridge"]):
        return "bridge_down"
    return "generic"


# ============================================================
# 内置默认模板（heal_templates/ 下同名文件优先）
# ============================================================

BUILTIN_PREFIX = """你是紫鸟自动化自愈 Agent。一个固化的自动化流程执行失败了，需要你诊断并修复。

## 你的任务
1. 读取下方失败上下文和流程定义，理解问题
2. 用 ziniao-assistant skill（POST http://127.0.0.1:9481/zclaw/tools/invoke）操作紫鸟浏览器诊断
3. 找到根因（页面结构变化？选择器失效？超时？认证过期？）
4. 修复流程定义 JSON 或 extracts/ 下的提取脚本
5. 重新执行修复后的流程验证: cd {scripts_dir} && python3 flow_engine.py run {flow_id} -v
6. 将修复方案写入 {scripts_dir}/learnings/known_issues.json
7. 按 AGENTS.md 的约定通知修复结果

## 失败上下文
- 流程: {flow_name} ({flow_id})  版本文件: {scripts_dir}/flows/{flow_id}.json
- 失败步骤: {step_id}（工具: {tool_name}）
- 错误类型: {error_type}
- 错误信息: {error}
- 失败时间: {timestamp}
- 运行参数: {params}
- 失败步骤入参: {failed_args}
- 失败现场截图: {screenshot}
- 自愈上下文文件: {heal_log_path}

## 关键约定（必须遵守）
- 所有浏览器操作只能通过 ZClaw bridge（X-ZClaw-Api-Key 认证，key 在 ~/.zclaw/config.json）
- 工具名以 GET /zclaw/tools 返回为准，不要臆造工具名
- execute_script 的 JS 必须用 IIFE 包裹: (function(){{ ... }})()
- 修复后必须用 flow_engine.py 重跑验证，再固化
- 提取类 JS 放在 extracts/*.js，流程中用 "@extracts/xxx.js" 引用，不要内联长脚本
"""

BUILTIN_TEMPLATES = {
    "nav_failed": """## 诊断方向（导航失败）
1. 先 open_store 打开店铺，visit_page 导航目标 URL，看是否跳转/404/登录页
2. take_screenshot 截图确认页面实际状态
3. 如果 URL 变了，用 execute_script 从站内菜单找到正确链接
4. 修复 flows/{flow_id}.json 中的 URL 或导航方式
""",
    "extract_failed": """## 诊断方向（数据提取失败）
1. 导航到目标页面，take_screenshot + get_page_content 查看实际结构
2. 对比 extracts/ 中的提取 JS 与实际 DOM，找出差异
3. 修复提取脚本（选择器、正则、解析逻辑），注意页面可能有中英文两种语言
4. 重跑流程验证提取结果非空且字段正确
""",
    "element_not_found": """## 诊断方向（元素未找到 / 校验失败）
1. 导航到目标页面截图，确认页面是否改版或弹出了遮罩/弹窗
2. 用 query_elements 尝试候选选择器；click_element 可改用 hint（可见文本）定位
3. 用 execute_script 探索 DOM 找到新选择器
4. 修复流程中的 selector / hint / 提取脚本
""",
    "timeout": """## 诊断方向（超时）
1. 手动执行同样的步骤，观察页面加载耗时
2. 偶发网络慢 → 调大 timeoutMs 或增加 on_fail.retry
3. 店铺首次启动需下载内核（1-5 分钟）→ open_store 后增加等待
4. 持续超时 → 检查目标 URL 是否仍有效
""",
    "auth_failed": """## 诊断方向（认证失败）
1. 检查 ~/.zclaw/config.json 的 ZCLAW_API_KEY 是否有效（curl GET /zclaw/tools 测试连通）
2. bridge 认证错误通常需要用户更换 API key，无法自动修复
3. 如果是站点（如 Amazon）登录态过期，截图确认登录页，通知用户手动登录后重试
""",
    "bridge_down": """## 诊断方向（bridge 不可达）
1. 确认紫鸟浏览器客户端是否在运行（bridge 随客户端启动，端口 9481）
2. bridge 不可达属于环境问题，不要修改流程定义
3. 通知用户启动紫鸟浏览器后用 manager.py retry {flow_id} 重试
""",
    "generic": """## 诊断方向（通用）
1. 读取 flows/{flow_id}.json 理解整体流程，定位失败步骤
2. 用 ziniao-assistant 手动执行失败步骤，观察实际返回
3. take_screenshot 查看页面状态
4. 根据实际错误调整流程定义或提取脚本，重跑验证
""",
}

BUILTIN_FOOTER = """
## 修复后必须执行（固化闭环）
1. 更新 {scripts_dir}/flows/{flow_id}.json 或对应的 extracts/*.js（修复根因，版本号 version +1）
2. 校验: python3 flow_engine.py validate {flow_id}
3. 验证: python3 flow_engine.py run {flow_id} -v --no-heal（必须真实跑通）
4. 将修复写入 {scripts_dir}/learnings/known_issues.json 的 issues 数组:
   {{
     "pattern": "<错误信息中稳定可匹配的特征子串>",
     "flow_id": "{flow_id}",
     "step_id": "{step_id}",
     "root_cause": "<根因描述>",
     "fix": "<修复方案描述>",
     "fix_applied_at": "<ISO时间>",
     "resolved": true
   }}
5. 通知用户：修复了什么、根因、验证结果
"""


def _load_template(flow_id, error_type):
    """按优先级查找提示词模板正文"""
    candidates = [
        TEMPLATES_DIR / flow_id / f"{error_type}.md",
        TEMPLATES_DIR / flow_id / "generic.md",
        TEMPLATES_DIR / f"{error_type}.md",
        TEMPLATES_DIR / "generic.md",
    ]
    for path in candidates:
        if path.exists():
            try:
                return path.read_text(encoding="utf-8"), str(path)
            except Exception:
                continue
    return BUILTIN_TEMPLATES.get(error_type, BUILTIN_TEMPLATES["generic"]), "builtin"


class _SafeDict(dict):
    """format_map 占位符缺失时保留原样，避免模板渲染崩溃"""
    def __missing__(self, key):
        return "{" + key + "}"


def build_heal_prompt(heal_id, flow_id, flow_name, step_id, tool_name, error,
                      context=None, heal_section=None):
    """构建自愈提示词，返回 (prompt, heal_log_path, error_type)"""
    ensure_dirs()
    context = context or {}
    heal_section = heal_section or {}

    # 错误分类：步骤可通过 on_fail.context 显式指定类型
    explicit = context.get("heal_context")
    error_type = explicit if explicit in BUILTIN_TEMPLATES else \
        classify_error(error, step_id, tool_name)

    # 自愈上下文文件（给 Agent 读）
    heal_log_path = HEAL_LOGS_DIR / f"{heal_id}.json"
    heal_data = {
        "heal_id": heal_id,
        "flow_id": flow_id,
        "flow_name": flow_name,
        "step_id": step_id,
        "tool_name": tool_name,
        "error_type": error_type,
        "error": str(error),
        "timestamp": now_iso(),
        "context": context,
    }
    with open(heal_log_path, "w", encoding="utf-8") as f:
        json.dump(heal_data, f, ensure_ascii=False, indent=2, default=str)

    fields = _SafeDict(
        scripts_dir=str(SCRIPTS_DIR),
        flow_id=flow_id,
        flow_name=flow_name,
        step_id=step_id,
        tool_name=tool_name or "unknown",
        error_type=error_type,
        error=str(error)[:800],
        timestamp=now_str(),
        heal_log_path=str(heal_log_path),
        params=json.dumps(context.get("params", {}), ensure_ascii=False),
        failed_args=json.dumps(
            (context.get("failed_step") or {}).get("args", {}),
            ensure_ascii=False, default=str)[:500],
        screenshot=context.get("screenshot") or "（无）",
    )

    prefix = BUILTIN_PREFIX.format_map(fields)
    template, _src = _load_template(flow_id, error_type)
    body = template.format_map(fields)

    # 流程级自愈提示（flow JSON 的 heal.hints）
    hints_section = ""
    hints = heal_section.get("hints")
    if hints:
        hints_section = f"\n## 本流程的自愈提示（沉淀时编写）\n{hints}\n"

    # 历史修复记录（避免重复修复）
    history_section = ""
    known_path = LEARNINGS_DIR / "known_issues.json"
    if known_path.exists():
        try:
            with open(known_path, encoding="utf-8") as f:
                known = json.load(f)
            related = [i for i in known.get("issues", [])
                       if i.get("flow_id") == flow_id]
            if related:
                history_section = "\n## 历史修复记录（避免重复修复）\n"
                for issue in related[-5:]:
                    history_section += (
                        f"- 问题: {issue.get('pattern', '')[:80]}\n"
                        f"  根因: {issue.get('root_cause', '')[:80]}\n"
                        f"  修复: {issue.get('fix', '')[:80]}\n"
                        f"  状态: {'已解决' if issue.get('resolved') else '未解决'}\n")
        except Exception:
            pass

    footer = BUILTIN_FOOTER.format_map(fields)
    prompt = prefix + "\n" + body + hints_section + history_section + footer
    return prompt, str(heal_log_path), error_type


# ============================================================
# 冷却与频控
# ============================================================

def _recent_heal_triggers():
    """读取 learnings/heals.jsonl 中的触发记录"""
    heals_file = LEARNINGS_DIR / "heals.jsonl"
    if not heals_file.exists():
        return []
    entries = []
    with open(heals_file, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                entries.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    return entries


def _log_heal_event(entry):
    ensure_dirs()
    heals_file = LEARNINGS_DIR / "heals.jsonl"
    with open(heals_file, "a", encoding="utf-8") as f:
        f.write(json.dumps(entry, ensure_ascii=False, default=str) + "\n")


def check_cooldown(flow_id, step_id, config):
    """检查冷却与每日上限。返回 None 表示可触发，否则返回跳过原因。"""
    heal_cfg = config.get("heal", {})
    cooldown_min = heal_cfg.get("cooldown_minutes", 60)
    max_per_day = heal_cfg.get("max_per_day", 5)
    now = datetime.now()

    triggers = [e for e in _recent_heal_triggers() if e.get("event") == "triggered"]

    today = [e for e in triggers
             if e.get("flow_id") == flow_id
             and str(e.get("timestamp", ""))[:10] == now.strftime("%Y-%m-%d")]
    if len(today) >= max_per_day:
        return f"流程 {flow_id} 今日自愈已达上限 {max_per_day} 次"

    threshold = now - timedelta(minutes=cooldown_min)
    for e in reversed(triggers):
        if e.get("flow_id") != flow_id or e.get("step_id") != step_id:
            continue
        try:
            ts = datetime.fromisoformat(e["timestamp"])
        except (KeyError, ValueError):
            continue
        if ts > threshold:
            return (f"同一步骤 {step_id} 在冷却期内（{cooldown_min} 分钟）已触发过自愈，"
                    f"上次: {e['timestamp']}")
        break
    return None


# ============================================================
# 触发
# ============================================================

def trigger_heal(flow_id, flow_name, step_id, tool_name, error, context=None,
                 heal_section=None, dry_run=False, agent=None):
    """触发自愈：生成提示词 → 冷却检查 → 调用配置的 Agent CLI。

    返回 dict: {heal_id, success|skipped|dry_run, prompt_path, ...}
    """
    ensure_dirs()
    config = load_config()
    heal_cfg = config.get("heal", {})

    heal_id = f"heal_{flow_id}_{int(time.time())}"
    prompt, heal_log_path, error_type = build_heal_prompt(
        heal_id, flow_id, flow_name, step_id, tool_name, error,
        context=context, heal_section=heal_section)

    prompt_path = HEAL_LOGS_DIR / f"{heal_id}_prompt.md"
    with open(prompt_path, "w", encoding="utf-8") as f:
        f.write(prompt)

    print(f"  🔧 自愈: {heal_id} (错误类型: {error_type})")
    print(f"     提示词: {prompt_path}")

    base = {"heal_id": heal_id, "error_type": error_type,
            "prompt_path": str(prompt_path), "heal_log_path": heal_log_path}

    if not heal_cfg.get("enabled", True):
        _log_heal_event({"event": "skipped", "reason": "disabled", "flow_id": flow_id,
                         "step_id": step_id, "heal_id": heal_id, "timestamp": now_iso()})
        return {**base, "skipped": True, "reason": "config.heal.enabled = false"}

    if dry_run:
        return {**base, "dry_run": True}

    # 冷却 / 频控
    skip_reason = check_cooldown(flow_id, step_id, config)
    if skip_reason:
        print(f"     ⊘ 跳过: {skip_reason}")
        _log_heal_event({"event": "skipped", "reason": skip_reason, "flow_id": flow_id,
                         "step_id": step_id, "heal_id": heal_id, "timestamp": now_iso()})
        return {**base, "skipped": True, "reason": skip_reason}

    # 选择 Agent CLI
    agent_name = agent or heal_cfg.get("agent", "openclaw")
    agent_cfg = heal_cfg.get("agents", {}).get(agent_name)
    if not agent_cfg:
        return {**base, "success": False,
                "error": f"config.json 中未配置 agent: {agent_name}"}

    session_key = f"ziniao-heal:{flow_id}"
    placeholders = {
        "prompt": prompt,
        "prompt_path": str(prompt_path),
        "session_key": session_key,
        "flow_id": flow_id,
        "heal_id": heal_id,
    }
    cmd = [str(part).format_map(_SafeDict(placeholders))
           for part in agent_cfg.get("command", [])]
    timeout_sec = agent_cfg.get("timeout_sec", 600)

    display = [c if len(c) < 60 else c[:30] + "...<prompt>" for c in cmd]
    print(f"     Agent: {agent_name} → {' '.join(display)}")

    event = {
        "event": "triggered",
        "heal_id": heal_id,
        "flow_id": flow_id,
        "step_id": step_id,
        "error_type": error_type,
        "agent": agent_name,
        "session_key": session_key,
        "prompt_path": str(prompt_path),
        "timestamp": now_iso(),
    }

    try:
        result = subprocess.run(cmd, capture_output=True, text=True,
                                timeout=timeout_sec)
        success = result.returncode == 0
        print(f"     结果: {'✅' if success else '❌'} (exit={result.returncode})")
        if not success and result.stderr:
            print(f"     错误: {result.stderr[:200]}")
        event["cli_exit_code"] = result.returncode
        event["cli_stderr"] = (result.stderr or "")[:500]
        _log_heal_event(event)
        return {**base, "success": success, "agent": agent_name}

    except subprocess.TimeoutExpired:
        print(f"     ⚠ Agent CLI 超时（{timeout_sec}s）")
        event["cli_exit_code"] = -1
        event["cli_stderr"] = f"timeout after {timeout_sec}s"
        _log_heal_event(event)
        return {**base, "success": False, "error": "CLI timeout"}

    except FileNotFoundError:
        print(f"     ⚠ {cmd[0]} 命令不存在，请确认已安装并加入 PATH")
        _log_heal_event({**event, "event": "skipped",
                         "reason": f"{cmd[0]} not found"})
        return {**base, "success": False, "error": f"{cmd[0]} not found"}

    except Exception as e:
        print(f"     ⚠ 调用失败: {e}")
        return {**base, "success": False, "error": str(e)}


# ============================================================
# 已知问题匹配（0 tokens 路径）
# ============================================================

def check_known_issues(flow_id, step_id, error):
    """检查 known_issues.json，看是否有已解决的同类问题（命中则不触发 Agent）"""
    known_path = LEARNINGS_DIR / "known_issues.json"
    if not known_path.exists():
        return None
    try:
        with open(known_path, encoding="utf-8") as f:
            known = json.load(f)
    except Exception:
        return None

    error_str = str(error)
    for issue in known.get("issues", []):
        if not issue.get("resolved"):
            continue
        pattern = issue.get("pattern", "")
        same_step = (issue.get("flow_id") == flow_id
                     and issue.get("step_id") == step_id)
        if (pattern and pattern in error_str) or same_step:
            return issue
    return None


# ============================================================
# CLI 入口（手动测试用）
# ============================================================

if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="紫鸟自动化自愈触发器")
    parser.add_argument("--flow-id", required=True, help="流程 ID")
    parser.add_argument("--step-id", default="unknown", help="失败步骤 ID")
    parser.add_argument("--tool", default="unknown", help="失败工具名")
    parser.add_argument("--error", default="unknown error", help="错误信息")
    parser.add_argument("--agent", default=None, help="指定 Agent（覆盖 config.json）")
    parser.add_argument("--dry-run", action="store_true",
                        help="只生成提示词，不调用 Agent")
    args = parser.parse_args()

    flow_name = args.flow_id
    flow_file = SCRIPTS_DIR / "flows" / f"{args.flow_id}.json"
    heal_section = {}
    if flow_file.exists():
        try:
            with open(flow_file, encoding="utf-8") as f:
                flow_def = json.load(f)
            flow_name = flow_def.get("name", args.flow_id)
            heal_section = flow_def.get("heal", {})
        except Exception:
            pass

    result = trigger_heal(
        flow_id=args.flow_id,
        flow_name=flow_name,
        step_id=args.step_id,
        tool_name=args.tool,
        error=args.error,
        heal_section=heal_section,
        dry_run=args.dry_run,
        agent=args.agent,
    )
    print(json.dumps(result, ensure_ascii=False, indent=2))
