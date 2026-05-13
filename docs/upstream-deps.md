# Upstream 依赖全貌文档

> 生成日期：2026-05-12  
> Fork: easyfan/happy | Upstream: slopus/happy  
> 分叉点：提交 `89d01586`（Merge PR #1191 - Add new model options）

---

## 1. Upstream 状态概览

### 1.1 Fork 与 Upstream 差异统计

| 项目 | 值 |
|------|-----|
| 本地 HEAD | `894c1e8c`（2026-05-12） |
| Upstream HEAD | `5c7bf0fd`（2026-05-08） |
| 我们超前 upstream 的提交数 | ~10+（我们自己的功能） |
| Upstream 未合并的提交数 | **约 80+ commits** |

### 1.2 Upstream 最近重要提交（未合并）

| 提交 | 内容 | 风险 | 建议 |
|------|------|------|------|
| `e60816ed` | 推送通知安全修复：shell injection & path traversal，移除 debug logs | **高** | 立即审核合并 |
| `738b07b9` / `baf9e6d3` | 会话 Ctrl-C 处理改进，防止会话丢失 | 中 | 立即审核合并 |
| `6a9a0e11` / `934ffede` / `6582bebd` | claudeUuid plumbing、session fork RPC、resume utilities | 中 | 需协调，含 wire 变更 |
| `c4b13d90` | 桌面 UI 改造 + 会话 fork/duplicate + 文件查看器/编辑器（~500+ 文件变更） | 中 | 待观察，等 upstream 稳定 |
| `2e6f7e35` / `a944cbd4` / `fa88ac70` | Changelog 重构为单 markdown + MarkdownView | 低 | 下迭代候选 |
| `4533ef56` | Preact CJS 补丁处理 | 低 | 需评估完整依赖树 |

> **BUG-16 教训**：Upstream 推送通知模块（`pushSend.ts` + `pushDispatch.ts` + `focusTracker.ts`）在提交 `e60816ed` 之前早已存在，我们 fork 初期即未合并，导致 iOS Push Notification 整个链路缺失，直至迭代5才修复。**核心问题：缺乏系统性 upstream 追踪机制**。

### 1.3 Upstream 合并风险评估

- **依赖层面**：所有核心包版本与 upstream **完全同步**，无版本冲突风险
- **功能层面**：约 80+ 未合并提交，其中含安全修复（最高优先）和功能改进
- **协议层面**：session fork RPC 等涉及 happy-wire 变更，需完整协议版本升级检查

---

## 2. 核心依赖清单

| 包名 | CLI 版本 | Server 版本 | App 版本 | Upstream 同步状态 |
|------|---------|-----------|---------|-----------------|
| tweetnacl | ^1.0.3 | ^1.0.3 | — | ✅ 同步 |
| @modelcontextprotocol/sdk | 1.25.3 | — | — | ✅ 同步 |
| fastify | ^5.6.2 | ^5.2.0 | — | ✅ 同步（版本差异正常）|
| socket.io-client | ^4.8.1 | — | ^4.8.1 | ✅ 同步 |
| socket.io | — | ^4.8.1 | — | ✅ 同步 |
| @prisma/client | — | ^6.11.1 | — | ✅ 同步 |
| prisma | — | ^6.11.1 | — | ✅ 同步 |
| @anthropic-ai/claude-agent-sdk | ^0.2.96 | — | — | 需单独确认 |
| expo | — | — | ~55.0.8 | 需单独确认 |
| expo-updates | — | — | ~55.0.0 | 需单独确认 |

---

## 3. 关键依赖深度分析

### 3.1 tweetnacl — 加密核心

**版本**：`^1.0.3`（CLI + Server，API 成熟稳定）

**使用位置**：
- `packages/happy-cli/sources/api/encryption.ts` — 消息加密/解密
- `packages/happy-cli/sources/ui/auth.ts:33` — 身份验证密钥对生成
- `packages/happy-cli/sources/modules/fileTransfer/fileEncryption.ts` — 文件加密

**实际 API 用法**：
```typescript
// auth.ts:33
const secret = new Uint8Array(randomBytes(32));
const keypair = tweetnacl.box.keyPair.fromSecretKey(secret);
```

**我们的改动**：无，直接使用官方 API

**与 App 侧对应**：App 使用 `libsodium-wrappers`（不同库，API 语义相同但不互通），需确保加密协议层对齐（见 TECH-18 计划）

**升级风险**：低 — 1.0.3 是该库最终稳定版本，不再更新

---

### 3.2 @modelcontextprotocol/sdk — MCP 协议

