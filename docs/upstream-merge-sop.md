# Upstream Merge SOP

> 文档范围：easyfan/happy fork 对 slopus/happy upstream 的 cherry-pick / merge 操作规程  
> 关联文档：`docs/upstream-deps.md`（依赖全貌）、`.github/workflows/upstream-check.yml`（自动检测）  
> 最后更新：2026-05-19（迭代8，TECH-19 产出）

---

## 1. 合并前评估矩阵

每次 cherry-pick 或 merge 前，必须填写以下 5 维度评估表。评估结论为"阻塞"时，不得执行合并。

| 维度 | 评估项 | 通过标准 | 结论 |
|------|--------|----------|------|
| **安全性** | 是否涉及 shell injection / path traversal / 加密路径 | 无新增攻击面；或安全修复已同步引入 | 通过 / 阻塞 |
| **冲突风险** | 高冲突文件（见 §3）是否被修改 | 已手工预检 diff，无静默覆盖风险 | 通过 / 需人工处理 |
| **wire 协议** | 是否修改 `happy-wire` 消息结构 | 新增字段为 optional；或各端消费方已同步更新 | 通过 / 阻塞 |
| **依赖完整性** | 本次提交是否依赖其他未合并提交 | 所有前置提交已在当前分支 | 通过 / 阻塞 |
| **测试覆盖** | 合并后 typecheck + test 是否通过 | 两项命令均零错误退出 | 通过 / 阻塞 |

> 填写时间：执行 cherry-pick 前。结论列全部为"通过"或"需人工处理（已处理）"方可继续。

---

## 2. 分批次合并优先级

基于迭代8对 upstream 158 个 commits 的深度分析（基线 `c4b82fc6` → `511917e1`）。

### Batch 1 — 立即合并（~1 天工作量）

优先级：P0/P1 bug fix，无顺序依赖，可并行 cherry-pick。

| 包 | Commit | 内容 | 优先级 |
|----|--------|------|--------|
| CLI | `36b23d57` | JSONL history replay 竞态（--resume 重复历史消息） | P0 |
| CLI | `f8c0c0db` | permission handler reset on session resume（孤儿权限请求） | P0 |
| CLI | `1744ff03` | 丢弃 isMeta user 消息（skill prompt 注入到聊天，**须与 a038957d 成对**） | P0 |
| CLI | `a038957d` | SDK isSynthetic → isMeta 传播（**须与 1744ff03 成对**） | P0 |
| CLI | `f9fa2aff` | cross-spawn（Windows Claude binary 支持） | P1 |
| CLI | `17f37337` | webappUrl settings.json 持久化 | P1 |
| Server | `22181f79` | 删除 per-message push，仅保留 session-event push | P0 |

**执行顺序说明**：
- `1744ff03` 和 `a038957d` 必须成对 cherry-pick，先 `a038957d` 后 `1744ff03`（逻辑依赖方向）
- 其余 5 个提交无顺序依赖，可任意顺序

**预期收益**：修复聊天重复历史、权限 UI 卡死、skill 提示墙、Windows spawn 失败、推送通知风暴

### Batch 2 — 下迭代合并（~2-3 天工作量，含严格顺序依赖）

**必须按顺序执行，不可乱序。**

#### 2a. Session Fork 四件套（顺序依赖）

```
Wire: 2c96ceba → CLI: 6f005e09 → CLI: 6582bebd → CLI: 934ffede
```

| 步骤 | 包 | Commit | 内容 |
|------|----|--------|------|
| 1 | Wire | `2c96ceba` | `SessionEnvelope` 新增 `claudeUuid?: string`（optional，向后兼容） |
| 2 | CLI | `6f005e09` | claudeUuid plumbing（sessionProtocolMapper 更新） |
| 3 | CLI | `6582bebd` | claude session fork + truncate utility |
| 4 | CLI | `934ffede` | session-fork RPC + daemon spawn resume |

> **安全门控**：合并步骤 3/4 前必须执行 §4 所列安全检查清单，确认 `shellescape` + `UUID_RE` 已就位。

#### 2b. App 修复（可与 2a 并行但注意内部顺序）

