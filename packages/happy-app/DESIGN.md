# happy-app — 模块设计文档
> 生成时间：2026-04-29
> 分析文件数：398
> 研究范围：packages/happy-app/sources/

---

## 一句话定位

happy-app 是 Happy 系统的 React Native + Expo 跨平台前端（iOS/Android/Web/macOS），充当用户与远程 Claude Code 会话之间的加密控制终端。输入：用户操作（发送消息、批准权限）；输出：E2E 加密消息 → happy-server → CLI daemon；接收：Socket.IO 实时更新（解密后展示）。

---

## 架构图

```
┌─────────────────────────────────────────────────────────┐
│                 happy-app (前端)                         │
│  iOS / Android / Web / macOS                            │
│                                                         │
│  ┌───────────────────┐   ┌───────────────────────────┐  │
│  │  Expo Router v6   │   │   Sync Engine (sync.ts)   │  │
│  │  app/(app)/*      │   │   InvalidateSync × N      │  │
│  │  File-based nav   │   │   ActivityAccumulator     │  │
│  └────────┬──────────┘   └────────────┬──────────────┘  │
│           │                           │                  │
│  ┌────────▼──────────────────────────▼──────────────┐   │
│  │  Zustand Store (storage.ts)                       │   │
│  │  sessions / sessionMessages / machines / artifacts│   │
│  │  Reducer: Raw → Normalized → ReducerMessage       │   │
│  └──────────────────┬────────────────────────────────┘   │
│                     │                                    │
│  ┌──────────────────▼────────────────────────────────┐   │
│  │  ApiSocket (apiSocket.ts) — Singleton              │   │
│  │  REST API (fetch + Bearer token)                   │   │
│  │  Socket.IO → /v1/updates (WebSocket only)         │   │
│  │  RPC over Socket.IO (sessionRPC / machineRPC)     │   │
│  └──────────────────┬────────────────────────────────┘   │
│                     │                                    │
│  ┌──────────────────▼────────────────────────────────┐   │
│  │  Encryption Layer (encryption.ts)                  │   │
│  │  masterSecret → contentKeyPair + anonID            │   │
│  │  SessionEncryption / MachineEncryption / Artifact  │   │
│  │  libsodium: XSalsa20-Poly1305 + Curve25519（消息加密/密钥交换）│
│  │  Ed25519 仅用于 QR 认证阶段的签名                   │
│  │  rn-encryption: AES256（独立 RN 加密库，非 libsodium）│   │
│  └───────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
                 ↕ HTTPS / WSS
┌────────────────────────────────┐
│       happy-server              │
│  REST + Socket.IO 实时推送     │
└────────────────────────────────┘
                 ↕ Socket.IO RPC
┌────────────────────────────────┐
│       happy-cli (daemon)        │
│  本地机器 Claude 会话控制      │
└────────────────────────────────┘
```

---

## 入口与生命周期

### App 初始化序列（`app/_layout.tsx`）

```
RootLayout 挂载
  ├─ Notifications channel setup (Android 8.0+, line 1-51)
  ├─ SplashScreen.preventAutoHideAsync()          _layout.tsx:73
  ├─ loadFonts()（AsyncLock 单次加载）            _layout.tsx:120-181
  │    IBM Plex Sans/Mono, Bricolage Grotesque, FontAwesome
  ├─ await sodium.ready（libsodium 初始化）       _layout.tsx:244
  ├─ TokenStorage.getCredentials()                _layout.tsx:247-251
  │    Native: SecureStore | Web: localStorage
  ├─ [可选] Dev credential override               _layout.tsx:252-264
  │    EXPO_PUBLIC_DEV_TOKEN / URL query params
  ├─ [如有 credentials] syncRestore(credentials) _layout.tsx:266-273
  │    → Encryption.create() → apiSocket.init()
  └─ setInitState({ credentials })（解锁渲染）    _layout.tsx:275
       → SplashScreen.hideAsync()（延迟 100ms）   _layout.tsx:284-289
```

**Provider 嵌套顺序**（`_layout.tsx:402-422`）：
```
SafeAreaProvider → KeyboardProvider → GestureHandlerRootView
→ AuthProvider → ThemeProvider → StatusBarProvider
→ ModalProvider → CommandPaletteProvider → RealtimeProvider
→ SidebarNavigator (routes)
```
PostHogProvider 在最外层包裹（tracking 初始化后）。

