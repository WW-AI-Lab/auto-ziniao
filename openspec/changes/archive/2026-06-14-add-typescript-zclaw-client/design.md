## Context

M1 已归档并建立 TypeScript workspace、`packages/core`、`packages/schemas`、flow contract schemas、fixture/golden 与 `pnpm validate:baseline`。当前生产运行仍完全依赖 Python：`manager.py` 转发到 `engine/manager.py`，真实 ZClaw 调用由 `engine/zclaw_client.py` 执行。

本阶段是 TS 迁移 M2：建立 `packages/zclaw`。该包会成为后续 TS `packages/flow-engine` 的唯一 ZClaw bridge 出口，因此安全边界必须先被单测和静态扫描锁定。实现时不得执行真实 flow，不得调用真实 `POST /zclaw/tools/invoke` 做基线验证，不得修改 Python 生产链路。

## Goals / Non-Goals

**Goals:**

- 新增 `packages/zclaw`，提供 TS 侧 ZClaw bridge client。
- 固定配置读取、API key 处理、路径白名单、工具发现、工具调用、高级封装和错误分类。
- 用离线测试覆盖成功路径、错误路径、超时、非法路径、store/target 注入和 wrapper 参数映射。
- 调整安全扫描，使 `packages/zclaw` 成为 TS 中唯一允许访问 `127.0.0.1:9481` 与 `/zclaw/*` 的包。
- 将 `packages/zclaw` 纳入 build/typecheck/test/`pnpm validate:baseline`。

**Non-Goals:**

- 不迁移 `engine/flow_engine.py`、`engine/self_heal.py`、`engine/manager.py` 或 `manager.py`。
- 不替换 `python3 manager.py ...` 生产入口。
- 不执行真实 flow，不打开店铺浏览器，不依赖紫鸟客户端在线完成测试。
- 不新增 WebAdmin API、CLI、OpenClaw adapter 或 self-heal 行为。
- 不引入 Playwright/Selenium/Puppeteer/browser-use、axios、undici 或其他 HTTP/runtime 依赖。

## Architecture Assessment

### Existing Design Reuse

- 复用 `packages/core`：
  - `ZiniaoError` 作为错误基类；
  - JSON 文件读取 helper 用于读取 `~/.zclaw/config.json`；
  - 路径 helper 可用于测试中的 repo 定位，但 `packages/zclaw` 不应读取 repo runtime data。
- 复用 `packages/schemas`：
  - `KNOWN_ZCLAW_TOOLS` 与相关类型作为 wrapper tool name 的单一来源；
  - 不在 `packages/zclaw` 复制工具名常量。
- 复用 Python `engine/zclaw_client.py` 行为作为兼容参考：
  - 默认 base URL；
  - `ZCLAW_API_KEY` / `~/.zclaw/config.json` 读取；
  - `_request()` 仅允许 `/zclaw/*`；
  - `invoke()` 自动注入 `storeId` / `targetId`；
  - wrapper 映射到现有 ZClaw 工具名。
- 复用 M1 测试模式：
  - Vitest；
  - root `pnpm typecheck` / `pnpm test` / `pnpm validate:baseline`；
  - 静态安全扫描。

### Boundaries and Ownership

- `packages/zclaw` 拥有：
  - bridge base URL 与 API key 配置读取；
  - HTTP request helper；
  - ZClaw client 实例状态：`storeId`、`targetId`、`verbose`；
  - typed wrappers；
  - ZClaw 专用错误类型与错误码。
- `packages/zclaw` 不拥有：
  - flow DSL 解析、变量替换、retry/on_fail/branch 语义；
  - output 写入与 run log；
  - self-heal 分类、prompt、Agent 调用；
  - WebAdmin API 调度或锁。
- 调用关系：
  - 后续 `packages/flow-engine` 只能依赖 `packages/zclaw` 执行浏览器相关 tool；
  - `packages/core` 和 `packages/schemas` 不得反向依赖 `packages/zclaw`；
  - WebAdmin 后端未来不得直接访问 bridge，应通过 flow/CLI 服务层。
- 失败职责：
  - 非 `/zclaw/*` path：client 同步拒绝；
  - API key 缺失：构造 invoke-capable client 时失败；
  - 连接拒绝/超时：返回 `bridge_unavailable` / `zclaw_timeout` 类型错误，不 fallback 到本机浏览器；
  - `ret != 0` 或 `data.ok === false`：抛出保留原始响应的 ZClaw 错误；
  - retry 由未来 flow-engine 管理，本包不内置业务 retry。
- 超时与取消：
  - 使用 Node 内置 `AbortController` 实现每次请求 timeout；
  - 不新增队列、连接池、后台任务或持久连接。

### Options and Rationale

1. **HTTP 实现：Node global `fetch` vs `urllib` parity wrapper vs axios**
   - 选择 Node global `fetch` + `AbortController`。
   - 理由：Node 22 已提供稳定 `fetch`，足够覆盖本地 bridge 调用，避免新增 HTTP 依赖和供应链风险。
   - 替代方案：axios/undici。代价是引入额外依赖；当前需求不需要。

2. **测试方式：mock fetch/server vs 真实 bridge**
   - 选择 mock fetch 或本地测试 server。
   - 理由：基线验证不得调用真实 `POST /zclaw/tools/invoke`，也不得要求紫鸟客户端在线。
   - 替代方案：真实 bridge smoke test。留到后续 flow-engine/CLI 双跑阶段，并且必须单独人工触发。