| 顺序 | Commit | 内容 | 注意 |
|------|--------|------|------|
| 1 | `5a914a20` | 消息懒加载 + 并行 AES 解密 + backward pagination | 须在 972bcef1 之前合并 |
| 2 | `972bcef1` | chat-title 竞态修复（session-key 未就绪时延迟应用） | 同 sync.ts，依赖 5a914a20 上下文 |
| 3 | `3caa51b4` | RN Blob polyfill ArrayBuffer → uri-based FormData（iOS/Android） | 独立，可任意顺序 |
| 4 | `ba7b2294` | 聊天滚动修复 + diff overlay 按需渲染 | 独立，可任意顺序 |

#### 2c. Server（可与 2a/2b 并行）

| Commit | 内容 |
|--------|------|
| `5981a899` | happy server 自托管（CLI subcommand + PGlite + static webapp） |
| `31a6e4df` | Pino multistream（Bun bundle logging 修复，配合 5981a899） |

### Batch 3 — 待观察（等 upstream 稳定）

| Commit | 内容 | 等待条件 |
|--------|------|---------|
| `c4b13d90` | Desktop UI 改造（~500+ 文件变更） | upstream 稳定后单独规划，体量过大 |
| `511917e1` | Codium projects & agents 集成 | 确认对 happy-app 核心路径无影响 |
| `266c0072` | 工具调用折叠分组展示（默认禁用） | 等用户反馈再决策 |
| `03ca2219` | UX 优化（具体见 upstream-deps.md §8.1） | 同上 |

---

## 3. 冲突处理规则

### 3.1 高冲突风险文件

以下文件在 upstream 中被大幅修改，且我们 fork 中也有自有改动，cherry-pick 时必须特别谨慎：

| 文件 | 冲突来源 | 处理要点 |
|------|---------|---------|
| `packages/happy-app/sources/sync.ts` | `5a914a20`（懒加载）和 `972bcef1`（竞态修复）均修改此文件 | 按 2a 顺序先合并 5a914a20，再合并 972bcef1；冲突段以我们自有加密逻辑为准 |
| `packages/happy-app/sources/components/AllFilesDiffView.tsx` | `ba7b2294` 按需渲染改造 | 检查我们的文件传输显示逻辑是否被覆盖；保留我们的 mcp__happy__share_file 相关展示 |
| `packages/happy-cli/sources/api/sessionProtocolMapper.ts` | Session fork 四件套中 `6f005e09` 修改此文件 | 合并前阅读我们自有的字段映射逻辑，确保 claudeUuid optional 字段不破坏现有 mapper |

### 3.2 冲突处理步骤

1. **预检**：执行 `git diff HEAD...<commit> -- <高冲突文件>` 查看 upstream 的具体变更范围
2. **标记**：对涉及高冲突文件的提交，在评估矩阵中标注"需人工处理"
3. **cherry-pick**：使用 `git cherry-pick -n <commit>`（不自动提交），手工解决冲突后再提交
4. **验证**：冲突解决后立即运行 `yarn typecheck`（对应包），确认类型无误
5. **记录**：在 commit message 中标注 `cherry-pick <hash> with manual conflict resolution`

### 3.3 静默覆盖防范

cherry-pick 时若 Git 报告"自动合并成功"但涉及高冲突文件，**不要轻信自动合并结果**，必须执行：

```bash
git diff HEAD <conflict-file>
```

人工确认我们的自有改动未被静默丢弃。

---

## 4. Session Fork 安全门控清单

> 引用：`docs/upstream-deps.md §6.4`

`6582bebd` / `934ffede` 合并前，**必须逐项勾选**。任一项未通过即阻塞合并。

### 背景

`e60816ed`（`fix: shell injection & path traversal`）引入了两个关键安全标识符：
- `shellescape()`：对 tmux spawn path 中的 `resumeClaudeSessionId` 进行 shell 转义
- `UUID_RE`：在 fork/duplicate/rewind RPC handlers 中校验 UUID 格式，防止 path traversal

若 `e60816ed` 未合并而 session fork 功能已合并，则引入 shell injection 和 path traversal 漏洞。

### 验证步骤

**步骤 1：确认 `e60816ed` 已合并或其安全部分已 cherry-pick**

```bash
git log --oneline | grep e60816ed
# 或
git log --oneline | grep "shell injection"
```

