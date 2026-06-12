#!/usr/bin/env python3
"""
ZClaw Bridge API 客户端 — 紫鸟浏览器自动化的底层通信层。
0 tokens 运行：纯 HTTP 调用，不依赖 OpenClaw。

【最高安全规则】所有浏览器操作只能通过紫鸟 ZClaw bridge（/zclaw/* 端点）执行，
由紫鸟客户端拉起店铺浏览器。绝对禁止调用本机浏览器（Chrome/Safari/Edge/Firefox）
或 Playwright/Selenium/Puppeteer 等框架。本客户端是项目唯一的网络出口，
_request() 中的路径白名单是硬约束，禁止绕过或移除。
"""

import json
import os
import time
import sys
from urllib.request import Request, urlopen
from urllib.error import URLError, HTTPError


def _load_config():
    """加载配置：优先环境变量，其次 ~/.zclaw/config.json"""
    config = {
        "base_url": "http://127.0.0.1:9481",
        "api_key": ""
    }
    # 环境变量
    if os.environ.get("ZCLAW_BASE_URL"):
        config["base_url"] = os.environ["ZCLAW_BASE_URL"]
    if os.environ.get("ZCLAW_API_KEY"):
        config["api_key"] = os.environ["ZCLAW_API_KEY"]
    # 配置文件
    config_path = os.path.expanduser("~/.zclaw/config.json")
    if os.path.exists(config_path):
        with open(config_path) as f:
            file_config = json.load(f)
        if not config["api_key"] and "ZCLAW_API_KEY" in file_config:
            config["api_key"] = file_config["ZCLAW_API_KEY"]
        if "ZCLAW_BASE_URL" in file_config and config["base_url"] == "http://127.0.0.1:9481":
            config["base_url"] = file_config["ZCLAW_BASE_URL"]
    return config


CONFIG = _load_config()


class ZClawError(Exception):
    """ZClaw bridge 调用失败"""
    def __init__(self, message, tool=None, raw=None):
        super().__init__(message)
        self.tool = tool
        self.raw = raw


