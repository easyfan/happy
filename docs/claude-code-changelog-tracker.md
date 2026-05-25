# Claude Code SDK Changelog Tracker

> 生成日期：2026-05-19 | 最后更新：2026-05-21（接入 claude-code-source 源码研究）
> 维护者：迭代8研究（TECH-20）  
> 源码路径：`~/claude-code-source/claude-code/`（反编译还原版），wiki `ccs_*` 系列页面

## 当前版本状态

| 包名 | 版本 | upstream 版本 | 状态 | 最后检查 |
|------|------|-------------|------|---------|
| @anthropic-ai/claude-agent-sdk | 0.2.96 | 0.2.96 | **同步** | 2026-05-19 |
| @anthropic-ai/sandbox-runtime | 0.0.37 | 0.0.37 | **同步** | 2026-05-19 |

**结论**: Happy CLI 当前使用的 SDK 版本与 upstream main 分支完全同步。

---

## 关键 API 使用现状

### 1. 核心 Query API

**当前调用位置**: `/src/claude/sdk/query.ts`

```typescript
// 官方 SDK 导入
import { query as sdkQuery, type Options, type Query } from '@anthropic-ai/claude-agent-sdk'

// Happy 包装器将 QueryOptions 映射到官方 Options
export function query(params: { 
  prompt: QueryPrompt
  options?: QueryOptions 
}): Query
```

**API 映射关系**：
- `QueryOptions.permissionMode` → `Options.permissionMode`
- `QueryOptions.canCallTool` → `Options.canUseTool`（函数回调）
- `QueryOptions.mcpServers` → `Options.mcpServers`
- `QueryOptions.settingsPath` → `Options.settings`
- `QueryOptions.abort` → `Options.abortController`
- `QueryOptions.resume` → `Options.resume`
- `QueryOptions.continue` → `Options.continue`

**实现特点**：
- 支持自定义系统提示 (`customSystemPrompt` 或 `appendSystemPrompt`)
- AbortSignal 自动包装为 AbortController
- MCP 服务器本地代理绕过配置（`ensureLocalProxyBypass`）

---

### 2. Permission Hook API（权限回调）

**当前调用位置**: `/src/claude/utils/permissionHandler.ts`

#### 官方 SDK 契约
```typescript
// 来自 @anthropic-ai/claude-agent-sdk
type CanUseTool = (
  toolName: string,
  input: unknown,
  options: {
    signal: AbortSignal
    toolUseID: string  // 官方 SDK 提供的工具调用 ID
  }
) => Promise<PermissionResult>
```

#### Happy 的实现
```typescript
class PermissionHandler {
  handleToolCall = async (
    toolName: string,
    input: unknown,
    mode: EnhancedMode,
    options: { signal: AbortSignal; toolUseID: string }
  ): Promise<PermissionResult>
}
```

**权限决策逻辑**：
1. **AskUserQuestion** - 永不自动批准（需要用户交互）
2. **已允许的工具** - 检查白名单（allowedTools）
3. **Bash 特殊处理** - 支持字面量匹配和前缀匹配（`Bash(command:*)`）
4. **ExitPlanMode** - 永不自动批准（需要用户审批）
5. **模式特定规则**：
   - `bypassPermissions` - 全部自动批准
   - `acceptEdits` - 编辑类工具自动批准
   - `plan` - 只读工具自动批准，危险工具需审批
   - `default` - 所有操作需审批

**新增 API 特点**（与旧版 MCP 权限服务器的区别）：
- 通过 `canUseTool` 回调接收 `toolUseID`（官方生成）
- 返回 `PermissionResult { behavior: 'allow'|'deny', updatedInput?: Record }`
- 支持动态模式切换（`setPermissionModeCallback`）
- 通过 Session RPC 而非 MCP 服务器返回权限响应

---

### 3. Session 生命周期 API

**当前调用位置**: `/src/claude/claudeRemote.ts` (第158-168行)

#### 启动新会话
```typescript
const response = query({
  prompt: messages,  // PushableAsyncIterable<SDKUserMessage>
  options: {
    cwd: opts.path,
    mcpServers: opts.mcpServers,
    permissionMode: mapToClaudeMode(initial.mode.permissionMode),
    canCallTool: opts.canCallTool,
    // ... 其他选项
  },
})
```

#### 恢复会话（--resume）
```typescript
const sdkOptions: QueryOptions = {
  resume: startFrom ?? undefined,  // 传入会话 ID
  // ... 其他选项
}
```

