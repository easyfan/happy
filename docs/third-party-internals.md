# 自引三方库深度文档

> 生成日期：2026-05-19  
> 研究员：迭代 8 研究员  
> 范围：Happy monorepo 中的 libsodium（app 侧加密）和 expo-open-ota（OTA 更新机制）

---

## 1. libsodium（happy-app 加密层）

### 1.1 概览

Happy app 使用 **@more-tech/react-native-libsodium**（NaCl 兼容库）进行端到端加密。加密层分为两个主要场景：

1. **盒式加密（Box）**：用于会话间通信，公钥密码学
2. **秘密盒（SecretBox）**：用于会话内数据存储，对称密钥加密

### 1.2 使用路径分析

#### 主加密模块

| 文件 | 模块 | 调用的 libsodium API | 用途 | 数据流向 |
|------|------|------------------|------|---------|
| `/encryption/libsodium.ts` | `getPublicKeyForBox()` | `crypto_box_seed_keypair(seedKey)` | 从种子生成静态公钥 | 密钥管理 |
| `/encryption/libsodium.ts` | `encryptBox()` | `crypto_box_keypair()` | 生成临时密钥对 | 消息加密准备 |
| `/encryption/libsodium.ts` | `encryptBox()` | `crypto_box_easy()` | 加密消息到接收方公钥 | App → Server |
| `/encryption/libsodium.ts` | `decryptBox()` | `crypto_box_open_easy()` | 解密消息用接收方私钥 | Server → App |
| `/encryption/libsodium.ts` | `encryptSecretBox()` | `crypto_secretbox_easy()` | 对称加密（JSON 序列化数据） | 本地存储 |
| `/encryption/libsodium.ts` | `decryptSecretBox()` | `crypto_secretbox_open_easy()` | 对称解密本地存储数据 | 本地读取 |

#### 加密器实现

| 类 | 文件 | 使用的 Box/SecretBox API | 典型应用 |
|-----|------|------------------------|---------|
| `SecretBoxEncryption` | `/sync/encryption/encryptor.ts` | `encryptSecretBox()` / `decryptSecretBox()` | 会话消息、元数据、智能体状态 |
| `BoxEncryption` | `/sync/encryption/encryptor.ts` | `encryptBox()` / `decryptBox()` | 跨设备会话同步（潜在） |
| `AES256Encryption` | `/sync/encryption/encryptor.ts` | N/A（使用 expo-aes） | 备选对称加密方案 |

#### 会话级加密集成

| 消费者 | 文件 | 加密器类型 | 加密对象 |
|--------|------|----------|---------|
| SessionEncryption | `/sync/encryption/sessionEncryption.ts` | SecretBoxEncryption（可配置） | 会话消息、元数据、代理状态 |
| MachineEncryption | `/sync/encryption/machineEncryption.ts` | SecretBoxEncryption（可配置） | 机器元数据、守护进程状态 |

### 1.3 关键密钥材料与初始化

**SecretBox 密钥生成：** 
- 长度：`crypto_secretbox_KEYBYTES`（32 字节）
- 来源：从认证令牌/会话密钥派生（具体实现在 auth 流程中）

**Box 密钥对生成：**
- 公钥 + 私钥：各 32 字节（ED25519 曲线）
- 种子：用户认证时生成/存储的唯一种子

### 1.4 序列化与 Nonce 处理

#### SecretBox 格式
```
[Nonce (24 bytes)][Encrypted Data (variable)]
```
- Nonce：随机生成，每次加密不同（`crypto_secretbox_NONCEBYTES = 24`）
- 数据：JSON 序列化后的对象

#### Box 格式
```
[Ephemeral Public Key (32 bytes)][Nonce (24 bytes)][Encrypted Data (variable)]
```
- 临时公钥：接收方可用于解密
- Nonce：随机，24 字节
- 发送方私钥：用于加密

### 1.5 与 CLI 侧 TweetNaCl 的对照表

