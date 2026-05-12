# Claude Code SDK & MCP 内部机制深度文档

> 生成日期：2026-05-12  
> 覆盖版本：@anthropic-ai/claude-agent-sdk@0.2.96、@modelcontextprotocol/sdk@1.25.3（Happy 使用）/ 1.29.0（上游最新）

---

## 1. SDK Session 生命周期

### 1.1 Session 创建与初始化

**SDK 核心流程**：

1. **Session 对象创建**（`packages/happy-cli/sources/claude/session.ts:35-66`）
   - 在 `runClaude()` 中初始化 `Session` 类
   - 包含 API 客户端、消息队列、环境变量、MCP 服务器配置
   - 使用 UUID 作为内部会话标签

2. **API 会话创建**（`packages/happy-cli/sources/claude/runClaude.ts:48-143`）
   - 行号 70-72：`AgentState` 初始化为空对象
   - 行号 142：通过 `api.getOrCreateSession()` 创建新会话
   - 行号 120-126：检查重连环境变量（`HAPPY_RECONNECT_SESSION_ID` 等）

3. **Claude 进程启动**（`packages/happy-cli/sources/claude/claudeLocal.ts:37-50`）
   - 生成临时 settings 文件（包含 `SessionStart` hook）
   - 配置 MCP 服务器和权限模式
   - 通过 `cross-spawn` 启动 Claude 进程

4. **SDK Query 初始化**（`packages/happy-cli/sources/claude/sdk/query.ts:14-73`）
   - 行号 30-45：构建 `Options` 对象，映射到官方 SDK 格式
   - 行号 44：`sessionId` 始终设置为 `undefined`（由 SDK 内部管理）
   - 行号 69-72：调用官方 `query()` 函数开始交互

### 1.2 Session 恢复（--resume）

**恢复流程关键点**：

1. **Resume 标志处理**（`packages/happy-cli/sources/claude/claudeRemote.ts:54-77`）
   - 行号 54-77：从 `claudeArgs` 提取 `--resume` 标志
   - 检查下一个参数是否为 UUID 格式，提取 session ID 为 `startFrom`

2. **本地模式 Resume**（`packages/happy-cli/sources/claude/claudeLocal.ts:102-137`）
   - 行号 110-125：按优先级处理 `--resume`
     - `--session-id <uuid>`（新会话强制使用特定 ID）
     - `--resume <id>`（恢复特定会话）
     - `--continue`（恢复最后一个会话）
   - 行号 118-122：通过 `claudeFindLastSession()` 查找最后一个会话

3. **SDK Resume 集成**（`packages/happy-cli/sources/claude/sdk/query.ts:32`）
   - `resume` 字段直接映射到 `Options.resume`，格式：`uuid | undefined`
   - SDK 内部处理会话历史重放和新 session ID 生成

> **⚠️ Gotcha**：使用 `--resume` 时，Claude 创建**新的 session ID**，历史消息被重写为新 ID。Happy 必须跟踪两个 session ID：原始和恢复后的。这是已知的 upstream resume bugs（见 project_upstream_resume_bugs）。

### 1.3 Session 销毁与清理

1. **Session 对象清理**（`packages/happy-cli/sources/claude/session.ts:78-82`）
   - `cleanup()` 方法清除 keepAlive 定时器，清空 session found callbacks

2. **权限处理器重置**（`packages/happy-cli/sources/claude/utils/permissionHandler.ts:305-339`）
   - `reset()` 方法清除所有未完成权限请求
   - 待处理请求移至已完成状态（标记为 `canceled`，原因："Session switched to local mode"）

---

## 2. PTY vs SDK 双模式

### 2.1 PTY 模式（node-pty）入口与流程

**PTY 模式由 `claudeLocal` 实现**（`packages/happy-cli/sources/claude/claudeLocal.ts:1-50`）：

- 使用 `cross-spawn` 启动 Claude 进程（跨平台兼容）
- `createInterface` 捕获 readline 输出（处理流式 JSON）
- MCP 服务器配置通过环境变量传递
- Hook settings 路径配置
- 代理绕过设置（`ensureLocalProxyBypass`）
- `claudeCliPath` 指向脚本启动器：`scripts/claude_local_launcher.cjs`

