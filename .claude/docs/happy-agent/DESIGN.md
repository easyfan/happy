# happy-agent — 模块设计文档

> 生成时间：2026-04-29 | 研究范围：packages/happy-agent/src | 分析文件数：9 个 TypeScript 源文件

---

## 一句话定位

happy-agent 是一个独立 CLI 二进制，无需本地 daemon，直接通过 WebSocket + 加密 RPC 远程控制分布式机器上的 Claude Code Agent 会话。

---

## 架构图

```
happy-agent CLI (commander.js)
        │
        ├── config.ts          读取 HAPPY_SERVER_URL / HAPPY_HOME_DIR
        ├── credentials.ts     读写 ~/.happy/agent.key (token + secret)
        │
        ├── auth.ts            QR 码身份验证（临时 keypair + 轮询）
        │
        ├── api.ts             REST API 层（axios）
        │   ├── GET /v1/sessions
        │   ├── GET /v2/sessions/active
        │   ├── POST /v1/sessions
        │   ├── DELETE /v1/sessions/{id}
        │   ├── GET /v1/sessions/{id}/messages
        │   └── GET /v1/machines
        │
        ├── session.ts         SessionClient (EventEmitter + Socket.IO)
        │   ├── 连接 /v1/updates (WebSocket)
        │   ├── 接收加密 update 事件
        │   ├── waitForIdle / waitForTurnCompletion
        │   └── sendMessage / sendStop
        │
        ├── machineRpc.ts      机器 RPC（短连接 Socket.IO）
        │   ├── spawnSessionOnMachine → {machineId}:spawn-happy-session
        │   └── resumeSessionOnMachine → {machineId}:resume-happy-session
        │
        ├── encryption.ts      加密原语层（全部使用 TweetNaCl，无 libsodium 依赖）
        │   ├── Legacy：TweetNaCl secretbox（XSalsa20-Poly1305）
        │   ├── DataKey：AES-256-GCM（node:crypto）
        │   ├── Box：TweetNaCl box（X25519 + XSalsa20-Poly1305）
        │   │       注：函数名 libsodiumEncryptForPublicKey 为历史命名，实际使用 tweetnacl.box
        │   └── 密钥派生：HMAC-SHA512 树 + SHA-512 预哈希
        │
        └── output.ts          格式化输出（表格 / JSON / 历史消息）
```

---

## 入口与生命周期

### 程序入口（index.ts:117-508）

```
程序启动
  └─ commander 解析 process.argv
       ├─ 加载 Config（config.ts:loadConfig）
       ├─ 加载凭据（credentials.ts:requireCredentials）
       └─ 分发到命令处理器
```

**11 个顶级 CLI 命令**（auth 包含 3 个子命令 login / logout / status，展开后共 13 行）：

| 命令 | 功能 |
|------|------|
| `auth login` | QR 码登录，生成临时 keypair，轮询授权 |
| `auth logout` | 清除凭据文件 |
| `auth status` | 显示认证状态 |
| `machines` | 列出所有机器（含活跃过滤） |
| `list` | 列出会话（`--active` 只显示活跃） |
| `status` | 实时监听会话状态（SessionClient） |
| `spawn` | 在指定机器上创建新会话（machine RPC） |
| `resume` | 恢复会话到原始机器（machine RPC） |
| `create` | 仅创建会话记录（不连接机器） |
| `send` | 向 Agent 发送消息（可 `--wait` 等待完成） |
| `history` | 读取消息历史 |
| `stop` | 停止会话（通过 Socket.IO `session-end` 事件通知 daemon，不调用 DELETE 端点） |
| `wait` | 等待 Agent 空闲 |

### 进程生命周期

- 单次命令执行后退出（非守护进程）
- 顶级 catch 捕获所有异常，打印错误并设置 `exitCode = 1`（index.ts:505-508）
- `wait`/`status` 命令保持 Socket.IO 长连接直到条件满足或超时

---

## 核心算法与事件流

### SessionClient 状态机（session.ts）

**连接配置**（session.ts:111-124）：
- 路径：`/v1/updates`，传输：WebSocket-only
- auth：`{ token, clientType: 'session-scoped', sessionId }`
- 重连：Infinity 次，1s–5s 退避