**当前状态：** ✅ CLI 侧在 `packages/happy-cli/src/`（注意：CLI 包目录为 `src/`，非 `sources/`）中使用 TweetNaCl

**已确认的 CLI 侧 TweetNaCl 使用文件**：
- `packages/happy-cli/src/api/encryption.ts` — 消息加密/解密（box 加密）
- `packages/happy-cli/src/ui/auth.ts` — 身份验证密钥对生成（box.keyPair.fromSecretKey）
- `packages/happy-cli/src/modules/fileTransfer/fileEncryption.ts` — 文件加密
- 以及其他 4 个文件

**双端加密已对齐**：App（libsodium）与 CLI（TweetNaCl）使用相同的 NaCl 加密算法族，端对端数据可互解密。

#### 对照表

| 操作 | libsodium (App) | TweetNaCl (CLI - 假设) | 语义等价性 |
|------|-----------------|----------------------|-----------|
| 生成公钥 | `crypto_box_seed_keypair()` | `nacl.box.keyPair.fromSecretKey()` | ✅ 等价（ED25519） |
| 加密消息 | `crypto_box_easy()` | `nacl.box()` | ✅ 等价（ChaCha20-Poly1305） |
| 解密消息 | `crypto_box_open_easy()` | `nacl.box.open()` | ✅ 等价 |
| 对称加密 | `crypto_secretbox_easy()` | `nacl.secretbox()` | ✅ 等价（XSalsa20-Poly1305） |
| 对称解密 | `crypto_secretbox_open_easy()` | `nacl.secretbox.open()` | ✅ 等价 |

### 1.6 关键注意事项

1. **Nonce 生成：** 
   - 使用 `expo-crypto.getRandomBytes()` 生成（硬件随机或伪随机）
   - 每次调用必须产生不同 nonce（重用 nonce + 密钥 = 密钥破裂）

2. **密钥长度不可调：**
   - SecretBox 密钥固定 32 字节
   - Box 密钥对固定 32 + 32 字节
   - 任何缩短/拉长都会导致运行时错误

3. **Base64 编码转换：**
   - 所有加密后的二进制数据通过 base64 编码后存储（JSON 兼容）
   - 解密前必须先 base64 解码回 Uint8Array

4. **JSON 序列化时机：**
   - SecretBox 仅支持二进制输入
   - 应用需自行调用 `JSON.stringify()` 后再编码为 UTF-8，最后再加密
   - 解密后反向操作：UTF-8 解码 → JSON.parse()

5. **错误处理：**
   - `decryptBox()` / `decryptSecretBox()` 返回 `null` 表示解密失败（不抛异常）
   - 需要调用方检查 null 并返回错误响应

### 1.7 Web 平台特殊处理

**文件：** `/dev/expoCryptoShim.ts`

Web 平台 libsodium 加载可能需要 polyfill；app 通过这个 shim 处理平台差异。

---

## 2. expo-open-ota（OTA 更新机制）

### 2.1 当前配置状态

**app.config.js 中的 OTA 配置：** ❌ **未配置 expo-open-ota**

当前 plugins 中：
- ✅ `expo-router`
- ✅ `expo-asset`
- ✅ `@more-tech/react-native-libsodium`
- ✅ `expo-camera`
- ❌ 无 `expo-updates` 或 `expo-open-ota` 配置

**结论：** App 当前使用的是 Expo 标准编译流程，不支持 OTA 更新。

### 2.2 当前重启/重载机制

#### 语言切换 (`language.tsx`)
```typescript
const reloadApp = () => {
    if (Platform.OS === 'web') {
        window.location.reload();      // Web: 硬刷新
    } else {
        Modal.alert(                   // Native: 提示用户重启
            t('settingsLanguage.restartRequired'),
            t('settingsLanguage.restartRequiredMessage')
        );
    }
};
```
- **Web 侧：** 浏览器页面刷新即可切换语言（I18N 上下文重新初始化）
- **Native 侧（iOS/Android）：** 无 OTA → 需要用户手动重启应用（kill + reopen）

