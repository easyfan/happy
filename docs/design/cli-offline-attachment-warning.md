# CLI 离线附件警告 (AT-10)

## 背景

用户在 session 中附加文件时，若所在机器的 CLI daemon 已离线，文件仍能上传到 server（加密存储），但 CLI 无法立即处理。需在附件预览卡片上显示警告，告知用户文件已保存、CLI 重连后自动发送。

## 数据流

```
server timeout
  → machine.active = false
    → WebSocket 推送 update-machine
      → Zustand store applyMachines()
        → useMachine(machineId).active = false
          → isMachineOnline() = false
            → cliOfflineWarning = t('fileShare.deviceOfflineWarning')
              → AgentInput prop
                → AttachmentPreviewBar（status === 'ready' 时渲染）
```

## 实现

### machineUtils.ts（已有）
```typescript
export function isMachineOnline(machine: Machine): boolean {
    return machine.active;
}
```

### SessionView.tsx（新增）
```typescript
import { useMachine } from '@/sync/storage';
import { isMachineOnline } from '@/utils/machineUtils';

const sessionMachine = useMachine(machineId ?? '');
const cliOfflineWarning = sessionMachine && !isMachineOnline(sessionMachine)
    ? t('fileShare.deviceOfflineWarning')
    : undefined;

// 传入 AgentInput
<AgentInput
    ...
    cliOfflineWarning={cliOfflineWarning}
/>
```

### AgentInput.tsx（新增 prop + 透传）
```typescript
interface AgentInputProps {
    ...
    /** Warning shown on the attachment preview bar when the CLI machine is offline */
    cliOfflineWarning?: string;
}

// 透传给 AttachmentPreviewBar，仅在 ready 状态显示
<AttachmentPreviewBar
    attachment={attachmentState}
    cliOfflineWarning={attachmentState.status === 'ready' ? props.cliOfflineWarning : undefined}
/>
```

### AttachmentPreviewBar.tsx（已有，无需修改）
```typescript
type AttachmentPreviewBarProps = {
    attachment: AttachmentState;
    cliOfflineWarning?: string;  // 已预留
};
// 已有渲染逻辑：
{cliOfflineWarning && (
    <Text style={[styles.warningText, { color: theme.colors.textSecondary }]}>
        {cliOfflineWarning}
    </Text>
)}
```

## i18n

`fileShare.deviceOfflineWarning` 已在所有 10 种语言中定义（含中文简繁体、英语等）。

## 设计决策

- **仅在 ready 状态显示**：uploading/error 状态有自己的 UI（进度条、错误+重试），警告只在用户准备发送时才有意义
- **不阻断发送**：警告为提示性文字，用户仍可发送消息（文件会在 CLI 重连后自动处理）
- **响应式**：`useMachine` 订阅 Zustand store，CLI 重连后 `machine.active` 变为 true，警告自动消失

## 测试

### UT（AttachmentPreviewBar.test.ts）
- `isMachineOnline`：active=true → online，active=false → offline（2 cases）
- `deriveCliOfflineWarning`：null 机器/在线/离线各场景（4 cases）
- ready/uploading/error 状态的警告过滤逻辑（1 case）
- 在线→离线转换（1 case）

### 功能测试（AT-10a/b）
- AT-10a：在线时附件无警告 ✅
- AT-10b：离线时 ready 状态显示"设备离线。文件已保存，CLI 重新连接后将自动发送。" ✅