### AuthContext 生命周期（`auth/AuthContext.tsx:19-81`）

| 操作 | 流程 |
|------|------|
| 初始化 | `isAuthenticated = !!initialCredentials`（line 20）|
| `login()` | `TokenStorage.setCredentials()` → `syncCreate()` → setState |
| `logout()` | 注销 push token → `clearPersistence()` → `removeCredentials()` → reload |

**全局 auth 同步**（`AuthContext.tsx:24-26`）：`setCurrentAuth()` 允许非 React 代码访问当前认证状态。

### 认证流程：QR code Challenge-Response

```
Phase 1 authQRStart  — 生成临时 keypair，公钥编入 QR
Phase 2 authChallenge — crypto_sign_seed_keypair(secret) + 随机 challenge + signature
Phase 3 authQRWait   — 轮询 POST /v1/auth/account/request（1s 间隔）
                       状态: 'not_found' → 'pending' → 'authorized'
                       Authorized: 解密响应 → 提取 token + secret
Phase 4 authApprove  — App 扫描 CLI QR → POST /v1/auth/response
```
（`auth/authChallenge.ts:4-8`, `auth/authQRWait.ts:13-60`, `auth/authApprove.ts:12-55`）

### Socket.IO 连接生命周期（`sync/apiSocket.ts`）

**Singleton**: `export const apiSocket = new ApiSocket()`

```
apiSocket.initialize({ endpoint, token }, encryption)
  → if (!config || socket) return  // 防双连
  → io(endpoint, {
      path: '/v1/updates',
      transports: ['websocket'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: Infinity
    })                              // apiSocket.ts:70-82
  → setupEventHandlers()

Event handlers:
  connect → updateStatus('connected')
            if !socket.recovered → fire reconnectedListeners  // apiSocket.ts:248-249
  disconnect → updateStatus('disconnected')
  connect_error → updateStatus('error')
  onAny(event, data) → dispatch to messageHandlers Map      // apiSocket.ts:275-283
```

**重连后恢复**（`sync.ts:1745-1760`）：
```
sessionsSync.invalidate()
machinesSync.invalidate()
artifactsSync.invalidate()
friendsSync.invalidate()
friendRequestsSync.invalidate()
feedSync.invalidate()
sendSync.invalidate() (per-session pending outbox，全部)
```
消息按 session 懒加载（onSessionVisible 触发）。

### Sync Engine 初始化（`sync/sync.ts:2344-2371`）

```
syncCreate/syncRestore → syncInit(credentials, restore)

Step 1  Encryption.create(secret)                sync.ts:2347-2351
        secret = decodeBase64(credentials.secret)  // 32B 验证
        → derive contentDataKey → contentKeyPair
        → derive anonID (analytics)

Step 2  initializeTracking(encryption.anonID)    sync.ts:2353-2354

Step 3  apiSocket.initialize(endpoint, token, encryption) sync.ts:2356-2358

Step 4  apiSocket.onStatusChange(storage.setSocketStatus)  sync.ts:2360-2363

Step 5  if restore: sync.restore()（非阻塞）    sync.ts:2366-2370
        if create: sync.create()（await settings/profile/purchases）
```

**InvalidateSync 实例**（`sync.ts:122-131`）：
`sessionsSync, settingsSync, profileSync, purchasesSync, machinesSync, nativeUpdateSync, artifactsSync, friendsSync, friendRequestsSync, feedSync, pushTokenSync`（共 11 个），每个绑定一个 fetch/sync 方法。

### 活跃定时器与后台任务

| 定时器 | 周期 | 位置 |
|--------|------|------|
| ActivityUpdateAccumulator 防抖 | 2000ms（类默认 500ms，Sync 构造时传入 2000ms）| `activityUpdateAccumulator.ts:13-51`，`sync.ts:140` |
| 重要活动变化（state toggle）立即 flush | 立即 | `activityUpdateAccumulator.ts:38` |
| 时间戳 >60s 立即 flush | 触发时 | `activityUpdateAccumulator.ts:44` |
| AppState 后台消息超时看门狗 | 30s | `sync.ts:338-352` |

