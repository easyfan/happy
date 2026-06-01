# BUG-21 Re-spike：iOS 冷启动 30 秒瓶颈分析

**日期**：2026-06-02  
**迭代**：IT22-01  
**背景**：迭代13（commit `1f766e82`）已将 fetchSessions 串行解密改为 `Promise.allSettled` 并行化，但 iOS TestFlight build 38 用户仍报约 30 秒冷启动。本 spike 通过静态代码分析找出真实瓶颈。

---

## 摘要

迭代13的修复（`Promise.allSettled`）**确实正确实现**，并行化了 dataEncryptionKey 解密循环（Loop 1）。但这仅是整个调用链的一小段，不足以解决 30 秒问题。

**最可能的真实瓶颈**（按可能性排序）：
1. iOS libsodium native bridge 并发限制（RN bridge 线程池串行化 150 个 native 调用）
2. Server 端无分页（硬编码 `take: 150`，200+ sessions 时触发二次请求）
3. `SecretBoxEncryption` 未并行化（封装层仍为同步 for 循环）

---

## fetchSessions 调用链图

```
冷启动触发
    └── fetchSessions() [sync.ts:761]
        ├── [网络] GET /v1/sessions [sync.ts:765]
        │   └── sessionRoutes.ts:14-46
        │       ├── take: 150（硬编码，无分页）⚠️
        │       └── 返回 sessions + nextCursor
        │
        ├── [解密 Loop 1] dataEncryptionKey x N [sync.ts:2590-2598]
        │   └── Promise.allSettled ✅（迭代13已并行化）
        │       └── crypto_box_open_easy [libsodium native bridge]
        │           └── iOS RN bridge 线程池 ⚠️（可能串行化）
        │
        ├── [解密 Loop 2] metadata + agentState [sync.ts:2620-2645]
        │   ├── AES decrypt → Promise.all ✅（已并行）
        │   └── SecretBox decrypt → for 循环 ❌（仍串行）
        │       └── encryptor.ts:27-34
        │
        └── [状态更新] applySessions [storage.ts:404-560]
            ├── sort/filter/reducer: O(n log n)，n=150 时 <50ms ✓
            └── Zustand 批量更新 ✓
```

---

## 各阶段分析

### 阶段 1：网络拉取（Server 端）

**文件**：`packages/happy-server/sources/app/api/routes/sessionRoutes.ts:14-46`

```typescript
// sessionRoutes.ts:22（硬编码 take）
take: 150,  // ⚠️ 无分页限制
```

- 用户 session 数超过 150 时，需二次 API 调用
- 无 cursor-based 分页的冷启动优化（仅加载 top 50 最近 sessions）
- **时间估算**：4-10 秒（取决于用户 session 数量和网络 RTT）
- Web 端同样走此路径，但如果 Web 未复现，说明 Web 侧总 session 数较少

### 阶段 2：dataEncryptionKey 解密（已修复）

**文件**：`packages/happy-app/sources/sync/sync.ts:2590-2598`

```typescript
// ✅ 迭代13已并行化
await Promise.allSettled(sessions.map(s => decryptKey(s)))
```

- 并行化正确实现
- **但**：每个 `decryptKey` 调用 libsodium `crypto_box_open_easy`（native bridge）
- iOS RN bridge 线程池有限，150 个并发 native 调用可能仍被序列化
- **时间估算**：150 × 7ms ≈ 1-2 秒（即使"并行"也受 bridge 限制）

### 阶段 3：SecretBoxEncryption 未并行化（需修复）

**文件**：`packages/happy-app/sources/sync/encryption/encryptor.ts:27-34`

```typescript
// ❌ 仍为同步 for 循环
for (const session of sessions) {
    const decrypted = secretBox.decrypt(session.data)
    results.push(decrypted)
}

// 对比：AES 路径（已并行）
// encryptor.ts:115
await Promise.all(sessions.map(s => aes.decrypt(s)))  // ✅
```

- 默认加密类型（SecretBox）的 sessions 解密仍串行
- AES 路径已并行化，但 SecretBox 路径未跟进
- **时间估算**：视 SecretBox session 数量，~150-300ms