**步骤 2：验证 `shellescape()` 已就位**

```bash
grep -n "shellescape" packages/happy-cli/sources/daemon/run.ts
```

预期输出：包含 `shellescape(options.resumeClaudeSessionId)` 的行，位于 tmux spawn 命令的 `fullCommand` 字符串拼接处。

**步骤 3：验证 `UUID_RE` 已就位**

```bash
grep -rn "UUID_RE" packages/happy-cli/sources/api/
```

预期输出：在 fork/duplicate/rewind RPC handler 所在文件中，所有接收 `claudeSessionId` / `cutAfterUuid` 的入口点均已用 `UUID_RE` 校验。

> 注意：`packages/happy-cli/sources/modules/claudeFindLastSession.ts` 中的 `uuidPattern` 作用域不同，不覆盖 RPC 层，不能以此替代 UUID_RE 检查。

**门控 Checklist（执行 6582bebd 和 934ffede 前必填）**

- [ ] `e60816ed` 已合并（`git log` 中可见）
- [ ] `shellescape()` 函数存在于 `packages/happy-cli/sources/daemon/run.ts`
- [ ] tmux spawn path 中 `resumeClaudeSessionId` 已用 `shellescape()` 包裹
- [ ] `UUID_RE` 存在于 fork/duplicate RPC handler 所在文件
- [ ] 所有接收 `claudeSessionId` 的 RPC 入口均已用 `UUID_RE` 校验

---

## 5. 验证检查点

每次 cherry-pick 完成后，按以下顺序执行验证。**所有命令必须零错误退出，否则不得推送。**

### 5.1 通用检查（每次必做）

```bash
# 1. TypeScript 类型检查（选对应包）
cd packages/happy-cli && yarn typecheck
cd packages/happy-server && yarn typecheck   # yarn build 即为 typecheck
cd packages/happy-app && yarn typecheck

# 2. 单元测试
cd packages/happy-cli && yarn test
cd packages/happy-server && yarn test
```

### 5.2 针对 Batch 1 的额外验证

```bash
# JSONL replay 竞态修复（36b23d57）：验证 --resume 不重复历史消息
# 手工测试：启动 CLI，resume 一个已有 session，确认消息不重复

# skill prompt 修复（1744ff03 + a038957d）：验证 isMeta 消息不出现在聊天
# 手工测试：运行一个带 skill 的 session，确认 skill prompt 不出现在 UI
```

### 5.3 针对 Batch 2 Session Fork 的额外验证

```bash
# Wire 协议变更（2c96ceba）：验证 SessionEnvelope 序列化/反序列化
cd packages/happy-wire && yarn test  # 若有测试

# sessionProtocolMapper（6f005e09）：验证 claudeUuid optional 不破坏现有 session
# 手工测试：正常会话连接，确认 sessionId 映射正常

# Session fork RPC（934ffede）：端到端验证 fork 功能
# 手工测试：通过 App 触发 session fork，验证新 session 正常创建
```

### 5.4 App 验证（Batch 2 App 部分）

```bash
cd packages/happy-app && yarn typecheck

# sync.ts 改动（5a914a20 + 972bcef1）：验证消息加载和 title 不竞态
# Web 端：yarn web，打开一个 session，滚动历史，确认加密/解密正常
# iOS：yarn ios（若模拟器可用）
```

---

## 6. Fork 差异点检查（移植正确性验证）

> 本节来源：2026-05-24 PO + 总架构深度复盘（upstream 集成风险分析）  
> 核心认知：cherry-pick ≠ 移植完成。upstream 在它自己的环境中测试过的代码，不等于在我们的环境中也是正确的。

### 6.1 三层架构差异点

每次 cherry-pick 前，必须对照以下三层差异，逐一判断该提交的行为假设是否在我们的环境中依然成立：