#### 登出流程 (`AuthContext.tsx`)
```typescript
const logout = async () => {
    // ... 清理 push token、持久化存储等 ...
    syncReset();
    clearPersistence();
    await TokenStorage.removeCredentials();
    
    // 更新 React 状态
    setCredentials(null);
    setIsAuthenticated(false);
    
    // Web: 硬刷新；Native: 路由变化自动导向登录屏幕
    if (Platform.OS === 'web') {
        window.location.reload();
    }
};
```
- **Web：** 全页刷新清空 localStorage
- **Native：** 依赖 React 状态变化 + Expo Router 路由守卫

### 2.3 RC-01 的技术影响评估

**RC-01 状态：** ⚠️ OTA 被显式禁用（无 expo-updates 配置）

#### 当前无 OTA 的影响

| 流程 | 影响 | 替代方案 |
|------|------|---------|
| 语言切换（Native） | 需要手动重启应用 | ✅ Web 上可正常刷新；Native 建议未来改进 UX（显示"重启提示"后自动冷启） |
| 登出流程 | 状态清理完全，下次冷启时重新初始化 | ✅ 足够 |
| 功能更新 | 必须通过 App Store/Play Store 发布 | ✅ 标准流程 |
| 文本/配置更新 | 需要完整应用重新构建 | ❌ 效率低（无 OTA 的成本） |
| 紧急补丁 | 无法快速部署（App Store 审核延迟） | ⚠️ 风险 |

### 2.4 OTA 架构原理（参考）

如果 expo-open-ota 配置启用，架构会是：

```
┌─────────────────────────────────┐
│  App Startup                    │
│  ├─ Load Manifest from EAS      │  <── EAS Update Service
│  ├─ Check if OTA Update         │      (CDN 分发)
│  │  Available (hash compare)    │
│  └─ If yes: Download Bundle    │      
└─────────────────────────────────┘
         │
         ├─ On Success: 
         │  └─ Stage Bundle
         │     (next restart load)
         │
         └─ On Failure:
            └─ Fallback to Native
               (last known good)
```

**关键特性：**
- Manifest：JSON，包含 bundle hash、app 版本、发布时间
- Bundle：JS/TSX 编译产物 + 资源（images, fonts）
- 分阶段加载：下载→验证→暂存→下次启动生效（不中断当前会话）
- 自动回滚：若新 bundle 启动失败，回到上一版本

### 2.5 RC-01 禁用的原因推测

**可能的原因：**

1. **稳定性考虑**
   - OTA 引入的不确定性（网络、签名、CDN 问题）
   - RC-01 是稳定发布，优先选择保守策略

2. **无 EAS 账户配置**
   - `extra.eas.projectId` 已配置（`0b8c2e73-4e2e-46fa-8c32-9dd343f13b35`）
   - 但 OTA 更新需要额外配置（channels、deployment profiles）

3. **加密敏感**
   - App 包含 libsodium E2E 加密
   - OTA bundle 大小、签名验证等需要特殊处理

### 2.6 未来重新启用路径

#### 前置条件
- [ ] 配置 EAS Update channels（production, preview, dev）
- [ ] 在 app.config.js 中注册 `expo-updates` plugin
- [ ] 配置签名密钥和发布配置文件
- [ ] 编写 OTA 版本检查 UI（可选进度条）

#### 代码变更
```javascript
// app.config.js 新增
plugins: [
    // ...
    ["expo-updates", {
        enabled: true,
        updateUrl: `https://u.expo.dev/${projectId}`,
        runtimeVersion: {
            policy: "appVersion"  // or "nativeVersion"
        }
    }]
]
```

#### 运行时流程改进
```typescript
// App 启动时检查 OTA
import * as Updates from 'expo-updates';

