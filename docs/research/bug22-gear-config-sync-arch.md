# BUG-22 研究报告：Gear Icon 配置跨设备同步架构方案评估

**报告日期**: 2026-06-02  
**调研任务**: IT22-02  
**模块**: happy-app 状态管理 + happy-wire 协议 + happy-server 会话管理  

---

## 摘要与建议

### 核心问题
Gear icon（设置齿轮）下的两个配置项仅本地生效：
- **Permission Mode**（权限模式：default/plan/read-only/acceptEdits/bypassPermissions 等）
- **Model**（模型选择）

设备 A 改了配置，设备 B 看到的仍是本地默认值，无跨设备同步。

### 推荐方案
**优先采用方案 A（最小改动）**，原因：
1. **快速交付**：XS 工作量，仅涉及 happy-app 本地逻辑优化
2. **无 wire 改造**：避免协议版本升级，减少兼容性风险
3. **用户体验足够**：加入会话时单次同步已可满足跨设备一致性需求
4. **未来扩展路径清晰**：若需完整双向同步，再演进至方案 B

长期可考虑方案 B（完整同步），但当前优先级不高。

---

## 现状代码分析

### 1. 状态存储位置

#### 1.1 Permission Mode 存储
**文件**: `/Users/zhengfan/happy/packages/happy-app/sources/sync/storage.ts`

**存储流程**：
- **本地持久化**: MMKV（`session-permission-modes` 键）
  - 加载: `loadSessionPermissionModes()` (line 348)
  - 保存: `saveSessionPermissionModes(allModes)` (line 70, 745)
  - 格式: `Record<sessionId, PermissionModeKey>`

- **Zustand Store**: 
  - 字段: `Session.permissionMode: string | null` (line 107)
  - 更新方法: `updateSessionPermissionMode(sessionId: string, mode: string)` (line 1048-1077)

**关键代码**（storage.ts 行数）：
```typescript
// 407-410: 初始化时从 MMKV 加载
let sessionPermissionModes = loadSessionPermissionModes();

// 1048-1077: 更新权限模式
updateSessionPermissionMode: (sessionId: string, mode: string) => set((state) => {
    // ...
    saveSessionPermissionModes(allModes);  // 立即保存到 MMKV
    return { sessions: updatedSessions };
}),

// 425-430: applySessions 中的初始化逻辑
const resolvedPermissionMode: PermissionModeKey =
    (existingPermissionMode && existingPermissionMode !== 'default' ? existingPermissionMode : undefined) ||
    (savedPermissionMode && savedPermissionMode !== 'default' ? savedPermissionMode : undefined) ||
    (session.permissionMode && session.permissionMode !== 'default' ? session.permissionMode : undefined) ||
    defaultPermissionMode;
```

**持久化实现**（persistence.ts）：
```typescript
// 行号待查，MMKV 操作
export function loadSessionPermissionModes(): Record<string, string> { ... }
export function saveSessionPermissionModes(modes: Record<string, string>) { ... }
```

#### 1.2 Model Mode 存储
**文件**: `/Users/zhengfan/happy/packages/happy-app/sources/sync/storage.ts`

**存储流程**：
- **本地持久化**: MMKV（`session-model-modes` 键）
  - 加载: `loadSessionModelModes()` (line 349)
  - 保存: `saveSessionModelModes(allModes)` (line 1099)
  
- **Zustand Store**: 
  - 字段: `Session.modelMode: string | null` (line 108)
  - 更新方法: `updateSessionModelMode(sessionId: string, mode: string)` (line 1078-1106)

**关键代码**（storage.ts 行数）：
```typescript
// 1078-1106: 更新模型模式
updateSessionModelMode: (sessionId: string, mode: string) => set((state) => {
    // ...
    saveSessionModelModes(allModes);  // 立即保存到 MMKV
    return { sessions: updatedSessions };
}),

// 434-437: applySessions 中恢复模型模式
const existingModelMode = state.sessions[session.id]?.modelMode;
const resolvedModelMode = existingModelMode ?? savedModelModes[session.id] ?? session.modelMode ?? null;
```

### 2. 现有同步机制

#### 2.1 Session 同步流程
**入口**: `/Users/zhengfan/happy/packages/happy-app/sources/sync/sync.ts`

**fetchSessions**（第 135 行）：
```typescript
this.sessionsSync = new InvalidateSync(this.fetchSessions);
```

**同步发生在**：
1. 应用初始化：`#init()` 调用 `this.sessionsSync.invalidate()` (line 233)
2. 应用返回前台：AppState 变化时 (line 233-244)

