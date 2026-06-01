# Upstream Batch 5 扫描报告

**日期**：2026-06-02  
**迭代**：IT22-03  
**Fork HEAD**：4b677752（迭代21，2026-06-02）  
**Upstream HEAD**：e10e5197（2026-06-01）  
**未合并 commits**：176 个  

---

## 摘要

Batch 5 候选约 45-50 个 commits，建议分阶段执行。无新增 P0 安全修复（所有已在 Batch 4 及之前合并）。

**立即行动**：Batch 5.0（3 commits，低风险）可在本迭代或迭代23起始执行。  
**建议执行时间**：迭代23（Batch 5.0+5.4 合并），App 性能专项迭代（Batch 5.2）。

---

## P0 安全修复（新增：0 个）

所有已知 P0 安全修复已合并到 fork：

| Commit | 描述 | Fork 状态 |
|--------|------|---------|
| e60816ed | shell injection & path traversal 修复 | ✅ 迭代12，062fdcf8 |
| 1744ff03 | CLI isMeta 用户消息过滤 | ✅ 迭代9，4d4c39a5 |
| a038957d | SDK isSynthetic→isMeta 传播 | ✅ 迭代9，4d4c39a5（成对） |
| 32c4b9f0 | 竞态条件、路径遍历、验证修复 | ✅ N/A（fork 已自然超越，迭代13） |
| c2b9e16a | Socket 重连初始化修复 | ✅ 迭代18，1278c480 |
| b7297317 | App 紧凑会话指示符稳定化 | ✅ 迭代18，1278c480 |

---

## P1 候选：关键稳定性 Bugs

| Commit | 描述 | 适用性 | 复杂度 | 依赖 | Batch |
|--------|------|--------|--------|------|-------|
| **9c698a59** | 新创建 machine 在实时更新中缺失（new-machine schema） | ✅ 高 | 低 | 无 | 5.0 |
| **812f4e1b** | Codex permission-mode plumbing + full-yolo 策略 | ✅ 中 | 低 | 无 | 5.0 |
| **00725d20** | CLI bundled server Prisma engine 路径修复 | ⚠️ 中（bundled mode 触发） | 低 | 无 | 5.1 |
| **31a6e4df** | Pino multistream（bundled logging） | ⚠️ 中 | 低 | 依赖 00725d20 | 5.1 |
| f8c0c0db | CLI 会话 resume 清除孤儿权限请求 | — | — | — | 已合并迭代9 |
| 36b23d57 | CLI JSONL replay 竞态修复 | — | — | — | 已合并迭代9 |

---

## P2 候选：产品体验优化

| Commit | 描述 | 适用性 | 复杂度 | 依赖 | Batch |
|--------|------|--------|--------|------|-------|
| **22181f79** | Server 停止发送 per-message push 通知 | ✅ 中 | 低 | 无 | 5.0 |
| **3caa51b4** | App RN Blob polyfill ArrayBuffer→uri（S3/附件上传 iOS/Android fix） | ✅ 高 | 低 | 无 | 5.2 |
| **972bcef1** | App chat-title 元数据竞态修复 | ✅ 中 | 低 | 配对 5a914a20 | 5.2 |
| **ba7b2294** | App chat 滚动 + diff overlay 性能修复 | ✅ 高 | 中 | 配对 5a914a20+972bcef1 | 5.2 |
| **b042d834** | Agent 默认值可配置（per-session model/tools）| ⚠️ 需产品确认 | 中（24 文件） | 无 | 5.3（PO 决策后） |
| **ab4696a3** | 更高聊天框 + web/desktop 新会话输入 | ✅ 低 | 低 | 无 | 5.4 |
| **6f669691** | groupToolCalls 默认关闭 | ✅ 低 | 低 | 无 | 5.4 |
| **266c0072** | 工具调用分组折叠展示 | ✅ 低 | 低 | 无 | 5.4 |
| **03ca2219** | settings tool call 分组 toggle | ✅ 低 | 低 | 无 | 5.4 |
| **17f37337** | CLI webappUrl 从 settings.json 解析 | ✅ 低 | 低 | 无 | 5.4 |

---

## P3 候选：性能优化