**消息接收流**（session.ts:139-187）：
```
update 事件
  ├─ t='new-message'
  │    ├─ content.t='encrypted' → 解密 body.message.content.c → emit('message')
  │    └─ content.t 非 'encrypted' → 静默丢弃（无 emit）
  │         注：系统仅处理加密消息，所有非加密 new-message 事件被无声忽略，这是有意为之的安全设计
  └─ t='update-session'
       ├─ metadata 字段存在 AND metadata.version > this.metadataVersion
       │    → 解密 body.metadata.value → 赋值 this.metadata，更新 this.metadataVersion
       ├─ agentState.value 为 falsy（服务端主动清空） → this.agentState = null，更新版本号
       ├─ agentState.value 为 truthy → 解密 → 赋值（解密失败则为 null），更新版本号
       └─ 统一 emit('state-change', { metadata, agentState })（无论字段是否存在均触发一次）
```

> **注意**：agentState 和 metadata 字段均可单独缺失。字段缺失时对应的版本号和值保持不变；state-change 事件无论如何均会触发一次，携带当前最新的 metadata 和 agentState（session.ts:169-182）。

### 空闲检测（session.ts:22-42）

```
前提：agentState 不为 null。若 agentState 为 null（会话初始化中或状态未知），
checkIdleState 直接返回 false（视为非空闲），不进入下面的公式计算。

idle = NOT controlledByUser AND NOT (requests 非空)
archived = lifecycleState === 'archived'
```

**waitForIdle() 流程**（session.ts:245-287）：
1. 立即检查 → 已空闲则 resolve；archived 则 reject
2. 注册 `state-change` + `disconnected` 监听器
3. 超时（默认 300s）→ reject

### 转向完成检测（session.ts:289-365）

追踪 4 个变量：`sawActivity`, `activeTurnId`, `sawTurnStart`, `sawNonReadyMessage`

**完成条件**：
1. `turn-end` 事件（turnId 匹配）→ 立即 finish
2. ready 事件 AND (sawTurnStart OR sawNonReadyMessage) → finish
3. state-change 且当前 idle AND sawActivity → finish

### 身份验证流程（auth.ts:17-88）

```
生成临时 ephemeral keypair（NaCl box）
  → POST /v1/auth/account/request（上传公钥）
  → 展示 QR 码（happy:///account?{base64url(pubKey)}）
  → 轮询 POST（1s 间隔，120s 超时）
  → 收到 authorized → decryptBoxBundle（账户密钥）
  → 保存凭据到 ~/.happy/agent.key（chmod 0o600，~/.happy/ 目录权限 0o700）
```

### 机器 RPC 流程（machineRpc.ts:59-207）

```
创建短连接（reconnection: false）
  → waitForConnect（10s 超时）
  → 加密参数 → emitWithAck('rpc-call', payload, timeout=30s)
  → 解密响应
  → 断开连接
```

方法：`{machineId}:spawn-happy-session` / `{machineId}:resume-happy-session`

---

## 数据模型与状态

### Config（config.ts）

```typescript
{
    serverUrl: string;    // HAPPY_SERVER_URL 或 https://api.cluster-fluster.com
    homeDir: string;      // HAPPY_HOME_DIR 或 ~/.happy
    credentialPath: string;  // homeDir/agent.key
}
```

### Credentials（credentials.ts）

```typescript
{
    token: string;
    secret: Uint8Array;
    contentKeyPair: { publicKey: Uint8Array; secretKey: Uint8Array };
}
// 文件存储：JSON { token, secret: base64 }，权限 0o600
```

### RawSession（服务端返回，api.ts:27-39）

```typescript
{
    id: string;
    seq: number;
    createdAt: number;
    updatedAt: number;
    active: boolean;
    activeAt: number;
    metadata: string;              // base64 加密 JSON
    metadataVersion: number;
    agentState: string | null;     // base64 加密 JSON
    agentStateVersion: number;
    dataEncryptionKey: string | null;  // base64 NaCl box bundle
}
```

### DecryptedSession（api.ts:41-52）

```typescript
{
    id, seq, createdAt, updatedAt, active, activeAt: ...,
    metadata: unknown;             // 解密后 JSON
    agentState: unknown | null;
    dataEncryptionKey: string | null;
    encryption: { key: Uint8Array; variant: 'legacy' | 'dataKey' };
}
```

### 会话元数据结构（output.ts:5-12）

```typescript
{
    path?: string;          // 工作目录
    host?: string;
    tag?: string;           // 会话标签
    summary?: string | { text?: unknown };
    lifecycleState?: string;  // 'archived' 表示已归档
    machineId?: string;     // 用于 resume 命令
}
```

### 机器元数据结构（output.ts:20-26）

```typescript
{
    host?: string;
    platform?: string;
    homeDir?: string;
    happyCliVersion?: string;
    resumeSupport?: {
        rpcAvailable?: boolean;         // 是否支持 RPC
        happyAgentAuthenticated?: boolean;
    };
}
```

### AgentState 结构（session.ts:31-41）