#### 2.2 Session 数据更新（来自 server）
**文件**: `/Users/zhengfan/happy/packages/happy-app/sources/sync/sync.ts`

`applySessions()` 被调用时触发（来自 WebSocket 更新）：
- `storage.getState().applySessions(sessions)` 处理从 server 收到的 session 列表

**Server 端信息**：
- `updateSessionPermissionMode` / `updateSessionModelMode` **不存在** server 端字段
- Session 的 `permissionMode` / `modelMode` 在服务器上不被存储或同步
- 服务器上仅存储 `metadata` 和 `agentState`（见 happy-server/sessionUpdateHandler.ts）

### 3. Wire 协议分析

**文件**: `/Users/zhengfan/happy/packages/happy-wire/src/messages.ts`

**UpdateSessionBody** 结构（line 57-62）：
```typescript
export const UpdateSessionBodySchema = z.object({
  t: z.literal('update-session'),
  id: z.string(),
  metadata: VersionedEncryptedValueSchema.nullish(),
  agentState: VersionedNullableEncryptedValueSchema.nullish(),
});
```

**现状**：
- ❌ 不包含 `permissionMode` 字段
- ❌ 不包含 `modelMode` 字段
- ❌ 不包含 `effortLevel` 字段（类似配置）
- ✅ 仅支持 metadata 和 agentState

**Server 处理**（happy-server/sessionUpdateHandler.ts line 57-79）：
```typescript
// update-metadata 处理 metadata 版本控制
// update-state 处理 agentState 版本控制
// 无 permissionMode 相关逻辑
```

### 4. Gear Icon UI 实现

**文件**: `/Users/zhengfan/happy/packages/happy-app/sources/-session/SessionView.tsx`

**更新回调**（line 406-416）：
```typescript
const updatePermissionMode = React.useCallback((mode: PermissionMode) => {
    storage.getState().updateSessionPermissionMode(sessionId, mode.key);
}, [sessionId]);

const updateModelMode = React.useCallback((mode: ModelMode) => {
    storage.getState().updateSessionModelMode(sessionId, mode.key);
}, [sessionId]);
```

**AgentInput 传递**（line 886-898）：
```typescript
onPermissionModeChange?.(model);
setShowSettings(false);
```

**现状问题**：
- ✅ UI 调用正确的更新函数
- ✅ 本地状态立即更新
- ❌ 更新 **仅保存到本地 MMKV**，不同步到 server
- ❌ 其他设备无法感知此更改

---

## 方案 A：最小方案（推荐）

### 设计概述
设备加入会话时，**Server 推送当前配置的初始值**。不修改 wire 协议，不在 server 落库。

### 工作流

```
Device A (connected)           Server                    Device B (joining)
──────────────                 ──────                    ─────────────────

User changes
Permission Mode
to "plan"
    │
    ├─ updateSessionPermissionMode()
    │  └─ save to local MMKV ✓
    └─ Zustand state updated ✓

[在 Device B 上]
                                                         User opens session
                                                         │
                                                         ├─ onSessionVisible(id)
                                                         │  └─ sync.fetchSessions()
                                                         │     
                                                         ├─ Server returns ALL
                                                         │  session data
                                                         │  (with Device A's
                                                         │   permission mode
                                                         │   in metadata)
                                                         │
                                                         └─ Device B loads
                                                            Device A's config
                                                            from session.metadata
                                                            ✓ 跨设备一致
```

### 改动方案

#### 改动 1：Server 端（happy-server）
**文件**: `/Users/zhengfan/happy/packages/happy-server/sources/app/api/routes/sessionRoutes.ts`

**修改内容**：
在 `GET /v1/sessions` 返回时，检查 session 的 metadata，提取并返回：
- `permissionMode`（如果存在）
- `modelMode`（如果存在）

**具体实现**：
```typescript
// 在 sessionRoutes.ts 的 GET /v1/sessions 响应中
const decoratedSessions = sessions.map(session => ({
    ...session,
    permissionMode: decryptAndExtract(session.metadata, 'permissionMode'),
    modelMode: decryptAndExtract(session.metadata, 'modelMode'),
}));
```

**实现细节**：
- Metadata 已加密，需要 server 端解密 metadata 内容
- 或者：改为在 metadata 内的明文字段中存储配置（需评估安全性）
- **建议**: 采用第二种方法——在 metadata 中添加明文 configVersion 字段用于版本控制

#### 改动 2：App 端（happy-app）
**文件**: `/Users/zhengfan/happy/packages/happy-app/sources/sync/sync.ts`

