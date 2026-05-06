# 附件 UX 改进功能测试用例

**功能**：附件预览内嵌输入框 / ready 状态自动隐藏 / Office 格式支持  
**分支**：`happy-family`  
**对应 TODO**：TODO1、TODO2、TODO3  
**文档日期**：2026-04-27  

---

## 一、测试范围

| 编号前缀 | 功能域 |
|----------|--------|
| UI — | 附件预览渲染位置（TODO1） |
| LC — | ready 状态附件卡片生命周期（TODO2） |
| OF — | Office 格式文件上传（TODO3） |
| BD — | 边界条件与安全校验 |

**测试平台**：Web App（localhost:8081）、iOS Simulator、Android Emulator

---

## 二、测试用例

### UI — 附件预览渲染位置（TODO1）

#### UI-01 上传中：预览卡片在输入框内部显示

| 项目 | 内容 |
|------|------|
| 前提 | 已登录，session 活跃，CLI 在线 |
| 操作 | 点击 attach 按钮 → 选择一个文件（选大文件以使上传时间延长）|
| 预期 | 进度卡片（文件名 + 大小 + 进度条）出现在输入框**内部**顶部，输入框高度被撑高；输入框外部**没有**独立卡片 |
| 验证点 | 进度卡片与文字输入区之间有细分隔线 |

#### UI-02 上传中：进度条正常更新

| 项目 | 内容 |
|------|------|
| 前提 | UI-01 进行中 |
| 操作 | 观察进度条 |
| 预期 | 进度条从 0% 向 100% 推进，文件名和大小始终正确显示 |

#### UI-03 error 状态：卡片仍在输入框内显示错误

| 项目 | 内容 |
|------|------|
| 前提 | 模拟上传失败（断网或 CLI 离线）|
| 操作 | 选取文件后立即断开网络 |
| 预期 | 卡片在输入框内部显示红色错误提示 + Retry 按钮 + × 取消按钮 |

#### UI-04 输入框在有附件时可以正常输入文字

| 项目 | 内容 |
|------|------|
| 前提 | 任意上传状态（uploading 或 error）|
| 操作 | 在输入框中输入文字 |
| 预期 | 文字输入正常，不受卡片遮挡；输入框继续跟随内容高度增长 |

---

### LC — ready 状态附件卡片生命周期（TODO2）

#### LC-01 上传完成后卡片自动消失

| 项目 | 内容 |
|------|------|
| 前提 | UI-01 执行完毕（文件上传成功）|
| 操作 | 等待上传完成 |
| 预期 | 进度卡片消失，输入框恢复最小高度；attach 按钮图标变为高亮色（primary color） |

#### LC-02 ready 状态下 attach 按钮高亮，点击可取消

| 项目 | 内容 |
|------|------|
| 前提 | LC-01 完成（已有 ready 附件）|
| 操作 | 点击 attach 按钮（高亮状态）|
| 预期 | 附件被取消（`onAttachmentReady(null)` 已调用），attach 按钮恢复默认颜色，`pendingAttachment` 清空；**不**弹出文件选择 overlay |

#### LC-03 ready 状态附件随消息一起发送后消失

| 项目 | 内容 |
|------|------|
| 前提 | 有 ready 状态附件 |
| 操作 | 在输入框输入文字，点击发送 |
| 预期 | 消息发送成功，attach 按钮恢复默认色，输入框回到最小高度，没有残留附件状态 |

#### LC-04 无附件时 attach 按钮点击弹出 overlay（正常流程不受影响）

| 项目 | 内容 |
|------|------|
| 前提 | 没有 pending 附件 |
| 操作 | 点击 attach 按钮 |
| 预期 | 弹出文件选择 overlay（Photos / Files 两项）|

#### LC-05 上传中取消（点 × 按钮）

| 项目 | 内容 |
|------|------|
| 前提 | 文件正在上传（uploading 状态）|
| 操作 | 点击进度卡片上的 × 按钮 |
| 预期 | 卡片消失，上传终止，`cancelUpload` 被调用，attach 按钮恢复默认色 |

---

### OF — Office 格式文件上传（TODO3）

#### OF-01 上传 .docx（Word OOXML）

| 项目 | 内容 |
|------|------|
| 前提 | 设备上有一个 .docx 文件 |
| 操作 | attach → Files → 选择 .docx |
| 预期 | 文件出现在文件选择器中（未被过滤）；选中后上传流程正常启动；服务端返回 200 |

#### OF-02 上传 .xlsx（Excel OOXML）