```typescript
{
    controlledByUser?: boolean;    // 用户占用中
    requests?: Record<string, unknown>;  // 待处理请求
}
```

---

## 外部接口与依赖

### HTTP API（共 7 个端点）

认证头（api.ts:203-208）：
```
Authorization: Bearer {token}
X-Happy-Client: cli-control-plane/0.1.0
```

| 方法 | 路径 | 功能 |
|------|------|------|
| POST | `/v1/auth/account/request` | 发起/轮询身份验证 |
| GET | `/v1/sessions` | 列出所有会话 |
| GET | `/v2/sessions/active` | 列出活跃会话 |
| POST | `/v1/sessions` | 创建新会话 |
| DELETE | `/v1/sessions/{id}` | 删除会话 | 注：当前版本无对应 CLI 命令入口；api.ts 已实现 deleteSession() 但未被任何命令调用（孤立代码） |
| GET | `/v1/sessions/{id}/messages` | 获取消息历史（legacy v1 端点，最多 150 条，无分页；happy-cli 使用 v3 端点）|
| GET | `/v1/machines` | 列出机器 |

### WebSocket 事件（Socket.IO，路径 `/v1/updates`）

**接收**：
- `update` — 加密消息/状态更新（session.ts:139）

**发送**：
- `message` — 用户消息（session.ts:205）
- `session-end` — 停止会话（session.ts:368）
- `rpc-call`（emitWithAck）— 机器 RPC（machineRpc.ts:95）

### 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `HAPPY_SERVER_URL` | `https://api.cluster-fluster.com` | API 服务器 URL |
| `HAPPY_HOME_DIR` | `~/.happy` | 配置目录 |

### NPM 依赖

| 包名 | 用途 |
|------|------|
| axios | HTTP 客户端 |
| tweetnacl | NaCl box/secretbox 加密 |
| socket.io-client | WebSocket 实时连接 |
| commander | CLI 框架 |
| qrcode-terminal | 终端 QR 码 |

### 内部依赖

- `@slopus/happy-wire`：`SessionMessage` 类型（api.ts:2）

---

## 加密模型

### 双变体加密

| 变体 | 算法 | 格式 | 适用场景 |
|------|------|------|---------|
| legacy | TweetNaCl secretbox (XSalsa20-Poly1305) | nonce(24B) + ciphertext | 旧会话，无 dataEncryptionKey |
| dataKey | AES-256-GCM (node:crypto) | version(1B) + nonce(12B) + ciphertext + authTag(16B) | 新会话，有 DEK |

### 密钥层次

```
账户 secret（256bit）
  └─ HMAC-SHA512（'Happy EnCoder', ['content']）
       └─ contentKeySeed（32B）
            └─ SHA-512(contentKeySeed)[0:32] → boxSecretKey（模拟 libsodium crypto_box_seed_keypair 内部行为）
                 └─ TweetNaCl box.keyPair.fromSecretKey(boxSecretKey) → contentKeyPair

每会话：
  random 32B sessionKey（AES-256-GCM）
    └─ 用 contentKeyPair.publicKey NaCl box 加密存储到服务器
    └─ 本地用 contentKeyPair.secretKey 解密取回
```

### NaCl Box 格式（encryption.ts:183-205）

```
ephemeral_pubkey(32B) + nonce(24B) + ciphertext
```

用途：加密会话 DEK 发送到服务器

### 签名质询认证（authChallenge，encryption.ts:163-179）

通过账户 secret 派生 Ed25519 签名密钥对（TweetNaCl sign.keyPair.fromSeed），生成随机 32 字节 challenge，用私钥签名后返回 `{ publicKey, challenge, signature }`。用于服务端验证客户端持有对应 secret，适用于 token 刷新等场景。

---

## 已知限制与待验证项

- `seq` 字段：SessionClient 全文无 seq 引用，仅在数据模型中透传（RawSession/DecryptedSession），不用于乱序检测或状态恢复
- [待验证] `localId` 字段的语义（客户端去重标识？）（api.ts:89）
- [待验证] `providerToken`（machineRpc.ts:90）的实际用途（外部 AI 供应商令牌？）
- `history --limit` 是纯客户端截断：从服务端获取最多 150 条消息后，在本地通过 `slice(-limit)` 取最新 N 条（index.ts:435-437）。服务端无分页 API，无法突破 150 条上限。
- [待验证] `/v2/sessions/active` 相比 `/v1/sessions` 的具体过滤逻辑（服务端实现）
- 消息历史一次全量获取，无流式分页（api.ts:324）
- RPC 调用无重试，30s 超时即失败（machineRpc.ts:95）
- 本模块无持久本地状态（除凭据文件），无本地缓存层