### 资源管理

**通知监听器**（`_layout.tsx:344-369`）：`subscription.remove()` 在 `useEffect` 清理函数中调用。

**语音会话**（`RealtimeProvider.tsx:14`）：`<ElevenLabsProvider key={generation}>` 通过 key 变化触发 remount，避免 LiveKit Room 重用 bug。

**[待验证] 资源泄漏风险**：
- 消息锁 Map（`sync.ts:292-299`）：per-session AsyncLock，session 删除时不清理
- AppState listener（`sync.ts:143`）：无显式 `.remove()` 调用

---

## 核心算法与事件流

### 消息发送流水线（`sync/sync.ts:469-558`）

```
user input
  ├─ 解析 permission mode / model（messageMeta.ts）
  ├─ 创建 RawRecord（含 sentFrom, permissionMode, model, systemPrompt）
  ├─ SessionEncryption.encryptRawRecord() → base64
  ├─ enqueue to pendingOutbox + UI (normalizeRawMessage)
  ├─ getSendSync(sessionId).invalidate() → flushOutbox()
  └─ [如有附件] sessionRPC('file:upload', { uploadId })（异步，fire-and-forget）
                  sync.ts:551-557
```

**flushOutbox**（`sync.ts:1598-1659`）：HTTP POST `/v3/sessions/{sid}/messages`
- 成功：响应含 seq → updateSessionLastSeq
- 失败：启动 30s 后台超时看门狗

### 消息接收与解密（`sync/sync.ts:1763-1856`）

```
Socket.IO 'update' event
  ├─ 验证 ApiUpdateContainerSchema（App 本地定义，body 类型为含 App 专有字段的 ApiUpdateSchema；
  │   区别于 happy-wire 的 CoreUpdateContainerSchema，两者不可互换）
  ├─ 获取 SessionEncryption(sessionId)
  ├─ encryption.decryptMessage()（单条解密，命中缓存跳过；批量解密仅用于全量拉取路径）
  ├─ 规范化为 NormalizedMessage
  ├─ 检查生命周期事件（turn-start/end, task_complete → thinking 状态）
  ├─ 快速路径：incomingSeq == lastSeq+1 → 直接 enqueue + update lastSeq
  └─ 慢速路径：seq 有 gap → invalidate getMessagesSync(sessionId)
```

**批量解密**（`sync/sessionEncryption.ts:26-94`）：
1. 检查缓存（MessageId → DecryptedMessage）
2. 收集未缓存且加密的消息
3. 批量 base64 decode → Uint8Array[]
4. 单次 `encryptor.decrypt(array)` 并行解密
5. 逐条写入缓存

### E2E 加密体系（`sync/encryption/encryption.ts:12-207`）

**初始化（`encryption.ts:14-27`）**：
```
masterSecret (32B)
  → deriveKey('Happy EnCoder', ['content'])
    → contentDataKey（只读实例字段，值为 contentKeyPair.publicKey，即 Curve25519 公钥）
    → crypto_box_seed_keypair(seed) → contentKeyPair（实例字段，含 publicKey/privateKey）
    注：contentDataKey 存储的是派生后的 publicKey（非原始 seed），供外部加密逻辑访问
  → deriveKey('Happy Coder', ['analytics', 'id']).slice(0,16)
    → anonID（16 char hex，用于 PostHog）
```

**加密层次**：
1. **Legacy（SecretBoxEncryption）**：masterSecret 直接加密（XSalsa20-Poly1305）
2. **Session 级 AES256**：Session DEK → AES256Encryption（现代路径）
3. **Machine 级**：独立 MachineEncryption 上下文

**文件加密**（`sync/fileEncryption.ts:25-75`）：
```
Blob: nonce_blob(24B random) + encrypt(bytes, sessionKey)
Meta: nonce_meta(24B random, INDEPENDENT) + encrypt({filename,mimeType,sizeBytes}, sessionKey)
```
两个 nonce **必须**独立：防止 XSalsa20 two-time-pad 攻击（`apiUploads.ts:54-59`）。

**Session DEK 解密**（`encryption.ts:183-194`）：
```
base64 → decodeBase64 → version byte check (0)
→ decryptBox(slice(1), contentKeyPair.privateKey) → Uint8Array DEK
```

