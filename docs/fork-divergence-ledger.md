# Fork Divergence Ledger — 分叉账本

> 文档范围：记录 easyfan/happy fork 中所有**显式决定"暂不合并"或"延迟合并"**的 upstream 变更。  
> 关联文档：`docs/upstream-merge-sop.md`（合并 SOP）、`docs/upstream-deps.md`（依赖全貌）  
> 格式规范：见 `docs/upstream-merge-sop.md §7.3`  
> 最后更新：2026-06-04（IT25 B5.5 快扫：新增 d2d2f730/f749b436/e1f2dca9 决策）

---

## 账本价值

任意时刻可回答"我们与 upstream 的分叉点在哪里、为什么"，而非只知道 commit 数字差距。  
每次决策"暂不合并"时，必须在本账本中登记；每次重评后，更新决策状态（合并 / 继续暂缓 / 永久放弃）。

---

## 暂不合并记录

| 提交/范围 | 决策 | 理由 | 重评时间 |
|-----------|------|------|---------|
| `c4b13d90`（桌面 UI 改造，500+ 文件变更） | 暂不合并 | 与我们 UI 分叉冲突风险过高，体量过大，静默覆盖风险极高 | upstream 稳定后单独规划 |
| session fork 四件套（`2c96ceba` → `6f005e09` → `6582bebd` → `934ffede`） | ~~Batch 2（延迟合并）~~ **→ 已合并** | 见"已合并"表 | — |
| `4533ef56`（Preact CJS 补丁） | 待评估 | 依赖树影响未知，需评估对 happy-app / happy-cli 构建产物的影响 | 下次 vendor 依赖评审时 |
| `514ef3f1` + `a28b9a94`（AgentInput uncontrolled + Fabric fix）| 待评估 | 输入性能优化（击键 re-render 从 JS 帧率→原生帧率），工作量 M，5 文件 +381/-278。**成对，不可拆**：a28b9a94 是 514ef3f1 的 Fabric regression fix，单独 cherry-pick 514ef3f1 会导致 iOS/Android 发送后输入框不清空。在我们 fork 上 a28b9a94 单独无法复现（无前提 514ef3f1）。触发重评条件：App 输入体验成为用户反馈热点，或排一个 App 性能专项迭代时。 | App 性能专项迭代时 |
| `00725d20`（CLI bundled Prisma engine fix） | 暂缓 | 触发条件为 bundled bun binary 全新安装模式，我们日常 dev/docker 部署无复现；需独立 spike 验证是否影响我们的 daemon 分发路径 | 下次 CLI bundled binary 打包测试时 |
| `b042d834`（configurable agent defaults）| **DEFERRED — 专项迭代** | 2026-06-03 PO 决策：SKIP 本轮。功能与 IT23-02（per-session server 落库）互补不冲突，但 storage.ts 双边修改（79文件 changed-in-both），手工 merge 工作量 M；新增 Settings/Agents 页面值得独立规划。重评时机：Agent 偏好设置专项迭代（含 FEAT-08 HUD），届时一并手工 merge。CLI 默认值变更（DEFAULT_CLAUDE_PERMISSION_MODE=yolo）需独立 PO 产品方向确认。 | Agent 偏好设置专项迭代 |
| `d2d2f730`（happy-server 拆包 → happy-server-self-host，变为公开 npm 包）| **SKIP — PO 永久决策** | 2026-06-04 PO 决策：我们维持私有部署模型（Docker + 腾讯云），不需要公开发布 server 包。上游改为公开 npm 包是其自托管商业化路径，与我们的用户部署方式无关。永久 SKIP，无需重评。 | — |
| `e1f2dca9`（Remove unused projectManager.ts，308 行）| **SKIP — 我们重度依赖** | 2026-06-04 spike 结论：上游认为 unused，但我们 fork 的 `storage.ts`（9处）/ `gitStatusSync.ts`（2处）/ `sync.ts`（1处）共 12 处调用，是 git status 追踪 + 项目分组的核心模块。永久 SKIP。 | — |
| `f749b436`（FilesSidebar file tree row 样式清理）| **DEFERRED** | 2026-06-04：我们 `FilesSidebar.tsx` 502 行已有独立 tree 实现，样式清理 commit 有轻微上下文冲突风险，功能无影响，不紧急。重评时机：FilesSidebar 有功能性改动时顺手合并。 | FilesSidebar 下次功能性改动时 |
| session fork/duplicate UI 系列（`1fd27ee4` → `e7c4d644` → `f563e01b` → `a2a888f5`）| **待 arch review（与 `c4b13d90` 同组决策）** | 2026-06-03 PO 补录（266c0072 cherry-pick 溯源触发）。四个 commit 于 upstream 2026-05-06 引入，长期仅被 `c4b13d90`（桌面 UI 大改造）条目隐含覆盖，未单独登记。现显式补录。影响文件：`session/[id]/info.tsx`（+61 lines）、`ChatList.tsx`（+27/+22/+4 lines，四次修改）、`MessageView.tsx`（+37 lines）、`useSessionQuickActions.ts`（+62 lines）、`DuplicateSheet.tsx`（+147 lines 重构）、`ops.ts`（+39 lines）、`packages/happy-cli/src/api/apiMachine.ts`（+24 lines）、`claudeSessionFork.ts`（+57 lines）。功能依赖 session fork 四件套 RPC（`2c96ceba`→`6f005e09`→`6582bebd`→`934ffede`）已在 fork 中，但 App 侧 UI 和 DuplicateSheet 组件整体未合入。与 fork 现有 UI 存在较大分叉风险，需 arch review 确认是否启用 `expResumeSession` 功能门控路径。 | session fork 功能专项迭代（arch review 通过后），与 `c4b13d90` 一并决策 |