3. **工具名来源：复用 schemas 常量 vs 运行时强依赖 `GET /zclaw/tools`**
   - 选择复用 `packages/schemas` 的静态常量作为类型与 wrapper 映射来源，同时保留 `getTools()` 用于运行时发现。
   - 理由：wrapper 编译期需要稳定 tool name，运行时发现用于诊断和未来能力检查；静态常量不得用于臆造不存在的工具。
   - 替代方案：每次调用前都 `getTools()`。这会增加耦合和延迟，且不适合离线单测。

4. **安全扫描策略：全仓禁止 bridge 字符串 vs 唯一包 allowlist**
   - 选择 `packages/zclaw` allowlist，其余 `packages/*` 仍禁止直接 bridge 访问。
   - 理由：M2 的目标就是建立唯一 TS 出口，继续全仓禁止会阻止实现；放开全仓会破坏边界。

### Quality Attributes

- **安全**：只允许 `/zclaw/*` path；仅 `packages/zclaw` 可出现受控 bridge URL；禁止本机浏览器依赖与命令；API key 不写日志、不进入错误 message。
- **可靠性**：结构化错误保留 `tool`、`code`、`status`、`raw` 供上层分类；timeout 明确。
- **性能**：每次请求为短生命周期本地 HTTP，不引入连接池；wrapper 不额外轮询 `list_stores` 或 `getTools`。
- **可维护性**：低层 request 与高级 wrappers 分层；wrapper tool name 来自 `packages/schemas`。
- **可测试性**：所有行为可用 mock HTTP/fetch 离线验证。
- **可部署性**：不新增 runtime 依赖和服务；不改变现有 Python 生产路径。

### Complexity and Exceptions

新增 `packages/zclaw` 是跨后续阶段的基础设施，复杂度是必要的，因为后续 TS flow-engine 不能直接拼 HTTP 调用或绕过安全边界。控制方式：

- API 面保持最小，仅覆盖当前 Python client 已有能力和蓝图列出的 wrapper；
- 不引入重试、缓存、长连接、队列、状态持久化；
- 不新增真实 bridge 集成测试到默认验证命令；
- 通过安全扫描保证唯一出口。

## Decisions

1. `packages/zclaw` 只依赖 `@ziniao/core`、`@ziniao/schemas` 与 Node 标准库。替代方案是引入 HTTP client 依赖；当前不采用。
2. `createZclawClient()` 默认读取环境变量和 `~/.zclaw/config.json`，API key 缺失时 fail fast。替代方案是允许调用时才失败；这会把配置错误推迟到运行中，不利于上层诊断。
3. request helper 接收 path 而不是完整 URL，并在拼接 base URL 前校验 `path.startsWith("/zclaw/")`。替代方案是让调用方传完整 URL；这会扩大绕过面。
4. `invoke()` 自动注入 `storeId` / `targetId`，但不得覆盖调用方显式传入的值。替代方案是总是覆盖；这会破坏特殊调用场景。
5. `packages/zclaw` 单测不得连接真实 `127.0.0.1:9481`。替代方案是真实 smoke test；该测试必须留到后续人工验证或双跑阶段。

## Risks / Trade-offs

- [Risk] 静态工具常量与 `GET /zclaw/tools` 的真实结果可能漂移 -> Mitigation：保留 `getTools()`，后续 flow-engine 或 CLI 阶段可增加人工/显式环境检查；默认测试不臆造新工具。
- [Risk] 安全扫描 allowlist 过宽导致其他包绕过 `packages/zclaw` -> Mitigation：扫描规则只允许 `packages/zclaw/src` 中受控文件出现 bridge URL/path，其他包仍失败。
- [Risk] API key 错误被日志泄露 -> Mitigation：错误 message 只报告缺失或来源，不输出 key 值；测试覆盖错误字符串。
- [Risk] 与 Python client 行为不完全一致 -> Mitigation：wrapper 参数映射按 Python client 建立 golden 单测，后续 flow-engine 接入前再做兼容对比。
- [Risk] 过早抽象过多 -> Mitigation：不实现 retry、缓存、插件系统、真实 bridge smoke test、flow 执行或 WebAdmin 接入。

## Migration Plan

1. 新增 `packages/zclaw` 包、tsconfig、exports 与源码。
2. 增加 Vitest 单测，覆盖配置、白名单、HTTP 成功/失败、超时和 wrapper 映射。
3. 更新 root scripts，把 `packages/zclaw` 纳入 `build`、`typecheck`、`test` 与 `validate:baseline`。
4. 更新 `scripts/security-scan.ts`，把 `packages/zclaw` 设为唯一 bridge allowlist。
5. 更新 README、`docs/05-TS重构技术蓝图.md` 和 AGENTS 中的 M2 状态与后续顺序。
6. 验证：`pnpm typecheck`、`pnpm test`、`pnpm build`、`pnpm validate:baseline`、`openspec validate add-typescript-zclaw-client --strict`。

回滚方式：删除 `packages/zclaw`，恢复 root scripts 与安全扫描 allowlist 到 M1 状态。由于 Python `manager.py` 与 `engine/zclaw_client.py` 未变，回滚后 `python3 manager.py list` 与 `python3 manager.py validate orders_overview` 仍应可运行。

## Open Questions

- 暂无阻塞问题。真实 bridge smoke test 是否作为后续 flow-engine change 的显式人工验证任务处理，本 change 不纳入默认验证。
