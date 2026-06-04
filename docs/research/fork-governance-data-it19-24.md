# Fork Governance 实证数据 — IT19/22/23/24

**收集日期**：2026-06-04
**数据来源**：4 次 upstream 迭代（IT19 Batch4 / IT22 纯研究 / IT23 Batch5.0+BUG22 / IT24 Batch5.4）
**分析目的**：评估 fork governance 方法论有效性，评估是否达到博客/SEIP 发表门槛

---

## 一、逐迭代数据

### IT19 — Upstream Batch 4（2026-05-29 ～ 2026-05-31）

**数据来源**：`po/audit-upstream-batch-4-2026-05-31.md`（完整 audit 报告存在）

| 指标 | 值 | 说明 |
|------|----|------|
| QA 总轮次 | 1 | Round 1 CONDITIONAL GO，PO 第 1 轮接受 |
| CONDITIONAL 条件数 | 2 | TC-E2E-W-05/TC-UP-E03（stdin drain）+ TC-E2E-I-03（iOS） |
| CONDITIONAL 接受/拒绝 | 2/0 | 全部接受（基础设施限制，代码审阅确认正确） |
| 触发 Pattern 类型 | C × 1, D × 0 | TC-E2E-W-05 需活跃 remote session → Pattern C（验证盲区）；iOS Simulator TextInput 限制 → Pattern C |
| Phase 5 返工次数（ESCALATE 项）| 0 | Phase 5 Tech Lead BLOCK = 0 |
| 计划 vs 实际复杂度 | 计划 S，实际 2/5 | 规划 dep-graph spike 后 6 commits，无意外；手工 merge 8fe04a51 时发现 fork 定制逻辑需保护，超出预期但控制在范围内 |
| DEFERRED-infra 项 | 是 | TC-E2E-I-03 iOS Simulator TextInput 限制 |

**补充说明**：
- Upstream 合入 6 commits，SKIP 2 commits（cef3fa7f changelog 污染 / 1f72db29 N/A）
- 合并流程 upstream 精简模式（Phase 0→5→6→6.5→7），Phase 6 tech_review 以 Phase B 自审替代
- 最大亮点：dev-module-team-cli 在手工 merge 8fe04a51 时正确识别并保留 fork 的 RemoteModeDisplay 定制逻辑

---

### IT22 — 纯技术调研迭代（2026-06-02）

**数据来源**：IT22 audit 报告未找到（`po/audit-iteration-22-2026-06-02.md` 不存在），数据从 task-board.md 重建

| 指标 | 值 | 说明 |
|------|----|------|
| QA 总轮次 | 0 | 纯调研迭代，无生产代码产出，无 E2E 验收（同 IT25 先例） |
| CONDITIONAL 条件数 | 0 | 无 QA |
| CONDITIONAL 接受/拒绝 | N/A | — |
| 触发 Pattern 类型 | 无 | 无 cherry-pick 操作 |
| Phase 5 返工次数 | 0 | 无 Phase 5 实施 |
| 计划 vs 实际复杂度 | 计划 XS+XS+S，实际 1/5 | 三个调研任务（BUG-21 spike / BUG-22 arch / Upstream Batch 5 快扫）单日完成，与预期吻合 |
| DEFERRED-infra 项 | 否 | — |

**补充说明**：
- IT22 是纯研究迭代：BUG-21 iOS 冷启动 profiling + BUG-22 配置同步方案评估 + Upstream Batch 5 PR 扫描
- 3 个任务均完成，产出 `docs/research/bug21-ios-coldstart-spike.md` + `docs/research/bug22-gear-config-sync-arch.md` + `docs/research/upstream-batch5-scan.md`
- 此类迭代不产出实证数据，但作为后续 IT23 cherry-pick 的前置决策依据

---

### IT23 — Upstream Batch 5.0 + BUG-22 配置同步（2026-06-02）

**数据来源**：`po/audit-iteration-23-2026-06-02.md`（完整 audit 报告存在）

