# happy-cli — 模块设计文档
> 生成时间：2026-04-29
> 分析文件数：184
> 研究范围：packages/happy-cli/src/

---

## 一句话定位

happy-cli 是运行于开发者本机的 Claude Code 代理进程，通过 E2E 加密 Socket.IO + HTTP 与服务端通信，实现移动端/Web app 远程控制本地 Claude（及 Gemini/Codex 等 ACP Agent）会话。输入：移动端加密消息 + RPC 调用；输出：加密 Agent 消息推送 + 文件操作 + 进程管理。

---

## 架构图

```
┌─────────────────────────────────────────────────────────┐
│                      happy-app (mobile/web)              │
│   用户输入 → 加密消息/RPC 调用 ←→ Session 状态/消息流   │
└───────────────────┬─────────────────────┬───────────────┘
                    │ Socket.IO /v1/updates│ HTTP /v3/sessions/:id/messages
                    ▼                     ▼
           ┌────────────────────────────────────┐
           │          happy-server               │
           │  (消息中继/加密存储/RPC 路由)        │
           └────────────┬───────────────────────┘
                        │ Socket.IO + HTTP
                        ▼
┌───────────────────────────────────────────────────────────┐
│                    happy-cli (本机)                        │
│                                                           │
│  ┌──────────────┐   ┌────────────────┐   ┌────────────┐  │
│  │   daemon     │   │  Claude 模式   │   │  ACP 模式  │  │
│  │  (run.ts)    │   │ (runClaude.ts) │   │ (runAcp.ts)│  │
│  │  进程锁       │   │  MessageQueue2 │   │ AcpBackend │  │
│  │  HTTP控制服务 │   │  loop.ts 状态机│   │ ACP SDK    │  │
│  │  60s心跳/升级 │   │  SDK/local模式│   │ ndJSON流   │  │
│  └──────┬───────┘   └───────┬────────┘   └─────┬──────┘  │
│         │                   │                   │         │
│  ┌──────▼───────────────────▼───────────────────▼──────┐ │
│  │            ApiSession / ApiMachine (Socket.IO)        │ │
│  │  RpcHandlerManager │ encryption.ts │ InvalidateSync   │ │
│  └──────────────────────────────────────────────────────┘ │
│                                                           │
│  ┌─────────────────────┐    ┌──────────────────────────┐ │
│  │  MCP Happy Server   │    │  文件传输模块             │ │
│  │ (share_file 等工具) │    │  App→CLI / CLI→App       │ │
│  └─────────────────────┘    └──────────────────────────┘ │
└───────────────────────────────────────────────────────────┘
                        │
          ┌─────────────┼─────────────┐
          ▼             ▼             ▼
    Claude SDK      Gemini CLI    Codex CLI
    (SDK/local)     (ACP ndJSON)  (ACP ndJSON)
```

---

## 入口与生命周期

### 顶层 CLI 命令（`src/index.ts`）

| 命令 | 入口 |
|------|------|
| `happy doctor` | `runDoctorCommand` |
| `happy auth` | `handleAuthCommand` |
| `happy connect <vendor>` | `handleConnectCommand` |
| `happy sandbox` | `handleSandboxCommand` |
| `happy resume` | `handleResumeCommand` |
| `happy codex` | `handleCodexCommand` |
| `happy gemini` | 内联逻辑 |
| `happy daemon start/stop/status` | `startDaemon` / `stopDaemon` |
| `happy <default>` | `runClaude` |

---

### Daemon 生命周期（`daemon/run.ts`）

#### 启动序列

```
startDaemon()                             run.ts:48
  ├─ 注册 SIGINT/SIGTERM/uncaughtException  run.ts:79-101
  ├─ isDaemonRunningCurrentlyInstalledHappyVersion()
  │    ├─ 版本匹配 → exit(0)
  │    └─ 版本不符 → stopDaemon() 再继续
  ├─ acquireDaemonLock(5 次重试, 200ms 间隔)  O_EXCL 原子创建
  ├─ startCaffeinate()                        阻止 macOS 休眠
  ├─ authAndSetupMachineIfNeeded()
  ├─ 从磁盘恢复 persisted sessions (14天内)
  ├─ startDaemonControlServer()               随机端口 HTTP
  ├─ writeDaemonState(fileState)
  ├─ ApiClient.create() + getOrCreateMachine()
  ├─ apiMachine.setRPCHandlers()
  ├─ apiMachine.connect()                     WebSocket 建连
  └─ setInterval(heartbeat, 60s)
```