### 2.2 SDK 模式（claude-agent-sdk）入口与流程

**SDK 模式由 `claudeRemote` 实现**（`packages/happy-cli/sources/claude/claudeRemote.ts:15-45`）：

```typescript
// 行号 158-161
const response = query({
    prompt: messages,
    options: sdkOptions,
});

// 行号 129：Permission 回调集成
canCallTool: (toolName, input, options) =>
  opts.canCallTool(toolName, input, mode, options)
```

- 行号 174-200：`for await (const message of response)` 异步迭代响应消息
- 处理 `system/init`、`assistant`、`result` 消息，提取工具列表和 MCP 服务器状态
- Session ID 通过 hook 上报后触发 `onSessionFound()` 回调

### 2.3 模式选择逻辑

**主控制循环**（`packages/happy-cli/sources/claude/loop.ts:47-110`）：

- 行号 70：初始模式从 `opts.startingMode` 读取
- 行号 74-108：Switch 语句
  - `case 'local'`：`claudeLocalLauncher()` → 可能切换到 remote
  - `case 'remote'`：`claudeRemoteLauncher()` → 可能切换到 local

**模式切换触发条件**：用户通过 RPC 切换、连接丢失、明确切换命令

> **⚠️ 限制**（`packages/happy-cli/sources/claude/runClaude.ts:60-62`）：Daemon 会话**不能**使用 local/interactive 模式，会抛出 "Daemon-spawned sessions cannot use local/interactive mode"。

---

## 3. Permission Hook 机制

### 3.1 Permission Request 消息结构

**Claude SDK 中的 `CanUseTool` 回调**（`node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:145-188`）：

```typescript
type CanUseTool = (
  toolName: string,
  input: Record<string, unknown>,
  options: {
    signal: AbortSignal;
    toolUseID: string;      // 唯一标识符（CRITICAL — 响应必须携带此 ID）
    suggestions?: PermissionUpdate[];
    blockedPath?: string;
    decisionReason?: string;
    title?: string;
    displayName?: string;
    description?: string;
    agentID?: string;
  }
) => Promise<PermissionResult>;
```

**Happy 中的权限响应类型**（`packages/happy-cli/sources/claude/utils/permissionHandler.ts:14-22`）：

```typescript
interface PermissionResponse {
  id: string;           // 对应 toolUseID
  approved: boolean;
  reason?: string;
  mode?: PermissionMode;
  allowTools?: string[];
  updatedInput?: Record<string, unknown>;
  receivedAt?: number;
}
```

### 3.2 Happy CLI 拦截点（MCP server）

**权限处理主流程**（`packages/happy-cli/sources/claude/utils/permissionHandler.ts:132-191`）：

- 行号 132：`handleToolCall()` 是 `canUseTool` 的实现
- 行号 135-139：`AskUserQuestion` 总是需要用户批准
- 行号 142-158：检查已允许的工具列表（`allowedTools` Set）
- 行号 172-184：根据权限模式自动批准
  - `bypassPermissions`：全部批准
  - `acceptEdits`：自动批准编辑工具
  - `plan`：自动批准只读工具
- 行号 190：调用 `handlePermissionRequest()` 发送到移动端

**权限请求发送到移动端**（行号 196-257）：

```typescript
// 行号 230：推送 Socket.IO 通知
this.session.api.push().sendSessionNotification({
  kind: 'permission',
  metadata: this.session.client.getMetadata(),
  data: {
    sessionId: this.session.client.sessionId,
    requestId: id,
    tool: toolName,
    type: 'permission_request',
    provider: 'claude',
  }
});

// 行号 243-253：更新 AgentState（供 App 拉取）
this.session.client.updateAgentState((currentState) => ({
  ...currentState,
  requests: {
    ...currentState.requests,
    [id]: { tool: toolName, arguments: input, createdAt: Date.now() }
  }
}));
```

### 3.3 Permission 响应流程

**RPC 处理器注册**（`packages/happy-cli/sources/claude/utils/permissionHandler.ts:344-386`）：

