# Phase 5 实现规则（就近读入）

协调者在进入 Phase 5 前 Read 本文件，确保以下规则在当前 context 活跃。

---

## 专职团队路由规则

| module_package | 首选 Agent | 兜底 Agent |
|----------------|-----------|-----------|
| `happy-app` | `dev-module-team-app` | `general-purpose`（role prompt 注入） |
| `happy-server` 或 `happy-wire` | `dev-module-team-server` | `general-purpose`（role prompt 注入） |
| `happy-cli` | `dev-module-team-cli` | `general-purpose`（role prompt 注入） |
| 其他/跨包 | `dev-module-team` | `general-purpose`（role prompt 注入） |

**subagent_type 不存在时的降级规则**（G-11，2026-05-08）：
若调用某 subagent_type 时返回"Agent type not found"错误，**不得中止工作流**，立即自动降级至 `general-purpose`，并在 prompt 中注入该角色的职责描述（如"你是 dev-module-team-server，负责 happy-server 模块实现..."）。向用户输出一行提示：`[Phase 5 警告] subagent_type dev-module-team-server 不存在，已降级为 general-purpose + role prompt，功能无损失。`

未标注 `module_package` 的模块，协调者根据模块名称和 `module_source_dir` 推断所属包，无法推断时向用户输出警告（格式：`[Phase 5 警告] 模块 <name>（路径 <module_source_dir>）无法推断包归属，已路由至兜底 dev-module-team，建议检查 design_consolidated.md 的 module_package 字段`），再使用兜底。

**并行进度输出规范**：并行启动多个模块 Agent 时，协调者须在启动前向用户输出一次汇总（`[Phase 5] 并行启动 N 个模块：<name1>、<name2>…`），每个 Agent 完成时立即向用户输出单条进度（`[Phase 5] 模块 <name> 完成（<N>/<total>）`），全部完成后输出汇总结果。

## happy-wire 串行规则

若多个模块需改 happy-wire → 先按模块列表顺序**逐一串行**执行涉及 happy-wire 的模块（使用 `dev-module-team-server`，前一个 Agent 返回后再启动下一个），再并行执行其余模块；否则全并行。

## Phase B 完整性验证

收到模块返回时，检查 `impl_output` 文件末尾是否含 `PHASE_B_READY` 字段。

- 存在 `PHASE_B_READY: YES` → 执行前置验证（须全部通过才可记录为 YES）：
  1. **UT 已实际运行并通过**：`impl_output` 须包含 vitest/jest 实际运行输出（含通过用例数），仅代码自审不满足此条件。
  2. **测试文件存在性检查**：若 `design_<module>.md` 的测试策略节列出了需 vitest 覆盖的路径（catch 块/副作用/弹窗等），则使用 Glob 检查 `$module_source_dir/**/*.{test,spec}.{ts,tsx}` 是否存在对应测试文件；若任何文件缺失 → 降级为 `PHASE_B_READY: NO | UT: MISSING_FILES`，并向用户输出 `[Phase 5 警告] 模块 <name> 声明 PHASE_B_READY: YES 但测试文件缺失：<files>`。
  3. 前置验证全通过 → 记录 `PHASE_B_READY: YES`，继续流程。
- 存在 `PHASE_B_READY: NO | UT: BLOCKED` → 在 ESCALATE 列表记录该模块 UT-BLOCKED，传给 Phase 6。

  **合法的 BLOCKED 原因**（仅以下情形可声明 BLOCKED，否则须修复后重新提交）：
  - 依赖外部服务（数据库/网络/硬件）且测试环境无法提供
  - 上游 bug 已知（须在 impl_output 中注明 issue 链接）
  - 平台限制（如 iOS 真机专属 API 无法在 Simulator 运行）

- 存在 `PHASE_B_READY: NO | UT: MISSING_FILES` → 同 BLOCKED 处理，向用户输出警告并记录 ESCALATE 列表。
- 缺失任何 `PHASE_B_READY` 字段 → 向用户输出警告（`[Phase 5 警告] 模块 <name> 的 impl_output 缺少 PHASE_B_READY 字段，自审步骤可能未执行`），不阻塞流程，记录到 ESCALATE 列表供 Phase 6 关注。

## 超时/错误处理

若某个 module-team Agent 超时（默认超时 60 分钟）或返回错误，向用户输出：

> **[Phase 5 错误]** 模块 `<name>`（包：`<module_package>`）实现失败（原因：<超时/错误摘要>）。请选择：(a) 重试该模块 (b) 跳过该模块（标注 DEFERRED，进入 Phase 6 时明确提示跳过影响）(c) 中止工作流。

等待用户决策，不得静默继续。若用户选择 (b)，在 progress.md 中标注该模块为 `DEFERRED`，并将该信息传入 Phase 6 的 `deferred_modules` 参数。

## dev-test-engineer 错误处理

若 `dev-test-engineer` 超时或返回错误，`SCRATCH/test_cases.md` 缺失，向用户输出：

