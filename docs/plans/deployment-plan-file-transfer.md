# 生产部署计划：双向文件传输功能（Phase 1）

**功能分支**：`feat/file-transfer`（待合并至 main）  
**计划日期**：2026-04-22  
**部署负责人**：\_\_\_\_\_\_  
**预计窗口**：低峰期（建议非工作日 UTC 03:00–05:00）

---

## 组件部署矩阵

| 组件 | 变更类型 | 部署方式 | 回退难度 |
|------|---------|---------|---------|
| **happy-server** | **新增 DB 表 + 3 个新 API 端点** | TeamCity → Docker → K8s rolling | ⚠️ 中（migration 需手动回退）|
| **happy-app** | 新增 UI 组件 + 上传逻辑 | EAS OTA（JS 层）| ✅ 易（回退到上一 OTA）|
| **happy-cli** | 新增 fileTransfer 模块 + MCP 工具 | npm publish（`happy` 包）| ✅ 易（pin 旧版本）|

**部署顺序**：Server 先 → CLI 同步或稍后 → App OTA 最后  
**理由**：App 和 CLI 都依赖 Server 的 `/v1/uploads` API；Server 未就绪时两端调用会返回 404，但不会崩溃（graceful degradation）。

---

## 一、执行前检查标准（Pre-flight Checklist）

### 1.1 代码质量门禁

| # | 检查项 | 命令 | 通过标准 |
|---|-------|------|---------|
| P-01 | happy-server TypeScript 编译无错 | `pnpm --filter happy-server build` | 0 errors |
| P-02 | happy-cli TypeScript 编译无错 | `pnpm --filter happy-cli build` | 0 errors |
| P-03 | happy-app TypeScript 编译无错 | `pnpm --filter happy-app typecheck` | 0 errors |
| P-04 | happy-server 单测全绿 | `pnpm --filter happy-server test` | 0 FAIL（uploadCreate/Get/Delete.spec.ts 覆盖 ST/IT 场景）|
| P-05 | happy-cli 单测全绿 | `pnpm --filter happy-cli test` | 0 FAIL（pendingAttachments + fileUploadRpc）；已知 #1098-#1106 upstream failures 豁免 |
| P-06 | 功能测试报告确认 | 查阅 `docs/reports/file-transfer-test-report.md` | 31/35 PASS，0 FAIL，2 bugs 已修复 |

### 1.2 数据库迁移验证

| # | 检查项 | 操作 | 通过标准 |
|---|-------|------|---------|
| P-07 | migration SQL 审阅 | 阅读 `prisma/migrations/20260416000000_add_pending_upload/migration.sql` | 仅有 `CREATE TABLE PendingUpload`、`CREATE INDEX`、`CREATE TYPE UploadDirection`、`ADD CONSTRAINT`；无 `ALTER COLUMN`、无 `DROP` |
| P-08 | migration 不破坏现有表 | 确认 SQL | 无对现有表的 ALTER/DROP 操作 |
| P-09 | 生产 DB 迁移预演 | 在 staging/preview 环境运行 `pnpm --filter happy-server migrate` | 无错误，迁移文件 hash 与本地一致 |
| P-10 | Prisma client 已 generate | `pnpm --filter happy-server generate` | 生成的 client 包含 `PendingUpload` model |

### 1.3 环境与基础设施

| # | 检查项 | 方法 | 通过标准 |
|---|-------|------|---------|
| P-11 | 生产 Postgres 版本兼容 | `SELECT version()` | PostgreSQL 13+ |
| P-12 | `UploadDirection` enum 在生产 DB 不存在（首次部署）| `SELECT typname FROM pg_type WHERE typname='UploadDirection'` | 返回 0 行（如返回 1 行说明已有脏数据，需调查）|
| P-13 | K8s 有足够资源 | `kubectl describe nodes` | CPU/Memory request 可满足新镜像 |
| P-14 | TeamCity Server 构建配置就绪 | 检查 `Lab_HappyServer` 配置 | 指向正确分支/commit |
| P-15 | TeamCity Web 构建配置就绪 | 检查 `Lab_HappyWeb` 配置 | 指向正确分支/commit |
| P-16 | npm 登录态有效（CLI 发布）| `npm whoami` | 显示正确账号 |
| P-17 | EAS 登录态有效（App OTA）| `eas whoami` | 显示正确账号 |