### RPC 调用流程（`sync/apiSocket.ts:127-162`）

```
App → sessionRPC(sessionId, method, params)
  ├─ getSessionEncryption(sessionId)  // throws if not initialized
  ├─ encryptRaw(params) → base64
  ├─ socket.emitWithAck('rpc-call', {
  │    method: `${sessionId}:${method}`,
  │    params: encrypted
  │  })
  └─ decrypt(result.result) → return R
```
机器级 RPC（`machineRPC`）：相同模式，改用 MachineEncryption key。

### Permission Request 处理（`sync/reducer.ts`）

**CLI 侧触发链**（权限请求如何到达 App）：
```
CLI permissionHandler.ts:243
  → socket.emitWithAck('update-state', { agentState, expectedVersion })
  → happy-server 乐观并发写入（CAS），广播 update-session 事件
  → App sync.ts:1899 接收 update-session，解密 agentState
  → 更新 Zustand Store.sessions[id].agentState
  → reducer Phase 0 消费 AgentState.requests，创建 ToolMessage
```

### Web Permission Zombie Recovery（B-02，`sync/storage.ts`）

当 Web 客户端因 Socket.IO 心跳超时（~60s）断开并重连后，断线期间被其他设备（如 iOS）处理完的权限请求，在 Web 端恢复时会显示为"Handled on another device"信息气泡，而非静默灰色状态。

**SessionMessages 扩展字段**（`storage.ts:64-69`）：
```typescript
interface SessionMessages {
    messages: Message[];
    messagesMap: Record<string, Message>;
    reducerState: ReducerState;
    isLoaded: boolean;
    seenPendingIds: Set<string>;      // 本设备曾见过的 pending 权限 ID
    missedCompletedIds: Set<string>;  // 检测为"missed"的已完成权限 ID（UI 消费）
}
```
两个 Set 均为**纯内存**字段，不持久化到 MMKV，App 重启后自然清空。

**"Missed"检测算法**（在 `applySessions` 的 agentState 处理块中执行）：
```
Step 1: 把所有 agentState.requests[permId] 加入 seenPendingIds
Step 2: 遍历 agentState.completedRequests：
  - Condition A: completedAt != null && now - completedAt < 30_000ms（时间窗口）
  - Condition B: !seenPendingIds.has(permId)（本设备未曾见过该请求）
  → 同时满足 A+B → 加入 missedCompletedIds
```

**30 秒窗口理由**：Socket.IO 重连通常在 1-5s 内完成；>30s 前完成的权限用户已完成上下文切换，无需再显示；与现有后台发送看门狗（`sync.ts:338-352`）保持一致。

**UI 变更链**：
```
storage.applySessions → missedCompletedIds.add(permId)
  ↓ Zustand 更新触发重渲染
ToolView → useMemo: storage.getState().sessionMessages[sid]?.missedCompletedIds.has(permId)
  ↓ isMissed=true
PermissionFooter → 早返回分支：
  <View> <Ionicons name="phone-portrait-outline"/> <Text>{t('permissions.handledOnAnotherDevice')}</Text> </View>
```

**新增翻译键**（全部 10 个语言文件）：
```
permissions.handledOnAnotherDevice  →  "Handled on another device"
```

**风险**：纯 App 内逻辑，无 server/CLI 变更；算法为 O(n) 其中 n=completedRequests 数量（通常 <50），性能影响可忽略。

**6 个处理阶段**（`reducer.ts:36-70`）：
```
Phase 0:   AgentState.requests → 创建 ToolMessage (pending/approved)
Phase 0.5: 消息到事件转换
Phase 1:   用户/文本消息
Phase 2:   工具调用 → 匹配 permission（name + args 深相等）→ 更新 ToolMessage
Phase 3:   工具结果 → update ToolMessage.result
Phase 4:   子链消息（isSidechain=true）
Phase 5:   模式切换事件
```

**匹配算法**（`reducer.ts:112-150`）：
- 按 `tool name + arguments` 深相等匹配
- 优先匹配最新 permission（防止 stale permission 重用）
- tool call 可覆盖 permission 占位（toolIdToMessageId 映射）

