# release/iteration-27-2026-06-05

技术债务专项：测试覆盖修复 + 服务器合规整改。

- 修复：parseMarkdownBlock.test.ts 期望格式更新，5/5 测试恢复 PASS
- 修复：machinesRoutes.ts 数据库操作合规（inTx 包裹、privacyKit 编码、afterTx 事件发送）

# release/iteration-26-2026-06-05

Upstream Batch 5.5A：9 个上游提交合并 + reducer 修复 + E2E 基础设施整固。

- 合并 9 个 upstream commits（CLI、App、Server、Infra 四域）
- 修复：reducer localId 断链导致的消息循环回溯问题
- 修复：Dockerfile.happy-cli-test 缺少 scripts/ 目录拷贝
- 修复：QA Loop 机制双重保障（qa-gatekeeper + Phase 6.5 规则）
- 修复：E2E 容器变更感知三层防护（release 流程 + CI 强制退出 + 逃逸拦截）

# release/iteration-24-2026-06-04

App 性能专项 + Upstream Batch 5.4：工具调用折叠 UI + 更高输入框。

- 合并 Upstream Batch 5.4（6 个 commits）：工具调用结果折叠展示、更高聊天输入框
- 验证：fetchSessions 并行解密（IT13）在 iOS 上最终生效确认
- 验证：多设备 agentState 同步（IT21）三端覆盖补测通过

# release/iteration-23-2026-06-02

配置同步 + Upstream Batch 5.0：多设备 permission mode 与 model 配置跨端同步。

- 新增：sessions 表存储 permissionMode/modelMode，设备 A 改配置后设备 B 重连自动同步
- 新增 API：PATCH /v1/sessions/:id 写入配置
- 合并 Upstream Batch 5.0：新机器实时更新修复 + Codex permission-mode 完整链路
- 诊断打点：fetchSessions 分段耗时日志，追踪 iOS 冷启动性能

# release/iteration-22-2026-06-02

技术调研迭代：BUG-21/22 根因分析 + Upstream Batch 5 候选扫描。

- 调研：iOS 冷启动真实瓶颈 profiling（fetchSessions 路径）
- 调研：多设备配置同步方案架构评估（Path 1 vs Path 2）
- 扫描：上游 30 个开放 PR 筛选，确认 Batch 5.0 合并候选

# release/iteration-21-2026-06-01

Resume 健壮性 + 多端 agentState 脏写修复。

- 修复：Resume switch 缺少 default 分支导致静默失败，补充 10 种语言翻译
- 修复：CLI shutdown hook 退出前发送 idle 状态，server 侧 TTL 自动清理 agentState
- 修复：App decryptAgentState 返回 null 时的 UI null 状态显示

# release/iteration-19-2026-05-31

Upstream Batch 4：CLI stdin 稳定性 + App sync 健壮性。

- 修复：CLI 信号转发——孤儿进程 ctrl+c 无效问题（forward signals to native binary）
- 修复：CLI stdin 三件套——remote→local 切换时 drain stdin、保持 raw mode、强制 blocking
- 修复：App sync 空白屏幕机器同步卡死
- 修复：App 等待 session sync 完成后再丢弃排队消息

# release/iteration-18-2026-05-29

Upstream Batch 3：CLI socket 重连 + App 紧凑会话状态指示器。

- 修复：CLI socket 断线后 connect_error 触发智能重连（startSmartReconnect）
- 优化：App 会话列表状态指示器重构为 renderLeadingIndicator 函数，渲染更紧凑

# release/iteration-17-2026-05-29

自动化收口：Phase 6.5 强制门 + Dockerfile 精确 hash 追踪。

- 新增：Phase 6.5 进入前 NATIVE_BUILD_REQUIRED 强制确认门（拦截物料缺失导致的 QA 失败）
- 升级：Dockerfile.happy-cli-test 嵌入 git.hash LABEL，E2E 容器版本校验从 warning 升级为精确 hash 硬阻塞

# release/iteration-16-2026-05-28

物料、制品、环境自动化：消除三类 DEFERRED 根因。

- 新增：QA Gatekeeper Step 0 制品新鲜度 + 环境状态前置验证
- 新增：E2E 容器变更感知 CI job（cli/server/wire 有变更则强制重建）
- 新增：Phase 5 末尾强制触发 native build，不等 QA 发现物料缺失

# release/iteration-15-2026-05-28

全量发版测试：7 条发布渠道全部验证通过。

- 发布：CLI v1.1.8 宿主机 + happy-family 容器 daemon 更新
- 发布：E2E 容器重建 + Web 部署（app.easyfan.info）+ Server 生产部署
- 发布：iOS TestFlight build 36（1.7.0）+ Android production keystore 签名 APK（275MB）
- 安全：修复 fastlane 摘要日志中密码泄露问题

# release/iteration-14-2026-05-28

Native Build 基础设施：Android keystore + fastlane iOS/Android 双端自动化。

- 新增：Android production keystore（4096-bit，~/.handy/happy-release.keystore）
- 新增：withAndroidSigning config plugin 自动注入签名配置
- 新增：fastlane match iOS 证书初始化（Apple Distribution ALJ346ZR7M）
- 新增：fastlane Fastfile iOS release + Android build 双端 lanes
- 发布：iOS TestFlight 1.7.0 (build 35) + Android production APK 1.7.0