---

## 已合并（从暂缓升级）

| 提交/范围 | 原决策 | 合并时间 | 合并迭代 |
|-----------|--------|---------|---------|
| session fork 四件套（`e60816ed` + `2c96ceba` → `6f005e09` → `6582bebd` → `934ffede`）+ 安全前置 | Batch 2 延迟合并 | 2026-05-25 | upstream-batch-2（迭代12）|
| App sync 大改（`5a914a20` → `972bcef1` + `3caa51b4` + `ba7b2294` + `2327f49c`）| Batch 2 延迟合并 | 2026-05-25 | upstream-batch-2（迭代12）|
| Server 自托管（`5981a899` + `31a6e4df`）| Batch 2 延迟合并 | 2026-05-25 | upstream-batch-2（迭代12）|

---

## 架构分叉记录（永久性设计分歧，非 commit 级别）

> 此节记录 easyfan/happy 与 upstream 在架构层面的永久性分歧决策。
> 与"暂不合并"不同，这些分歧是有意的、基于价值取舍的选择，不计划迁移到 upstream 方案。
> 每条记录含：分歧描述、选择理由、重新评估触发条件。

---

### ARCH-01：附件传输架构（server-relay E2E 加密 vs S3 presigned URL）

**决策时间**：2026-05-25（upstream-batch-2 迭代，3caa51b4 调查发现）

**Upstream 方案**：S3 presigned URL
- 客户端请求 server 签发 presigned PUT URL → 文件直传 S3（server 不接触字节）
- 下载类似：server 签发 presigned GET URL → 客户端直接从 S3 拉取
- 加密为"客户端约定"，协议层不强制
- 无 DB 记录，靠 ref 路径 + session 鉴权
- 文件格式：`.enc` 后缀，无 MIME 限制强制

**我们的方案**：server-relay E2E 加密（`/v1/uploads`）
- App 端强制 E2E 加密（`encryptFileForUpload` 是唯一路径），再 POST JSON 到 server
- Server 存密文（local 磁盘或 S3），永不接触明文
- 支持双向传输（`direction: app_to_cli | cli_to_app`）+ pending 轮询（CLI 拉取未递达上传）
- DB 记录（`pendingUpload` 表，24h TTL，idempotent upsert）
- MIME allowlist 服务端强制，sizeBytes 校验

**选择我们方案的理由**：
1. **E2E 加密协议层保证**：presigned URL 方案加密是"客户端自律"，与 happy 核心安全主张不符
2. **双向传输原生支持**：`app_to_cli | cli_to_app` + pending 机制是 happy 双向文件传输的基础，upstream 单向设计无法直接满足
3. **当前规模 server 带宽不是瓶颈**：presigned 方案的核心价值（减少 server 中转带宽）对自用部署无意义

**重新评估触发条件**（满足任一即应重新讨论）：
- [ ] 月活用户 > 1000，且 server 附件流量成为月度成本的显著项（> 20%）
- [ ] 产品方向转为 SaaS 多租户，需要文件存储按用户隔离且可审计
- [ ] 出现安全审计要求"server 不可接触任何文件字节（含密文）"的合规场景
- [ ] upstream 的附件方案引入了 server 端强制加密验证机制（消除协议层漏洞）