| 指标 | 值 | 说明 |
|------|----|------|
| QA 总轮次 | 3 | 第1轮 context 溢出（语言漂移）无效；第2轮 BLOCKED-env+BLOCKED-material；第3轮发现并修复 BUG-IT23-01 后 CONDITIONAL GO |
| CONDITIONAL 条件数 | 2 | TC-CFG-03 iOS 离线场景 + TC-DIAG-01 CDP 日志捕获 |
| CONDITIONAL 接受/拒绝 | 2/0 | 全部接受（Android 同路径 PASS / `__DEV__` 代码审阅确认） |
| 触发 Pattern 类型 | B-外部 × 1, C × 1, A × 1 | Pattern B-外部：BUG-IT23-01 CORS 漏检（Phase 5+6 双重漏检，api.ts 全局配置依赖隐式）；Pattern C：iOS TC-CFG-03 基础设施限制；Pattern A：server PATCH 端点在 Docker + CORS 环境下的额外验证场景 |
| Phase 5 返工次数（ESCALATE 项）| 2 | schema.prisma 漏提交（CONFIG-server）+ RawSession type 漏提交（CONFIG-app），Phase 6 捕获后修复 |
| 计划 vs 实际复杂度 | 计划 XS+S+S，实际 3/5 | 原计划 3 个任务，但 Phase 5 两处漏提交 + QA 3轮 + BUG-IT23-01 CORS 修复大幅增加实际消耗；单日完成但边界紧张 |
| DEFERRED-infra 项 | 是 | TC-CFG-03 iOS（Simulator 基础设施限制） |

**补充说明**：
- P1 Bug（BUG-IT23-01 CORS）由 QA 第 3 轮实测发现，Phase 5+6 双重漏检根因：`api.ts` CORS methods 数组为全局手工维护，非路由层显式声明
- 16 个新单测新增（CLI 5 + Server 6 + App 5）
- QA Gatekeeper 第 1 轮 context 溢出触发韩文输出（本地禁令生效，轮次作废），属方法论层风险

---

### IT24 — Upstream Batch 5.4（2026-06-03 ～ 2026-06-04）

**数据来源**：`po/audit-iteration-24-2026-06-04.md`（完整 audit 报告存在）

| 指标 | 值 | 说明 |
|------|----|------|
| QA 总轮次 | 5 | Round 1 正常；Round 2 漏测 Android/Web + TC-CFG-03 设计错误；Round 3 漏测 TC-BUG23；Round 4 "代码共享"豁免被 PO 否决；Round 5 发现 Android 用了 production APK（错误 build），重测后 PASS |
| CONDITIONAL 条件数 | 4 | TC-B54-06/07 iOS PARTIAL + TC-CFG-03 iOS PARTIAL + TC-CFG-03 Android PARTIAL + TC-BUG23-02 DEFERRED-infra |
| CONDITIONAL 接受/拒绝 | 4/0（1 次被否后重测）| Round 4 "代码共享"豁免被 PO 拒绝（要求实测），Round 5 补测 PASS 后接受 |
| 触发 Pattern 类型 | B-外部 × 1, C × 2 | Pattern B-外部：266c0072 引用 DuplicateSheet/canFork，来自未合入的 session fork/duplicate 系列（Phase 3 需溯源，已建立 §6.6 规程）；Pattern C × 2：iOS Simulator 键盘遮挡（TC-CFG-03）+ TTL 5分钟路径无等待窗口（TC-BUG23-02）|
| Phase 5 返工次数（ESCALATE 项）| 0 | P0 Bug = 0，Phase 5 实施无 ESCALATE |
| 计划 vs 实际复杂度 | 计划 S，实际 4/5 | QA 五轮（规范执行下应为 1-2 轮）是最大意外；附带发现并修复 withAndroidSigning `package com.helloworld` 系统性 bug 超出计划范围 |
| DEFERRED-infra 项 | 是 | TC-BUG23-02 TTL 5分钟路径 + TC-CFG-03 iOS 真实设备 |