### 消息规范化流水线

```
Server JSON
  ↓
RawRecord（typesRaw.ts:442-474）
  角色：'agent' | 'user' | 'session'
  ↓
NormalizedMessage（typesMessage.ts:528-563）
  roles: user / agent / event / file-share
  agent content types: text, thinking, tool-call, tool-result, summary, sidechain
  ↓
ReducerMessage（dedup via messageIds/localIds Maps）
  → Zustand Store.sessionMessages
```

### 数据同步 — InvalidateSync 模式（`sync.ts:122-140`）

```
InvalidateSync:
  invalidate() → appends async fetch to queue（防并发）
  awaitQueue() → Promise.all for startup ready gate
  Pattern: fetch → apply → update Store → UI react
```

**启动就绪门控**（`sync.ts:203-243`）：
```
Promise.all([sessionsSync.awaitQueue(), machinesSync.awaitQueue()])
  .then(applyReady) → UI 解锁
```

### Activity 更新节流（`activityUpdateAccumulator.ts:3-96`）

- 2000ms 防抖（实际运行时配置值，见 sync.ts:140），批量发送活跃状态
- 重要状态变化（active/thinking toggle）立即 flush
- 时间戳 >60s（session 断线超时 120s 的一半）立即 flush，防服务端超时判定

---

## 数据模型与状态

### Zustand Store 结构（`sync/storage.ts:138-223`）

```typescript
StorageState {
  sessions: Record<string, Session>
  sessionMessages: Record<string, {
    messages: Message[]
    messagesMap: Record<string, Message>
    reducerState: ReducerState
    isLoaded: boolean
    seenPendingIds: Set<string>      // B-02: 本设备曾见过的 pending 权限 ID（内存）
    missedCompletedIds: Set<string>  // B-02: 检测为"missed"的权限 ID（内存）
  }>
  machines: Record<string, Machine>
  artifacts: Record<string, DecryptedArtifact>
  friends: Record<string, UserProfile>
  feedItems: FeedItem[]
  socketStatus: 'disconnected' | 'connecting' | 'connected' | 'error'
  realtimeStatus: 'disconnected' | 'connecting' | 'connected' | 'error'
}
```
持久化：MMKV 后端（`sync/storage.ts:321-1512`），`useShallow` 避免不必要重渲染。

### Session（`sync/storageTypes.ts:91-121`）

```typescript
{
  id, seq, createdAt, updatedAt, active, activeAt
  metadata: Metadata | null               // 加密 Session 元数据（服务端加密存储）
  metadataVersion: number                  // CAS 乐观锁版本
  agentState: AgentState | null            // 权限请求状态
  agentStateVersion: number
  thinking: boolean
  presence: "online" | number              // "online" 或最后见时间戳
  todos?: TodoItem[]
  // 本地字段（不同步服务端）：
  draft, permissionMode, modelMode, effortLevel, latestUsage
}
```

**Metadata**（`storageTypes.ts:7-54`）：path, host, version, models, operatingModes, thoughtLevels, tools[], slashCommands[], mcpServers[], skills[], sandbox, machineId, lifecycleState

### AgentState（`sync/storageTypes.ts:58-76`）：Zod Schema

```typescript
{
  controlledByUser?: boolean
  requests: Record<string, {
    tool: string; arguments: any; createdAt?: number
  }>                                        // 待审批权限
  completedRequests: Record<string, {
    tool, arguments, createdAt, completedAt, status, reason, mode, allowedTools, decision
  }>                                        // 已完成权限
}
```

### Machine（`sync/storageTypes.ts:135-179`）

- 基础：host, platform, happyCliVersion, arch, username, homeDir
- CLI 可用性：{ claude, codex, gemini, openclaw, detectedAt }
- 恢复支持：{ rpcAvailable, requiresSameMachine, happyAgentAuthenticated }
- daemonState: any（运行时动态状态）

### API 更新事件类型（`sync/apiTypes.ts:56-135`）

**持久化事件**（Socket.IO `update` 事件）：
`new-session`, `update-session`, `new-message`, `delete-session`,
`update-machine`, `delete-machine`, `update-account`,
`new-artifact`, `update-artifact`, `delete-artifact`,
`relationship-updated`, `new-feed-post`, `kv-batch-update`

