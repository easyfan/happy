# Upstream Batch 5.5 快扫报告

**扫描日期**：2026-06-04
**基准 commit**：a944cbd4（B5.4 最后合并项：changelog card style）
**扫描范围**：upstream/main 上 a944cbd4 之后的新增 71 个 commits
**总结**：71 commits 中约 25 个已通过早期 Batch 合入，约 14 个可直接 SKIP，约 10 个为新增 CHERRY-PICK CANDIDATE，7 个需 INVESTIGATE，15 个为 DEFERRED（含账本已有条目）。

---

## 一、候选 commit 列表

### 1A. CHERRY-PICK CANDIDATE（新增，尚未合入，可直接应用）

| Hash | 内容摘要 | 包 | 优先级 | 说明 |
|------|---------|-----|--------|------|
| `c1cd0fb6` | doctor clean --help guard，防止意外 kill daemon | CLI | P1 | 1文件 +12行，XS。目前 `happy doctor clean` 无 --help 守卫，直接执行危险操作 |
| `cb2fc38b` | 强制 grayscale font smoothing 修复 Safari 缩放下文字锯齿 | App CSS | P2 | 1文件 +7行，XS。修复 web/desktop Safari 缩放时字体渲染问题 |
| `64125285` | Dockerfile.webapp 增加 HAPPY_SERVER_URL build arg | CI/Infra | P2 | 1文件 +2行，XS。自托管 webapp Docker build 可指定 server URL |
| `3204dd2f` | slash command chip 修复：parseLocalCommandMessage 支持 command-args | App | P1 | 3文件，S。修复带参数 slash command 显示重复内容的 bug，补 14 个测试 |
| `76caca3a` | autocomplete limit 5→50 + 键盘选择滚动跟随 | App | P2 | 2文件，S。命令/文件补全从仅显示5个提升到50个，arrow key 保持选中项可见 |
| `e7453263` | web composer 支持图片拖拽 drop（原本只有 paste） | App | P2 | 1文件 +45行，S。web 端拖拽图片到聊天框，与 paste 路径对齐 |
| `cef3fa7f` | MarkdownView bullet 渲染修复（• 替换 "- "，嵌套支持） | App | P2 | 3个 markdown 相关文件，S。我们 MarkdownView 目前仍显示原始 "- " |
| `5c7bf0fd` | changelog migration：老用户从版本号体系升级时正确显示 whats-new banner | App | P1 | 1文件，XS。不合入则老用户升级后永远不见 changelog 提示 |
| `18635e57` + `512e1b8d` | server 指标使用估算行数替代精确 COUNT（性能优化） | Server | P2 | 2文件，XS。metrics2.ts + 测试，减少 DB 负担 |
| `9c698a59` server侧 | machinesRoutes.spec.ts（server 侧 POST /v1/machines 契约测试） | Server | P2 | 1文件 +179行，S。我们的 a11d10b6 只合了 app 侧，server 侧 spec 未合；跨包契约测试，防止 new-machine 协议再次漂移 |

### 1B. 已合入（通过我们自己的 commit 实现，无需重新合并）

| Hash | 合入对应 | 说明 |
|------|---------|------|
| `812f4e1b` | f1bc452d (UP-01-cli) | Codex permission-mode plumbing |
| `9c698a59` app侧 | a11d10b6 (UP-01-app) | new-machine handler（app 侧） |
| `b7297317` | c66e1cf0 (batch3) | compact session indicators |
| `c2b9e16a` | c66e1cf0 (batch3) | socket reconnect fix |
| `ab4696a3` | 1040d831 (B5.4) | taller chat（我们自己实现） |
| `266c0072` | 6b5df052 (B5.4) | tool call grouping |
| `03ca2219` | B5.4 | groupToolCalls settings toggle |
| `6f669691` | B5.4 | groupToolCalls default off |
| `2327f49c` | 33c7fefb | local command chips |
| `313a4706` | 5a81adda (batch4) | app sync fix |
| `8fe04a51`+`62da7974`+`50439047` | 226c893d (batch4) | stdin cleanup |
| `93fec60f` | 5a81adda (batch4) | wait for session sync |
| `972bcef1` | sync.ts（直接合入） | chat-title 竞态修复 |
| `5981a899` | 8c81d7d2 | happy server self-host |
| `31a6e4df` | 8c81d7d2 | pino multistream |
| `ba7b2294` | 85721cdf | chat scroll + diff overlay |
| `3caa51b4` | 5e9b6b37 | RN Blob polyfill |
| `f8c0c0db`+`1744ff03`+`a038957d`+`36b23d57`+`17f37337`+`22181f79`+`f9fa2aff` | 4d4c39a5 (batch1) | Batch 1 全部 |
| `e10e5197` | 我们自己已 un-skip | secretKeyBackup 测试（我们更早完成） |