| 操作 | 选择一个 .xlsx 文件 |
|------|------|
| 预期 | 同 OF-01 |

#### OF-03 上传 .pptx（PowerPoint OOXML）

| 操作 | 选择一个 .pptx 文件 |
|------|------|
| 预期 | 同 OF-01 |

#### OF-04 上传 .doc（Word 97-2003）

| 操作 | 选择一个 .doc 文件 |
|------|------|
| 预期 | 同 OF-01 |

#### OF-05 上传 .xls（Excel 97-2003）

| 操作 | 选择一个 .xls 文件 |
|------|------|
| 预期 | 同 OF-01 |

#### OF-06 上传 .ppt（PowerPoint 97-2003）

| 操作 | 选择一个 .ppt 文件 |
|------|------|
| 预期 | 同 OF-01 |

#### OF-07 文件选择 overlay 标签文案已更新

| 操作 | 打开 attach overlay，观察第二项描述 |
|------|------|
| 预期 | 标签文案包含 "Word, Excel, PowerPoint"（各语言版本均已更新） |

#### OF-08 Office 文件发送后 CLI 收到正确 mimeType

| 前提 | OF-01 完成（.docx 文件 ready）|
|------|------|
| 操作 | 输入消息，发送 |
| 预期 | CLI 收到 attachment metadata，`mimeType` 为 `application/vnd.openxmlformats-officedocument.wordprocessingml.document` |

---

### BD — 边界条件与安全校验

#### BD-01 服务端拒绝不在白名单的 MIME type

| 操作 | 直接 POST /v1/uploads，mimeType = `application/zip` |
|------|------|
| 预期 | 返回 HTTP 400，body `{ error: 'UNSUPPORTED_FILE_TYPE', allowedTypes: [...] }`，`allowedTypes` 包含全部 12 种类型 |

#### BD-02 文件大小超限（> 10 MB）

| 操作 | 尝试上传一个 11 MB 的 .docx |
|------|------|
| 预期 | 服务端返回 400 FILE_TOO_LARGE；App 侧展示 error 状态卡片 |

#### BD-03 simultaneous attach 按钮防重

| 操作 | 文件上传途中（uploading）再次点击 attach 按钮 |
|------|------|
| 预期 | attach 按钮处于 disabled 状态（opacity 降低），不触发第二次选择 |

#### BD-04 旧格式（PDF / TXT）上传不受影响

| 操作 | 上传 .pdf 和 .txt 各一次 |
|------|------|
| 预期 | 全程正常，行为与改动前一致 |

---

## 三、测试执行矩阵

| 用例 | Web | iOS | Android | 优先级 |
|------|-----|-----|---------|--------|
| UI-01 | ☐ | ☐ | ☐ | P0 |
| UI-02 | ☐ | ☐ | ☐ | P1 |
| UI-03 | ☐ | ☐ | ☐ | P1 |
| UI-04 | ☐ | ☐ | ☐ | P1 |
| LC-01 | ☐ | ☐ | ☐ | P0 |
| LC-02 | ☐ | ☐ | ☐ | P0 |
| LC-03 | ☐ | ☐ | ☐ | P0 |
| LC-04 | ☐ | ☐ | ☐ | P0 |
| LC-05 | ☐ | ☐ | ☐ | P1 |
| OF-01 | ☐ | ☐ | ☐ | P0 |
| OF-02 | ☐ | ☐ | ☐ | P0 |
| OF-03 | ☐ | ☐ | ☐ | P0 |
| OF-04 | ☐ | ☐ | ☐ | P1 |
| OF-05 | ☐ | ☐ | ☐ | P1 |
| OF-06 | ☐ | ☐ | ☐ | P1 |
| OF-07 | ☐ | —  | —  | P1 |
| OF-08 | ☐ | ☐ | ☐ | P1 |
| BD-01 | ☐ | —  | —  | P0 |
| BD-02 | ☐ | ☐ | ☐ | P1 |
| BD-03 | ☐ | ☐ | ☐ | P1 |
| BD-04 | ☐ | ☐ | ☐ | P0 |

**图例**：☐ 待执行 ✅ PASS ❌ FAIL — 不适用此平台

---

## 四、自动化单元测试覆盖

| 测试文件 | 覆盖内容 |
|----------|----------|
| `sources/components/AttachmentPreviewBar.test.ts` | `formatBytes` 全区间；`AttachmentState` 三种 status 的字段约束 |
| `sources/app/api/routes/uploadsRoutes.spec.ts` | MIME 白名单：12 种允许类型全测；8 种拒绝类型；响应体结构 |