| 差异层 | 具体差异 | 典型风险 |
|--------|---------|---------|
| **Docker Daemon 层** | upstream 无 Docker 容器化运行假设；我们的 daemon 生命周期与 container restart 解耦 | upstream 的 session/permission lifecycle 修复可能不覆盖 container restart 场景（案例：迭代9 UP-02，daemon 重启孤儿权限） |
| **端对端加密层** | upstream 无 App↔CLI 端对端加密；我们的 sync.ts 含自有加密/解密逻辑 | 涉及 sync.ts / sessionProtocolMapper.ts 的提交可能与我们自有加密路径发生静默覆盖（案例：Batch 2 `5a914a20` 高冲突风险）|
| **MCP 拦截器层** | upstream MCP 工具流直接执行；我们在 permission request 路径插入了 App 侧拦截 | permission handler 相关修复可能默认 MCP 工具直接返回，与我们的异步等待模式不兼容 |

### 6.2 四类风险模式识别

执行 cherry-pick 前，对照以下模式判断本次集成属于哪类，并标注对应处置要求：

| 模式 | 特征识别信号 | 处置要求 |
|------|------------|---------|
| **模式 A — Scope Gap** | 修复的 bug 场景在 upstream 环境中定义，但我们有额外运行场景（Docker restart / 真机 push / 容器网络）| 必须额外补充"我们专属场景"的验证用例，不能复用 upstream 的测试结论 |
| **模式 B — 隐式依赖链** | 提交 message 中无明确前置说明，但代码调用了同批次其他提交新增的函数/常量 | 执行 Batch 前先做依赖图 spike（见 §6.3）；已知成对提交严禁拆开 cherry-pick |
| **模式 C — 验证盲区** | 修复涉及 iOS 真机 / APNs / EAS 干净环境 / dev/ debug 屏幕 / 容器网络出口等本地测试覆盖不到的场景 | 需明确标注"该场景 E2E 暂无覆盖"，并在 QA 阶段增加手工验证步骤 |
| **模式 D — 环境假设不兼容** | 提交隐含假设（如"进程不会被外部 kill"、"文件系统持久化于本机"），与我们的 Docker/容器化环境不符 | 需重写或补充适配逻辑，不能直接 cherry-pick；需设计测试验证适配后行为 |

### 6.3 Batch 集成前置 Spike

对于体量超过 3 个相关提交的 Batch，在实际 cherry-pick 前必须先做一次依赖图 spike：

```
目标：把 Batch 内所有提交的依赖关系显式画出来
产出：每个提交标注：
  - 前置依赖（必须先于本提交合并的提交 hash）
  - 后置依赖（本提交是哪些提交的前置）  
  - 安全门控（是否有 §4 类的安全前置要求）
  - 差异点影响（触发模式 A/B/C/D 哪些）
预计耗时：XS~S（~2-4 小时），可避免 QA 阶段多轮返工
```

**已知的成对/顺序约束（历史积累）**：

| 提交组 | 约束 | 来源 |
|--------|------|------|
| `1744ff03` + `a038957d` | 必须成对，`a038957d` 先于 `1744ff03` | 迭代9 Batch 1 |
| `6582bebd` + `934ffede` | 必须在 `e60816ed` 之后（安全前置）| TECH-21 门控 |
| Wire `2c96ceba` → CLI `6f005e09` → `6582bebd` → `934ffede` | 严格顺序依赖 | Batch 2 四件套 |
| App `5a914a20` → `972bcef1` | `5a914a20` 先（sync.ts 上下文依赖）| upstream-deps.md §8 |

### 6.4 "移植完成"判定标准

下列三项全部满足，才可认定本次 cherry-pick 移植完成：

1. **三层差异点核查通过**：§6.1 每层均已评估，无被触发的差异风险；或差异风险已有显式处置措施
2. **场景补充验证通过**：针对"我们专属场景"（区别于 upstream 测试场景）的验证已执行并通过
3. **typecheck + 单测通过**：§5.1 通用检查零错误退出

> **关键原则**：typecheck + 单测通过 ≠ 集成正确。upstream 的运行时修复（并发、生命周期、外部 API）在静态检查中透明，必须通过 E2E 场景验证。

---

## 7. Fork Governance Framework（分叉治理框架）

> 本节来源：2026-05-25 PO + 总架构深度复盘
> 核心认知：fork 税（Fork Tax）是 fork 的内在成本，不可消除，只能管理。upstream 集成迭代应采用与常规功能迭代**不同的心理预期和执行标准**。

### 7.1 Fork 税的心理预期调整

