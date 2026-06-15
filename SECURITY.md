# Security Policy

## 浏览器安全边界

Auto Ziniao 只允许通过紫鸟 ZClaw bridge 操作店铺浏览器：

- 工具发现：`GET http://127.0.0.1:9481/zclaw/tools`
- 工具调用：`POST http://127.0.0.1:9481/zclaw/tools/invoke`

禁止使用本机 Chrome、Safari、Edge、Firefox、Chromium、Playwright、Selenium、Puppeteer、browser-use 或 `open <url>` 作为替代方案。

## 凭证

- ZClaw API key 只放在环境变量或 `~/.zclaw/config.json`。
- `config.json` 是本机配置，已被 `.gitignore` 排除。
- 仓库只提交 `config.example.json`。
- 不要在 issue、PR、日志或截图中粘贴真实 token、店铺名和业务数据。

## 漏洞报告

请通过 GitHub Security Advisory 或私有渠道报告安全问题。不要公开披露可直接复现的凭证泄漏、桥接绕过或本机浏览器 fallback 漏洞。