| Commit | 描述 | 适用性 | 复杂度 | 依赖 | Batch |
|--------|------|--------|--------|------|-------|
| **5a914a20** | App 消息懒加载 + 并行 AES 解密 + backward pagination | ✅ 高 | 高 | 配对 972bcef1+ba7b2294 | 5.2（严格顺序） |
| **514ef3f1** | AgentInput 非受控 textarea（JS帧率→原生帧率） | ⚠️ 中 | 中 | **必须成对** a28b9a94 | 5.5（App性能专项） |
| **a28b9a94** | App Fabric 发送后清除输入框 | ⚠️ 中 | 低 | **必须成对** 514ef3f1 | 5.5（App性能专项） |
| **f9fa2aff** | CLI cross-spawn（Windows 兼容） | ✅ 中 | 低 | 无 | 5.4 |
| **2e6f7e35** | App changelog 重构为单 markdown | ✅ 低 | 中 | 无 | 5.4 |
| **a944cbd4** | App changelog 卡片样式 | ✅ 低 | 中 | 依赖 2e6f7e35 | 5.4 |

---

## SKIP 列表（70+ 个）

| 理由 | 数量 | 示例 |
|------|------|------|
| UI 微调/样式（不影响功能） | 30+ | cb2fc38b, 11209ec0, 2a0694e3 |
| 文档更新/changelog | 15+ | 30e9ba3b, 849ce4fc, 81318411 |
| 测试/CI 改动 | 10+ | e10e5197, 21c6ced0 |
| Release 版本标记 | 5+ | 904c9417, 05d2e723 |
| **c4b13d90** | 桌面 UI 大改造（500+ 文件），与 fork UI 分叉冲突风险高 | 1 |
| 功能开发进行中 | 5+ | 511917e1（Codium projects） |

---

## Dep-Graph Spike 结论

```
Batch 5.0（无依赖，立即可执行）
  9c698a59 — new-machine onboarding fix
  812f4e1b — codex permission plumbing
  22181f79 — push optimization（server）

Batch 5.1（可选，bundled binary 相关）
  00725d20 — bundled Prisma engine
       ↓
  31a6e4df — pino multistream

Batch 5.2（序列化，App 性能专项）
  3caa51b4 — blob polyfill（独立，可先合并）
       ↓
  5a914a20 — lazy-load + parallel decrypt
       ↓
  972bcef1 — chat-title race
       ↓
  ba7b2294 — scroll + diff overlay

Batch 5.3（PO 决策后）
  b042d834 — agent defaults（需产品确认）

Batch 5.4（低优先级，随其他 batch 顺带）
  ab4696a3, 6f669691, 266c0072, 03ca2219, 17f37337, f9fa2aff
  2e6f7e35 → a944cbd4（顺序）

Batch 5.5（不建议本轮）
  514ef3f1 ← a28b9a94（成对，App 性能专项时重评）
  c4b13d90（体量过大，待单独规划）
```

**关键约束**：
- `5a914a20 → 972bcef1 → ba7b2294` 合并顺序为硬依赖（均改 sync.ts 消息处理链路）
- `514ef3f1 + a28b9a94` 必须成对（单独 cherry-pick 514ef3f1 将导致 iOS/Android 发送后输入框不清空）

---

## 执行建议总结

| 阶段 | 候选 commits | 工作量 | 风险 | 建议时间 |
|------|------------|--------|------|---------|
| **Batch 5.0** | 3 个 | 1-2 天 | 🟢 低 | 迭代23起始 |
| **Batch 5.1** | 2 个（成对） | 1 天 | 🟡 中 | bundled binary 打包测试时 |
| **Batch 5.2** | 4 个（序列化） | 3-4 天 | 🟡 中 | App 性能专项迭代 |
| **Batch 5.3** | 1 个 | M | 🔴 高 | PO 产品确认后 |
| **Batch 5.4** | 8 个（UI 打磨） | 1-2 天 | 🟢 低 | 随 Batch 5.0 顺带 |
| **Batch 5.5** | 2 个 | — | 🔴 高 | App 性能专项或 UI 稳定后 |

**PO 决策请求**：`b042d834`（agent 默认值可配置）是否纳入 Batch 5.3？需要产品方向确认。