**临时事件**（Socket.IO `ephemeral` 事件）：
```typescript
{ type: 'activity', id, active, activeAt, thinking }      // 会话活跃状态
{ type: 'usage', id, key, timestamp, tokens, cost }       // token 使用
{ type: 'machine-activity', id, active, activeAt }         // 机器在线状态
```

**统一更新容器**（`apiTypes.ts:146-153`）：
```typescript
{ id: string, seq: number, body: ApiUpdate, createdAt: number }
```

### 消息类型体系

**NormalizedAgentContent**（`sync/typesMessage.ts:486-526`）：
- `text`: { type, text, uuid, parentUUID }
- `thinking`: { type, thinking, uuid, parentUUID } [待验证: 扩展思维字段]
- `tool-call`: { id, name, input, description, uuid, parentUUID }
- `tool-result`: { tool_use_id, content, is_error, uuid, parentUUID, permissions? }
- `summary`: { summary }
- `sidechain`: { uuid, prompt }

**MessageMeta**（`sync/typesMessageMeta.ts:4-14`）：
sentFrom, permissionMode, model, fallbackModel, customSystemPrompt, appendSystemPrompt, allowedTools, disallowedTools, displayText

**StoredPermission**（`sync/reducer.ts:132-142`）：
```typescript
{ tool, arguments, createdAt, completedAt?, status: 'pending'|'approved'|'denied'|'canceled', decision? }
```

### 加密数据模型

**Artifact**（`artifactTypes.ts:4-14`）：
```typescript
{
  header: string          // Base64 encrypted { title: string | null }
  body?: string           // Base64 encrypted { body: string | null }
  dataEncryptionKey: string  // Base64 Box-encrypted DEK
}
```

**文件传输**（`sync/typesRaw.ts`，`sync/typesMessage.ts:20-31`）：
```typescript
FileShareMessage {
  kind: 'file-share'
  uploadId, filename, mimeType, sizeBytes, description?
}
AttachmentRef { uploadId, filename, mimeType, sizeBytes }
```

### 设置类型

**Settings**（`settings.ts:10-59`）：viewInline, showLineNumbers, diffStyle, preferredLanguage, voiceAssistantLanguage, analyticsOptOut, recentMachinePaths[]

**LocalSettings**（`localSettings.ts:7-20`）：debugMode, themePreference, commandPaletteEnabled, sidebarCollapsed（设备特定，不跨设备同步）

### 状态流转

```
Cold Start:
  initState=null → loadFonts + sodium → credentials=null → render auth screens

Warm Start:
  initState=null → credentials found → syncRestore → apiSocket connect
  → sessions/machines loaded → render app screens

Login:
  QR scan → token+secret → syncCreate → await settings/purchases → render app

Logout:
  unregisterPushToken → clearPersistence → removeCredentials → reload

Session lifecycle:
  CREATE → active=true → heartbeat(session-alive)
  → agentState updates (CAS) → permission requests ↔ approvals
  → messages → session-end / timeout → active=false

Socket.IO lifecycle:
  connect → reconnectedListeners → invalidate all syncs
  disconnect → updateStatus → reconnect loop (1-5s)
```

---

## 外部接口与依赖

### REST API 端点（全量）