**API 关键发现**：
- SDK 的 `query()` 返回异步迭代器（`AsyncIterable<SDKMessage>`）
- 消息类型：`'system'`, `'assistant'`, `'user'`, `'result'`
- `system` 消息的 `subtype: 'init'` 包含 `session_id`
- 消息流自动处理工具调用/结果的交互

#### Query 对象的控制方法
```typescript
interface QueryResponse {
  setPermissionMode(mode: 'default'|'acceptEdits'|'bypassPermissions'|'plan'): Promise<void>
  // ... 迭代器方法（for await...of）
}
```

---

### 4. MCP 服务器注册 API

**当前调用位置**: `/src/claude/claudeRemote.ts` (第121行)

```typescript
const sdkOptions: QueryOptions = {
  mcpServers: opts.mcpServers,  // Record<string, any>
}
```

**当前状态**：
- MCP 配置通过 QueryOptions 传递
- 支持多个 MCP 服务器
- 本地 MCP 服务器自动配置 HTTP 代理绕过（NO_PROXY）

**需要跟踪的 API 变化**：
- `mcpServers` 的具体 schema（stdio vs HTTP 配置）
- 是否有新的 MCP 服务器生命周期 hook

---

## Session 协议映射

**当前调用位置**: `/src/claude/utils/sessionProtocolMapper.ts`

Happy 在 SDK 消息流之上添加了会话协议层，用于跨多个 subagent 的状态追踪：

- **输入**: 原始 SDK 消息（assistant/user/system）
- **输出**: SessionEnvelope（Happy 的跨进程协议）
- **追踪**: 
  - Subagent 生命周期（start/stop）
  - Tool 调用的 parent_tool_use_id 映射
  - Sidechain 消息处理（来自 Task/Agent 工具）

**关键映射**：
```
SDK Message (assistant/user) 
  → SessionEnvelopes (turn-start/text/tool-call-start/tool-call-end/turn-end)
  → 通过 Session API 传输至移动应用
```

---

## 权限模式映射

**当前调用位置**: `/src/claude/utils/permissionMode.ts`

Happy 支持 7 种权限模式，但 Claude SDK 仅支持 4 种：

| Happy 模式 | → | Claude SDK 模式 | 备注 |
|-----------|---|-----------------|------|
| default | → | default | 直接传递 |
| acceptEdits | → | acceptEdits | 直接传递 |
| bypassPermissions | → | bypassPermissions | 直接传递 |
| plan | → | plan | 直接传递 |
| yolo | → | bypassPermissions | 别名（跳过所有权限） |
| safe-yolo | → | default | 降级为默认（需要权限） |
| read-only | → | default | 降级为默认（SDK 不支持只读） |

**权限模式命令行支持**：
- `--permission-mode VALUE`
- `--permission-mode=VALUE`
- `--dangerously-skip-permissions` (强制 bypassPermissions)

**沙箱集成**：
- 沙箱启用时强制 `bypassPermissions`（`applySandboxPermissionPolicy`）

---

## SDK 消息类型使用

**来自**: `@anthropic-ai/claude-agent-sdk`

### 接收的消息类型

#### System Messages
```typescript
type SystemMessage = {
  type: 'system'
  subtype: 'init'  // 会话初始化
  session_id: string
  tools: string[]
  slash_commands: string[]
  mcp_servers?: { name: string; status: string }[]
  skills: string[]
}
```

#### Assistant Messages
```typescript
type AssistantMessage = {
  type: 'assistant'
  message: {
    role: 'assistant'
    content: ContentBlock[]
  }
  // ContentBlock: { type: 'text'|'thinking'|'tool_use', ... }
}
```

#### User Messages
```typescript
type UserMessage = {
  type: 'user'
  message: {
    role: 'user'
    content: string | ContentBlock[]
  }
}
```

#### Result Messages
```typescript
type ResultMessage = {
  type: 'result'
  // 会话完成
}
```

### 发送的消息格式

```typescript
interface SDKUserMessage {
  type: 'user'
  parent_tool_use_id: string | null
  message: {
    role: 'user'
    content: string | ContentBlock[]
  }
}
```

**工具结果块**（在 UserMessage 中）：
```typescript
{
  type: 'tool_result',
  tool_use_id: string,
  content: string
}
```

---

## 关键 API 风险清单

### 1. 高风险：Permission Callback 变更
- **风险**: 如果 SDK 改变 `canUseTool` 签名或 `options` 参数结构
- **影响**: Permission Handler 直接依赖 `toolUseID` 字段
- **监控点**: 
  - options 参数是否有新字段
  - toolUseID 是否改名或重构
  - PermissionResult 返回格式