### 1.4 回退准备

| # | 检查项 | 操作 |
|---|-------|------|
| P-18 | 记录当前生产 Server 镜像 tag | `kubectl get deployment handy -o jsonpath='{.spec.template.spec.containers[0].image}'` → 记录至本文档 **回退信息** 节 |
| P-19 | 记录当前生产 Web 镜像 tag | 同上，`happy-app` deployment |
| P-20 | 记录当前 CLI npm 版本 | `npm view happy version` → 记录 |
| P-21 | 记录当前 App OTA runtimeVersion | 查阅 EAS dashboard → 记录 |
| P-22 | 确认 DB 有近期备份 | 检查备份系统 | 最近一次备份时间距现在 < 24h |

**回退信息（执行前填写）：**
```
Server 镜像：docker.korshakov.com/handy-server:____________
Web 镜像：  docker.korshakov.com/happy-app:____________
CLI 版本：  ____________
App runtime version: 20（OTA 层，无需记录 build number）
DB 备份时间：____________
```

### 1.5 Pre-flight Checkpoint 确认表

部署负责人逐项签字确认后方可进入执行阶段：

```
[ ] P-01 happy-server 编译
[ ] P-02 happy-cli 编译
[ ] P-03 happy-app 编译
[ ] P-04 happy-server 单测
[ ] P-05 happy-cli 单测
[ ] P-06 功能测试报告
[ ] P-07 migration SQL 审阅
[ ] P-08 migration 安全性
[ ] P-09 staging 迁移预演
[ ] P-10 Prisma client generate
[ ] P-11 Postgres 版本
[ ] P-12 enum 不存在确认
[ ] P-13 K8s 资源充足
[ ] P-14 TeamCity Server 配置
[ ] P-15 TeamCity Web 配置
[ ] P-16 npm 登录
[ ] P-17 EAS 登录
[ ] P-18 Server 镜像已记录
[ ] P-19 Web 镜像已记录
[ ] P-20 CLI 版本已记录
[ ] P-21 App runtimeVersion 已记录
[ ] P-22 DB 备份确认

负责人：____________    时间：____________
```

---

## 二、执行详细步骤

### Step 1：合并代码到 main

```bash
# 确保本地 main 最新
git checkout main && git pull

# 合并功能分支（无 --ff，保留 merge commit 方便回退）
git merge --no-ff feat/file-transfer -m "feat: bidirectional file transfer Phase 1"

# 推送
git push origin main
```

**预期耗时**：5 min  
**检查点 E-01**：GitHub 上 main 分支最新 commit 包含 `20260416000000_add_pending_upload` migration 文件。

---

### Step 2：构建并部署 happy-server

#### 2a. 触发 TeamCity 构建

在 TeamCity `Lab_HappyServer` → Run Build（指向 main 最新 commit）。

构建流程（TeamCity 自动执行）：
```
pnpm install
pnpm --filter happy-wire build
pnpm --filter happy-server build
docker build -f Dockerfile.server -t docker.korshakov.com/handy-server:{version} .
docker push docker.korshakov.com/handy-server:{version}
kubectl set image deployment/handy handy=docker.korshakov.com/handy-server:{version}
```

**预期耗时**：10–15 min（构建 8 min + 推镜像 3 min + K8s rolling 3 min）

#### 2b. 监控 rolling update

```bash
# 观察 Pod 滚动情况（新 Pod 起来后旧 Pod 终止）
kubectl rollout status deployment/handy --timeout=5m

# 查看 Pod 列表
kubectl get pods -l app=handy -w
```

滚动策略（现有配置 `maxUnavailable: 1, maxSurge: 0`）：先终止 1 个旧 Pod → 启动 1 个新 Pod → 依次替换。

**检查点 E-02**：`kubectl rollout status` 输出 `successfully rolled out`。

#### 2c. 确认 DB migration 已执行

新镜像启动时 entrypoint 自动运行 `prisma migrate deploy`：

```bash
# 查看新 Pod 启动日志，确认 migration 执行
kubectl logs -l app=handy --since=5m | grep -E "(migration|PendingUpload|Applying)"
```

**检查点 E-03**：日志中出现 `Applying migration '20260416000000_add_pending_upload'` 且无 error。

---

### Step 3：Sanity Check — Server API

