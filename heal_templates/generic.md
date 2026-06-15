## 诊断方向（通用）
1. 读取 flows/{flow_id}.json 理解整体流程，定位失败步骤 {step_id}
2. 用 ziniao-assistant 手动执行失败步骤，观察实际返回
3. take_screenshot 查看页面状态
4. 根据实际错误调整流程定义或提取脚本，重跑验证