### 1C. SKIP（上游运营/内部/Tauri 专用，不适用我们 fork）

| Hash | 内容 | Skip 原因 |
|------|------|-----------|
| `450f29e9` | 特定账户 voice 额外额度 | 上游运营白名单（`cmp66x5u018d9wz0unf56tp07`），fork 不适用 |
| `4a64c66a` | macOS/Tauri 签名 entitlements | 我们不发布 Tauri 桌面版 |
| `f5e2d87a` | Tauri 外链在系统浏览器打开 | Tauri 专用 |
| `6c262b75` | Tune desktop header and default zoom | Tauri/desktop 专用 |
| `511917e1` | Codium projects and agents | Codium 专用包，我们无 Codium |
| `5cc918ca` + `fa88ac70` | 隐藏 image upload（broken）| 上游图片上传功能不完整暂时隐藏，我们已有完整实现（不隐藏） |
| `096adeda` | 删除 test changelog entry | 仅 CHANGELOG.md 内容，我们有自己的 changelog |
| `c4b82fc6` | docs(plan): rename 规划文档 | 上游内部规划，无代码变更 |
| `68ca7357` | docs(skill): control-flow | 上游内部 skill 文档 |
| `81318411` | docs: tauri desktop packaging plan | 上游内部规划 |
| `30e9ba3b` + `9c55a763` + `3ccbd713` + `75c928b7` | docs(skill) 系列 | 上游内部 skill 维护文档 |
| `0bfb7041` | chore(skills): sessions skill | 上游内部 skill |
| `8cd3054e` + `849ce4fc` | docs(changelog/app) | 上游内部文档 |
| `68607b55` | Adjust probe settings in handy.yaml | 上游 infra 配置 |
| `21c6ced0` | Enforce publish-time package checks | 主要改 SKILL.md（上游发版流程），不影响我们 |
| `ab588cfd` | Add local agent skills and self-host plan | 上游内部 docs/skills |
| `904c9417` + `05d2e723` + `5e6e28b2` + `0f8aa14f` | Release CLI version xxx | 上游版本号 bump |
| `2a0694e3` | Merge origin/main into feat/app-polish | upstream 内部 merge commit |
| `700b1c09` | ci: retrigger after transient electron 502 | 上游 CI 操作 |

### 1D. INVESTIGATE（需深入分析，可能有冲突或影响）

| Hash | 内容 | 调查要点 |
|------|------|---------|
| `e1f2dca9` | Remove unused project manager（删除 projectManager.ts 308行）| 我们的 storage.ts 和 sync.ts 有大量 projectManager 引用；上游认为未使用，但我们 fork 可能仍依赖。需确认我们哪些功能依赖 projectManager，是否可以移除 |
| `d2d2f730` | Split self-host server package（happy-server → happy-server-self-host，变为公开包）| 我们的 package.json 仍是 private: true 原始状态。需评估是否需要跟随上游重命名为公开 npm 包，及对我们 Docker 部署的影响 |
| `17aa703f` | surface build metadata in settings（app.config.js + SettingsView）| 我们的 app.config.js 有大量自有扩展（enableGms, withAndroidSigning 等），合并有冲突风险。功能本身有价值（显示构建 SHA/时间戳） |
| `58d5ecb8` | Set webapp zoom default to 1x（AGENTS.md + useTauriZoom.ts）| 我们无 AGENTS.md，仅 useTauriZoom.ts 改动 XS；但需确认 1x 默认是否影响我们的 web 布局 |
| `11209ec0` | remove folder icons from sidebar and header titles | 影响 3 个 UI 组件（ActiveSessionsGroupCompact, ChatHeaderView, SessionsList），需确认我们有无相关 UI 分叉 |
| `f749b436` | Clean up file tree rows | FilesSidebar.tsx，涉及我们 fork 文件树 UI |
| `b042d834` | Add configurable agent defaults | **已在 Divergence Ledger DEFERRED（Agent 偏好设置专项迭代）**，见下节 |

---

## 二、Session Fork/Duplicate 系列溯源

### 266c0072 溯源状态（延续 IT24 分析）

Divergence Ledger 中已记录的 session fork/duplicate UI 系列（`1fd27ee4` → `e7c4d644` → `f563e01b` → `a2a888f5`）在 a944cbd4 之后**无新增 commits**。

上游 B5.4 之后的 71 个新增 commits 中，未发现任何涉及 `DuplicateSheet`、`canFork`、`handleForkFromMessage`、`useSessionQuickActions` 的新修改。

**溯源结论**：session fork/duplicate 系列在 B5.5 窗口内没有新增内容，维持当前 Ledger 状态（待 arch review + `c4b13d90` 一并决策）。

---

## 三、安全/P0 候选