**版本**：Happy 使用 `1.25.3`，上游最新 `1.29.0`

**使用位置**：
- `packages/happy-cli/sources/claude/utils/startHappyServer.ts` — MCP 服务器启动
- `packages/happy-cli/sources/codex/happyMcpStdioBridge.ts` — MCP 桥接

**实际 API 用法**：
```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
const mcp = new McpServer({ name: "Happy MCP", version: "1.0.0" });
```

**我们的改动**：无

**版本差距**（`1.25.3` → `1.29.0`）：
- `LATEST_PROTOCOL_VERSION` 从 `"2025-03-26"` 升至 `"2025-11-25"`
- 可能影响协议握手，升级前需测试 MCP tool 注册兼容性

**升级风险**：中等 — 协议版本更新可能影响自定义 MCP 工具行为

---

### 3.3 socket.io-client — 实时通信

**版本**：`^4.8.1`（CLI + App）

**使用位置**：
- `packages/happy-cli/sources/api/apiSession.ts:3` — 会话 WebSocket 连接
- `packages/happy-app/sources/sync/` — 移动端实时同步

**实际 API 用法**：
```typescript
import { io, Socket } from 'socket.io-client'
// 连接配置在 ApiSessionClient 中（含重连策略）
```

**我们的改动**：无

**升级风险**：低 — 4.8.x 系列稳定，与 server 侧 socket.io 版本匹配

---

### 3.4 fastify — HTTP 服务框架

**版本差异**：CLI 使用 `^5.6.2`，Server 使用 `^5.2.0`（两者均为 upstream 同版本）

**用途**：
- CLI：HTTP 反向代理、本地 API 服务
- Server：主 API 服务（Fastify 5 + Prisma）

**我们的改动**：Server 侧有自定义路由（`sources/app/` 下各 action 文件）

**升级风险**：低~中 — Fastify 5.x 系列相对稳定；建议 CLI 和 Server 统一到相同小版本

---

### 3.5 prisma + @prisma/client — 数据库 ORM

**版本**：`^6.11.1`（Server）

**待处理迁移**：`20250715012822_add_metadata_version_agent_state`（仅 DO NOT RUN，需人工执行）

**我们的改动**：Schema 有项目专属改动（见 `packages/happy-server/prisma/schema.prisma`）

> **注意**：CLAUDE.md 规定 **never run migrations yourself** — 只有人工执行 `yarn migrate`

**升级风险**：中等 — Schema 变更前必须完成待处理迁移；6.x 系列有 breaking changes 记录

---

## 4. OTA 方案依赖

### 4.1 当前状态

- **方案**：已从 EAS（Expo Application Services）迁移至 **expo-open-ota + 腾讯云本地存储**（迭代1完成）
- **OTA 服务端**：`ota.easyfan.info`（腾讯云，Let's Encrypt SSL 有效至 2026-08-03）
- **当前配置**：`packages/happy-app/eas.json` + `app.config.js`

**相关依赖**：

| 包 | 版本 | 用途 |
|----|------|------|
| expo | ~55.0.8 | 主框架 |
| expo-updates | ~55.0.0 | 运行时 OTA 更新支持 |
| expo-server-sdk | ^3.15.0（CLI 侧） | APNs 推送 |

### 4.2 expo-open-ota 说明

- `expo-open-ota`（EOAS CLI）为外部工具，不在 monorepo 内部
- 通过 `npx eoas publish` 调用（见 `packages/happy-app/package.json` `ota` 脚本）
- OTA 推送必须从**腾讯云服务器侧**执行（本地网络不稳定），见 `project_ota_push_procedure` memory

### 4.3 升级路径

- `expo-updates` 与 Expo SDK 版本绑定，升级时需同步升级 Expo SDK
- OTA 回滚机制：通过 EOAS 管理的 update channel，可回退到历史版本

---

## 5. 升级风险矩阵

| 包名 | 风险等级 | 风险说明 | 建议策略 |
|------|---------|---------|---------|
| tweetnacl | 🟢 低 | 1.0.3 为最终稳定版 | 保持当前版本 |
| socket.io / socket.io-client | 🟢 低 | 4.8.1 稳定，与 upstream 同步 | 保持当前版本 |
| fastify | 🟢 低 | 5.x 系列相对稳定 | 考虑统一 CLI 与 Server 小版本 |
| @modelcontextprotocol/sdk | 🟡 中 | 协议版本 bump 影响 MCP 握手 | 监控更新，升级前测试兼容性 |
| prisma / @prisma/client | 🟡 中 | 待处理迁移 + 6.x breaking changes | 先完成待迁移，再评估升级 |
| expo / expo-updates | 🟡 中 | Expo SDK 升级影响 OTA 方案 | 跟随 Expo 官方 LTS 节奏 |
| @anthropic-ai/claude-agent-sdk | 🟡 中 | SDK API 签名可能变更（见 TECH-17） | 每次升级前检查 CanUseTool 签名 |

