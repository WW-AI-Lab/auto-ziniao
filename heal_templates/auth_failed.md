## 诊断方向（认证失败）
1. 检查 ~/.zclaw/config.json 的 ZCLAW_API_KEY 是否有效（curl GET /zclaw/tools 测试连通）
2. bridge 认证错误通常需要用户更换 API key，无法自动修复
3. 如果是站点（如 Amazon）登录态过期，截图确认登录页，通知用户手动登录后重试