**补充说明**：
- 五轮 QA 根因分析：QA Gatekeeper 倾向 DEFERRED 而非建立前置条件（未检查 dev vs production APK 要求；未主动启动 CC 进程作为 TC-BUG23 前置条件）
- 新增 G-ANDROID-E2E-01（Android E2E 必须用 dev build）
- cherry-pick diff context 溯源方法论升级（upstream-merge-sop §6.6），防范 B-外部隐式依赖

---

## 二、汇总统计

> 注：IT22 为纯研究迭代，不含 cherry-pick 操作，以下汇总中 cherry-pick 相关统计排除 IT22（n=3）

| 指标 | IT19 | IT22 | IT23 | IT24 | 均值（含cherry-pick迭代） | 最大 | 最小 |
|------|------|------|------|------|--------------------------|------|------|
| QA 轮次 | 1 | 0 | 3 | 5 | 3.0 | 5 | 1 |
| CONDITIONAL 条件数 | 2 | 0 | 2 | 4 | 2.7 | 4 | 2 |
| CONDITIONAL 接受率 | 100% | N/A | 100% | 100%（1次补测后）| 100% | — | — |
| Phase 5 返工（ESCALATE 项）| 0 | 0 | 2 | 0 | 0.7 | 2 | 0 |
| 上线后 P0 Bug | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 计划复杂度（1-5）| 2 | 1 | 3 | 4 | 3.0 | 4 | 2 |
| DEFERRED-infra 有/无 | 有 | 无 | 有 | 有 | 有（3/3 cherry-pick 迭代）| — | — |

**关键发现**：
1. **P0 Bug 零上线**：3 次 cherry-pick 迭代上线后 P0 Bug 均为 0，方法论的安全门控有效
2. **QA 轮次波动大**：从 1 轮到 5 轮，方差高；根因不在方法论本身，而在执行层 QA Gatekeeper 行为规范
3. **CONDITIONAL 全部接受**：所有 CONDITIONAL 条件均为基础设施限制（iOS Simulator / remote session 不可用），无功能性 CONDITIONAL
4. **DEFERRED-infra 普遍**：所有 cherry-pick 迭代均有 DEFERRED-infra，iOS Simulator TextInput / dev build 要求是反复出现的根因

---

## 三、Pattern 分布

基于 upstream-merge-sop.md §6.2 的四类模式（A/B/C/D）：

| Pattern | 全称 | 出现次数（3次cherry-pick迭代）| 典型案例 |
|---------|------|------------------------------|---------|
| A — Scope Gap | 修复场景在 upstream 环境中定义，我们有额外运行场景 | 1 次 | IT23：server PATCH 端点在 Docker + Web CORS 环境下的额外验证场景（upstream 无 CORS 配置概念）|
| B-外部 — 隐式依赖链（Batch 外）| cherry-pick 提交依赖 Batch 范围外的 upstream 历史 | 2 次 | IT23：api.ts CORS methods 数组全局手工维护，新 endpoint 需同步但 Phase 5/6 均未覆盖；IT24：266c0072 引用 DuplicateSheet/canFork，依赖未合入的 session fork/duplicate 系列 |
| B-内部 — 隐式依赖链（Batch 内）| 同 Batch 内提交互相依赖 | 1 次 | IT19：stdin 系列 8fe04a51→62da7974→50439047 顺序依赖，dep-graph spike 正确识别 |
| C — 验证盲区 | 场景覆盖不到（iOS 真机 / APNs / dev/debug 屏幕 / 容器网络）| 5 次 | IT19 TC-E2E-I-03（iOS Simulator TextInput）；IT23 TC-CFG-03 iOS；IT24 TC-B54-06/07 iOS + TC-CFG-03 iOS + TC-BUG23-02（5分钟TTL）|
| D — 环境假设不兼容 | 提交隐含的假设与我们的 Docker/容器环境不符 | 0 次 | 无（现有迭代未触发 D 类，可能因 Batch 规模较小，环境假设差异未暴露）|

**Pattern 分布结论**：
- C（验证盲区）是最高频 Pattern，根本原因是 iOS Simulator 基础设施持续受限
- B-外部 × 2 是最高影响 Pattern：均导致了 QA 阶段才发现的问题（BUG-IT23-01 CORS / IT24 diff context 溯源）
- D 类未触发，说明现有 Batch 规模（2-7 commits）控制良好，未踩到环境假设不兼容的雷区