### 2. 中风险：Message Type 变更
- **风险**: 新增或修改消息类型
- **影响**: Session Protocol Mapper 需要更新处理逻辑
- **监控点**:
  - system 消息的新 subtype
  - ContentBlock 的新类型
  - assistant/user 消息的新字段

### 3. 中风险：Query API 签名变更
- **风险**: 如果 query() 返回类型或选项改变
- **影响**: claudeRemote.ts 需要更新
- **监控点**:
  - Options 接口的新字段
  - Query 对象的新方法（如 setPermissionMode 是否稳定）
  - Resume 流程的改变

### 4. 低风险：MCP 配置 Schema 变更
- **风险**: mcpServers 配置格式改变
- **影响**: 需要更新配置传递
- **监控点**:
  - mcpServers 的类型定义
  - 新的 MCP 生命周期钩子

### 5. 低风险：系统提示 API 变更
- **风险**: systemPrompt 选项格式改变
- **影响**: 需要更新 systemPrompt 对象构造
- **监控点**:
  - `type: 'preset'` 和 `preset: 'claude_code'` 的稳定性
  - append 字段的支持

---

---

## CC 内部机制（源码级，来自 ~/claude-code-source 研究，2026-05-21）

> 以下内容来自 `~/claude-code-source/claude-code/src/` 反编译还原源码，wiki `ccs_*` 系列页面。
> 这是 Claude Code 内部实现，不是 SDK 公开 API，但对理解 Happy CLI 集成至关重要。

### 工具权限三路机制（ccs_hooks.md §工具权限三路）

CC 内部有三个不同的 permissionHandler，Happy CLI 走的是 **interactiveHandler 路径**（有 dialog）：

```
1. coordinatorHandler（Swarm coordinator 专用）
   → runHooks → tryClassifier(BASH_CLASSIFIER 死代码) → fallthrough 放行
   
2. interactiveHandler（交互终端，Happy CLI 走此路径）
   → Promise.race 四路并发：
     - dialog（弹出交互式对话框，用户回答）← Happy 拦截此处
     - bridge（BRIDGE_MODE，死代码）
     - channel（KAIROS_CHANNELS，死代码）
     - hooks（后台 hook 执行）
   → createResolveOnce.claim() 保证只采用最快到达的结果

3. swarmWorkerHandler（Swarm worker 专用）
   → 先 registerPermissionCallback() 再 sendPermissionRequestViaMailbox()
   → 先注册防响应早于注册的竞态
```

**对 Happy 的影响**：Happy MCP server 拦截的是 CC 的 `dialog` 路径。`Promise.race` 特性意味着如果 MCP server 响应慢，CC 的 `hooks`（后台 hook）可能先执行完并覆盖权限决策。

### PermissionDecisionReason 11 种（来自 ccs_types.md）

```typescript
type PermissionDecisionReason =
  // 规则/模式
  | 'rule' | 'mode' | 'subcommandResults'
  // 工具/Hook
  | 'permissionPromptTool' | 'hook'
  // Agent 相关
  | 'asyncAgent' | 'sandboxOverride' | 'classifier'
  // 路径/安全
  | 'workingDir' | 'safetyCheck' | 'other'
```

**关键**：`permissionPromptTool` 是 Happy MCP 对应的 reason。当 CC SDK 内部 `canUseTool` 被触发时，reason = `permissionPromptTool` 表明这是通过工具协议（MCP）来的权限请求。

### 工具注册分类（来自 ccs_tool-system.md）

CC 工具分 4 类，影响 Happy CLI 的 canUseTool 收到哪些工具：

| 类别 | 内容 | 说明 |
|------|------|------|
| A 类（始终注册）| BashTool, GlobTool, GrepTool, FileReadTool, FileEditTool, AgentTool 等 27 个 | Happy CLI 总会收到这些工具的权限请求 |
| B 类（feature() 恒 false）| SleepTool, WebBrowserTool, MonitorTool 等 12 个 | 死代码，Happy 永远不会收到 |
| C 类（运行时门控）| TaskCreateTool, EnterWorktreeTool, TeamCreateTool 等 | 依赖 `isTodoV2Enabled()` 等条件函数 |
| D 类（USER_TYPE=ant）| ConfigTool, TungstenTool, REPLTool 等 | 内部账号专属，外部用户不触发 |

**实践意义**：Happy CLI 的 canUseTool 回调必须正确处理 A 类全部 27 个工具，C 类按运行时环境不定触发。

### AppState 字段结构（来自 ccs_hooks.md §AppState）