**修改内容**：
在 `fetchSessions()` 返回的 session 对象中捕获 server 返回的 `permissionMode` / `modelMode`：

```typescript
// 修改 fetchSessions 返回处理
const applySessions = (sessions: Session[]) => {
    sessions.forEach(session => {
        // 如果 server 返回了 permissionMode，且本地未有自定义值，则采用 server 值
        if (session.permissionMode && !localPermissionModes[session.id]) {
            storage.getState().updateSessionPermissionMode(
                session.id, 
                session.permissionMode
            );
        }
    });
};
```

**改动文件清单**：
1. **happy-server**:
   - `sessionRoutes.ts` - 修改 GET /v1/sessions 响应

2. **happy-app**:
   - `sync/sync.ts` - 修改 fetchSessions 返回处理逻辑
   - 可选: `sync/storage.ts` - 完善 applySessions 中的 permissionMode 解析

### 工作量评估
- **设计**: XS (0.5 天)
- **Server 实现**: XS (0.5 天)
- **App 实现**: XS (0.5 天)
- **测试**: S (1 天)
- **总计**: **S (2-2.5 天)**

### 风险分析
- ✅ **低风险**: 无 wire 协议改动，向后兼容
- ✅ **低风险**: Server 端改动最小化（仅响应返回增强）
- ⚠️ **中风险**: Metadata 解密/提取可能与加密策略冲突（需检查 metadata 加密时机）
- ✅ **低风险**: 本地存储优先级机制已存在（applySessions line 425-430）

### 限制与权衡
- ❌ **单向同步**: 仅在加入/刷新会话时同步，非实时
- ❌ **不支持动态更新**: Device A 改配置后，Device B 需刷新才能看到
- ❌ **不支持多人同步**: 三个设备同时使用时，配置可能不统一

---

## 方案 B：完整方案（未来演进）

### 设计概述
将 `permissionMode` / `modelMode` / `effortLevel` 纳入 Session 的持久化同步，支持实时双向同步。

### 工作流

```
Device A                    Wire Protocol              Server              Device B
────────                    ─────────────              ──────              ────────

User changes
Permission Mode
to "plan"
    │
    ├─ updateSessionPermissionMode()
    │  ├─ MMKV save ✓
    │  ├─ Zustand update ✓
    │  └─ socket.emit('update-session-config',
    │      {sessionId, permissionMode: 'plan'})
    │
    │                        wire: UpdateSessionConfig
    │                        ────────────────────────
    │                          sessionId
    │                          permissionMode
    │                          modelMode
    │                          effortLevel
    │                          version
    │                                   ├─ validate
    │                                   ├─ store in DB
    │                                   │  (sessions table:
    │                                   │   permissionMode column)
    │                                   │
    │                                   ├─ broadcast to ALL
    │                                   │  interested devices
    │                                   │
    │                                   └─ emit 'session-config-updated'
    │
    │                                                  ├─ receive event
    │                                                  ├─ update Zustand
    │                                                  ├─ save MMKV
    │                                                  └─ UI refresh ✓
    │
    └─ ✓ 实时双向同步完成
```

### Wire 协议改动

**新增消息类型**：`UpdateSessionConfigBody`

**文件**: `/Users/zhengfan/happy/packages/happy-wire/src/messages.ts`

```typescript
export const UpdateSessionConfigBodySchema = z.object({
  t: z.literal('update-session-config'),
  sessionId: z.string(),
  permissionMode: z.string().optional(),
  modelMode: z.string().optional(),
  effortLevel: z.string().optional(),
  version: z.number(),  // 用于版本控制（防止冲突）
});

export const CoreUpdateBodySchema = z.discriminatedUnion('t', [
  UpdateNewMessageBodySchema,
  UpdateSessionBodySchema,
  UpdateMachineBodySchema,
  UpdateSessionConfigBodySchema,  // 新增
]);
```

### Server 改动

**涉及文件**：
1. **Prisma Schema** (`schema.prisma`):
   ```prisma
   model Session {
     // ... existing fields
     permissionMode        String?      // 权限模式 key
     permissionModeVersion Int          // 版本控制
     modelMode             String?      // 模型 key
     modelModeVersion      Int          // 版本控制
     effortLevel           String?      // 努力程度 key
     effortLevelVersion    Int          // 版本控制
   }
   ```

2. **sessionUpdateHandler.ts** - 新增 `update-session-config` handler:
   ```typescript
   socket.on('update-session-config', async (data: unknown) => {
       // 1. 验证输入
       // 2. 版本冲突检测
       // 3. 数据库更新
       // 4. 事件广播到所有设备
   });
   ```