- 行号 345：注册 `'permission'` RPC 处理器
- 行号 348-361：解析响应 → 检查 toolUseID → 调用 `handlePermissionResponse()`
- 行号 364-384：完成的请求移至 `completedRequests`，记录批准/拒绝状态

**Promise 解析**（行号 71-126）：

```typescript
private handlePermissionResponse(response: PermissionResponse, pending: PendingRequest): void {
  // 行号 77-85：更新允许的工具
  if (response.allowTools) {
    response.allowTools.forEach(tool => {
      if (tool.startsWith('Bash(')) {
        this.parseBashPermission(tool);  // 解析 Bash(cmd:*) 模式
      } else {
        this.allowedTools.add(tool);
      }
    });
  }
  // 行号 88-90：更新权限模式
  if (response.mode) { this.permissionMode = response.mode; }
  // 行号 110/121-124：解析 Promise
  pending.resolve({ behavior: 'allow'|'deny', updatedInput, message });
}
```

---

## 4. MCP Tool 注册与调用

### 4.1 MCP Server 初始化

- Happy 使用版本：`@modelcontextprotocol/sdk@1.25.3`
- 上游最新版本：`1.29.0`
- `LATEST_PROTOCOL_VERSION = "2025-11-25"`（`node_modules/@modelcontextprotocol/sdk/dist/esm/types.d.ts:3`）
- `DEFAULT_NEGOTIATED_PROTOCOL_VERSION = "2025-03-26"`（同文件行号 4）

### 4.2 Tool 注册协议

**工具名称空间**：Happy 中工具前缀为 `mcp__happy__*`，移动专用为 `mcp__mobile__*`

**自动批准规则**（`packages/happy-cli/sources/codex/utils/permissionHandler.ts:27-38`）：

```typescript
private static readonly ALWAYS_AUTO_APPROVE_NAMES = new Set([
  'change_title',
  'mcp__happy__change_title',
]);
private static readonly ALWAYS_AUTO_APPROVE_ID_PREFIXES = ['change_title'];
```

**调用判断链路**（行号 69-109）：
1. `shouldAutoApprove()` 检查工具名称和 ID 前缀
2. 匹配 → 直接存入 `completedRequests`，返回 `{ decision: 'approved' }`
3. 不匹配 → 进入标准权限流程（存储 PendingRequest → 更新 AgentState → 发送通知）

### 4.3 mcp__happy__* 工具调用链路（以 change_title 为例）

```
1. Claude 调用 mcp__happy__change_title
2. CanUseTool 回调触发
3. shouldAutoApprove() → true（在 ALWAYS_AUTO_APPROVE_NAMES）
4. 直接批准，无移动端弹窗
5. MCP server 执行 tool
6. 结果返回给 Claude
```

---

## 5. 已知风险与 Gotcha

### 5.1 Session 跨 Daemon 生命周期问题

**问题**：
- Daemon 进程重启时，旧的 `keepAlive` 引用丢失（`session.ts:69-72`）
- `keepAliveInterval` 未被正确清理，服务器认为会话已死亡
- Session 对象绑定到进程生命周期，进程退出后状态不可恢复

**缓解建议**：
- Daemon 重启前显式调用 `session.cleanup()`
- 实现会话状态持久化到磁盘
- 重新连接时重建 keepAlive 状态

**已知 upstream bug**：Resume 按钮静默失败（daemon RPC error 格式不兼容 + session 跨 daemon 生命周期不追踪），见 memory `project_upstream_resume_bugs.md`。

### 5.2 MCP 拦截器配置时机

**问题**：
- Hook settings 文件必须在 Claude 进程启动**前**就位（`runClaude.ts:29`）
- Session ID 通过 hook 上报；hook 路径无效 → `onSessionFound()` 不触发 → `session.sessionId` 保持 null
- Session null 导致元数据更新失败（`session.ts:106-120`）

**关键路径**：
```
runClaude.ts:29 → generateHookSettingsFile()
runClaude.ts:42 → hookSettingsPath 传递给 loop()
loop.ts:64     → 传递给 Session()
claudeRemote.ts:131 → 传递给 SDK Query
```