#### 心跳与自升级（每 60s，`run.ts:813-904`）

1. 清除僵尸子进程（`process.kill(pid, 0)` 探测）
2. 检测 `dist/index.mjs` mtime（npm 安装后文件被替换）
3. 若检测到升级：释放锁 → 启动新 daemon → `process.exit(0)`
4. 写心跳到 `daemon.state.json`

环境变量 `HAPPY_DAEMON_HEARTBEAT_INTERVAL` 可覆盖间隔。

#### 停止序列（`run.ts:907-935`）

```
cleanupAndShutdown(source)
  ├─ clearInterval(heartbeat)
  ├─ apiMachine.updateDaemonState({status:'shutting-down'})
  ├─ await 100ms（让 metadata 发出）
  ├─ apiMachine.shutdown()
  ├─ stopControlServer()
  ├─ cleanupDaemonState()
  ├─ stopCaffeinate()
  ├─ releaseDaemonLock(handle)
  └─ process.exit(0)
```

触发来源：SIGINT/SIGTERM、App RPC、CLI HTTP、uncaughtException（带 1s 兜底 exit 防 cleanup 卡死）。

---

### Claude 模式 Session 生命周期（`claude/runClaude.ts`）

```
runClaude(credentials, options)
  ├─ ApiClient.create() → getOrCreateMachine()
  ├─ 探测 HAPPY_RECONNECT_* 环境变量（daemon 就地重连）
  ├─ getOrCreateSession() 或离线降级 + startOfflineReconnection
  ├─ startHappyServer(session)   MCP Happy 工具服务器
  ├─ startHookServer()           Claude Session ID 变更监听
  ├─ MessageQueue2 初始化（modeHash: permissionMode/model/systemPrompt）
  ├─ session.onUserMessage() 接收移动端消息
  │    └─ 解析 permissionMode/model/attachments 等字段
  ├─ 等待附件就绪（waitForUploadIds）
  └─ loop() → while (true): claudeLocal（cross-spawn 子进程）或 claudeRemote（claude-agent-sdk）
```

**模式切换**（`loop.ts`）：通过返回值驱动（无状态机），`local` ↔ `remote` 互切，`satisfies never` 确保编译期全覆盖。

---

### ACP Session 生命周期（`agent/acp/runAcp.ts:449`）

```
runAcp(opts)
  ├─ ApiClient + getOrCreateMachine + createSessionMetadata
  ├─ api.getOrCreateSession()
  ├─ setupOfflineReconnection()       onSessionSwap 回调
  ├─ startHappyServer()               MCP 工具服务器
  ├─ new AcpBackend({...mcpServers, permissionHandler})
  ├─ backend.startSession()           spawn ACP agent 子进程
  │    ├─ withRetry(initialize, 3次)  协议握手（60s 超时）
  │    └─ withRetry(newSession, 3次)  获取 acpSessionId
  ├─ session.onUserMessage() → messageQueue
  ├─ keepAlive interval（2000ms）
  └─ [主循环] while (!shouldExit)
       ├─ messageQueue.waitForMessagesAndGetAsString()
       ├─ sessionManager.startTurn()
       ├─ backend.sendPrompt()
       ├─ await turnEnded（最长 5 分钟）
       └─ sessionManager.endTurn('completed')
```

**Teardown（finally 块，`runAcp.ts:934-967`）**：8 步有序释放：keepAlive → reconnection → pendingTurn → permissionHandler → backend.offMessage → backend.dispose → happyServer.stop → session 归档/发送 death 通知/flush/close。

---

### ACP Backend 资源配对（`AcpBackend.ts`）