```bash
# 获取生产 token（用测试账号）
export TOKEN="<test-account-jwt>"
export BASE="https://api.happy.engineering"  # 或实际 API 域名
export SESSION_ID="<test-session-id>"

# 3-1: 创建上传记录
curl -s -X POST "$BASE/v1/uploads" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"uploadId\":\"deploy-smoke-$(date +%s)\",\"sessionId\":\"$SESSION_ID\",\"direction\":\"app_to_cli\",\"encryptedData\":\"dGVzdA==\",\"encryptedMeta\":\"dGVzdA==\",\"mimeType\":\"text/plain\",\"sizeBytes\":4}" \
  | jq '{status: .uploadId}'

# 期望: {"status": "deploy-smoke-..."}（非 404/500）

# 3-2: 获取刚创建的上传记录
curl -s "$BASE/v1/uploads/$UPLOAD_ID?sessionId=$SESSION_ID" \
  -H "Authorization: Bearer $TOKEN" | jq '.uploadId'

# 期望: 返回 uploadId

# 3-3: 删除
curl -s -X DELETE "$BASE/v1/uploads/$UPLOAD_ID?sessionId=$SESSION_ID" \
  -H "Authorization: Bearer $TOKEN" -o /dev/null -w "%{http_code}"

# 期望: 204

# 3-4: MIME 拒绝验证
curl -s -X POST "$BASE/v1/uploads" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"uploadId\":\"deploy-smoke-mime-$(date +%s)\",\"sessionId\":\"$SESSION_ID\",\"direction\":\"app_to_cli\",\"encryptedData\":\"dGVzdA==\",\"encryptedMeta\":\"dGVzdA==\",\"mimeType\":\"video/mp4\",\"sizeBytes\":4}" \
  -w "\nHTTP: %{http_code}"

# 期望: 400 UNSUPPORTED_FILE_TYPE
```

**检查点 E-04**：4 个 curl 测试全部返回预期状态码。

---

### Step 4：发布 happy-cli

```bash
# 进入 CLI 包
cd packages/happy-cli

# 确认当前版本（应为 1.1.4 或已 bump）
cat package.json | jq .version

# 运行发布流程（build → test → bump → publish）
cd ../..
yarn release happy-cli
# 交互式确认版本号（Patch: 1.1.5 或根据实际决定）
```

发布后验证：
```bash
# 等待 npm CDN 同步（约 1 min）
npm view happy version
# 期望: 刚发布的新版本号

npm view happy dist-tags
# 期望: latest 指向新版本
```

**检查点 E-05**：`npm view happy version` 返回新版本号。

---

### Step 5：发布 happy-app（OTA）

```bash
cd packages/happy-app

# 确认 runtimeVersion 未变（纯 JS 变更，无原生代码改动）
cat app.json | jq .expo.runtimeVersion
# 期望: "20"（无需改动）

# 发布 OTA 到 production channel
yarn ota:production
```

OTA 内容说明：
- 新增 `AgentInput.tsx` 附件上传逻辑（含 Web blob URL 修复）
- 新增 `FileShareBubble.tsx`（含 flex 布局 Bug 修复）
- 新增文件传输相关 i18n strings（9 个语言文件）

**检查点 E-06**：EAS dashboard 上 production channel 出现新 update，状态为 `published`。

---

### Step 6：部署 happy-app Web

在 TeamCity `Lab_HappyWeb` → Run Build（main 最新 commit）。

构建参数需确认：
- `POSTHOG_API_KEY`：已配置
- `REVENUE_CAT_STRIPE`：已配置

```bash
# 监控 Web deployment rolling update
kubectl rollout status deployment/happy-app --timeout=5m
```

**检查点 E-07**：`kubectl rollout status` 输出 `successfully rolled out`。

---

## 三、执行后检查标准（Post-deployment Checklist）

### 3.1 基础健康检查