| 路径 | 方法 | 用途 | 文件 |
|------|------|------|------|
| `/v1/auth/account/request` | POST | QR 轮询认证 | `auth/authQRWait.ts:23` |
| `/v1/auth/request/status` | GET | 检查认证状态 | `auth/authApprove.ts` |
| `/v1/auth/response` | POST | App 批准认证（CLI QR 扫码） | `auth/authApprove.ts:46-54` |
| `/v1/auth/account/response` | POST | App 批准账户互认 | `auth/authAccountApprove.ts:8` |
| `/v3/sessions/{id}/messages` | GET/POST | 消息拉取/发送 | `sync/sync.ts` |
| `/v1/artifacts` | GET/POST | Artifact 列表/创建 | `sync/apiArtifacts.ts:10-88` |
| `/v1/artifacts/{id}` | GET/PATCH | 单个 Artifact | `sync/apiArtifacts.ts:34-56` |
| `/v1/uploads` | POST | 加密文件上传 | `sync/apiUploads.ts:41-119` |
| `/v1/uploads/{id}` | GET/DELETE | 下载/消费确认 | `sync/apiUploads.ts:125-152` |
| `/v1/uploads/pending` | GET | 查询 CLI 待处理上传（CLI 重连时调用，at-most-once delivery） | `server/uploadPendingList.ts` |
| `/v1/usage/query` | POST | 使用统计查询 | `sync/apiUsage.ts:27-54` |
| `/v1/push-tokens` | POST/GET/DELETE | 推送 token 管理 | `sync/apiPush.ts:20-86` |
| `/v1/connect/{service}/register` | POST | 连接第三方服务 | `sync/apiServices.ts:9-36` |
| `/v1/connect/github/params` | GET | GitHub OAuth | `sync/apiGithub.ts:27-51` |
| `/v1/kv/{key}` | GET | KV 单值 | `sync/apiKv.ts:70-80` |
| `/v1/voice/conversations` | POST | 语音会话凭证 | `sync/apiVoice.ts:14-43` |
| `/v1/voice/usage` | GET | 语音统计 | `sync/apiVoice.ts:45-63` |
| `/v1/user/search` | GET | 用户搜索 | `sync/apiFriends.ts:25-34` |
| `/v1/feed` | GET | 信息流 | `sync/apiFeed.ts:20-60` |

**REST API 通用请求头**（`sync/apiSocket.ts:190-195`）：
- `Authorization: Bearer {token}`
- `X-Happy-Client: {platform}/{version}`（如 `ios/1.0.0`）

**Socket.IO 握手认证**（`sync/apiSocket.ts:70-76`）：
- 通过 handshake `auth` 对象传递，而非 HTTP 请求头：
  `auth: { token, clientType: 'user-scoped', happyClient }`

### Socket.IO 客户端事件

**Client → Server**（`sync/apiSocket.ts`）：
- `rpc-call` → `{ method: "${sessionId}:${method}", params: encrypted }`
- `rpc-call` → `{ method: "${machineId}:${method}", params: encrypted }`

**Server → Client**（`sync/sync.ts` handlers）：
- `update` → ApiUpdateContainer（含 seq 版本）
- `ephemeral` → 临时活跃/usage/machine 状态

### 关键依赖

| 包 | 版本 | 用途 |
|----|------|------|
| `expo` | ~55.0.8 | React Native 运行时 |
| `expo-router` | ~55.0.7 | 文件路由 |
| `expo-secure-store` | ~55.0.0 | token 安全存储 |
| `expo-notifications` | ~55.0.0 | 推送通知 |
| `@slopus/happy-wire` | — | 共享 Wire 类型（ApiMessage 等）|
| `libsodium-wrappers` | 0.8.2 | 密码学基元 |
| `@more-tech/react-native-libsodium` | ^1.5.5 | RN libsodium 绑定 |
| `rn-encryption` | ^2.5.0 | AES256 现代路径加密核心（`sync/encryption/aes.ts:1`）|
| `socket.io-client` | — | WebSocket 客户端 |
| `zustand` | — | 全局状态管理 |
| `react-native-mmkv` | — | 高性能持久化 |
| `@elevenlabs/react-native` | — | 语音助手 |
| `@livekit/react-native` | ^2.9.0 | 实时音视频 |
| `react-native-purchases` | — | RevenueCat 订阅 |

### 环境变量

| 变量 | 必须 | 说明 |
|------|------|------|
| `EXPO_PUBLIC_HAPPY_SERVER_URL` | 可选 | 服务器 URL，默认 `https://happy.easyfan.info` |
| `EXPO_PUBLIC_LOG_SERVER_URL` | 可选 | 日志服务器 |
| `EXPO_PUBLIC_POSTHOG_API_KEY` | 可选 | PostHog 分析（构建时嵌入，`app.config.js:184`）|
| `EXPO_PUBLIC_POSTHOG_KEY` | 可选 | PostHog 运行时覆盖（`appConfig.ts:84`，优先级高于构建值）|
| `EXPO_PUBLIC_REVENUE_CAT_APPLE` | 生产 | iOS 订阅 SDK 密钥 |
| `EXPO_PUBLIC_REVENUE_CAT_GOOGLE` | 生产 | Android 订阅 SDK 密钥 |
| `EXPO_PUBLIC_REVENUE_CAT_STRIPE` | 生产 | Stripe 密钥 |
| `EXPO_PUBLIC_DEV_TOKEN` | 开发 | 跳过 QR 认证 |
| `EXPO_PUBLIC_DEV_SECRET` | 开发 | 配合 DEV_TOKEN 使用 |