**建议**：每次操作前验证 hook 文件存在；实现文件监视；增加回退机制。

### 5.3 升级注意事项

**claude-agent-sdk 升级**（当前 `0.2.96`）：
- 检查 `CanUseTool` 回调签名（`toolUseID` 字段是否变更）
- 检查 `Options` 类型（`sessionId` 字段）
- 检查 `Query` 返回类型（异步迭代器接口）
- `claudeCodeVersion: "2.1.96"` 需与 CLI binary 版本匹配

**@modelcontextprotocol/sdk 升级**（Happy `1.25.3` → 上游 `1.29.0`）：
- `LATEST_PROTOCOL_VERSION` 从 `2025-03-26` 升至 `2025-11-25`，可能影响协议握手
- 工具注册 API 可能变化
- 自动批准规则依赖工具 ID 格式，格式变化会导致静默失败

---

## 6. Happy CLI 调用关系图

```
CLI Entry (sources/index.ts)
  │
  ├── handleAuthCommand / handleConnectCmd / handleSandboxCmd
  │
  └── runClaude() [runClaude.ts]
       ├── generateHookSettingsFile()
       ├── Initialize Session (session.ts)
       ├── Setup API client (api.ts / apiSession.ts)
       └── loop() [loop.ts]
            │
            ├── LOCAL mode → claudeLocalLauncher()
            │    ├── spawn Claude via cross-spawn
            │    ├── readline on stdout (stream JSON)
            │    └── Hook settings → session ID discovery
            │
            └── REMOTE mode → claudeRemoteLauncher()
                 └── claudeRemote() [claudeRemote.ts]
                      ├── Build SDK options (sdk/query.ts)
                      ├── query() → @anthropic-ai/claude-agent-sdk
                      └── for await (message of response)
                           ├── system/init → extract tools, MCP servers
                           ├── assistant → stream output
                           └── result → session complete

Permission Flow (anywhere in loop):
  Claude requests tool
    → CanUseTool callback (permissionHandler.ts:132)
    → shouldAutoApprove()? → immediate allow
    → No: createPendingRequest + AgentState update
    → push().sendSessionNotification (kind: 'permission')
    → Mobile App receives → user taps Allow/Deny
    → RPC response received → rpcHandlerManager
    → handlePermissionResponse() → resolve Promise
    → SDK gets PermissionResult → continues execution
```

---

## 7. 关键源文件索引

| 组件 | 路径 | 主要功能 |
|------|------|---------|
| SDK 集成包装 | `packages/happy-cli/sources/claude/sdk/query.ts` | 官方 SDK query() 包装，Options 映射 |
| Session 管理 | `packages/happy-cli/sources/claude/session.ts` | 会话状态、keepAlive、回调注册 |
| PTY 模式 | `packages/happy-cli/sources/claude/claudeLocal.ts` | 进程启动、PTY 管理 |
| SDK 模式 | `packages/happy-cli/sources/claude/claudeRemote.ts` | SDK 集成、消息流处理 |
| 权限处理 | `packages/happy-cli/sources/claude/utils/permissionHandler.ts` | CanUseTool 实现、权限流程 |
| 控制循环 | `packages/happy-cli/sources/claude/loop.ts` | 模式切换、主循环 |
| API 客户端 | `packages/happy-cli/sources/api/api.ts` | 服务器通信 |
| API 会话 | `packages/happy-cli/sources/api/apiSession.ts` | Socket.IO、RPC、状态管理 |
| Codex 权限 | `packages/happy-cli/sources/codex/utils/permissionHandler.ts` | 自动批准规则、MCP tool 路由 |

## 8. SDK 类型定义关键引用

| 类型 | 文件 | 行号 | 说明 |
|------|------|------|------|
| `CanUseTool` | `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` | 145-188 | 权限回调签名 |
| `PermissionResult` | 同上 | ~650+ | 权限结果类型 |
| `Options` | 同上 | ~200+ | Query 选项类型 |
| MCP 协议版本 | `node_modules/@modelcontextprotocol/sdk/dist/esm/types.d.ts` | 3-4 | `LATEST_PROTOCOL_VERSION` |