### 阶段 4：状态更新

**文件**：`packages/happy-app/sources/sync/storage.ts:404-560`

- `applySessions` 使用 sort/filter/reducer，n=150 时 O(n log n) < 50ms ✓
- Zustand 批量更新，不逐条触发 render ✓
- **结论**：此阶段不是瓶颈

---

## 瓶颈假设排名

| 排名 | 瓶颈 | 可能性 | 时间估算 | 代码位置 | 可测量指标 |
|------|------|--------|---------|---------|-----------|
| 1 | iOS libsodium native bridge 并发限制 | 🔴 最高 | 1-3 秒 | sync.ts:2590-2598 | `performance.mark()` 打点 bridge 调用耗时 |
| 2 | Server 无分页（take: 150，用户 session 多时二次请求）| 🟠 高 | 4-10 秒 | sessionRoutes.ts:22 | 网络 DevTools 看 API 响应时间 |
| 3 | SecretBoxEncryption 串行 for 循环 | 🟠 中 | 150-300ms | encryptor.ts:27-34 | 解密前后 Date.now() |
| 4 | Storage sort/filter | 🟡 低 | <50ms | storage.ts:404-560 | — |
| 5 | React 渲染 | 🟢 很低 | — | — | React Profiler |

**关键区分因素**：Web 端未复现 → 要么是 iOS libsodium bridge 特有，要么是 iOS 用户 session 数量远多于 Web（iOS 是主要设备）。

---

## 修复建议

### 诊断优先（无代码修改，下一步立即执行）

1. **获取用户实际 session 数量**：直接询问或在 App 日志中输出 `sessions.length`
2. **网络分段统计**：在 fetchSessions 中添加时间打点
   ```typescript
   const t0 = Date.now()
   const sessions = await fetchFromServer()  // 阶段1
   const t1 = Date.now()
   await Promise.allSettled(sessions.map(decryptKey))  // 阶段2
   const t2 = Date.now()
   console.log(`[perf] fetch=${t1-t0}ms decrypt=${t2-t1}ms total=${t2-t0}ms`)
   ```
3. **对比 Web vs iOS 同一账号**：如果两端 session 数相同，iOS 更慢 → 指向 bridge 瓶颈

### 修复优先级（循证后执行）

| 优先级 | 修复方案 | 工作量 | 预期收益 |
|--------|---------|--------|---------|
| P1 | 分页加载：冷启动仅拉 top 50，滚动加载更多（server + app 双端改动）| M | 消除二次请求，首屏加载 < 2s |
| P2 | SecretBoxEncryption 并行化：for 循环 → `Promise.all` | XS | 减少 150-300ms |
| P3 | 验证 libsodium bridge 开销：Profile iOS 确认 native 调用耗时 | XS（仅诊断）| 确认是否需要 WebAssembly 替代方案 |

### 下一迭代建议

**最低成本确认方案**（IT22-01 结论）：
1. 先加日志诊断（XS，无架构风险），取得真实数据
2. 若 server 用时 > 5s → 优先做分页（需 server + app 改动，但收益确定）
3. 若 decrypt 用时 > 5s → 修复 SecretBox 串行 + 评估 bridge 开销

**委员会触发条件**：如果决定实施分页（P1），涉及 server API 变更 + App sync 引擎改动，需要架构委员会审核（符合 `po:launch` 规则中"核心 sync 引擎改动"前置门控）。

---

## 涉及文件清单

| 文件 | 关键行号 | 问题 |
|------|---------|------|
| `packages/happy-app/sources/sync/sync.ts` | 761, 2590-2598, 2620-2645 | fetchSessions 入口 + 解密循环 |
| `packages/happy-app/sources/sync/encryption/encryptor.ts` | 27-34（❌）, 115（✅） | SecretBox 串行 vs AES 并行 |
| `packages/happy-server/sources/app/api/routes/sessionRoutes.ts` | 14-46 | 无分页 take:150 |
| `packages/happy-app/sources/sync/storage.ts` | 404-560 | applySessions 状态更新（非瓶颈）|