| 资源 | 申请 | 释放 |
|------|------|------|
| `ChildProcess` | `startSession():398 spawn()` | `dispose():1297 SIGTERM→1s→SIGKILL` |
| `ClientSideConnection` | `startSession():709` | `dispose():1291 cancel()` |
| `idleTimeout` | `sessionUpdateHandlers.ts:189` | `dispose():1319 clearIdleTimeout()` |
| `toolCallTimeouts` (Map) | `sessionUpdateHandlers.ts:270` | `dispose():1329 全部 clear` |
| `pendingPermissions` (Map) | `requestPermission` 回调 | `dispose():1334 clear()` |

---

## 核心算法与事件流

### 消息处理流水线（Claude 模式，CLI→App）

```
Claude SDK 输出 (onMessage)
  ├─ formatClaudeMessageForInk → Ink 显示缓冲区
  ├─ 跟踪 ongoingToolCalls（tool_use in ↔ tool_result out）
  ├─ getAskUserQuestionToolCallIds → push notification 触发
  ├─ sdkToLogConverter.convert() → JSONL log 格式
  ├─ 附加 permissions 字段到 tool_result
  └─ OutgoingMessageQueue.enqueue()       ← CLI→App 出站队列
       ├─ 顶层 tool call：延迟 250ms（等待权限响应）
       └─ sidechain 消息：立即入队
         ↓
ApiSessionClient.enqueueMessage(立即加密 content)
  → pendingOutbox.push({content, localId})
  → sendSync.invalidate()
  → flushOutbox() → HTTP POST /v3/sessions/:id/messages
    （CLI 内部批次上限：MAX_OUTBOX_BATCH_SIZE = 50，最新优先）
    （Server API 实际接受上限：100 条）
```

**注意**：`MessageQueue2` 是 **App→CLI 入站**消息的缓冲队列（接收移动端下发的用户指令），与上述 `OutgoingMessageQueue`（CLI→App 出站）方向相反，职责不同。

### 消息接收与去重（App→CLI，`apiSession.ts:199-212`）

```
Socket.IO 'update' 事件
  ├─ seq === lastSeq+1 → 直接解密处理，更新 lastSeq
  └─ seq 不连续 → receiveSync.invalidate() → HTTP GET /v3/sessions/:id/messages 补偿
```

首次连接（`lastSeq === 0`）始终走 HTTP 拉取。

### E2E 加密双轨（`api/encryption.ts`）

| 变体 | 算法 | 密钥 | 序列化格式 |
|------|------|------|------------|
| `legacy` | TweetNaCl `secretbox`（XSalsa20-Poly1305） | 32B 对称密钥（`secret`） | `nonce(24B) \|\| ciphertext` |
| `dataKey` | AES-256-GCM（Node.js `crypto`） | 32B AES 密钥（`machineKey`） | `version(1B=0) \|\| nonce(12B) \|\| ciphertext \|\| authTag(16B)` |

公钥加密（文件传输/密钥交换）：`nacl.box`（X25519-XSalsa20-Poly1305），格式 = `ephemeralPubKey(32B) \|\| nonce(24B) \|\| encrypted`。

身份验证：`nacl.sign`（Ed25519），challenge-response 防重放。

### MessageQueue2 并发控制（`utils/MessageQueue2.ts`）

- **单消费者模式**：`waiter` 字段最多持有 1 个 resolve 回调，不支持多消费者并发
- **批量收集**：`collectBatch()` 从队头收集相同 `modeHash` 的消息拼接；遇到不同 modeHash 或 `isolate` 标志立即停止
- **Isolate 消息**：`/compact`/`/clear` 命令通过 `pushIsolateAndClear()` 单独处理，不合并
- **AbortSignal 防泄漏**：abort 时清除 waiter 引用并 resolve(false)

### InvalidateSync（debounced 同步原语，`utils/sync.ts`）

驱动 `sendSync`（HTTP 消息发送）和 `receiveSync`（HTTP 消息拉取）：
- `invalidate()` 若命令未运行则立即启动；若已在运行则设置 `_invalidatedDouble = true`
- 命令完成后检查 `_invalidatedDouble`，为 true 则再次执行，保证无消息丢失
- `backoff` 包裹，网络失败自动重试

### RPC 请求处理（`api/rpc/RpcHandlerManager.ts`）

方法名格式：`<scopePrefix>:<method>`（scopePrefix = sessionId 或 machineId）

