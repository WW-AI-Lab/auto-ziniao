## 诊断方向（bridge 不可达）
1. 确认紫鸟浏览器客户端是否在运行（bridge 随客户端启动，端口 9481）
2. bridge 不可达属于环境问题，不要修改流程定义
3. 通知用户启动紫鸟客户端后用 `pnpm auto-ziniao retry {flow_id}` 重试；不要修改 flow JSON 或 extracts 来掩盖环境问题