| # | 检查项 | 命令/操作 | 通过标准 |
|---|-------|---------|---------|
| D-01 | Server Pod 全部 Running | `kubectl get pods -l app=handy` | 所有 Pod `Running`，无 `CrashLoopBackOff` |
| D-02 | Server 健康检查端点 | `curl -s https://api.happy.engineering/health` | HTTP 200 |
| D-03 | Web Pod 全部 Running | `kubectl get pods -l app=happy-app` | 同上 |
| D-04 | Web 首页可访问 | 浏览器访问 `https://app.easyfan.info` | 页面正常渲染，无 JS 错误 |
| D-05 | CLI 可安装 | `npm install -g happy@latest --dry-run` | 无 404/403 |
| D-06 | DB 表已创建 | `SELECT COUNT(*) FROM "PendingUpload"` | 返回 0（空表，正常）|
| D-07 | Enum 已创建 | `SELECT enumlabel FROM pg_enum WHERE enumtypid = 'UploadDirection'::regtype` | 返回 `app_to_cli` 和 `cli_to_app` |

### 3.2 功能验证（生产环境 Smoke Test）

| # | 测试场景 | 操作 | 期望 |
|---|---------|------|------|
| D-08 | AT 方向：App 上传文件 | 用测试账号在 Web App 选取文件 → 上传 → 随消息发送 | 进度条正常，消息发送成功，CLI 收到文件 |
| D-09 | DT 方向：CLI 分享文件 | CLI 调用 `mcp__happy__share_file` | App 显示 `FileShareBubble`，图片渲染正常 |
| D-10 | 大文件拒绝 | 选取 > 10 MB 文件 | 弹出 "File too large" 提示，无上传请求 |
| D-11 | Web App 加载 | 浏览器无痕模式访问 Web App | 无 bundle 500 错误，App 正常启动 |
| D-12 | 非文件传输功能无回归 | 正常发送消息、权限弹窗、会话列表 | 与部署前行为一致 |

### 3.3 监控指标检查（部署后 30 min 内）

| # | 指标 | 检查位置 | 告警阈值 |
|---|------|---------|---------|
| D-13 | Server 5xx 错误率 | Prometheus / Grafana | < 0.1%（文件传输相关端点同时检查）|
| D-14 | `/v1/uploads` 端点延迟 | Grafana | P99 < 2s |
| D-15 | DB 连接池使用率 | Grafana | < 80% |
| D-16 | Pod CPU/Memory | `kubectl top pods` | 无异常飙升 |
| D-17 | OTA 更新推送成功率 | EAS dashboard | 新 update rollout 开始，无大量错误 |

### 3.4 Post-deployment Checkpoint 确认表

```
[ ] D-01 Server Pod Running
[ ] D-02 Server 健康检查
[ ] D-03 Web Pod Running
[ ] D-04 Web 首页可访问
[ ] D-05 CLI 可安装
[ ] D-06 DB 表已创建
[ ] D-07 Enum 已创建
[ ] D-08 AT 方向 smoke test
[ ] D-09 DT 方向 smoke test
[ ] D-10 大文件拒绝
[ ] D-11 Web App 加载
[ ] D-12 非文件功能无回归
[ ] D-13 5xx 错误率正常
[ ] D-14 API 延迟正常
[ ] D-15 DB 连接池正常
[ ] D-16 Pod 资源正常
[ ] D-17 OTA rollout 正常

负责人：____________    时间：____________
```

---

## 四、故障回退步骤

### 4.1 Server 回退

**触发条件**：D-01/D-02 失败，或 D-13 5xx > 1%，或 DB migration 失败。

```bash
# 立即回退到上一镜像（填入 Pre-flight 记录的版本）
kubectl set image deployment/handy \
  handy=docker.korshakov.com/handy-server:<旧镜像tag>

# 确认回退完成
kubectl rollout status deployment/handy --timeout=5m

# 验证旧版本运行
kubectl get pods -l app=handy
curl -s https://api.happy.engineering/health
```

**DB Migration 回退**（仅当 Server 回退后 PendingUpload 表影响旧版本时执行）：

```sql
-- 在生产 Postgres 执行（需 DBA 权限，谨慎操作）
-- 旧版本 Server 不使用 PendingUpload，表存在不影响运行
-- 如确需回退（例如 enum 冲突），执行：

DROP TABLE IF EXISTS "PendingUpload";
DROP TYPE IF EXISTS "UploadDirection";

-- 然后在 _prisma_migrations 表中删除对应记录
DELETE FROM "_prisma_migrations"
WHERE migration_name = '20260416000000_add_pending_upload';
```

> ⚠️ Migration 回退会丢失上线后产生的所有 PendingUpload 数据。由于 PendingUpload 是临时数据（TTL 24h，注入后即删），丢失影响极小。但仍需确认当时是否有用户正在传输文件。