```
rpc-request 事件
  → 解密 request.params（decrypt(key, variant, decodeBase64(params))）
  → 查找 handler（Map<prefixedMethod, handler>）
  → handler(decryptedParams)
  → 加密响应 encodeBase64(encrypt(key, variant, result))
  → 任意异常 → 加密后返回 {error: message}
```

断连时清空 socket 引用；重连时统一重新注册所有已有 handler。

### ACP 权限阻塞桥（`AcpBackend.ts:567`，`BasePermissionHandler.ts:47`）

ACP SDK 的 `requestPermission` 是同步回调但需等待移动端异步响应：
1. 真正的阻塞发生在 `AcpBackend.ts:567` 的 `requestPermission` 闭包中，通过 `this.options.permissionHandler.handleToolCall()` 等待 Promise
2. `BasePermissionHandler.ts:47` 的 `pendingRequests` Map 存入 Promise resolve 引用，同时向移动端发送 `permission-request` 事件
3. 移动端通过 RPC 调用 `respondToPermission()`（`AcpBackend.ts:1254-1272`），触发 `onPermissionResponse` 回调链
4. 回调链间接触发 `BasePermissionHandler` 内的 resolve，Promise 完成，返回 ACP optionId（proceed_once/proceed_always/cancel）

注意：`respondToPermission()`（第 1254-1272 行）本身**不**直接发送权限响应给 ACP agent，它仅发出 UI 事件，需经由回调链才能触发 `pendingRequests` 中的 resolve。

在移动端响应前，ACP agent 子进程的 stdin 处于阻塞等待。

### Idle 检测机制

不使用 ACP 协议显式 complete 事件，通过 debounce timeout 实现：
- 每个 `agent_message_chunk` 到达时重置 500ms idle timeout
- 500ms 内无新 chunk 且无活跃 tool calls → `emitIdleStatus()`（`sessionUpdateHandlers.ts:184-196`）
- `waitForResponseComplete()` 通过 `idleResolver` Promise 等待此事件

默认 tool call 超时：2 分钟（`DEFAULT_TOOL_CALL_TIMEOUT_MS = 120_000`），`think` 类型 30s。

### 文件传输双向流

**App→CLI**：
```
App POST /v1/uploads (加密文件)
  → Server 通知 CLI: RPC file:upload {uploadId, filename, mimeType, sizeBytes}
  → CLI GET /v1/uploads/:id?sessionId= (下载加密 blob)
  → decryptFileBlob() + decryptFileMeta()
  → 写入 $HAPPY_HOME_DIR/uploads/<sessionId>/<uploadId>-<filename>
  → DELETE /v1/uploads/:id （消费确认）
  → pendingAttachments.enqueue()
  → runClaude.ts 等待 waitForUploadIds() → 路径注入消息文本
```

**CLI→App**：
```
CLI POST /v1/uploads (direction: 'cli_to_app', 加密文件)
  → CLI 发 file_share session message {uploadId, filename, mimeType, sizeBytes}
  → App 收到消息 → 从 server 下载解密
```

---

## 数据模型与状态

### Session 运行时类型（`api/types.ts`）

```typescript
Session = {
  id: string;
  seq: number;
  encryptionKey: Uint8Array;
  encryptionVariant: 'legacy' | 'dataKey';
  metadata: Metadata;
  metadataVersion: number;
  agentState: AgentState | null;
  agentStateVersion: number;
}
```

### Metadata（加密后传输，必填字段）

```typescript
Metadata = {
  path: string;        // 工作目录
  host: string;        // 主机名
  homeDir: string;
  happyHomeDir: string;
  happyLibDir: string;
  happyToolsDir: string;
  // + 可选：version, name, os, summary, machineId, claudeSessionId,
  //         tools, slashCommands, mcpServers, skills, lifecycleState,
  //         models, currentModelCode, operatingModes 等（ACP 注入）
}
```

### AgentState（permission 状态机）

```typescript
AgentState = {
  controlledByUser?: boolean | null;
  requests?: { [id]: { tool, arguments, createdAt } };            // pending
  completedRequests?: { [id]: { tool, arguments, createdAt,
    completedAt, status: 'canceled'|'denied'|'approved',
    reason?, mode?, decision?, allowTools? } };                    // done
}
```

