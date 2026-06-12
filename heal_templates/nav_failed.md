## 诊断方向（导航失败）
1. 先 open_store 打开店铺，visit_page 导航目标 URL，看是否跳转/404/登录页
2. take_screenshot 截图确认页面实际状态
3. 如果 URL 变了，用 execute_script 从站内菜单找到正确链接
4. 修复 flows/{flow_id}.json 中的 URL 或导航方式
