# Fork Divergence Ledger — 分叉账本

> 文档范围：记录 easyfan/happy fork 中所有**显式决定"暂不合并"或"延迟合并"**的 upstream 变更。  
> 关联文档：`docs/upstream-merge-sop.md`（合并 SOP）、`docs/upstream-deps.md`（依赖全貌）  
> 格式规范：见 `docs/upstream-merge-sop.md §7.3`  
> 最后更新：2026-05-29（迭代19 pre-launch，Batch 4 dep-graph spike：514ef3f1+a28b9a94 新增待评估）

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
| `b042d834`（configurable agent defaults）| 产品决策 pending | 新 Feature（24文件，引入 agentDefaults.ts + Settings/agents.tsx），涉及 UX 设计决策（是否暴露 per-session model/tool 配置入口）；直接 cherry-pick 有冲突风险；需产品方向确认后独立迭代（工作量 M） | PO 产品方向决策后入 backlog |

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