---

## 6. 推荐合并策略

### 6.1 应立即审核并合并的 upstream 改动

| 提交 | 内容 | 优先级 |
|------|------|--------|
| `e60816ed` | 推送通知安全修复（shell injection & path traversal） | **P0 — 安全** |
| `738b07b9` / `baf9e6d3` | 会话 Ctrl-C 处理改进 | P1 |

### 6.2 待观察的 upstream 改动（下一个规划周期评估）

| 提交范围 | 内容 | 等待条件 |
|---------|------|---------|
| session fork/duplicate + claudeUuid | 会话 fork RPC + wire 变更 | upstream 发布稳定版后评估协议兼容性 |
| `2e6f7e35` 等 | Changelog 重构 | 低优先，随其他 merge 顺带处理 |

### 6.3 暂不合并的改动

| 内容 | 原因 |
|------|------|
| 桌面 UI 改造（`c4b13d90`，~500+ 文件） | 体量过大，与我们的 UI 分叉冲突风险高；在发布计划中单独规划 |
| Preact CJS 补丁（`4533ef56`） | 需先评估我们的完整依赖树，确认无副作用 |

### 6.4 Session Fork 合并门控（TECH-21）

`934ffede` / `6582bebd` / `6a9a0e11` 三个提交构成 session fork/duplicate 功能的完整实现。
合并前必须同步处理以下两项安全依赖，否则引入 shell injection 和 path traversal 漏洞：

#### 依赖状态

| 标识符 | 来源提交 | 作用 | Fork 中状态 |
|--------|---------|------|------------|
| `shellescape()` | `e60816ed` | 对 tmux spawn path 中的 `resumeClaudeSessionId` 进行 shell 转义，防止 command injection | **不存在** — `e60816ed` 尚未合并 |
| `UUID_RE` | `e60816ed` | 在 fork/duplicate/rewind RPC handlers 中校验 `claudeSessionId` / `cutAfterUuid` 格式，防止 path traversal | **不存在** — 同上（`claudeFindLastSession.ts` 中的 `uuidPattern` 作用域不同，不覆盖 RPC 层） |

> **注意**：`shellescape` 和 `UUID_RE` 均由 `e60816ed`（`fix: shell injection & path traversal`）
> 引入，该提交与 P0 推送通知安全修复捆绑发布。合并 session fork 三提交时**必须**先确认
> `e60816ed` 已合并或同步 cherry-pick 其安全部分。

#### Merge 前必须验证的 Checklist

- [ ] **shellescape 已就位**：`packages/happy-cli/src/daemon/run.ts` 中存在 `shellescape()` 函数，
      且 tmux spawn path（`fullCommand` 字符串拼接处）已用 `shellescape(options.resumeClaudeSessionId)` 包裹
- [ ] **UUID_RE 已就位**：`packages/happy-cli/src/api/apiMachine.ts`（或 fork/duplicate RPC handler 所在文件）
      中所有接收 `claudeSessionId` / `cutAfterUuid` 的入口点均已用 `UUID_RE` 校验，非 UUID 格式立即拒绝

---

## 7. Upstream 追踪 SOP（最小方案）

> 配合 TECH-19（迭代7）建立自动 CI 检测；当前先人工执行

**每次迭代开始前**（建议 5 分钟例行检查）：

```bash
# 查看 upstream 最近 20 条提交
git fetch upstream
git log upstream/main --oneline -20

# 查看差异文件统计（不看内容）
git diff HEAD..upstream/main --stat | tail -5

# 筛选安全相关提交
git log upstream/main --oneline -50 | grep -iE "fix|security|inject|traversal|vuln"
```

**触发立即 merge 的信号**：
- 提交信息含 `security`、`injection`、`traversal`、`CVE`
- 涉及 `pushSend`、`pushDispatch`、`encryption` 相关文件

**关联文档**：
- `docs/claude-code-sdk-internals.md` — SDK/MCP 内部机制
- `docs/upstream-merge-sop.md`（TECH-19 产出，迭代7）
- `.github/workflows/upstream-check.yml`（TECH-19 产出，迭代7）