上游 a944cbd4 之后的 71 个 commits 中，**无安全关键 commit**。

- `e10e5197`（secretKeyBackup 测试 un-skip）：我们的 fork 在此之前已完成 un-skip，不构成新增
- 无新 shell injection / path traversal / crypto 路径修改
- 无新 auth / session 安全修复

**结论**：B5.5 窗口内无 P0 安全候选，无需紧急处理。

---

## 四、建议 Batch 5.5 范围

### 小批次 A（XS~S，可快速合入，~1 天）

按包层级分组，无顺序依赖：

**CLI（1个）**
- `c1cd0fb6` — doctor clean --help guard（Pattern: 纯新增，无冲突，XS）

**App（6个）**
- `3204dd2f` — slash command chips fix，修复带参数命令显示错误（有配套测试，S）
- `cef3fa7f` — MarkdownView bullet 渲染修复（3个 markdown 文件，S）
- `5c7bf0fd` — changelog migration banner fix（useChangelog.ts，XS）
- `76caca3a` — autocomplete limit 5→50 + scroll 跟随（S）
- `e7453263` — web 图片拖拽 drop（XS）
- `cb2fc38b` — grayscale font smoothing Safari fix（CSS，XS）

**Server（2个）**
- `18635e57` + `512e1b8d` — metrics 估算优化（2文件，XS）
- `9c698a59` server侧 — machinesRoutes.spec.ts 契约测试（1文件，S）

**Infra（1个）**
- `64125285` — Dockerfile.webapp HAPPY_SERVER_URL（XS）

**合计**：10 个 commits，估算 ~4-6 小时（含 typecheck 验证）

### INVESTIGATE 候选（M，下次 Batch 评估）

以下需要先做 spike 再决定：
- `e1f2dca9` — projectManager 删除（需确认我们的 projectManager 用法，可能是 SKIP 或需要先移除我们的依赖）
- `d2d2f730` — server 包名变更（需 PO 决策是否跟随上游改为公开包）
- `17aa703f` — build metadata（app.config.js 冲突分析）
- `58d5ecb8` + `11209ec0` + `f749b436` — UI 小修（需确认无 fork 冲突，若无则可入小批次）

---

## 五、Divergence Ledger 更新建议

### 新增条目

1. **`e1f2dca9`（Remove unused project manager）** — 上游 2026-05-17 删除，我们有大量依赖。建议状态：**INVESTIGATE**，重评条件：确认我们 fork 中 projectManager 的实际调用路径是否仍在使用（Sidebar/Sessions 等），再决定是否同步删除或保留。

2. **`d2d2f730`（Split self-host server package）** — 上游将 happy-server 重命名为 happy-server-self-host 并变为公开 npm 包。建议状态：**DEFERRED（PO 决策）**，重评条件：产品方向确认是否需要公开发布 server 包，或维持我们的私有部署模型。

3. **`cef3fa7f` + 以上 B5.5 CANDIDATES** — 列入"待合并"，Batch 5.5 小批次 A 执行。

### 修改条目

- `4533ef56`（Preact CJS 补丁）：本次扫描未发现上游有 follow-up commit，维持原状（待评估）
- `514ef3f1` + `a28b9a94`（uncontrolled textarea 成对）：B5.5 无新变化，维持 DEFERRED（App 性能专项迭代）
- `00725d20`（bundled Prisma engine）：维持暂缓
- `b042d834`（configurable agent defaults）：维持 DEFERRED（Agent 偏好设置专项迭代）
- `c4b13d90`（Desktop UI，500+ 文件）：B5.5 无新变化，维持暂不合并
- session fork/duplicate UI 系列（`1fd27ee4` 等四件套）：B5.5 无新变化，维持待 arch review

---

## 附：已处理 commits 快查

以下 commits 出现在 `git log HEAD..upstream/main` 中（因我们用自有 commit 实现，Git 不识别为已合入），确认无需操作：

```
已合入对应关系（上游hash → 我们的实现）:
812f4e1b → f1bc452d | 9c698a59(app) → a11d10b6 | b7297317 → c66e1cf0
c2b9e16a → c66e1cf0 | ab4696a3 → 1040d831 | 266c0072 → 6b5df052
03ca2219 → B5.4 | 6f669691 → B5.4 | 2327f49c → 33c7fefb
313a4706 → 5a81adda | 8fe04a51+62da7974+50439047 → 226c893d
93fec60f → 5a81adda | 972bcef1 → sync.ts直接合入
5981a899 → 8c81d7d2 | 31a6e4df → 8c81d7d2 | ba7b2294 → 85721cdf
3caa51b4 → 5e9b6b37 | f8c0c0db+1744ff03+a038957d+36b23d57+17f37337+22181f79+f9fa2aff → 4d4c39a5
e10e5197 → 我们自己已 un-skip
```
