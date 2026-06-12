## 诊断方向（元素未找到 / 校验失败）
1. 导航到目标页面截图，确认页面是否改版或弹出了遮罩/弹窗
2. 用 query_elements 尝试候选选择器；click_element 可改用 hint（可见文本）定位
3. 用 execute_script 探索 DOM 找到新选择器
4. 修复流程中的 selector / hint / 提取脚本