3. **eventRouter.ts** - 扩展事件广播
   ```typescript
   buildUpdateSessionConfigUpdate(...) {
       // 构建 UpdateSessionConfigBody
   }
   ```

### App 改动

**涉及文件**：
1. **storage.ts**:
   - `Session` interface 添加版本字段
   - `updateSessionPermissionMode` 改为发送 socket 事件（而非仅本地保存）

2. **sync.ts**:
   - 新增 socket listener: `socket.on('session-config-updated', ...)`
   - 处理 server 推送的配置更新

3. **AgentInput.tsx**:
   - 改为通过 sync 发送配置更新（而非直接调用 storage）

### 数据库迁移
**Prisma migration 需求**：
```bash
pnpm db-migrate new add_session_config_fields
```

### 工作量评估
- **设计**: S (1.5 天)
- **Prisma Schema + Migration**: XS (0.5 天)
- **Server 实现**: M (3-4 天)
  - Socket handler 编写
  - 版本控制机制
  - 事件广播系统
- **Wire 协议扩展**: S (1 天)
- **App 实现**: M (2-3 天)
  - Storage 改造
  - Socket listener
  - 同步逻辑
- **测试**: M (2-3 天)
- **总计**: **L (10-12 天)**

### 风险分析
- ⚠️ **高风险**: Wire 协议改动，需版本升级
- ⚠️ **高风险**: 数据库 schema 改动，需 migration 处理
- ⚠️ **中风险**: 版本控制机制设计（多设备并发修改）
- ⚠️ **中风险**: Server 事件广播可靠性（需确保所有设备收到更新）

---

## Wire 协议改动决策

### 方案 A：**不需要** Wire 改动
- 现有 `update-session` 消息已支持返回 session 数据
- Server 端仅返回增强数据，App 端本地处理
- **推荐状态**: ✅ **采纳**

### 方案 B：**需要** 新增 Wire 消息类型
- 新增 `UpdateSessionConfigBody` 以支持配置专用同步
- 需要版本升级策略（兼容旧客户端）
- **推荐状态**: 📋 **预留设计**，暂不实现

---

## 文件改动清单总结

### 方案 A（推荐实施）

| 包 | 文件 | 改动摘要 | 行号 | 工作量 |
|---|---|---|---|---|
| happy-server | `app/api/routes/sessionRoutes.ts` | 在 GET /v1/sessions 返回中增加 permissionMode / modelMode | TBD | XS |
| happy-app | `sync/sync.ts` | 修改 fetchSessions 返回处理，捕获 server 返回的配置 | ~300-400 | XS |
| happy-app | `sync/storage.ts` | 完善 applySessions 中配置值的优先级解析 | 425-430 | XS |

### 方案 B（未来考虑）

| 包 | 文件 | 改动摘要 |
|---|---|---|
| happy-wire | `src/messages.ts` | 新增 `UpdateSessionConfigBodySchema` |
| happy-server | `prisma/schema.prisma` | 新增 3 个字段 (permissionMode, modelMode, effortLevel) |
| happy-server | `app/api/socket/sessionUpdateHandler.ts` | 新增 socket handler: `update-session-config` |
| happy-server | `app/events/eventRouter.ts` | 新增 `buildUpdateSessionConfigUpdate()` 函数 |
| happy-app | `sync/storage.ts` | Session interface 添加版本字段；updateSessionXXX 改为 emit socket 事件 |
| happy-app | `sync/sync.ts` | 新增 socket listener；处理 `session-config-updated` 事件 |
| happy-app | `components/AgentInput.tsx` | 改为通过 sync 发送配置更新 |

---

## 现状限制与已知问题

### 1. Draft 消息的类似问题
**相关代码**: `storage.ts` line 1012-1047

`updateSessionDraft()` 也仅存储本地，不同步到 server。但这是**设计特性**（draft 是临时的本地消息）。

### 2. 配置优先级复杂
**现状**: `applySessions` 中存在 4 层优先级（line 425-430）：
1. 现有设备上的 permissionMode
2. 保存的 permissionMode（MMKV）
3. Server 返回的 permissionMode
4. 默认值

**问题**: 当 Server 返回新值时，本地 MMKV 优先级更高，可能无法同步新值。

### 3. Effort Level 同样未同步
**代码位置**: `storage.ts` line 1107-1132

`updateSessionEffortLevel()` 同样仅本地保存，不通过 server 同步。应与 permissionMode / modelMode 同步考虑。

---

## 实施建议

