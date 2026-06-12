# admin-frontend — 前端管理界面

## ADDED Requirements

### Requirement: SPA 整体结构与技术栈
前端 SHALL 为单页应用（React + TypeScript + Vite + antd v5），构建产物输出至 `webadmin/frontend/dist/` 并提交入库，由后端静态托管，运行期 MUST NOT 依赖 Node。界面 SHALL 包含侧边导航，至少含五个页面：概览（统计仪表盘）、流程管理、计划任务、运行与自愈记录、Agent 对话。界面语言为简体中文，无登录。

#### Scenario: 直接使用无需构建
- **WHEN** 用户安装 webadmin Python 依赖并启动服务后访问首页
- **THEN** 前端页面完整可用，无需本机安装 Node/npm

#### Scenario: 页面导航
- **WHEN** 用户点击侧边导航各菜单项
- **THEN** 前端路由切换到对应页面，刷新浏览器后仍停留在该页面

### Requirement: 流程管理页
流程管理页 SHALL 展示 flows 列表（名称、版本、参数、最近运行状态），并支持：查看/编辑 flow JSON（编辑器带 JSON 语法校验，保存调用后端校验 API，失败时展示具体错误）、查看关联 extracts 脚本（只读）、带参数表单的手动运行（参数项根据 flow 的 `params` 声明自动生成），运行后可查看实时状态直至结束。

#### Scenario: 编辑保存失败提示
- **WHEN** 用户保存了未通过后端校验的 flow JSON
- **THEN** 页面展示后端返回的具体校验错误，编辑内容不丢失

#### Scenario: 参数化运行
- **WHEN** 用户对声明了 `store_name` 参数的 flow 点击运行
- **THEN** 弹出参数表单（默认值预填），提交后展示运行进行中状态，结束后展示成功/失败结果

### Requirement: 计划任务页
计划任务页 SHALL 支持任务的新建、编辑、启用/停用、删除，触发方式表单覆盖 interval / daily / cron 三种（cron 输入框附支持语法说明），并展示每个任务的下次运行时间与最近触发结果；任务行可展开或跳转查看调度历史。

#### Scenario: 新建每日任务
- **WHEN** 用户选择 flow、填写每日 08:30 触发并保存
- **THEN** 列表出现该任务并显示计算出的下次运行时间

#### Scenario: 查看调度历史
- **WHEN** 用户点开某任务的历史记录
- **THEN** 展示最近触发记录（时间、状态、耗时、错误摘要）

### Requirement: 运行与自愈记录页
该页 SHALL 提供运行历史（可按 flow 过滤、分页）、自愈记录（含详情抽屉：失败上下文与提示词）、known_issues 只读列表，以及 `output/` 产出浏览（目录树 + CSV/JSON 在线预览 + 下载）。

#### Scenario: 查看失败运行的自愈详情
- **WHEN** 用户在运行历史中点击一条失败记录关联的自愈事件
- **THEN** 抽屉展示该次自愈的错误类型、失败上下文与完整提示词

#### Scenario: 预览 CSV 产出
- **WHEN** 用户在产出浏览中点击一个 CSV 文件
- **THEN** 页面以表格形式预览内容，并提供下载按钮

### Requirement: Agent 对话页（@ant-design/x）
对话页 SHALL 使用 `@ant-design/x` 组件实现：会话列表用 `Conversations`，消息流用 `Bubble`，输入框用 `Sender`；数据流经自定义 SSE 读取逻辑对接后端（注：实装的 @ant-design/x v2 已移除 v1 的 `useXAgent`/`useXChat` hooks，组件 + 自写数据层为 v2 官方形态）。页面 SHALL 支持：新建/切换/删除会话、选择 agent（清单来自后端，源于 `config.json`）、流式渲染回复、展示发送中/失败状态、加载历史消息。

#### Scenario: 流式对话
- **WHEN** 用户在 Sender 中发送消息
- **THEN** 用户气泡立即上屏，assistant 气泡随 SSE 增量内容逐步渲染，完成后状态正常

#### Scenario: 切换历史会话
- **WHEN** 用户在 Conversations 列表点击历史会话
- **THEN** 消息区加载该会话全部历史消息

#### Scenario: agent 执行失败反馈
- **WHEN** 后端下发错误事件（CLI 失败或超时）
- **THEN** 对应消息气泡展示失败状态与中文错误说明，用户可重新发送
