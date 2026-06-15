## ADDED Requirements

### Requirement: TS pacing policy offline baseline
系统 SHALL 将 TS flow pacing policy 纳入兼容性基线。默认 baseline MUST 覆盖 pacing schema、静态校验 warning/error、policy resolution、fake sleeper wait、critical confirm、budget rejection、store lock release 和 runtime event schema。该 baseline MUST 使用 mock tool client、fake sleeper、fixed clock 和临时 `dataRoot`，MUST NOT 执行真实 flow，MUST NOT 调用真实 ZClaw bridge，MUST NOT 打开店铺浏览器。

#### Scenario: pacing baseline 离线通过
- **WHEN** 用户执行 `pnpm validate:baseline`
- **THEN** pacing 相关测试在离线 mock 环境中通过，并且不连接 `127.0.0.1:9481`

#### Scenario: 当前 flow 兼容
- **WHEN** baseline 解析当前所有非模板 `flows/*.json`
- **THEN** 未声明 pacing 的历史 flow 仍可解析，并且 risk 缺失最多产生 warning，不阻断当前有效 flow 的 fatal 校验

#### Scenario: critical fixture 阻断
- **WHEN** baseline 运行非法 fixture，其中 `risk: "critical"` step 缺少 `confirm`
- **THEN** TS schema 辅助校验返回稳定 error code `critical_requires_confirm`

#### Scenario: runtime event fixture
- **WHEN** baseline 运行包含 write 和 critical step 的 mock flow
- **THEN** 测试生成 `flow_events.jsonl`，并逐行通过 runtime event schema 校验

### Requirement: Pacing safety scan regression
系统 SHALL 扩展或复用静态安全扫描，确保 pacing 实现不绕过现有 TS 包边界。`packages/flow-engine` 中 MUST NOT 直接访问 `127.0.0.1:9481`、`/zclaw/tools` 或 `/zclaw/tools/invoke`；MUST NOT 新增 Playwright、Selenium、Puppeteer、browser-use 或本机浏览器打开命令。安全扫描 MUST 继续允许 `packages/zclaw` 作为唯一 TS ZClaw bridge transport 包。

#### Scenario: flow-engine 不直接访问 bridge
- **WHEN** 执行 `pnpm security:scan`
- **THEN** scan 确认 `packages/flow-engine` 中不存在直接 bridge URL 或 `/zclaw/*` HTTP 访问代码

#### Scenario: 禁止浏览器自动化依赖
- **WHEN** pacing 实现或测试新增 `playwright`、`selenium`、`puppeteer` 或 `browser-use`
- **THEN** `pnpm security:scan` 失败，并指出 forbidden dependency