fork 税有两种支付方式：
- **分散支付**（健康）：每次集成时明确识别风险、多轮验证、根因追问，成本可预期
- **集中爆发**（有害）：跳过验证、接受 CONDITIONAL、放行 scope gap，债务积累后在生产或下次迭代中突然爆发

BUG-16（跨 5 迭代未检出）、迭代9 UP-02（3 轮返工）、BUG-20（6~8 迭代日沉没成本）均属集中爆发。

**调整后的预期**：upstream cherry-pick 迭代的 QA 轮次、返工率、总耗时，系统性地高于同等体量的功能开发迭代。这不是执行问题，是 fork 税的正常表现。

### 7.2 四阶段工作流

```
upstream 新 commit
      ↓
[阶段 1] 持续分类（72h 内，CI 辅助）
  ├── P0 安全 → 立即 hotfix 通道
  ├── CANDIDATE → 进入摄入队列（附初步 Pattern 标注）
  ├── HOT-ZONE → 等待 Batch 窗口，标注高冲突文件
  └── 暂不合并 → 记入 Divergence 账本（§7.3）
      ↓
[阶段 2] Batch 窗口前：依赖图 Spike（XS，~2-4h）
  产出：upstream-batch-N-dep-graph.md
  内容：每个提交的前置/后置依赖、安全门控、Pattern A/B/C/D 标注
      ↓
[阶段 3] 差异场景测试先行（先写测试，再 cherry-pick）
  三类必覆盖场景库（持续积累，详见 §6.1）：
  - docker-daemon-restart（session/permission lifecycle）
  - e2e-encryption（sync.ts / sessionProtocolMapper）
  - mcp-interception（permission handler 异步等待）
      ↓
[阶段 4] 执行 cherry-pick → 跑差异场景测试 → 通过才算移植完成
  通过 → 合并，更新 Divergence 账本
  失败 → 补充覆盖（Pattern A/D 追问根因，不接受 CONDITIONAL 放行）
```

### 7.3 Divergence 账本

文件路径：`docs/fork-divergence-ledger.md`

记录所有显式决定"暂不合并"或"延迟合并"的 upstream 变更：

| 提交/范围 | 决策 | 理由 | 重评时间 |
|-----------|------|------|---------|
| `c4b13d90`（桌面 UI，500+ 文件）| 暂不合并 | 与我们 UI 分叉冲突风险过高 | upstream 稳定后 |
| session fork 四件套 | Batch 2 | 顺序依赖已知，安全前置等就绪 | 下迭代启动时 |
| `4533ef56` Preact CJS | 待评估 | 依赖树影响未知 | 下次 vendor 评审 |

**账本的价值**：任意时刻可回答"我们与 upstream 的分叉点在哪里、为什么"，而非只知道 commit 数字差距。

### 7.4 Upstream cherry-pick 迭代的 QA 升级标准

常规功能迭代的 CONDITIONAL PASS 门槛不适用于 upstream cherry-pick 迭代。cherry-pick 迭代的 QA 必须：

1. **Pattern 显式核查**：针对本 Batch 每个提交，明确填写触发了哪些 Pattern（A/B/C/D），以及对应的缓解措施是否已验证
2. **差异场景测试通过**：三类差异场景库（§7.2 阶段 3）中适用的场景必须全部 PASS，不允许 DEFERRED
3. **根因一步到底**：任何 E2E 失败不允许以"upstream 已修复该 bug"为由关闭，必须追问"该修复在我们的环境中是否完整（Pattern A）"
4. **CONDITIONAL 的额外要求**：若确需 CONDITIONAL，必须以书面方式声明"哪个 Pattern 风险被显式接受、接受理由、重测触发条件"——无此声明的 CONDITIONAL 视为 FAIL

---

## 附录：常用命令速查

```bash
# 查看 upstream 未合并提交
git fetch upstream
git log upstream/main ^main --oneline

# 查看指定提交的变更文件
git show --stat <hash>

# 预检冲突（不实际合并）
git cherry-pick --no-commit <hash>
git status
git cherry-pick --abort  # 取消预检

# 安全关键词筛查
git log upstream/main ^main --oneline | grep -iE "security|inject|traversal|CVE|fix.*auth|fix.*crypto"
```