---

## 四、发表可行性评估

### 数据完整性评估

| 维度 | 状况 | 说明 |
|------|------|------|
| 样本量 | 3 次有效 cherry-pick 迭代 | IT22 为纯研究迭代，不含 cherry-pick 操作，实际样本 n=3 |
| 数据完整性 | IT19/IT23/IT24 完整；IT22 无 audit 报告 | 3 次迭代有完整 audit 报告，指标可对比 |
| 方法论文档化 | 完整 | upstream-merge-sop.md 含 Pattern A/B/C/D 定义 + 门控清单 + Gotcha |
| 量化指标 | 部分 | QA 轮次 / Pattern 频次 / P0 Bug 率有数据；"计划 vs 实际耗时"主观估算，无精确时间戳 |
| 对照组 | 无 | 无未使用该方法论的对照组数据，无法做统计显著性检验 |

### 发表可行性结论

**结论：NO-GO（当前阶段）**

**理由**：
1. **样本量不足**：n=3 次有效 cherry-pick 迭代，低于学术发表的最低实证样本要求（SEIP/ICSE 通常要求 5-10 次迭代或对比实验）
2. **无对照组**：无法证明"有方法论"vs"无方法论"的差异，当前数据只能描述现象，不能建立因果
3. **关键指标缺精确计量**：计划 vs 实际耗时依赖主观评分（1-5），无客观时间记录（各 Phase 开始/结束时间戳）；QA 轮次方差大（1 ～ 5），无法确定是方法论问题还是执行层问题
4. **IT22 数据缺失**：IT22 audit 报告不存在，IT22 作为纯研究迭代本身无 cherry-pick 数据，但 audit 缺失意味着部分决策上下文丢失

**工程博客（CONDITIONAL GO）**：
- 若目标是内部/公司工程博客（非同行评审），n=3 足够作为实践分享
- 条件：① 明确标注"早期实证，样本量有限"；② 聚焦方法论描述（Pattern A/B/C/D 分类框架）和单案例深度（BUG-IT23-01 CORS 发现路径）；③ 不做统计推断

---

## 五、下一步建议

### 短期（IT25-IT27，继续数据积累）

1. **补录精确时间戳**：从 IT25 开始，在 audit 报告中记录每个 Phase 的开始/结束时间（格式：`YYYY-MM-DD HH:MM`），建立客观的耗时基线

2. **结构化 Pattern 记录**：每次 cherry-pick 迭代在 audit 的 Benchmark 指标节中增加专项"Pattern 触发表"（参照本文件格式），避免事后重建困难

3. **QA 轮次根因标注**：每轮 QA 结束时标注触发原因（执行层问题 / 方法论漏洞 / 基础设施限制），便于后续区分"可控"vs"不可控"轮次增加

4. **建立 IT22 类迭代的数据范式**：纯研究迭代在 task-board 中有完整记录，但无 audit 报告，建议标准化为"轻量级 audit（1页）"，至少记录调研结论如何影响后续迭代决策

### 中期（5次 cherry-pick 迭代后，约 IT27-28）

- **重评发表可行性**：达到 n=5-6 次 cherry-pick 迭代后，结合时间戳数据，重新评估 SEIP/工程博客可行性
- **考虑加入对照组设计**：若有机会引入未走完整方法论的小批量实验（如快速单 commit cherry-pick），可建立弱对照

### 长期（如计划投稿 SEIP 2027 或 ICSE 工具轨道）

- 需补充：① n≥8 次迭代；② 精确时间数据；③ 至少 1 个对照组（同规模开源 fork 项目的 cherry-pick 实践）；④ 工具自动化（Pattern 分类 checker）
- 建议研究问题聚焦："在端对端加密 fork 中，cherry-pick Pattern B-外部（隐式跨 Batch 依赖）是否是 QA 轮次增加的主要预测因子？"

---

*数据收集人：研究员 Agent（IT25-RESEARCH-01）*
*最后更新：2026-06-04*