useEffect(() => {
    (async () => {
        const update = await Updates.checkAsync();
        if (update.isAvailable) {
            // 通知用户后台下载
            Modal.confirm('New version available', 'Update now?')
                .then(ok => ok && Updates.fetchUpdateAsync()
                    .then(() => Updates.reloadAsync())
                );
        }
    })();
}, []);
```

#### 语言切换改进（Native）
```typescript
// 使用 OTA 后的替代方案
const reloadApp = async () => {
    if (Platform.OS === 'web') {
        window.location.reload();
    } else {
        // Native: 加载 OTA（若可用）或冷启
        try {
            const update = await Updates.fetchUpdateAsync();
            if (update.isNew) {
                await Updates.reloadAsync();
            }
        } catch {
            // Fallback: 仍需用户手动重启（或使用原生模块强制 restart）
        }
    }
};
```

#### 回滚机制
```typescript
// EAS Rollbacks 自动处理
// 1. Manifest 中标记 rollback = true
// 2. App 检测到 rollback flag，跳过当前版本
// 3. 下次启动加载前一个已知良好版本
```

### 2.7 OTA 禁用期间的最佳实践

1. **始终通过 App Store/Play Store 发布** → 用户自动更新
2. **关键更新强制 app version bump** → 迫使重新下载
3. **不依赖运行时热更新** → 所有功能变化需要重编译
4. **I18N/配置更新** → 打包在二进制中（无法 OTA 分离）

### 2.8 与其他系统的集成影响

| 系统 | OTA 启用前 | OTA 启用后 | 注意事项 |
|-----|-----------|-----------|---------|
| libsodium 加密 | ✅ 生效 | ✅ 仍需验证 | OTA bundle 签名与加密密钥无冲突 |
| 语言系统 | Manual restart | 可改进为 OTA reload | 翻译文本 embed 在 bundle 中 |
| Push notifications | 标准 APNs 流程 | ✅ 不受影响 | 版本升级前后 push 兼容 |
| Socket.io 同步 | ✅ 标准 | ✅ 热加载可能中断连接 | 需要重连逻辑 |

---

## 3. 交叉影响分析

### 3.1 为什么 RC-01 禁用 OTA

- 无需网络下载 → 启动速度快
- 无回滚风险 → 稳定性优先
- 无签名复杂性 → 部署简化
- 对应 "第一阶段稳定发布" 策略

### 3.2 推荐的 RC-02+ 路线

1. **RC-01.1（维护版）**
   - 继续禁用 OTA
   - bug 修复通过 store 发布

2. **RC-02（功能发布）**
   - 启用 OTA 用于 I18N/配置更新
   - 核心功能仍需 store 更新
   - 并行测试 OTA 回滚机制

3. **RC-03+（全 OTA）**
   - 部分功能通过 OTA 快速部署（如 agent 提示词改进、UI 微调）
   - 主要功能仍需 native rebuild

### 3.3 libsodium 加密与 OTA 的兼容性

- ✅ **兼容**：libsodium 是应用层加密，OTA bundle 是平台层机制，互不干扰
- ⚠️ **需注意**：OTA bundle 本身应 signed by EAS（不需要 libsodium）
- ✅ **会话连续性**：OTA reload 后加密密钥仍保存在 secure storage，会话可继续

---

## 总结

### libsodium 现状
- 完整集成，支持 Box（跨设备）和 SecretBox（本地）加密
- CLI 侧尚未集成（可能 RC-02+ 功能）
- 与 TweetNaCl 在算法层等价，可互操作

### expo-open-ota 现状  
- RC-01 显式禁用（无 expo-updates 配置）
- 影响：语言切换(Native)和紧急补丁需要应用重启/store 发布
- 未来可通过配置 EAS channels + expo-updates plugin 启用

### 建议行动项
1. 确认 CLI 侧 RC-02+ 是否需要加密 → 如需则规划 TweetNaCl 集成
2. 评估 OTA 启用的收益 vs 风险 → RC-02+ 考虑试点启用
3. 测试 OTA 回滚流程 → 保证生产稳定性