CC 进程级状态有 ~85 个字段（不是小型状态机）：
- `DeepImmutable 段`：32 字段（含 replBridge* 13 个，大部分死代码）
- `非 DeepImmutable 段`：53 字段（Swarm / Skills / Plan / Session / Auth 等）

**Happy 关注点**：`invokedSkills`（skill 调用记录）、`sessionId`（有 session_id 的系统消息后才出现）

### CLAUDE.md / Memory 加载规则（来自 memory_cc-source-findings.md）

```
MEMORY.md 硬限制：200 行 / 25,000 字节（两者取先达到的）
Dream（自动压缩）：未上线（feature gate 关闭）
Native Pull（语义检索）：未上线（feature gate `tengu_moth_copse` 关闭）
```

**Happy 关注点**：Happy 注入的 MCP tool 描述（`mcp__happy__share_file` 等）会进入 CC 的工具列表初始化流程，不受 MEMORY.md 限制，但要注意 tool description 长度影响 prompt cache。

---

## CHANGELOG 摘要（最近版本）

**注意**：`~/claude-code-source` 为反编译还原版，非官方 SDK 包的 CHANGELOG。
官方 CHANGELOG 需要直接查询 `packages/happy-cli/node_modules/@anthropic-ai/claude-agent-sdk/`。

```bash
# 查看完整 CHANGELOG
cat ~/happy/packages/happy-cli/node_modules/@anthropic-ai/claude-agent-sdk/CHANGELOG.md 2>/dev/null | head -100
npm view @anthropic-ai/claude-agent-sdk@0.2.96 dist.tarball
# 或查看 npm 官网: https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk?activeTab=versions
```

---

## SDK 后续更新订阅建议

### 1. 自动监控机制
```bash
# 定期检查 upstream
git fetch upstream main --dry-run

# 对比 SDK 版本
git diff upstream/main -- packages/happy-cli/package.json | grep claude-agent-sdk
```

### 2. 关键监控文件
- **SDK API 使用**: `/src/claude/sdk/query.ts`, `/src/claude/utils/permissionHandler.ts`
- **类型定义**: `/src/claude/sdk/types.ts`
- **测试覆盖**: 
  - `/src/claude/claudeRemote.test.ts`（如有）
  - `/src/claude/utils/permissionHandler.test.ts`（如有）

### 3. 版本升级检查清单

当检测到 @anthropic-ai/claude-agent-sdk 新版本时：

- [ ] 下载新版 npm package
- [ ] 检查 CHANGELOG 中的 **Breaking Changes**
- [ ] 运行 TypeScript 类型检查：`npm run typecheck`
- [ ] 检查以下文件的兼容性：
  - `src/claude/sdk/query.ts` - Options 接口变化
  - `src/claude/utils/permissionHandler.ts` - canUseTool 签名
  - `src/claude/claudeRemote.ts` - Query 对象方法
- [ ] 运行集成测试：`npm test`（如有 claude.integration.test.ts）
- [ ] 检查 MCP 服务器配置格式
- [ ] 验证权限模式映射逻辑

### 4. 重点关注的 SDK 功能

基于当前使用模式，以下 SDK 功能需要重点关注更新：

1. **Core Query() Function** - 最基础的 API，任何改动都会影响
2. **canUseTool Callback** - 权限系统的核心，变化需立即处理
3. **Message Types** - 会话协议映射依赖消息结构
4. **Permission Modes** - 权限模式的定义和支持
5. **Resume/Continue** - 会话恢复功能至关重要
6. **MCP Integration** - Happy 大量依赖 MCP 服务器

---

## 与上游同步状态

**当前分支**: main  
**上游分支**: upstream/main  
**同步状态**: ✅ 完全同步

### SDK 相关 Commits（最近 12 条）

使用以下命令查看与上游 SDK 相关的最新变更：

```bash
git log -12 --oneline upstream/main -- packages/happy-cli/package.json
```

---

## 后续行动项

1. **立即**: 安装 node_modules 并读取完整 SDK CHANGELOG
   ```bash
   cd packages/happy-cli && npm install
   ```

2. **本周**: 建立 CI/CD 检查以在 SDK 更新时告警
   ```bash
   # 在 GH Actions 中添加依赖检查
   npm outdated @anthropic-ai/claude-agent-sdk
   ```

3. **持续**: 为 SDK API 使用点添加集成测试
   - Permission callback 流程
   - Resume 会话流程
   - MCP 服务器初始化

4. **文档**: 维护此文档，每次检查后更新版本号和风险评估

---

**STATUS**: DONE