**关联文件**：
- `packages/happy-app/sources/sync/apiUploads.ts`（我们的 App 端实现）
- `packages/happy-server/sources/app/api/routes/uploadsRoutes.ts`（我们的 server 端）
- `packages/happy-server/sources/app/upload/uploadCreate.ts`（存储核心逻辑）
- upstream `packages/happy-server/sources/app/api/routes/attachmentRoutes.ts`（参考）

---

## 上游扫描分叉域速查表

> **用途**：上游 commit 扫描时（B5.x 快扫等），凡 commit 描述/文件路径命中以下关键词，
> 须先比对该行"我们的实现"，确认兼容性后才可标注 CHERRY-PICK CANDIDATE；
> 不兼容或不确定 → 升级为 INVESTIGATE。
>
> **维护规则**：每次发现新的兼容性坑（如 `e7453263` 图片拖拽），在本表追加一行并注明发现迭代。

| # | 功能域 | 我们的实现 | 上游实现 | 命中关键词 | 发现迭代 |
|---|--------|-----------|---------|-----------|---------|
| 1 | **文件上传管道** | E2E 加密 `uploadFile` → `AttachmentRef`，POST JSON 到 happy-server | inline base64 / paste 嵌入，或 S3 presigned URL（`uploadFormFile.ts`，我们零调用）| upload / attachment / drag / drop / paste / image / file / blob / base64 / presigned | ARCH-01（IT12）|
| 2 | **附件 UI 入口** | `expo-document-picker` + `AttachmentPreviewBar` 纸夹按钮 | paste handler + 原生 clip icon，无独立预览 bar | composer / input / paste / clip / paperclip / attachment / picker | IT25（e7453263 spike）|
| 3 | **projectManager / git status UI** | `projectManager.ts`（386行）+ `gitStatusSync.ts` + `FilesSidebar.tsx`（502行）活跃使用 | 已删除 projectManager（`e1f2dca9`），无 git UI 功能 | projectManager / gitStatus / FilesSidebar / project / sidebar / git | IT25（e1f2dca9 spike）|
| 4 | **Server 部署模型** | 私有 Docker，`private: true`，不发布 npm 包 | 公开 npm 包 `happy-server-self-host`（`d2d2f730`）| server package / self-host / npm publish / release / registry | IT25（d2d2f730 PO 决策）|
| 5 | **桌面端（Tauri）** | 不发布 Tauri / macOS 桌面版，`useTauriZoom` 有代码但 `isTauri()` 门控，实际无效 | 上游活跃开发 Tauri，有 entitlements / zoom / desktop UI 专项 commit | tauri / desktop / macOS / zoom / webview / entitlements / nsis / updater | IT25（58d5ecb8 spike）|
| 6 | **Session fork/duplicate UI** | 未合入：`DuplicateSheet`、`canFork`、`expResumeSession` 功能门控未开启（见 Ledger 待 arch review 条目）| 完整 session 复制/分叉 UI | fork / duplicate / canFork / DuplicateSheet / expResume / claudeSessionFork | IT24（266c0072 溯源）|
| 7 | **品牌资源** | `easyfan/happy`，`com.easyfan.happy`，`app.easyfan.info` | `slopus/happy`，`app.happy.engineering`，不同域名和 bundle ID | logo / brand / slopus / associatedDomains / legal / footer / copyright | IT07（BUG-17）|
| 8 | **OTA / expo-updates** | `expo-updates` 已移除（BUG-20），自建 `expo-open-ota` 方案**处于停用/注释状态**，未成熟 | EAS Update，OTA 功能完整活跃 | ota / expo-updates / reloadAsync / update / channel / runtimeVersion / EAS | BUG-20（IT07）|

---

## 永久放弃

*（具体 upstream commit 被永久排除，不因架构原因，而因功能方向不符）*

| 提交/范围 | 放弃原因 | 决策时间 |
|-----------|---------|---------|
| — | — | — |

---

## 更新规范

- 每次 upstream 分类阶段（72h 内）有新的"暂不合并"决策时，追加到"暂不合并记录"表
- 每次 Batch 执行完成后，将已合并的条目从"暂不合并"迁入"已合并"表
- 决策变更（暂缓 → 永久放弃，或暂缓 → 立即合并）须更新对应行，不得删除历史决策记录
- 本文件由 PO 或协调者维护；任何改动须附 commit message 说明决策依据
