# 首次配置:API key 获取与持久化

仅在用户首次配置、key 失效或轮换、bridge 报认证错误时阅读本文件。日常调用的 key 解析顺序见 SKILL.md「调用方式」。

## 获取 key

ZClaw API key 从**服务方或 [紫鸟生态中心](https://open.ziniao.com/contactUs)** 获取,紫鸟客户端的设置界面里**没有** API key 生成入口。

## 配置方式(按推荐顺序)

1. **对话配置(首选)**:用户在对话中提供 key,助手把它合并写入配置文件并立即使用(见 SKILL.md)。
2. **配置文件**:
   - macOS / Linux:`~/.zclaw/config.json`
   - Windows:`%USERPROFILE%\.zclaw\config.json`(如 `C:\Users\<名字>\.zclaw\config.json`)
   内容为 JSON,至少含 `{ "ZCLAW_API_KEY": "your-key" }`;可选 `ZCLAW_BASE_URL`(默认 `http://127.0.0.1:9481`)。文件已存在时**合并更新**,保留其它字段。写配置文件用普通文件写入,不要创建脚本。
3. **环境变量** `ZCLAW_API_KEY`。
4. **安装脚本**:`bash ziniao-skills/install-ziniao-openclaw-skill.sh "YOUR_API_KEY"`(Windows 用 `install-ziniao-openclaw-skill.ps1` 加 `-ApiKey`)。

## 环境变量的坑(为什么推荐配置文件)

bridge 通过 `process.env.ZCLAW_API_KEY` 读取,变量必须存在于**启动紫鸟客户端(Electron)的那个进程**的环境里。从 GUI 启动(Dock、开始菜单)时只看得到系统/用户级环境变量,终端里 `export` 的 shell 变量无效。

- **macOS / Linux**:GUI 启动需把 `export ZCLAW_API_KEY=...` 写入 `~/.zshrc` / `~/.bashrc` / `~/.profile`,或系统级(Linux 可用 `/etc/environment`);终端启动则在同一 shell 里 `export` 即可。
- **Windows**:系统属性 → 环境变量 → 用户或系统变量 `ZCLAW_API_KEY`;或 PowerShell:`[Environment]::SetUserVariable("ZCLAW_API_KEY","your-key")`。改完系统变量后需重启紫鸟客户端。

配置文件方式没有这些进程环境问题,跨平台路径一致,故为推荐方案。

## 调用方说明

bridge 是本地 HTTP API,任何能携带有效 key 发请求的客户端都能调用同一组工具;本 skill 设计为配合 ZClaw 框架使用(推荐)。