**预期耗时**：5 min（rolling update）+ 5 min（DB 如需回退）

---

### 4.2 Web App 回退

**触发条件**：D-03/D-04 失败，或 Web App JS 错误激增。

```bash
# 回退到上一 Web 镜像
kubectl set image deployment/happy-app \
  happy-app=docker.korshakov.com/happy-app:<旧镜像tag>

kubectl rollout status deployment/happy-app --timeout=5m
```

**预期耗时**：3 min

---

### 4.3 CLI 回退

**触发条件**：用户报告 CLI 崩溃或文件传输功能异常。

```bash
# 将 latest tag 指向旧版本（不删除新版本，仅移动 tag）
npm dist-tag add happy@<旧版本号> latest

# 验证
npm view happy dist-tags
```

用户侧：旧版本 CLI 不包含文件传输模块，附件相关 RPC 不存在，旧版本行为完全不受影响。

**预期耗时**：2 min（npm tag 更新 + CDN 传播 ~5 min）

---

### 4.4 App OTA 回退

**触发条件**：OTA 推送后用户端出现崩溃或功能异常。

```bash
# 在 EAS dashboard 中将 production channel 回退到上一个 update
# 或通过 CLI：
eas update --channel production --message "rollback" --non-interactive
# 发布上一个 commit 的代码作为新 OTA（覆盖当前）
```

EAS OTA 原子更新，App 下次启动时自动拉取新 OTA。已在使用中的用户完成当前会话后生效。

**预期耗时**：5 min（发布）+ App 下次启动（自动）

---

### 4.5 回退决策树

```
部署后出现异常
    │
    ├─ Server 5xx > 1% 或 Pod CrashLoop
    │       → 立即执行 4.1 Server 回退
    │
    ├─ Web App 白屏或 JS 错误激增
    │       → 立即执行 4.2 Web 回退
    │
    ├─ CLI 用户报告安装后崩溃
    │       → 执行 4.3 CLI 回退
    │
    ├─ App OTA 用户报告文件传输崩溃
    │   （非文件传输功能正常）
    │       → 执行 4.4 OTA 回退
    │
    └─ 文件传输功能不可用但其他功能正常
            → 暂不回退；定位具体原因
              文件传输降级影响低（非核心路径）
```

---

## 五、Sanity Check（完整端到端验证）

在所有组件部署完成、Post-deployment Checklist 通过后执行。

### 环境准备

```bash
# 使用专用测试账号（勿用生产用户账号）
export TEST_ACCOUNT="<测试账号 JWT>"
export BASE="https://api.happy.engineering"

# 确认 CLI 版本是新版本
happy --version
```

### SC-1：AT 方向（App→CLI 完整链路）

1. 打开 Web App（无痕模式）登录测试账号
2. 进入一个已有活跃 CLI 会话
3. 点击输入框 📎 附件按钮
4. 选取 < 1 MB 的文本文件
5. 观察 AttachmentPreviewBar 进度条 → ready 状态
6. 点击发送

**期望**：
- CLI 端收到包含文件内容的消息（`console.log` 或 Claude 回应）
- `GET /v1/uploads/:id` 请求在 CLI 注入后返回 200
- 注入成功后临时文件被清理（`ls ~/.happy/uploads/` 目录为空）

### SC-2：DT 方向（CLI→App 完整链路）

```bash
# 在 CLI 会话中（或通过 MCP 工具调用）
mcp__happy__share_file '{"path": "/path/to/test.png", "description": "sanity check"}'
```

**期望**：
- Web App 出现 `FileShareBubble`，显示图片缩略图（240×180）
- 长按图片 → 系统分享菜单（或浏览器下载）
- CLI 侧返回 `{success: true}`

### SC-3：安全边界验证（生产 API 直接调用）

```bash
# 越权访问验证（用 token A 访问 token B 的 uploadId）
curl -s "$BASE/v1/uploads/nonexistent-id?sessionId=any" \
  -H "Authorization: Bearer $TEST_ACCOUNT" \
  -w "\nHTTP: %{http_code}"
# 期望: 404
```

### SC-4：非文件功能回归确认

- 发送普通文本消息 → 正常
- 权限弹窗（触发 Bash 工具）→ 正常弹出
- 会话列表 → 正常显示
- 语音功能（如已启用）→ 正常