状态流转：permission 请求 → `requests` → 用户决策 → `completedRequests`。

### Wire Protocol（`happy-wire/src/messages.ts`）

传输层容器（服务端不可解密）：

```typescript
SessionMessageContent = { c: string; t: 'encrypted' }
SessionMessage = { id, seq, localId?, content: SessionMessageContent, createdAt, updatedAt }
CoreUpdateBody =
  | { t: 'new-message'; sid: string, message: SessionMessage }          // sid = session ID（必填，用于路由）
  | { t: 'update-session'; id: string, metadata?: VersionedEncryptedValue, agentState?: VersionedNullableEncryptedValue }  // id = session ID（必填）
  | { t: 'update-machine'; machineId: string, metadata?, daemonState?, active?, activeAt? }  // machineId（必填）
```

### 生产消息格式（`happy-wire/src/legacyProtocol.ts` + `sessionProtocol.ts`）

**注意**：`happy-wire/src/sessionProtocol.ts`（SessionEnvelope 协议）标注为 `⚠️ UNDER REVIEW`，类型冻结、不接受新消费者，但 happy-cli **已在生产路径中大量使用**。`createEnvelope` 的 3 个调用点为：`claude/utils/sessionProtocolMapper.ts`、`codex/utils/sessionProtocolMapper.ts`、`agent/acp/AcpSessionManager.ts`（第三个是 AcpSessionManager，非 mapper）；此外 `apiSession.ts:enqueueSessionProtocolEnvelope()` 消费封装后的 envelope。注意：apiSession.ts 和 OpenClaw（openclaw 模块）本身**不**直接调用 `createEnvelope`。`legacyProtocol.ts` 格式如下：

```typescript
UserMessage  = { role: 'user'; content: {type:'text'; text}; localKey?, meta?, attachments? }
AgentMessage = { role: 'agent'; content: {type; ...}; meta? }
FileShareContent = { type: 'file_share'; uploadId, filename, mimeType, sizeBytes, description? }
```

### MessageMeta（`happy-wire/src/messageMeta.ts`，权威定义）

```typescript
MessageMeta = {
  sentFrom?, permissionMode?, model?, fallbackModel?,
  customSystemPrompt?, appendSystemPrompt?,
  allowedTools?, disallowedTools?, displayText?
}
```

⚠️ `packages/happy-cli/src/api/types.ts` 中重复定义了 `MessageMetaSchema` 但**缺少 `displayText` 字段** [已确认：CLI 端会静默忽略该字段，可通过补充 `displayText: z.string().optional()` 修复]。

⚠️ `packages/happy-cli/src/api/types.ts:241-248` 的 `AgentMessageSchema` 中 content 结构与 happy-wire 不兼容 [已确认：wire 版（`legacyProtocol.ts:36-40`）中 content type 为任意字符串且 passthrough，CLI 本地版硬编码 type 为 `'output'` 并新增独立 `data: z.any()` 字段，导致 CLI 对 'acp'/'codex'/'file_share' 等 type 值的 AgentMessage 解析与 wire 协议不一致，建议长期替换为直接导入 wire 定义]。

### 持久化结构

**Credentials**（`~/.happy/access.key`）：

```typescript
// 磁盘：{ token, secret?: Base64, encryption?: {publicKey: Base64, machineKey: Base64} }
// 运行时：{ token, encryption: {type:'legacy'; secret: Uint8Array}
//                            | {type:'dataKey'; publicKey: Uint8Array; machineKey: Uint8Array} }
```

**Settings**（`~/.happy/settings.json`，schemaVersion=2）：含 onboardingCompleted、machineId、daemonAutoStart 等。文件锁 + 原子写入（写临时文件再 rename）。

**PersistedSession**：14天内有效，存于 `sessions.json`，含 sessionId 和加密密钥（供 daemon 重启后恢复）。

**DaemonState**（API 可见）：

```typescript
DaemonState = {
  status: 'running' | 'shutting-down';
  pid?, httpPort?, startedAt?,
  shutdownRequestedAt?, shutdownSource?
}
```

---

## 外部接口与依赖