### 短期（当前迭代）
1. **采纳方案 A**
2. 评估 Metadata 加密策略是否允许在其中存储配置
3. 若需求紧急，可先实现临时方案：
   - Server 记忆最后一个设备的配置（session 最后修改时间戳）
   - 新设备加入时，拉取该 session 的最新配置快照

### 中期（后续迭代）
1. 审视现有 Session sync 机制
2. 评估方案 B 的成本收益
3. 若用户反馈强烈，则规划 Wire 协议升级

### 长期（产品演进）
1. 考虑更通用的 "session preferences" 系统
2. 支持用户级别的默认配置（所有会话继承）
3. 集成权限模式、模型选择、effort level 等为统一的 "Session Configuration" 概念

---

## PO 决策建议

### 优先级
**立即处理**: ⭐⭐⭐ 
- 用户期望跨设备一致性
- 影响核心体验（Permission Mode 直接影响权限行为）

### 推荐方案
**方案 A**（最小方案）
- **交付周期**: 2-3 天
- **风险级别**: 低
- **用户价值**: 中（加入会话时同步，非实时）

### 备选方案
**方案 B**（完整同步），仅在以下情况考虑：
- 用户频繁在多设备同时使用会话
- Permission Mode 需实时同步（当前不必要）
- 有带宽预算用于 Wire 协议升级

### 成本对比
| 方案 | 工作量 | 风险 | 用户价值 | 推荐 |
|---|---|---|---|---|
| A（最小） | S (2.5天) | 低 | 中 | ✅ 推荐 |
| B（完整） | L (11天) | 中 | 高 | 📋 预留 |

---

## 关键代码参考

### Session 数据结构
**storageTypes.ts** line 91-121：
```typescript
export interface Session {
    id: string,
    seq: number,
    // ...
    permissionMode?: string | null;  // 本地配置，不同步到 server
    modelMode?: string | null;       // 本地配置，不同步到 server
    effortLevel?: string | null;     // 本地配置，不同步到 server
}
```

### 本地持久化
**persistence.ts** (需查看完整实现)：
- `loadSessionPermissionModes()` - 从 MMKV 恢复
- `saveSessionPermissionModes()` - 保存到 MMKV
- 类似函数用于 modelMode 和 effortLevel

### 状态更新入口
**AgentInput.tsx** line 406-416 → **SessionView.tsx** line 406-416：
```typescript
const updatePermissionMode = React.useCallback((mode: PermissionMode) => {
    storage.getState().updateSessionPermissionMode(sessionId, mode.key);
}, [sessionId]);
```

---

## 附录：完整代码流追踪

### Gear Icon 设置流程（当前）
```
1. AgentInput.tsx (line 1354-1359)
   ├─ 用户按 gear icon
   ├─ handleSettingsPress() 调用
   └─ setShowSettings(true)

2. AgentInput.tsx (line 789-850)
   ├─ 显示设置 overlay（permission mode + model 选择）
   ├─ 用户选择 mode
   └─ 回调 handleSettingsSelect() → props.onPermissionModeChange?.(mode)

3. SessionView.tsx (line 406-408)
   ├─ onPermissionModeChange 回调
   ├─ 调用 updatePermissionMode(mode)
   └─ storage.getState().updateSessionPermissionMode(sessionId, mode.key)

4. storage.ts (line 1048-1077)
   ├─ updateSessionPermissionMode action
   ├─ 更新 Zustand state
   ├─ 调用 saveSessionPermissionModes(allModes)
   └─ MMKV 保存完成

5. persistence.ts (saveSessionPermissionModes 函数)
   └─ mmkv.set('session-permission-modes', JSON.stringify(allModes))

✓ 完成，但 **仅本地**
```

### Session 加载流程（当前）
```
1. sync.ts (line 232-244)
   ├─ App 初始化或返回前台
   ├─ this.sessionsSync.invalidate()
   └─ 触发 fetchSessions()

2. sync.ts (fetchSessions 逻辑)
   ├─ GET /v1/sessions (from server)
   └─ 返回 Session[] (包含 metadata, agentState, 但 ❌ 无 permissionMode)

3. storage.ts (line 404)
   ├─ applySessions(sessions)
   ├─ 从 MMKV 加载 savedPermissionModes
   ├─ 优先级解析 (line 425-430)
   │  1. 现有值 (existingPermissionMode)
   │  2. 保存值 (savedPermissionMode) ← MMKV
   │  3. Server 返回值 (session.permissionMode) ← ❌ 不存在
   │  4. 默认值
   └─ 最终结果：每个设备独立，无跨设备同步

✗ 问题所在
```

---

**报告完成时间**: 2026-06-02 09:00 UTC  
**调研版本**: v1.0