**加载优先级**（`sync/appConfig.ts:24-100`）：
1. ExponentConstants 原生模块（Android JSON）
2. Constants.expoConfig
3. `EXPO_PUBLIC_*` 运行时覆盖

### MCP 工具集成

**工具名称格式**（`components/tools/views/MCPToolView.tsx`）：`mcp__{server}__{tool_name}`

**已知 Happy 暴露工具**：
- `mcp__happy__share_file` — 服务端→用户文件分享（CLI 调用）
- `mcp__happy__change_title` — 修改会话标题

[待验证] `mcp__mobile__*` 工具是否由 happy-app 暴露，或属独立 MCP server。

---

## 性能特征

- **消息解密**：EncryptionCache 避免重复解密，批量 decrypt 减少 libsodium 调用开销
- **心跳节流**：ActivityUpdateAccumulator 2000ms 防抖合并心跳（`sync.ts:140` 传入值），减少 server 写压力
- **选择器优化**：Zustand + `useShallow` 浅比较，避免大 Store 触发全量重渲染
- **消息同步**：快速路径（seq 连续）跳过 re-fetch，仅 gap 时触发全量拉取
- **InvalidateSync**：防并发 fetch，多次 invalidate 合并为单次请求
- **MMKV 持久化**：比 AsyncStorage 快 10x+，同步 API，适合大量 session/message 数据
- **字体加载**：AsyncLock 保证 loadFonts 单次执行，Tauri 延迟加载
- **文件上传**：XHR progress API 提供精细进度，E2E 加密在上传前完成

---

## 已知限制与待验证项

### 确认的设计限制

1. **消息锁无清理**（`sync.ts:292-299`）：per-session AsyncLock 永不释放，长期使用大量 session 有内存泄漏风险
2. **AppState listener 无清理**（`sync.ts:143`）：Sync 实例重建时可能注册多个 listener
3. **Socket.IO 无降级**：仅 `transports: ['websocket']`，WebSocket 不可用时不自动降级到 polling
4. **推送不支持 Web**（`sync/pushRegistration.ts`）：Web 平台返回 `'unsupported'`

### 待验证项

| 标记 | 内容 | 位置 |
|------|------|------|
| [待验证] | `thinking` NormalizedContent 字段具体结构（扩展思维） | `typesMessage.ts:486` |
| [待验证] | Machine metadata legacy encryption path 完整细节（DEK box 加密） | `encryption.ts` |
| [待验证] | 权限 `decision` 字段语义（`approved` vs `approved_for_session`）| `reducer.ts:137` |
| [待验证] | MMKV 与 Zustand 持久化的具体集成方式 | `sync/storage.ts` persist 部分 |
| [待验证] | Expo Router 路由参数获取实际模式（`useLocalSearchParams` 还是 `useSearchParams`）| `app/(app)/` |
| [待验证] | session/machine 路由文件名（`[id].tsx` 具体路径）| `app/(app)/` |
| [待验证] | Token 过期处理机制（无显式 refresh 逻辑）| `auth/tokenStorage.ts` |
| [待验证] | Session encryption 初始化失败时的 RPC 行为（throw 后调用方如何处理）| `apiSocket.ts:128` |
| [待验证] | Sentry 错误追踪集成（依赖包存在但未见显式初始化）| `package.json` |
| [待验证] | `mcp__mobile__*` 工具的实际所有者（Happy-App 还是独立 MCP server？）| `MCPToolView.tsx` |
| [待验证] | Artifact PATCH 端点完整格式 | `sync/apiArtifacts.ts:93+` |
| [待验证] | KV POST/PATCH 端点完整参数 | `sync/apiKv.ts` |
| [待验证] | 后台发送看门狗中断处理完整逻辑 | `sync.ts:338-352` |
