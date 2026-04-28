# 设计文档：Android 无 GMS 设备二维码扫描修复

**状态**: 已实施（v1.2）  
**提交日期**: 2026-04-24  
**作者**: zhengfan  
**审核委员会**: 开发设计委员会

---

## 1. 问题陈述

### 1.1 现象

在不含 Google Mobile Services（GMS）的 Android 设备上（如华为鸿蒙、AOSP 设备、LineageOS、部分国内定制 ROM），用户进入「设置 → 账户 → 链接新设备」后，点击按钮完全没有反应，无任何错误提示，扫码窗口不打开。

同样的问题复现于「连接 Terminal」场景（使用 `happy://terminal?` URL 的流程）。

### 1.2 根因

`expo-camera` 的 Modern Barcode Scanner 底层使用 **Google ML Kit Barcode Scanning API**，依赖 GMS。具体失败点有两处：

| 代码位置 | 调用 | 在无 GMS 设备上的行为 |
|---|---|---|
| `useConnectAccount.ts:55` | `CameraView.launchScanner(...)` | 静默失败，无异常，无日志 |
| `useConnectAccount.ts:70` | `CameraView.isModernBarcodeScannerAvailable` | 返回 `false` |
| `useConnectTerminal.ts:60` | `CameraView.launchScanner(...)` | 同上 |
| `useConnectTerminal.ts:75` | `CameraView.isModernBarcodeScannerAvailable` | 返回 `false` |

**实际执行路径**：按钮 `onPress` 触发 `connectAccount` → `checkScannerPermissions()` 在 Android 上直接返回 `true`（第 8-10 行快捷路径）→ 调用 `CameraView.launchScanner()` → 静默失败。与此同时，`useEffect` 因 `isModernBarcodeScannerAvailable === false` 根本不注册监听器，因此即使 `launchScanner` 意外成功，结果也无法被捕获。两个失败点独立存在，均需修复。

此外，`useCheckCameraPermissions.ts` 在 Android 上始终返回 `true`（第 8-10 行注释说明：Google Code Scanner 不需要权限），导致权限检查看似通过，掩盖了底层的不可用性，让问题更难察觉。

### 1.3 影响范围

- `packages/happy-app/sources/hooks/useConnectAccount.ts`（链接新设备）
- `packages/happy-app/sources/hooks/useConnectTerminal.ts`（连接 Terminal）
- `packages/happy-app/sources/hooks/useCheckCameraPermissions.ts`（权限检查逻辑需联动调整）

iOS 和有 GMS 的 Android 设备不受影响。

---

## 2. 方案选型

### 2.1 方案对比

| 方案 | 依赖 | GMS 要求 | 实施复杂度 | 备注 |
|---|---|---|---|---|
| **方案 1**：react-native-vision-camera | ZXing（纯 Java） | 无 | 中 | 已在 `package.json` dependencies |
| 方案 2：expo-barcode-scanner（旧版） | 已弃用，Expo SDK 50+ 移除 | — | 高（降级风险） | 不可行 |
| 方案 3：第三方 Intents（仅 Android） | 设备内置扫描 App | 无 | 高（兼容性碎片化） | 不可行 |

### 2.2 选定方案：方案 1

`react-native-vision-camera` v4.7.3 **已在项目 dependencies 中**（`packages/happy-app/package.json`），无需新增依赖。其 `useCodeScanner` API 使用 ZXing（Android）/ AVFoundation（iOS），均不依赖 GMS。

---

## 3. 技术设计

### 3.1 架构变更概览

```
现有流程（有 GMS）:
  Button.onPress
    → checkScannerPermissions() → true
    → CameraView.launchScanner()      ← 系统弹出 ML Kit 扫码窗
    → CameraView.onModernBarcodeScanned  ← 收到结果
    → processAuthUrl()

目标流程（兼容无 GMS）:
  Button.onPress
    → checkScannerPermissions()
    → 导航至 QRScannerScreen（内嵌 VisionCamera + useCodeScanner）
    → 扫码成功回调 onScanned(url)
    → processAuthUrl()
    → 关闭 QRScannerScreen
```

### 3.2 新增组件：`QRScannerScreen`

**路径**: `packages/happy-app/sources/components/qr/QRScannerScreen.tsx`

该组件封装 `react-native-vision-camera` 的扫码能力，作为全屏模态页面使用。