### HTTP API（与 happy-server 通信）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/v1/auth` | Ed25519 challenge-response 认证，获取 token |
| POST | `/v1/sessions` | 创建/加载 session（含加密 metadata） |
| POST | `/v1/machines` | 注册 machine |
| POST | `/v1/connect/:vendor/register` | 注册 vendor API key |
| GET | `/v3/sessions/:id/messages` | 拉取加密消息（?after_seq=&limit=） |
| POST | `/v3/sessions/:id/messages` | 批量发送加密消息（CLI 侧 `MAX_OUTBOX_BATCH_SIZE=50`；Server 侧接受上限 100） |
| GET/POST/DELETE | `/v1/uploads/*` | 文件传输（下载/上传/消费确认） |

请求头：`Authorization: Bearer <token>` + `X-Happy-Client: <clientType>/<version>`

### Socket.IO（`/v1/updates`，`reconnection: false` + 手动重连）

两类连接：
- `session-scoped`：auth `{ token, clientType, sessionId, happyClient }`
- `machine-scoped`：auth `{ token, clientType, machineId, happyClient }`

**Server→Client 关键事件**：`update`（消息/元数据）、`rpc-request`（RPC 调用）、`ephemeral`（实时活跃状态）

**Client→Server 关键事件**：`session-alive`（keepalive）、`update-metadata`/`update-state`（乐观并发 CAS）、`rpc-register`/`rpc-unregister`、`machine-alive`（20s 间隔）

Socket.IO 配置 `reconnection: false`（禁用内置重连），由 `startSmartReconnect()` 实现手动重连：断线后启动 3000ms 间隔的轮询；若立即满足 `shouldReconnect()` 条件，额外发起一次 1s 的一次性快速尝试（setTimeout，非阶段切换）；3000ms 轮询持续至 socket.connected 为 true 时清除。

乐观并发：`expectedVersion` + 服务端返回 `{result, version, data}`，`version-mismatch` 时 `backoff()` 重试。

### Session 作用域 RPC（App→CLI，via Server）

| 方法 | 说明 |
|------|------|
| `bash` | 执行 shell 命令（cwd 限制在 workingDirectory）|
| `readFile` / `writeFile` | 文件读写（base64，写带 SHA-256 校验）|
| `listDirectory` / `getDirectoryTree` | 目录浏览（跳过 symlink）|
| `ripgrep` / `difftastic` | 调用本机二进制 |
| `file:upload` | App→CLI 文件传输触发 |
| `abort` / `switch` | 会话中止/切换控制 |
| `kill-session` | 停止当前会话 |

所有文件路径经 `pathSecurity.ts` validatePath() 防目录遍历。

### Machine 作用域 RPC

| 方法 | 说明 |
|------|------|
| `spawn-happy-session` | 启动新 Claude/ACP 会话 |
| `resume-happy-session` | 恢复已有会话 |
| `stop-session` | 停止指定会话 |
| `stop-daemon` | 触发 daemon 关机 |

### 关键依赖

| 包 | 用途 |
|----|------|
| `@slopus/happy-wire` | 共享 Wire 类型定义 |
| `@anthropic-ai/claude-agent-sdk` | Claude SDK（remote 模式）|
| `@agentclientprotocol/sdk` | ACP 协议（Gemini/Codex 等）|
| `socket.io-client` | WebSocket 实时通信 |
| `axios` | HTTP API 调用 |
| `tweetnacl` | legacy 加密 + Ed25519 签名 |
| `node:crypto` | AES-256-GCM（dataKey 变体）|
| `cross-spawn` | local 模式（`claudeLocal.ts`，启动 Claude 子进程，fd3 管道传递 thinking 状态） |
| `@agentclientprotocol/sdk` | `ClientSideConnection`, `ndJsonStream` 等 |
| `zod` | 消息类型验证 |