# release/iteration-13-2026-05-27

iOS 冷启动性能修复：fetchSessions 串行解密改为并行化。

- 优化：fetchSessions 从串行逐个解密改为 Promise.allSettled 并行执行，iOS 冷启动显著提速
- 修复：withTargetName iOS config plugin，解决 HelloWorld 应用名遗留问题
- 发布：iOS TestFlight 1.7.0 (build 34)

# release/iteration-12-2026-05-26

Upstream Batch 2 E2E 补测：容器重建 + TC-006 全量验证通过。

- 修复：E2E 容器重建（含 Batch 2 代码），Dockerfile.happy-cli-test 新增 happy-server + prisma generate
- 验证：TC-006 PASS（HTTP 200，38 次 migration 成功应用）

# release/iteration-10-2026-05-23

CI 物料自动化 + E2E 环境稳定性 + Android 认证自动化。

- 新增：CI 物料新鲜度守卫 workflow（material-freshness.yml）
- 新增：E2E 环境稳定性加固（agent rules 层，双容器隔离 + rebuild SOP）
- 新增：Android deep link QR 配对自动化（adb am start happy:// scheme）
- 修复：happy-wire dist 纳入 git 追踪，消除 APK 物料过期阻塞 E2E 根因

# release/iteration-9-2026-05-21

Upstream Batch 1 + 导航竞态修复 + Docker 健康检查。

- 合并 6 个 upstream bug fix（CLI JSONL 重放竞态、permission 孤儿清除、skill prompt 屏蔽、cross-spawn、webappUrl 持久化；Server 删除 per-message push）
- 修复：machine 页面导航竞态（router.replace 原子操作）
- 新增：Docker HEALTHCHECK + 生产监控脚本，容器健康状态实时可见

# release/iteration-7-2026-05-13

Bug 修复 + 安全加固：导航回归 + 品牌清理 + 路径穿越防御。

- 修复：Start New Session 后发送第一条消息不再跳回旧 session（router.replace 原子操作）
- 修复：Settings 页面品牌残留清理（slopus→easyfan，隐藏法律链接，移除 Codex 引用）
- 安全：fileUploadRpc 文件上传路径穿越防御（path.basename 截断）
- 文档：Session Fork 合并门控章节写入 upstream-deps.md

# release/iteration-6-2026-05-13

技术债专题 Phase 1：Upstream 深度分析 + Claude Code SDK 内部机制研究。

- 产出：docs/upstream-deps.md（80+ 未合并 upstream commits 分析、安全修复清单、升级风险矩阵）
- 产出：docs/claude-code-sdk-internals.md（permission hook / PTY-SDK 双模式 / session 生命周期 / MCP tool 注册）

# release/iteration-5-2026-05-11

Push Notification 链路补齐 + 多项质量修复。

- 修复：iOS Push Notification——cherry-pick upstream push 模块（pushSend/pushDispatch/focusTracker）
- 修复：切换 session 时 draft 附件不再被错误保留到新 session
- 修复：ImagePicker 废弃 API 替换（MediaTypeOptions → MediaType）
- 修复：移除不存在的 dev/masked-progress 路由注册

# release/iteration-4-2026-05-10

Webapp 稳定性 + 附件能力扩展：退避机制 + zip/tar/gz 支持。

- 修复：Session not found 无退避轮询（syncBackoff shouldStop 机制）
- 修复：downloadUpload 404 无限重试 React render loop（failedUploadIds 永久失败缓存）
- 新增：上传附件支持 .zip、.tar、.gz 压缩包格式
- 新增：Fork lock file CI 校验（防止 happy-wire dist 过期）

# release/iteration-3-2026-05-08

品牌拨正 + 质量补齐：OTA 品牌替换 + 三项遗留测试修复。

- 修复：App 品牌资源全量替换（slopus→easyfan，关联域名、图标、应用名）
- 新增：PermissionFooter.test.tsx（TC-04/05/06 vitest 覆盖）
- 修复：happy-server vitest 运行环境（pnpm hoisting / Node 兼容性）
- 修复：Link New Device QR code 现在正确内嵌 server URL，无需用户手动配置
- 新增：translations.spec.ts 翻译完整性测试

# release/iteration-2-prime-2026-05-08

稳定性修复：JSON.parse 防御 + WebSocket 事务合规。

- 修复：CLI decryptLegacy 和 App 批量解密中 JSON.parse 缺少 try-catch 导致的崩溃
- 修复：WebSocket handler 缺少 inTx 包裹和 Zod 输入校验
- 修复：Permission response loop + Archive 操作失败静默问题

# v1.7.0-iteration-1

基础设施建立：账户恢复修复 + OTA 迁移 + Web permission zombie 修复。

- 修复：Restore Account 后旧 sync 状态残留（login 前先 clearPersistence）
- 迁移：OTA 更新服务从 EAS 迁移至 expo-open-ota + 腾讯云本地存储（ota.easyfan.info）
- 修复：Web 端 permission request 在多设备场景下中途丢失——断线期间在其他设备处理的权限重连后自动补显"已在其他设备处理"
- 修复：allowTools → allowedTools 类型修复