**接口**:
```typescript
interface QRScannerScreenProps {
    urlPrefix: string;         // 'happy:///account?' 或 'happy://terminal?'
    onScanned: (url: string) => void;
    onClose: () => void;
}
```

**核心实现要点**:
```typescript
import { Camera, useCameraDevice, useCodeScanner } from 'react-native-vision-camera';

const device = useCameraDevice('back');
const scannedRef = React.useRef(false);  // 防止重复触发

const codeScanner = useCodeScanner({
    codeTypes: ['qr'],
    onCodeScanned: (codes) => {
        if (scannedRef.current) return;   // 已扫描锁：每帧均触发，需去重
        const url = codes.find(c => c.value?.startsWith(urlPrefix))?.value;
        if (url) {
            scannedRef.current = true;
            onScanned(url);               // onScanned 内部完成后调用 onClose
        }
    }
});

// 渲染（device 可能为 undefined，需 guard）
if (!device) {
    return <LoadingOrErrorView />;        // 不可将 undefined 传入 Camera
}

return (
    <Camera
        style={StyleSheet.absoluteFill}
        device={device}
        isActive={true}
        codeScanner={codeScanner}
    />
);
```

> **重复触发保护**：`useCodeScanner` 的 `onCodeScanned` 在摄像头对准 QR 码期间每帧都会触发。若不加 `scannedRef` 锁，`processAuthUrl`（网络请求）会被重复调用，导致竞态或重复绑定。`onScanned` 触发后应立即关闭（`isActive={false}` 或调用 `onClose`），以彻底停止帧处理。

> **device 为 undefined**：`useCameraDevice('back')` 在设备无可用后置摄像头时返回 `undefined`。直接将 `undefined` 传入 `<Camera device={...}>` 会抛出异常。组件必须在 device 为 undefined 时渲染降级 UI（加载中或错误提示）。

**权限处理**: vision-camera 要求 `CAMERA` 权限，需在组件挂载前（即进入扫码页之前，在按钮 onPress 的同步调用栈中）调用 `Camera.requestCameraPermission()`，iOS 和 Android 均需用户授权。详见 3.3 节关于 iOS 权限时机的约束。

### 3.3 权限钩子调整：`useCheckCameraPermissions`

> **命名说明**：当前文件名为 `useCheckCameraPermissions.ts`，内部导出函数为 `useCheckScannerPermissions`。本文档统一称文件名（前者），函数名（后者）保持不变。变更清单（3.5 节）以文件名为准。

当前实现在 Android 上跳过权限检查（因为 ML Kit Scanner 不需要）。改用 vision-camera 后，Android 也需要相机权限。

**变更**:
```typescript
// 移除 Android 快捷路径，统一走 Camera.requestCameraPermission()
import { Camera } from 'react-native-vision-camera';

export function useCheckScannerPermissions(): () => Promise<boolean> {
    return async () => {
        const status = await Camera.requestCameraPermission();
        return status === 'granted';
    };
}
```

> **iOS 权限时机约束**：Apple 要求 `requestCameraPermission()` 必须在用户手势的**直接调用栈**中调用（不能在 async 链中延迟过久，否则系统拒绝弹窗）。本方案中 `checkScannerPermissions()` 在按钮 `onPress` 内直接 `await`，满足直接调用栈要求。实现时应避免在此调用前插入与手势无关的异步操作。

> **破坏性变更**：现有 Android 有 GMS 的用户将首次被弹出相机权限请求弹窗（此前 ML Kit Scanner 不弹）。需在 Release Notes 中说明。

### 3.4 Hook 层变更：`useConnectAccount` / `useConnectTerminal`

**移除**:
- `CameraView.launchScanner()` 调用
- `CameraView.isModernBarcodeScannerAvailable` 检查
- `CameraView.onModernBarcodeScanned` 订阅
- `CameraView.dismissScanner()` 调用

**新增**:
- 本地状态 `isScannerOpen: boolean`
- 按钮 onPress 时：权限检查通过 → `setIsScannerOpen(true)`
- 渲染 `QRScannerScreen`（当 `isScannerOpen === true`）
- `onScanned` 回调：调用 `processAuthUrl(url)`，完成后 `setIsScannerOpen(false)`
- `onClose` 回调：直接 `setIsScannerOpen(false)`