### 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `HAPPY_SERVER_URL` | `https://api.cluster-fluster.com` | server 地址 |
| `HAPPY_HOME_DIR` | `~/.happy` | 数据/密钥目录 |
| `HAPPY_DAEMON_HEARTBEAT_INTERVAL` | `60000` | daemon 心跳间隔（ms）|
| `HAPPY_EXPERIMENTAL` | `false` | 实验性功能开关 |
| `HAPPY_DISABLE_CAFFEINATE` | `false` | 禁用 macOS caffeinate |
| `HAPPY_VARIANT` | `stable` | 显示 DEV MODE 标识 |
| `HAPPY_RECONNECT_*` | — | daemon 触发 session 重连时注入 |

---

## 性能特征

- **消息发送延迟**：CLI 使用 HTTP outbox 批量发送（非 Socket.IO），最近插入的消息优先发送（从队尾取批次），减少用户感知延迟
- **消息接收**：Socket.IO 推送 + HTTP 补偿双轨，seq 连续时 O(1) 解密处理；不连续时触发 HTTP 拉取（网络开销）
- **加密开销**：每条消息 JSON.stringify → UTF-8 → 加密（symmetric），文件传输额外进行公钥加密（非对称，仅密钥交换）
- **daemon 内存**：多 session 并发时每个 session 持有独立的 ApiSessionClient、MessageQueue2、pendingAttachments；无全局 session 池限制
- **ACP 重试**：initialize + newSession 各最多 3 次，指数退避（1s → 2s → 4s，上限 5s），ENOENT/EACCES/EPIPE 不重试
- **tool call 超时**：默认 2 分钟，防止挂起会话积累泄漏
- **MessageQueue2**：单消费者批量处理，同 modeHash 消息合并为单次 Claude 调用，减少上下文切换

---

## 已知限制与待验证项

### 已确认的设计限制

1. **sessionProtocol.ts 冻结但已生产使用**：`happy-wire/src/sessionProtocol.ts` 标注为 UNDER REVIEW/类型冻结，不接受新消费者；happy-cli 已在生产路径大量使用（`sessionProtocolMapper.ts` + `apiSession.ts`），新功能仍不得依赖前者
2. **MessageQueue2 单消费者**：`waiter` 字段设计为单消费者，多消费者并发会静默覆盖，当前代码路径中仅有一处消费者但 ACP 路径需确认
3. **ACP 权限阻塞**：`requestPermission` 在移动端响应前阻塞 ACP agent stdin，超时完全依赖 `permissionHandler` 内部实现
4. **RPC 无幂等保护**：`handleRequest` 无去重逻辑，Socket.IO 重传可能导致同一 RPC（如文件写入）重复执行
5. **Daemon 崩溃无自恢复**：daemon 意外退出时（uncaughtException 以外的崩溃）`daemon.state.json` 会被清除，无自动重启机制；需用户手动执行 `happy daemon start` 重启

### 待验证项

| 标记 | 内容 | 位置 |
|------|------|------|
| [已确认] | local 模式（`claudeLocal.ts`）使用 `cross-spawn` 子进程（非 node-pty），通过 fd3 管道传递 thinking 状态，轮询 `.jsonl` 文件读取 session 消息 | claudeLocal.ts |
| [待验证] | `setupOfflineReconnection` 的具体重连策略和 backoff | lifecycle_analysis.md §5.5 |
| [待验证] | 离线重连 scanner 跨多次重连的泄漏风险 | core_logic_analysis.md §13.4 |
| [已确认] | `MessageMeta.displayText` 字段在 CLI 消费侧存在对齐问题：`api/types.ts` 副本缺少该字段，CLI 会静默忽略 | api/types.ts:189-198 |
| [待验证] | `logger.ts` 日志目录创建逻辑的具体路径 | lifecycle_analysis.md §2.5 |
| [已确认] | SDK 包名为 `@anthropic-ai/claude-agent-sdk`（非 claude-code） | package.json:96 |
| [待验证] | MCP permission server 完整实现路径（`src/claude/sdk/` 下具体文件）| external_interface_analysis.md §11 |
| [已确认] | `node-pty` 不在 package.json 中，local 模式使用 `cross-spawn` | package.json |
| [待验证] | `src/resume/localHappyAgentAuth.ts` 中 `detectResumeSupport` 详细实现 | external_interface_analysis.md §11 |
| [待验证] | ACP Investigation 工具的 10 分钟超时（GeminiTransport）实现位置 | lifecycle_analysis.md §4.4 |