class ZClawClient:
    """紫鸟 ZClaw Bridge 客户端"""

    def __init__(self, base_url=None, api_key=None, store_id=None, target_id=None,
                 verbose=False):
        self.base_url = (base_url or CONFIG["base_url"]).rstrip("/")
        self.api_key = api_key or CONFIG["api_key"]
        self.store_id = store_id
        self.target_id = target_id
        self.verbose = verbose

        if not self.api_key:
            raise ZClawError("API key 未配置。请设置 ZCLAW_API_KEY 环境变量或 ~/.zclaw/config.json")

    def _request(self, method, path, body=None, timeout=30):
        """发送 HTTP 请求（仅允许紫鸟 bridge 的 /zclaw/* 端点，最高安全规则）"""
        if not path.startswith("/zclaw/"):
            raise ZClawError(f"安全规则禁止访问非 ZClaw 端点: {path}")
        url = f"{self.base_url}{path}"
        data = json.dumps(body).encode() if body else None
        headers = {
            "Content-Type": "application/json",
            "X-ZClaw-Api-Key": self.api_key,
        }
        req = Request(url, data=data, headers=headers, method=method)

        if self.verbose:
            print(f"  → {method} {path}")
            if body:
                tool = body.get("tool", "")
                print(f"    tool={tool}")

        try:
            with urlopen(req, timeout=timeout) as resp:
                result = json.loads(resp.read().decode())
                if self.verbose and result.get("ret") != 0:
                    print(f"  ← ERROR ret={result.get('ret')} msg={result.get('msg','')}")
                return result
        except URLError as e:
            raise ZClawError(f"Bridge 连接失败: {e}", raw=str(e))
        except HTTPError as e:
            raise ZClawError(f"HTTP {e.code}: {e.reason}", raw=str(e))

    def get_tools(self):
        """获取可用工具列表"""
        result = self._request("GET", "/zclaw/tools")
        if result.get("ret") == 0:
            return [t["name"] for t in result.get("data", [])]
        raise ZClawError("获取工具列表失败", raw=result)

    def invoke(self, tool, args=None, timeout=30):
        """调用工具"""
        if args is None:
            args = {}
        # 自动注入 storeId 和 targetId
        if self.store_id and "storeId" not in args:
            args["storeId"] = self.store_id
        if self.target_id and "targetId" not in args:
            args["targetId"] = self.target_id

        body = {"tool": tool, "args": args}
        result = self._request("POST", "/zclaw/tools/invoke", body, timeout=timeout)

        if result.get("ret") == 0:
            data = result.get("data", {})
            # 检查 invoke 层面的 ok 字段
            if isinstance(data, dict) and data.get("ok") is False:
                raise ZClawError(
                    f"工具调用失败: {data.get('error', 'unknown')}",
                    tool=tool, raw=result
                )
            return data
        else:
            raise ZClawError(
                f"invoke 返回错误: {result.get('msg', 'unknown')}",
                tool=tool, raw=result
            )

    # === 高级封装 ===

    def list_stores(self):
        """列出所有店铺"""
        data = self.invoke("list_stores", {"all": True})
        # invoke 返回的 data 已经是 {page, limit, total, items} 结构
        items = data.get("items", [])
        return items

    def open_store(self, store_id=None, store_name=None, launch_url=None):
        """打开店铺浏览器"""
        args = {}
        if store_id:
            args["storeId"] = store_id
        elif store_name:
            args["storeName"] = store_name
        if launch_url:
            args["launchUrl"] = launch_url
        # invoke() 已经返回 result["data"]，即 {storeId, name, status, ...}
        data = self.invoke("open_store", args, timeout=60)
        if data and isinstance(data, dict):
            self.store_id = data.get("storeId")
        return data

    def close_store(self, store_id=None):
        """关闭店铺"""
        sid = store_id or self.store_id
        if sid:
            return self.invoke("close_store", {"storeId": sid})

    def visit(self, url, wait_until="domcontentloaded", timeout_ms=30000):
        """导航到 URL"""
        return self.invoke("visit_page", {
            "url": url,
            "waitUntil": wait_until,
            "timeoutMs": timeout_ms,
        }, timeout=int(timeout_ms / 1000) + 15)

    def js(self, script, return_by_value=True):
        """执行 JavaScript"""
        result = self.invoke("execute_script", {
            "script": script,
            "returnByValue": return_by_value,
        })
        inner = result.get("data", {}).get("result", "")
        # 尝试解析 JSON 字符串
        if isinstance(inner, str):
            try:
                return json.loads(inner)
            except (json.JSONDecodeError, TypeError):
                return inner
        return inner

    def screenshot(self, full_page=False, format="png"):
        """截图，返回文件路径"""
        result = self.invoke("take_screenshot", {
            "fullPage": full_page,
            "format": format,
        })
        return result.get("data", {}).get("filePath", "")

    def click(self, selector=None, hint=None, wait_for_nav=False, timeout_ms=10000):
        """点击元素"""
        args = {"timeoutMs": timeout_ms}
        if selector:
            args["selector"] = selector
        if hint:
            args["hint"] = hint
        if wait_for_nav:
            args["waitForNavigation"] = True
        return self.invoke("click_element", args, timeout=int(timeout_ms / 1000) + 10)

    def wait_element(self, selector, timeout_ms=10000, state="visible"):
        """等待元素出现"""
        return self.invoke("wait_for_element", {
            "selector": selector,
            "timeoutMs": timeout_ms,
            "state": state,
        }, timeout=int(timeout_ms / 1000) + 5)

    def get_page_text(self, max_length=5000):
        """获取页面可见文本"""
        script = f"(function(){{ return document.body?.innerText?.substring(0,{max_length}) || ''; }})()"
        return self.js(script)

    def get_page_url(self):
        """获取当前页面 URL"""
        return self.js("(function(){ return location.href; })()")

    def get_page_title(self):
        """获取当前页面标题"""
        return self.js("(function(){ return document.title; })()")

    def get_running_stores(self):
        """获取运行中的店铺列表"""
        result = self.invoke("extract_data", {"mode": "running"})
        return result.get("total", 0), result.get("items", [])

    def sleep(self, seconds):
        """等待"""
        time.sleep(seconds)

    def __repr__(self):
        return f"ZClawClient(store={self.store_id}, target={self.target_id})"