**使用侧接入示意**（以 `useConnectAccount` 为例）:
```typescript
const [isScannerOpen, setIsScannerOpen] = React.useState(false);

const connectAccount = React.useCallback(async () => {
    if (await checkScannerPermissions()) {
        setIsScannerOpen(true);
    } else {
        Modal.alert(t('common.error'), t('modals.cameraPermissionsRequiredToScanQr'), [{ text: t('common.ok') }]);
    }
}, [checkScannerPermissions]);

// 调用方（account.tsx）需渲染 Scanner
// → 建议 useConnectAccount 返回 scannerElement，或将状态上提至 account.tsx
```

**接入方式选择**（需设计委员会确认）:

| 选项 | 描述 | 优点 | 缺点 |
|---|---|---|---|
| A. Hook 返回 `scannerElement` | Hook 内维护状态，返回 JSX 元素供调用方渲染 | 封装完整，调用方零感知 | Hooks 返回 JSX 不是 React 惯例 |
| **B. Hook 返回 `isScannerOpen + scanner props`** | Hook 返回状态和 props，调用方自行渲染 `QRScannerScreen` | 符合 React 模式，灵活 | 调用方（account.tsx 等）需少量改动 |
| C. 状态上提至 Screen 层 | Screen 直接调用权限 + 渲染 Scanner | 最清晰 | 需修改 account.tsx 较多 |

**推荐选项 B**。

### 3.5 文件变更清单

| 文件 | 操作 | 说明 |
|---|---|---|
| `sources/components/qr/QRScannerScreen.tsx` | **新建** | vision-camera 封装组件 |
| `sources/hooks/useCheckCameraPermissions.ts` | **修改** | 移除 Android 快捷路径 |
| `sources/hooks/useConnectAccount.ts` | **修改** | 移除 expo-camera scanner，改用 QRScannerScreen |
| `sources/hooks/useConnectTerminal.ts` | **修改** | 同上 |
| `sources/app/(app)/settings/account.tsx` | **修改**（小） | 渲染 QRScannerScreen（若选方案 B） |

---

## 4. 边界情况与兼容性

### 4.1 iOS 兼容性

vision-camera 在 iOS 使用 AVFoundation，与 expo-camera 的 `isModernBarcodeScannerAvailable`（iOS 上通常为 `true`）并存不冲突。替换后 iOS 行为与现有一致，UI 呈现为全屏相机而非系统弹出层——**这是 iOS 上的 UX 变化**，需 QA 确认。

### 4.2 Android 有 GMS 设备

ML Kit Scanner 被完全替换。有 GMS 设备将使用 ZXing，功能完全等价，但：
1. 首次使用会弹出相机权限请求（现在不弹）
2. UI 从系统弹出层变为 App 内全屏相机

### 4.3 Expo Prebuild / EAS Build 配置

vision-camera 需要在 `app.json` / `app.config.ts` 中确认 plugin 已注册：
```json
{
  "plugins": ["react-native-vision-camera"]
}
```
若未注册，iOS 的 `NSCameraUsageDescription` 和 Android 的 `<uses-permission android:name="android.permission.CAMERA"/>` 不会自动注入。

**需确认**: 当前 `app.json` 中 vision-camera plugin 是否已配置。

---

## 5. 测试策略

### 5.1 设备矩阵

| 设备类型 | 测试重点 |
|---|---|
| Android 无 GMS（鸿蒙 / AOSP） | 主要修复验证：扫码窗口可打开，扫码成功 |
| Android 有 GMS | 回归：功能不退化，权限弹窗首次出现 |
| iOS | 回归：UI 变化可接受，功能正常 |

> **测试环境要求**：vision-camera 是 native module，**必须使用 EAS dev build 或 production build** 进行验证。Expo Go 不支持 native module，会直接 crash，不代表实现有误。

### 5.2 测试场景

1. **主路径**：链接新设备 → 扫描二维码 → 设备成功绑定
2. **主路径**：连接 Terminal → 扫描二维码 → Terminal 成功连接
3. **权限拒绝**：拒绝相机权限 → 显示正确错误提示
4. **二次扫码**：关闭扫码窗口后再次开启 → 正常工作（`scannedRef` 需在关闭时重置）
5. **扫描非 happy URL**：扫到其他二维码（微信登录码、支付码等）→ 静默忽略，不触发 processAuthUrl，不弹错误
6. **扫描错误 happy URL**：URL 以 `happy://` 开头但前缀不完整匹配 → 同上，静默忽略
7. **并发防护**：快速多次点击按钮 → 不重复打开扫码窗口
8. **重复帧触发**：摄像头持续对准同一 QR 码 → processAuthUrl 仅调用一次（scanned 锁验证）

