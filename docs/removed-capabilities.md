# Removed Capabilities Record

记录已从 Happy App 中移除的功能，包括移除原因、移除时的完整实现、技术障碍，以及未来恢复的前提条件。

---

## [RC-01] App 内 JS Runtime 热重启（expo-updates `reloadAsync`）

**移除时间**：2026-05-15  
**涉及 commit**：`0dad634c`（移除 expo-updates 包）、`27b08aee`（revert 错误补丁）、BUG-20 修复 commit（最终清理）  
**影响范围**：happy-app（iOS / Android；Web 端 `window.location.reload()` 未受影响）

---

### 一、被移除的能力

在两个场景下，App 原本能够在用户操作后**无感知地热重启 JS Runtime**：

| 场景 | 调用位置 | 原始代码 |
|------|---------|---------|
| 语言切换生效 | `sources/app/(app)/settings/language.tsx` L30 | `await Updates.reloadAsync()` |
| Logout 后清理内存状态 | `sources/auth/AuthContext.tsx` L62 | `await Updates.reloadAsync()` |

`reloadAsync()` 来自 `expo-updates` 包，内部通过 `ExpoUpdates` native module 触发 React Native JS bundle 重新加载，效果等同于杀进程重启但更快（不走 native 冷启动）。

---

### 二、移除原因

**直接原因（I-01 OTA 迁移决策）**：迭代 1 决定将 OTA 推送从 EAS 迁移到自建 `expo-open-ota` 服务器（`commit 0dad634c`），并将 `expo-updates` 从 `package.json` 中移除，以彻底解耦 EAS 依赖。

**副作用**：`expo-updates` 被移除后，`reloadAsync()` 的底层 native module `ExpoUpdates` 随之不再被 link 到构建产物（`EXUpdates` pod 从 Podfile 移除）。任何调用链路均失效。

**为何不能用 `DevSettings.reload()` 替代**：该 API 仅在 React Native dev bundle 中存在，production build 中为 undefined，使用会导致 production 静默失败或 crash。

**为何不能用 `requireOptionalNativeModule('ExpoUpdates')` 替代**：`ExpoUpdates` native module 本体随 `expo-updates` 一起从 Podfile 移除，`requireOptionalNativeModule` 必然返回 null，reload 永远不会执行。

---

### 三、移除时的处置

| 场景 | 移除后行为 |
|------|----------|
| 语言切换 | preference 写入 MMKV，下次 cold start 时语言生效；用户通过 Modal 提示"语言将在重启 App 后生效"（i18n key: `settingsLanguage.restartRequired`） |
| Logout | 依赖 React state（`setCredentials(null)`）触发 `_layout.tsx` 导航回登录页；`syncReset()` 在 `clearPersistence()` 前调用以清理 sync engine 内存 |

**技术评估**：Logout 场景的替代方案是充分的（持久层已 await 清理完毕，React 导航到登录页）。语言切换场景有体验降级（需手动重启才能即时生效），但业界标准（iOS/Android 系统设置均如此），用户接受度可接受。

---

### 四、未来恢复的前提条件

恢复热重启能力，需满足以下所有条件之一：

**路径 A：重新引入 expo-updates（完整 OTA 方案）**
- 前提：重新接入 OTA 更新服务（EAS 或自建 expo-open-ota）
- 操作：`expo-updates` 重新加入 `package.json`，`EXUpdates` pod 重新 link
- 合适时机：有强烈的 OTA 推送需求，且已有稳定 OTA 服务器时
- 风险：引入 OTA 依赖与 App Store 审核流程的耦合（苹果要求 OTA 不得绕过审核）

**路径 B：使用 Expo 内部非公开 API**
- `NativeModules.DevSettings?.reload()`（dev only，不适合 production）
- `NativeModules.DevMenu?.reload()`（`expo-dev-client` 内，仅 dev client build）
- 以上均为 dev-only，**不适合 production**

**路径 C：RCT bridge reload（React Native 底层）**
- iOS：`[bridge requestReload]`（Objective-C，需桥接到 JS 层）
- Android：`reactInstanceManager.recreateReactContextInBackground()`
- 需自写 native module 或通过现有 `NativeModules` 访问（有 RN 版本兼容风险）
- 工作量 M，适合当用户体验强烈要求时

**路径 D：i18n 运行时可切换（彻底解法）**
- 修改 `sources/text/index.ts`：将 `currentLanguage` 从模块级 let 改为 React Context state
- 所有 `t()` 消费者需通过 Context re-render 感知变化
- 工作量 M-L，彻底消除语言切换对 reload 的依赖
- 适合语言切换是高频需求时

---

### 五、参考文件

- 委员会最终报告（归档）：`~/wiki/pages/happy_bug20-expo-updates-removal.md`
- 已移除功能注册表（归档）：`~/wiki/pages/happy_removed-capabilities.md`
- OTA 迁移决策：`memory/project_ota_migration.md`
- i18n 系统入口：`sources/text/index.ts`（`currentLanguage` 模块级静态单例）