**Sanity Check 通过标准**：SC-1 至 SC-4 全部通过。

---

## 六、上线后监控与运维

### 6.1 监控看板（部署后 48h 重点关注）

| 指标 | 工具 | 关注重点 |
|------|------|---------|
| Server 5xx 错误率 | Prometheus/Grafana | `/v1/uploads` 端点单独观察 |
| `/v1/uploads` P99 延迟 | Grafana | 基线：< 500ms；告警：> 2s |
| `PendingUpload` 表行数增长 | DB 监控 / 定时查询 | 异常积压（应在 24h TTL 后自动清理）|
| OTA 下载成功率 | EAS dashboard | 新 update rollout 百分比 |
| 用户报告的文件传输错误 | 用户反馈渠道 | 上线 48h 内每 6h 过一次 |

**每日 DB 健康查询**（上线后前 7 天执行）：

```sql
-- 检查 PendingUpload 积压情况
SELECT
    direction,
    notified,
    COUNT(*) as cnt,
    MAX(createdAt) as latest,
    MIN(expiresAt) as earliest_expiry
FROM "PendingUpload"
GROUP BY direction, notified;

-- 检查过期未清理的记录（应为 0，Server 定期清理）
SELECT COUNT(*) FROM "PendingUpload"
WHERE "expiresAt" < NOW();
```

### 6.2 告警配置建议

在现有 Prometheus 告警规则中增加：

```yaml
# 建议添加到 Prometheus rules
- alert: FileUploadHighErrorRate
  expr: |
    rate(http_requests_total{path=~"/v1/uploads.*", status=~"5.."}[5m]) /
    rate(http_requests_total{path=~"/v1/uploads.*"}[5m]) > 0.01
  for: 2m
  labels:
    severity: warning
  annotations:
    summary: "文件上传 API 5xx 错误率 > 1%"

- alert: PendingUploadBacklog
  expr: |
    (SELECT COUNT(*) FROM "PendingUpload" WHERE notified = false AND "createdAt" < NOW() - interval '1 hour') > 100
  for: 5m
  labels:
    severity: warning
  annotations:
    summary: "PendingUpload 未通知积压超过 100 条"
```

### 6.3 常见运维操作

**手动清理过期 PendingUpload**（TTL 到期后 Server 应自动清理，仅在积压时手动执行）：

```sql
DELETE FROM "PendingUpload"
WHERE "expiresAt" < NOW()
RETURNING uploadId, accountId, direction;
```

**查看某用户的上传记录**：

```sql
SELECT uploadId, sessionId, direction, notified,
       createdAt, expiresAt, downloadedAt
FROM "PendingUpload"
WHERE "accountId" = '<user-id>'
ORDER BY "createdAt" DESC
LIMIT 20;
```

**查看文件传输 API 日志**（Server Pod）：

```bash
kubectl logs -l app=handy --since=1h | grep -E "(/v1/uploads|PendingUpload|fileTransfer)"
```

**强制用户 CLI 拉取 pending 上传**（用户 CLI 离线恢复后未自动拉取时）：

无需服务端操作——CLI 重启后会自动调用 `GET /v1/uploads/pending`。如 CLI 长时间未拉取，检查 CLI daemon 是否在线。

### 6.4 Phase 2 准备（上线后 backlog）

上线后需关注并在下个迭代修复的已知问题：

| 项目 | 优先级 | 描述 |
|------|--------|------|
| IT-02：pendingAttachments 入队不幂等 | P1 | RPC 重试可导致同一文件注入两次；概率低但需修复 |
| MT-01/02：多端并发测试 | P1 | 两端 App 同时在线场景未验证 |
| Android/iOS 真机 AT 方向补测 | P1 | 需真机 + 完整 QR 配对 |
| AT-03/04：进度条/取消（真机限速）| P2 | 需真机 + 限速网络环境 |

---

## 附录：关键文件路径

| 文件 | 说明 |
|------|------|
| `packages/happy-server/prisma/migrations/20260416000000_add_pending_upload/migration.sql` | DB Migration SQL |
| `packages/happy-server/deploy/handy.yaml` | K8s Deployment manifest |
| `packages/happy-app/eas.json` | EAS build profiles |
| `docs/release-process.md` | 发布流程文档 |
| `docs/reports/file-transfer-test-report.md` | 功能测试报告 |