---

## 6. 风险评估

| 风险 | 可能性 | 影响 | 缓解措施 |
|---|---|---|---|
| vision-camera 与 expo SDK 55 兼容性问题 | 低（v4.7.3 已在 deps） | 高 | 在 dev build 上验证后再提 PR |
| iOS UX 变化（系统弹窗 → 全屏相机）引发用户反馈 | 中 | 低 | Release Notes 说明；QA 确认体验可接受 |
| Android 有 GMS 用户首次弹出权限请求 | 高（必然发生） | 低 | Release Notes 说明；属预期行为变更 |
| `app.json` plugin 未配置导致 build 失败 | 中 | 高 | PR 中明确包含 app.json 变更 |

---

## 7. 待确认项（审核委员会）

1. **QRScannerScreen 接入方式**：✅ 已选定**选项 A**（hook 内维护 `isScannerOpen` 状态，返回 `scannerElement: React.ReactElement | null`，调用方只需在 JSX 中插入 `{scannerElement}` 一行）。理由：4 处调用方改动量相同，选 A 封装更彻底，无需各调用方单独 import `QRScannerScreen`。
2. **iOS UX 变更接受度**：从系统弹出扫码层改为 App 内全屏相机，产品侧是否接受？
3. **app.json vision-camera plugin** 当前状态：✅ 已在 `app.config.js` plugins 数组第 105 行配置，无需额外改动。
4. **`useCheckCameraPermissions` 的破坏性变更**是否需要单独版本说明或分阶段发布？
5. **iOS 权限时机**：当前 `checkScannerPermissions` 的调用链（`onPress → await checkScannerPermissions()`）是否满足 Apple 直接手势调用栈要求？实现前需在 iOS 设备上验证权限弹窗可正常弹出。

---

## 8. 实施记录

### 8.1 变更文件

| 文件 | 操作 | 关键变更说明 |
|---|---|---|
| `sources/components/qr/QRScannerScreen.tsx` | **新建** | vision-camera 全屏扫码组件，含 scanned 锁和 device-null guard |
| `sources/hooks/useCheckCameraPermissions.ts` | **修改** | 移除 Android 快捷路径，统一使用 `Camera.requestCameraPermission()` |
| `sources/hooks/useConnectAccount.ts` | **修改** | 移除 expo-camera imports/listener/launchScanner；新增 `isScannerOpen` 状态和 `scannerElement` 返回值 |
| `sources/hooks/useConnectTerminal.ts` | **修改** | 同上，urlPrefix 为 `happy://terminal?` |
| `sources/app/(app)/settings/account.tsx` | **修改** | 解构 `scannerElement`，在 JSX 根节点加 `{scannerElement}` |
| `sources/components/EmptyMainScreen.tsx` | **修改** | 同上 |
| `sources/components/SettingsView.tsx` | **修改** | 同上 |
| `sources/components/ConnectButton.tsx` | **修改** | 同上 |

### 8.2 单元测试

**文件**: `sources/components/qr/__tests__/qrScannerLogic.test.ts`  
**运行**: `pnpm test` (vitest)  
**覆盖**: 12 个测试用例，全绿

测试覆盖点：
- account prefix 精确匹配、转发
- terminal prefix 精确匹配、转发
- 跨场景 URL 投递到错误 handler → 忽略
- 非 happy URL（第三方 QR 码）→ 忽略
- 无 value 的 code → 忽略
- 多 code 数组取第一个匹配
- scanned 锁：多次触发只调用一次 onScanned
- scanned 锁：首次调用后 ref.current === true
- scanned 锁：预锁定状态下不触发
- scanned 锁：reset 后可二次触发（模拟关闭重开）

> 注：React 组件渲染和 vision-camera 原生集成需 EAS dev build，由 QA 手动验证（见 §5）。

---

## 附录：关键 URL 格式参考

| 场景 | URL 格式 | 生成方 |
|---|---|---|
| 链接新设备（账户关联） | `happy:///account?<base64url(publicKey)>` | 新设备（`restore/index.tsx` QR 码） |
| 连接 Terminal | `happy://terminal?<base64url(publicKey)>` | Terminal CLI（happy daemon） |
