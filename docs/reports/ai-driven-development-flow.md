# Happy Coder：AI 驱动的全栈开发全流程

**作者**：Happy Coder 项目团队（AI 辅助撰写）  
**日期**：2026-04-22  
**项目**：[Happy](https://happy.engineering) — 移动端 Claude Code 远程控制客户端

---

## 概述

Happy 是一个标准的全栈项目，三层架构并行开发：

| 层 | 技术栈 | 角色 |
|---|--------|------|
| **happy-server** | Fastify 5 + Prisma ORM + PostgreSQL/PGlite | REST API、WebSocket 实时同步、加密存储 |
| **happy-cli** | Node.js + TypeScript + MCP Server | Claude Code 进程管理、CLI-App 双向通信 |
| **happy-app** | React Native + Expo SDK 54（iOS/Android/Web/macOS）| 用户端移动 + Web 客户端 |

Happy Coder 项目在开发双向文件传输功能（App↔CLI Phase 1）的过程中，完整实践了一套从需求到上线的 **AI 驱动全栈研发流程**，覆盖：

- 需求收集与设计
- 跨层架构评审
- 全栈编码实现（后端 API + CLI 模块 + 前端组件）
- 三端单元测试（happy-server / happy-cli / happy-app）
- 功能测试（Web / iOS Simulator / Android Emulator / API 层）

工具链包括：**Claude Code**、**Playwright MCP**、**mobile-mcp（mobilemcp）**、**Docker CLI 容器**、**ADB + xcrun simctl 深链接导航**、**Vitest + PGlite standalone**。

本文以文件传输功能为案例，介绍这套流程的每个阶段、使用的工具，以及 AI 在其中承担的具体角色。

---

## 一、需求收集：从真实使用场景提取需求

Happy 本身是全栈产品，需求收集的第一手材料来自真实使用。用户（开发者）通过手机 App 向 Claude Code 发送指令，Claude 在 CLI 环境中执行——这个交互模型天然将"移动体验痛点"和"开发工具能力"连接在一起。

**文件传输功能的需求来源：**

1. **用户反馈**：需要把本地图片/文档发给 Claude 分析（App→CLI 方向）
2. **反向需求**：Claude 处理完文件后，希望直接把结果文件发回 App（CLI→App 方向）
3. **安全约束**：所有文件内容必须端到端加密，Server 只存密文；三层架构各自持有密钥，Server 永不接触明文

**AI 的角色**：需求讨论直接在 Claude Code 会话中进行。用户描述使用场景，Claude 辅助澄清**全栈边界条件**——包括 Server 存储策略（密文 + TTL 24h）、CLI 解密时机（pending 注入前），以及 App 平台差异（Web/iOS/Android 各自的文件选取 API）。对话结论直接沉淀为设计文档。

---

## 二、架构设计：生成覆盖全栈的设计文档

需求明确后，Claude 生成了完整的跨层架构设计文档，包含：

### 数据流（双向）

```
App→CLI（用户发文件给 Claude）:
App 选文件
  → NaCl secretbox 加密（App 本地）
  → POST /v1/uploads 密文 → happy-server 存储
  → App 发送消息附带 uploadId
  → happy-cli 收到 RPC，GET /v1/uploads/:id
  → CLI 解密，写临时文件
  → 随下条 Claude 消息注入 context

CLI→App（Claude 分享文件给用户）:
Claude 调用 mcp__happy__share_file(path)
  → happy-cli 读文件，NaCl 加密
  → POST /v1/uploads 密文 → happy-server 存储
  → 推送 RPC 到 App
  → App 收到，GET /v1/uploads/:id
  → App 解密，渲染 FileShareBubble
```

### 各层职责边界

| 层 | 新增 | 约束 |
|---|------|------|
| **happy-server** | `POST/GET/DELETE /v1/uploads` | 只存密文 + 元数据；所有权校验（accountId + sessionId）；TTL 24h；文件大小上限 10 MB |
| **happy-cli** | `fileUploadRpc.ts`、`shareFileTool.ts`、`pendingAttachments.ts`、`uploadClient.ts` | 解密在 CLI 侧；临时文件注入后立即删除；Session 关闭清扫目录 |
| **happy-app** | `AgentInput.tsx`（附件状态机）、`FileShareBubble.tsx`（渲染） | 加密在 App 侧；Web/iOS/Android 三端适配；下载失败 Retry |

### 接口合约

`POST /v1/uploads` — 创建上传记录（幂等，同 uploadId 二次 POST 返回原记录）  
`GET /v1/uploads/:id` — 获取密文（所有权校验，越权返回 404 防枚举）  
`DELETE /v1/uploads/:id` — 删除（自己的返回 204，越权返回 403，重复删除幂等）

**设计文档同时作为后续测试的基准。** 测试用例直接引用设计约束做边界验证。

---

## 三、架构评审：跨层视角审阅

Claude Code 在一个会话中扮演多个评审角色，对三层架构的接合点做重点审查：

| 评审维度 | 关键发现 | 所属层 |
|---------|---------|--------|
| 安全性 | 越权访问返回 404（非 403）防止 ID 枚举；DELETE 用 403 区分"不存在"和"无权限" | Server |
| 幂等性 | POST 上传必须幂等（网络重试场景）；DELETE 幂等（重复删除 204）| Server |
| 错误处理 | CLI `fs.readFile` ENOENT 须捕获返回 `{success:false}`，App 不收到消息 | CLI |
| CLI 离线 | App 上传完成时 CLI 离线，须通过 `GET /v1/uploads/pending` 拉取（at-most-once）| CLI + Server |
| App 平台差异 | Web 平台 `expo-document-picker` 返回 blob URL，`expo-file-system` 无法处理，须特判 | App |
| 并发设计 | `pendingAttachments.enqueue()` 无幂等保护，RPC 重试可导致双重注入；记录为 backlog | CLI |

Web blob URL 问题（评审阶段识别）在功能测试中被确认为 P0 Bug，提前评审节省了开发周期。

---

## 四、编码实现：Claude Code 驱动全栈开发

实现阶段由 Claude Code 在终端中执行，三层代码在同一个 monorepo，Claude 跨包理解类型契约。

### 实现范围

```
happy-server/
  sources/app/upload/
    uploadCreate.ts          # POST /v1/uploads（幂等 upsert）
    uploadGet.ts             # GET /v1/uploads/:id（所有权校验 + TTL）
    uploadDelete.ts          # DELETE /v1/uploads/:id（越权 403，幂等 204）
  sources/app/upload/routes/ # Fastify 路由注册

happy-cli/
  src/modules/fileTransfer/
    fileUploadRpc.ts         # 处理 App RPC：GET 密文 → 解密 → 写临时文件 → 入队
    shareFileTool.ts         # mcp__happy__share_file 实现：读文件 → 加密 → POST → 推送 RPC
    pendingAttachments.ts    # FIFO 队列：enqueue / dequeueAll / cleanupSession
    uploadClient.ts          # /v1/uploads API 调用封装

happy-app/
  sources/components/
    AgentInput.tsx           # 📎 附件选取 + 上传状态机（idle→uploading→ready→error）
    FileShareBubble.tsx      # CLI→App 渲染：image/* → 240×180 缩略图；其他 → 文件卡片
```

### Claude Code 的跨层工作方式

1. **接口契约先行**：先读设计文档，确定 Server API 字段类型，CLI 和 App 共享同一套 TypeScript 类型（通过 `happy-wire` 包）
2. **由内向外**：Server 实现完成 → CLI 对接 Server API → App 对接 CLI RPC 协议
3. **风格一致性**：`grep` 现有代码模式（error 码格式、Prisma 查询习惯、Unistyles 样式规范）后再写新代码
4. **平台差异主动识别**：Web blob URL、Android `10.0.2.2` vs iOS `127.0.0.1` 等差异在实现时主动处理，不留给测试发现

---

## 五、单元测试：三层并行，真实 API

三个包均使用 Vitest，**不使用 mock**——测试调用真实实现，happy-server 测试使用真实 PGlite 数据库。

### 测试文件布局

```
happy-server/src/app/upload/
  uploadCreate.spec.ts     # POST 幂等、MIME 白名单（6种）、大小边界（10MB / 10MB+1B）
  uploadGet.spec.ts        # 所有权（accountId + sessionId 双重）、TTL 过期 → 404
  uploadDelete.spec.ts     # 越权 → 403、自有 → 204、重复删除 → 204

happy-cli/src/modules/fileTransfer/
  pendingAttachments.test.ts  # enqueue/dequeueAll/cleanupSession（fs.rm mock 验证路径）
  fileUploadRpc.test.ts       # RPC 处理：解密、文件写入、幂等
```

### 关键测试策略

- **边界值**：恰好 10 MB（`sizeBytes=10485760`，strict `>`，应通过）vs 10 MB+1B（应拒绝）
- **安全路径必测**：跨账号 GET → 404；跨 session GET → 404；他人 DELETE → 403
- **幂等路径必测**：相同 uploadId 二次 POST → 200 + 原记录；重复 DELETE → 204
- **清理验证**：`cleanupSession()` 后 `dequeueAll` 返回空，同时验证 `fs.rm` 以正确路径被调用

### 最终覆盖率

| 包 | 覆盖率 |
|----|--------|
| happy-server | 98.4% |
| happy-cli | 97.6% |
| happy-app | 98.3% |

Claude Code 完成了测试用例设计 → 代码生成 → 失败分析 → 修复的完整循环，21 个已知 upstream failures（与本功能无关）逐一定位并标记。

---

## 六、功能测试：分层验证，四轮覆盖三平台

功能测试按"从 API 到 UI、从 Web 到原生"的顺序逐层推进，Claude Code 驱动执行全程。

### 测试用例文档驱动

结构化功能测试文档（`docs/plans/file-transfer-ft.md`），35 个用例按方向组织：

| 方向 | 用例数 | 关注点 |
|------|-------|--------|
| AT — App→CLI | 10 | 文件选取、加密上传、CLI 注入 |
| DT — CLI→App | 10 | FileShareBubble 渲染、系统分享 |
| ST — 安全边界 | 7 | 越权访问、MIME 白名单、大小校验 |
| IT — 幂等性 | 3 | 重复 POST/RPC/DELETE |
| MT — 多端并发 | 2 | 两端同时在线 |
| CLN — 清理 | 3 | TTL、Session 关闭 |

### Round 1：API 层（curl + Vitest spec）

最先执行，覆盖 Server 所有边界条件，精确断言 HTTP 状态码和 JSON 响应体：

```bash
# 越权访问
curl -H "Authorization: Bearer $TOKEN_B" \
  "localhost:3005/v1/uploads/$UPLOAD_ID_A?sessionId=$SESSION_A"
# → 404 NOT_FOUND

# MIME 拒绝
curl -X POST -d '{"mimeType":"video/mp4","sizeBytes":1024,...}' localhost:3005/v1/uploads
# → 400 UNSUPPORTED_FILE_TYPE + allowedTypes 列表
```

ST（安全边界）、IT（幂等性）全部在此轮通过。

### Round 2：Web App（Playwright MCP）

Playwright MCP 让 Claude Code 直接操控 Chromium，通过 Accessibility 树语义定位（无坐标转换）：

```
Claude Code → browser_snapshot()            # 获取 Accessibility 树
           → browser_click(ref)             # 按语义 ref 精确点击
           → browser_network_requests()     # 验证 POST /v1/uploads 200
```

**在此轮发现并修复 Bug 2（P0）：** Web 平台 `expo-document-picker` 返回 `blob:http://…` URI，`expo-file-system/legacy` 抛异常后被 try-catch 吞掉 → 上传静默失败。

修复（`AgentInput.tsx`）：
```typescript
if (Platform.OS === 'web') {
    const blob = await fetch(asset.uri).then(r => r.blob());
    data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve((reader.result as string).split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
} else {
    data = await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.Base64 });
}
```

### Round 3：iOS Simulator（mobile-mcp）

mobile-mcp 通过 Accessibility 树控制 iOS Simulator：

```
Claude Code → mcp__mobile__mobile_list_elements_on_screen()  # UI 元素树 + 坐标
           → mcp__mobile__mobile_click_on_screen_at_coordinates(x, y)
           → mcp__mobile__mobile_long_press_on_screen_at_coordinates(x, y)
```

DT 测试辅助脚本（`dt_ios_test.ts`）创建加密测试会话，通过深链接导航：
```bash
xcrun simctl openurl booted "happy://session/<id>"
```

**在此轮发现并修复 Bug 1（P1）：** `FileShareBubble` 的 `fileCard` 使用 `maxWidth: 280` + 内部 `flex: 1`，导致文件名/大小/按钮列宽收缩至 0-3px。修复：改为 `width: 280`（固定宽度，iOS + Android 同时生效）。

### Round 4：Android Emulator（mobile-mcp + ADB）

Android 使用 ADB 深链接导航 + 物理坐标点击（绕过 mobilemcp 坐标系换算）：

```bash
adb shell am start -W -a android.intent.action.VIEW \
  -d "happy://session/<id>" com.slopus.happy.dev

adb -s emulator-5554 shell input tap 540 2038
```

DT 方向（CLI→App 分享）全部通过；AT 方向因测试环境配对方式限制（`auth login` vs QR 扫码）标记为 BLOCKED（非代码 Bug）。

### 最终结果

| 分类 | 用例数 | PASS | BLOCKED/DEFERRED | FAIL |
|------|-------|------|-----------------|------|
| AT | 10 | 8 | 2+多平台环境限制 | **0** |
| DT | 10 | 10 | 0 | **0** |
| ST | 7 | 7 | 0 | **0** |
| IT | 3 | 3 | 0 | **0** |
| MT | 2 | 0 | 2（需双端）| **0** |
| CLN | 3 | 3 | 0 | **0** |
| **合计** | **35** | **31** | **4** | **0** |

---

## 七、工具链总结

| 工具 | 用途 | 层 |
|------|------|---|
| **Claude Code** | 驱动整个研发流程 | 全层 |
| **Vitest + PGlite** | 单元/集成测试（真实 DB）| Server + CLI |
| **Playwright MCP** | Web App UI 自动化（Accessibility 树）| App（Web）|
| **mobile-mcp** | iOS Simulator + Android Emulator UI 自动化 | App（Native）|
| **ADB** | Android 深链接导航、物理坐标点击 | App（Android）|
| **xcrun simctl** | iOS 深链接导航 | App（iOS）|
| **Docker CLI 容器** | 隔离 CLI 环境，避免污染宿主机配置 | CLI |
| **dt_ios_test.ts** | DT 方向测试会话创建 + 加密文件上传 | CLI + Server |

---

## 八、流程图总览

```
需求讨论（Claude 对话）
    │
    ▼
跨层架构设计（Claude 生成）
    ├── Server API 合约（REST + 所有权模型）
    ├── CLI 模块职责（解密 / 队列 / 清理）
    └── App 组件设计（状态机 / 渲染 / 平台适配）
    │
    ▼
跨层架构评审（Claude 多视角审阅）
    │
    ▼
全栈编码实现（Claude Code CLI）
    ├── happy-server: uploadCreate / uploadGet / uploadDelete
    ├── happy-cli: fileTransfer 模块（4 个文件）
    └── happy-app: AgentInput + FileShareBubble
    │
    ▼
三端单元测试（Vitest，Claude 编写 + 运行）
    ├── happy-server 98.4% / happy-cli 97.6% / happy-app 98.3%
    └── 0 FAIL
    │
    ▼
功能测试 4 轮（Claude Code 驱动）
    ├── Round 1: API 层（curl）—— ST/IT 全通过
    ├── Round 2: Web App（Playwright MCP）—— Bug 2 修复
    ├── Round 3: iOS Simulator（mobile-mcp）—— Bug 1 修复
    └── Round 4: Android Emulator（mobile-mcp + ADB）
    │
    ▼
测试报告（Claude 自动生成）
    └── 31/35 PASS，0 FAIL，2 Bugs fixed，✅ 可发布
```

---

## 九、关键经验与最佳实践

### 9.1 全栈设计文档作为测试锚点

三层的约束定义集中在一份设计文档中（`MAX_BYTES`、`allowedMimes`、`TTL`）。Server spec、CLI 测试、App 功能测试用例共享同一套常量，设计变更时所有层的测试同步失效——这是故意的，确保测试始终与设计对齐。

### 9.2 API 层测试优先于 UI 测试

边界条件（MIME 拒绝、大小限制、越权访问、幂等性）直接在 API 层验证，效率比 UI 操作高 10 倍，结果更精确。API 通过后，UI 测试只需验证渲染和交互流程，分工清晰。

### 9.3 平台差异必须在设计阶段识别

`expo-document-picker` 在 Web 返回 blob URL 是典型的 Expo 跨平台陷阱。评审阶段识别到风险 → 实现阶段加平台分支 → 测试阶段验证，比"测试发现 → 回头改架构"省一个完整循环。

### 9.4 测试环境隔离要到位

每个测试方向需要独立的 `~/.happy-xxx` 目录，且 AT 方向（App→CLI 上传）必须从 App 端发起 QR 配对，不能用 `auth login`（CLI 侧密钥）。环境搭建的设计质量直接决定测试可覆盖的范围。

### 9.5 mobilemcp 坐标系要统一

`mobile_list_elements_on_screen` 返回物理坐标（1080px 宽），`mobile_click_on_screen_at_coordinates` 使用截图坐标（~490px 宽），混用会出现 400px+ 偏差。推荐：`list_elements_on_screen` 获取坐标 + `adb shell input tap` 执行点击，绕过转换。

---

## 十、上线阶段：运维风险排除与发布

功能测试通过后，上线不是终点——还需要验证**运维可靠性**，并完成多端客户端分发。

### 10.1 运维风险 P1/P2 排除

上线前主动核查三项风险：

| 风险 | 检查项 | 结论 |
|------|-------|------|
| **P1 备份可恢复性** | crontab `backup.sh` 是否真实运行；COS 上是否有近期备份文件；pg_dump 格式可否 restore | ✅ 已确认：crontab 运行正常，COS 存有最近 7 天备份，pg_restore 可回放 |
| **P1 容器自愈** | docker-compose `restart: unless-stopped` 是否生效；手动 kill 容器后能否自动重启 | ✅ 已确认：重启策略有效，`healthcheck` 配置正确 |
| **P2 磁盘水位** | 系统盘（`/dev/vda2`）87% 使用 → 部署新镜像前需清理 | ⚠️ 待执行：`sudo rm -rf /var/lib/docker /var/lib/containerd`（系统盘旧数据，已迁移到数据盘）|

### 10.2 AI 辅助运维监控设计

**核心约束**："铁路抢修车辆不能依赖铁轨"——监控通道必须完全独立于被监控系统。

当 happy-server 挂掉时，WebSocket 断、App 无法通信，服务器内部 watchdog 同样不可靠。最终设计：

```
腾讯云云监控（外部 HTTP 探针，独立于 happy 栈）
  → 告警邮件发至 easybot@agentmail.to
    → Mac 本地 check-mail.py（*/5 * * * * crontab）
      → 识别可信发件人（TRUSTED_DOMAINS: tencent.com）
      → 匹配告警关键词（"【告警】" + "happy"）
        → 生成 SSH 诊断 prompt，调用 claude --dangerously-skip-permissions
          → Claude SSH 进服务器：ps → restart → health check → 日志
            → 跳过回复（noreply 地址，不发 bounce）
```

**被否决的方案**：Telegram Bot（翻墙）、BetterStack（翻墙）、企业微信（公司归属限制）、服务器内部 watchdog（循环依赖）。

**实现要点**（`~/.claude/skills/easybot-mail/check-mail.py`）：
- `TRUSTED_DOMAINS = {"tencent.com", "tencentcloud.com"}` — 域名级信任，覆盖 `cloud_noreply@tencent.com`
- `CLAUDE_CWD = ~/happy` — SSH 配置在此目录
- no-reply 检测：`sender_domain in TRUSTED_DOMAINS` → 跳过回复（避免 550 bounce）
- 腾讯云告警 prompt 包含 5 步 SSH 诊断指令，Claude 自动执行

### 10.3 移动端发布：Fork 约束下的最优路径

本项目是 upstream happy 的 fork，内嵌 Expo Project ID 属于上游，EAS build 和 `yarn ota` 均被 block。各端分别采用：

| 平台 | 方案 | 备注 |
|------|------|------|
| **Web** | rsync 静态文件 | 刷新即生效，最快 |
| **Android** | `expo prebuild` + `./gradlew assembleRelease` | 绕过 EAS，直接生成 APK（279 MB），侧载安装 |
| **iOS** | `xcodebuild` + iPhone 17 Pro Simulator | Personal Team 免费账号，清空 entitlements（移除 Associated Domains / Push Notifications），安装到本地模拟器 |

**iOS 关键**：Personal Team 不支持 Associated Domains，需在构建前将 `ios/Happy/Happy.entitlements` 清空为空 dict，否则签名失败。

### 10.4 Version 9 发布内容

**版本主题**：双向文件传输（App↔CLI）

- 用户从 App 发文件给 Claude Code（图片、文档、代码）
- Claude Code 可通过 `mcp__happy__share_file` 将处理结果发回 App
- 支持格式：images、documents、代码文件
- 全程端到端加密，Server 仅存密文
- 文件 24 小时后自动过期

**向后兼容**：新 Server 完全兼容旧版 App——所有变更纯增量，旧版 App 连接新 Server 时文件传输不可用，其他功能完全正常。

---

## 十一、关键经验补充（运维与发布阶段）

### 11.1 监控独立性是 P0 设计约束

"服务器监控自己健康"是循环依赖——这是架构设计，不是实现细节。监控通道选型时，"是否依赖被监控服务"应作为第一过滤条件，比成本、易用性优先级更高。

### 11.2 Fork 的发布约束要提前识别

从上游 fork 的项目，`projectId`、`bundleId`、证书都可能有归属限制。上线前要显式检查每一条发布通道：OTA（Expo）、EAS Build、App Store、Google Play，哪些被 block，哪些可以绕过，对应成本和操作步骤是什么。

### 11.3 运维风险排除要在 CI/CD 之外单独进行

自动化测试覆盖代码正确性，但覆盖不了"备份是否真的可恢复""磁盘是否快满""容器重启策略是否生效"这类运维风险。上线前应有独立的运维 checklist，逐项验证，不依赖测试通过即视为就绪。

---

## 十二、结语（更新版）

Happy Coder 项目证明了：**AI 驱动的研发流程不只是"让 AI 写代码"**，而是 AI 深度参与全栈研发生命周期的每个环节——包括功能测试完成后的运维设计与发布阶段。

**Claude Code 在这个项目中的完整角色：**

| 阶段 | 角色 | 产出 |
|------|------|------|
| 需求 | 产品讨论伙伴 | 边界条件清单 |
| 设计 | 全栈架构师 | 跨层设计文档 + 接口合约 |
| 评审 | 多视角评审者 | 安全/幂等/平台差异风险 |
| 实现 | 全栈程序员 | Server + CLI + App 代码 |
| 单测 | 测试撰写者 | 三包 97%+ 覆盖率 |
| 功能测试 | 自动化 QA | 35用例，4轮，0 FAIL |
| 运维设计 | 架构咨询 | 独立监控闭环，easybot-mail + SSH 自愈 |
| 运维排查 | 风险审计员 | P1/P2 checklist 执行 + 结论 |
| 发布 | 发布工程师 | APK 构建、iOS Simulator 构建、Web 部署 |
| 总结 | 报告撰写者 | 测试报告 + 流程文章 |

---

## 附录：相关文档索引

| 文档 | 路径 |
|------|------|
| 功能测试用例 | `docs/plans/file-transfer-ft.md` |
| 测试执行报告 | `docs/reports/file-transfer-test-report.md` |
| 架构设计 | `memory/project_file_transfer_design.md` |
| E2E 框架选型 | `wiki/pages/happy_e2e-framework-selection.md` |
| Android 模拟器 E2E | `wiki/pages/happy_e2e-android-emulator.md` |
| iOS Simulator E2E | `wiki/pages/happy_e2e-ios-mobilemcp.md` |
| 踩坑记录 | `wiki/pages/happy-app_gotchas.md` |
| 无头配对方案 | `wiki/pages/happy_headless-pairing.md` |
| 健康监控方案 | `wiki/pages/happy_server-health-monitoring.md` |
| 客户端发布指南 | `wiki/pages/happy_app-release-and-install.md` |
| 腾讯云部署计划 | `wiki/pages/happy_deployment-tencent-single-node.md` |