> **[Phase 5 错误]** 测试用例生成失败（测试工程师超时/错误）。请选择：(a) 重试 dev-test-engineer (b) 手动提供 test_cases.md 到 `SCRATCH/test_cases.md` 后继续 (c) 跳过 Phase 6.5（标注 DEFERRED）。

等待用户决策，不得静默继续。若用户选择 (c)，在 progress.md 中标注 `test-phase` 为 `DEFERRED`，Phase 6.5 将跳过。

---

## Context 保护规则（枢纽角色强制）

dev-workflow 是枢纽角色，context 极为宝贵，每轮迭代极为冗长。

- **必须委托**：所有可用 sub-agent 执行的工作，**必须通过 Agent 工具委托，禁止 inline 执行**
- **权限失败 = P0 blocking**：若 sub-agent 出现权限问题（Bash 沙箱等），**禁止降级为 inline 代为执行**，应立即标注 `BLOCKED: sub-agent <name> permission denied`，向用户报告，暂停当前 Phase 等待权限修复
- **目的**：保护协调层 context，避免因 inline 长任务导致后续决策质量下降或 context 溢出

---

## Phase 5 结束钩子：Native Build 前置提示

协调者在 Phase 5 全部模块实现完成后（所有 module-team Agent 已返回结果），执行：

### 检查逻辑

1. 遍历本次迭代所有模块，检查是否存在 `module_package == "happy-app"` 的模块：
   - 数据来源：协调者已从 design_consolidated.md 或 architecture.md 读取的模块列表
   - 若模块未标注 module_package，根据 module_source_dir 路径推断：路径包含 `packages/happy-app` 即视为 happy-app 模块

2. **若存在 happy-app 模块**：
   - 向用户输出提示：
     `[Phase 5 -> Build 提示] 本次迭代包含 happy-app 变更（模块：<module_name_list>），Phase 5 完成后需要执行 native build 才能进行完整的 iOS/Android E2E 测试。Native build 直接在当前会话执行（fastlane 因 keychain/证书本地依赖必须在主 session）。执行命令：fastlane ios release / fastlane android build（参考 /release skill）。`
   - 在 progress.md 末尾追加一行：`NATIVE_BUILD_REQUIRED: true`

3. **若不存在 happy-app 模块**：
   - 在 progress.md 末尾追加一行：`NATIVE_BUILD_REQUIRED: false`
   - 不输出提示（静默）

### 注意事项

- 此钩子**不启动** build 进程，仅做提示和标志位写入
- `NATIVE_BUILD_REQUIRED` 字段供后续 Phase（如 Phase 6.5 QA、Phase 7 交付）读取判断
- 若迭代仅涉及 happy-server / happy-cli / happy-wire 变更，无需 native build（E2E 容器重建即可）
- 若 progress.md 中已存在 `NATIVE_BUILD_REQUIRED` 行（如重入场景），覆盖而非重复追加

---

## Phase 5 结束钩子：Native Build 强制确认门（INFRA-10-PLUS）

**触发条件**：上方检查逻辑判定 `NATIVE_BUILD_REQUIRED: true` 并已写入 progress.md。

**此节在 NATIVE_BUILD_REQUIRED=false 时完全跳过，不输出任何内容。**

### 强制确认门逻辑

1. **输出阻塞提示**（必须在进入 Phase 6 之前执行）：
   ```
   [Phase 5 -> Phase 6 阻塞] NATIVE_BUILD_REQUIRED=true
   本次迭代包含 happy-app 变更，必须完成 native build 后才能进入 Phase 6 技术评审。

   请直接在当前会话执行 native build（fastlane ios release + fastlane android build），
   完成后在此回复：已完成 native build
   （或输入 "skip" 跳过，但 Phase 6.5 的 iOS/Android E2E 将标记为 DEFERRED-native）
   ```

2. **等待用户响应**：
   - 收到 "已完成 native build"（或等效确认，如 "done"、"build 完了"、"完成"）→ 解除阻塞，进入 Phase 6，并在 progress.md 中记录 `NATIVE_BUILD_CONFIRMED: true`
   - 收到 "skip" 或用户明确表示跳过 → 在 progress.md 中记录 `NATIVE_BUILD_CONFIRMED: false`，进入 Phase 6，但在 Phase 6.5 调用 qa-gatekeeper 时传入 `native_build_skipped: true`，qa-gatekeeper 须将 iOS/Android TC 标记为 `DEFERRED-native`
   - **收到其他内容或无响应** → **禁止进入 Phase 6**，重复输出等待提示，直至收到明确的"确认"或"skip"

3. **强制性说明**（此处写入规则，供协调者读取）：
   - 协调者**不得**在未收到用户响应前推进至 Phase 6
   - 即使是重入（progress.md 已存在 NATIVE_BUILD_REQUIRED: true）也须重新确认，除非同时存在 `NATIVE_BUILD_CONFIRMED: true` 字段
   - 重入且已有 `NATIVE_BUILD_CONFIRMED: true` 时，跳过确认门，直接进入 Phase 6
