# Android E2E Daemon 配对 — adb Deep Link 方案

> **无需代码修改。** App 侧 deep link 认证链路已完整存在（`app.config.js` scheme → `terminal/index.tsx` → `processAuthUrl` → `authApprove`），与 QR 扫码路径共用同一套逻辑。

---

## 前置条件

1. Android 模拟器（或真机）已启动，`adb devices` 列出目标设备
2. Happy App（dev build）已安装，包名：`com.easyfan.happy.dev`
3. App 已完成账户登录，Settings 页面显示用户信息
4. Daemon 容器已启动（`docker logs happy-e2e-final` 有输出）
5. Daemon 已完成 auth request 注册（日志中出现 `happy://terminal?` URL）

---

## 获取 Daemon Public Key（deep link URL）

Daemon 启动后，日志中会输出与 QR Code 内容相同的 `happy://terminal?` URL：

```bash
# 容器环境（E2E 标准配置，容器名必须是 happy-e2e-final）
docker logs happy-e2e-final 2>&1 | grep "happy://terminal"

# 本机 daemon 环境
cat ~/.happy-e2e/logs/*.log | grep "happy://terminal"
```

输出示例：

```
happy://terminal?ABC123xyz...&server=http%3A%2F%2Fhost.docker.internal%3A3005
```

该 URL 中的 `?` 后的部分即为 base64url 编码的 pubKey（v2 格式同时含 `&server=` 参数）。

---

## adb 命令（完整格式，v2）

```bash
adb shell am start -a android.intent.action.VIEW \
  -d "happy://terminal?<base64url-pubKey>&server=<encodeURIComponent(serverUrl)>" \
  com.easyfan.happy.dev
```

**参数说明**：

| 占位符 | 来源 | 格式说明 |
|--------|------|---------|
| `<base64url-pubKey>` | daemon 日志中 `happy://terminal?` 之后至 `&server=` 之前的部分 | base64url 编码，无 padding |
| `<encodeURIComponent(serverUrl)>` | Happy server 地址（见下表） | URL 编码 |
| `com.easyfan.happy.dev` | dev build 包名，**不得**使用生产包名 `com.easyfan.happy` | 精确匹配已安装 APK |

**Server URL 对照表**（填入 `&server=` 的值，必须是 App 视角可访问地址）：

| App 运行环境 | Server URL（App 视角） |
|------------|----------------------|
| Android 模拟器 + 本机 Colima | `http://10.0.2.2:3005`（Android 模拟器访问宿主机的标准地址） |
| Android 模拟器 + 本机 Colima（daemon 在 Docker 容器内） | 仍用 `http://10.0.2.2:3005`，daemon 日志里的 `host.docker.internal` 须替换为 `10.0.2.2` |
| 真机 + 本机 server | 本机局域网 IP，如 `http://192.168.x.x:3005` |

> **重要**：`-d` 参数中的 server URL 必须是**模拟器视角**地址（`10.0.2.2:3005`），不是 daemon 容器视角的 `host.docker.internal:3005`。v2 格式 deep link 中 App 会调用 `setServerUrl()` 覆盖当前配置，确保二者对齐。

**实际命令示例**（模拟器 + 本机 server）：

```bash
# Step 1: 从 daemon 日志拿到完整 URL
DEEP_LINK=$(docker logs happy-e2e-final 2>&1 | grep "happy://terminal" | tail -1 | grep -o "happy://terminal?[^ ]*")

# Step 2: 注入 deep link（注意引号包裹防止 & 被 shell 解释为后台符号）
adb -s emulator-5554 shell am start -a android.intent.action.VIEW \
  -d "$DEEP_LINK" com.easyfan.happy.dev
```

---

## adb 命令（v1 格式，无 server 参数）

若 daemon 日志中的 URL 不含 `&server=`（旧版 v1 格式），App 使用当前已配置的 serverUrl：

```bash
adb shell am start -a android.intent.action.VIEW \
  -d "happy://terminal?<base64url-pubKey>" \
  com.easyfan.happy.dev
```

E2E 场景建议始终使用 v2 格式（含 `&server=`），确保 App serverUrl 与 daemon 对齐，避免残留旧 serverUrl 导致认证失败。

---

## adb_pair_daemon() 自动化伪代码

以下伪代码描述将手动配对步骤集成到 E2E setup 自动化脚本的方式：

```python
def adb_pair_daemon(device_id: str, server_url: str, timeout_sec: int = 30) -> bool:
    """
    通过 adb deep link 完成 Android E2E daemon 配对。
    返回 True 表示配对成功，False 表示超时或失败。
    """
    # Step 1: 等待 App 在前台且可交互（Home 页面已加载）
    wait_for_element(device_id, "MACHINES", timeout=timeout_sec)

    # Step 2: 从 daemon 日志提取 deep link URL
    deep_link_url = extract_deep_link_from_logs()
    # 期望格式：happy://terminal?<base64url-pubKey>&server=<encoded-url>

    # Step 3: 通过 adb 注入 deep link
    run_shell(
        f'adb -s {device_id} shell am start -a android.intent.action.VIEW '
        f'-d "{deep_link_url}" com.easyfan.happy.dev'
    )

    # Step 4: 等待 terminal 连接确认页出现（5 秒内）
    appeared = wait_for_element(
        device_id,
        text="Accept Connection",
        timeout=5
    )
    if not appeared:
        return False

    # Step 5: 自动点击"接受"按钮
    # 注意：必须用 mobile_list_elements_on_screen 获取真实像素坐标，
    # 不能用截图目测坐标（Android 模拟器坐标系是真实设备像素 1080x2400）
    elements = list_elements_on_screen(device_id)
    accept_btn = find_element_by_text(elements, "Accept Connection")
    click_center(device_id, accept_btn)

    # Step 6: 等待确认页消失（processAuthUrl 成功后 Modal.alert + router.back()）
    wait_for_element_gone(device_id, "Accept Connection", timeout=10)

    # Step 7: 验证 sessionKey 链路（通过 MACHINES 页面在线条目代理验证）
    # machine 上线 = daemon 成功解密 authApprove 返回的 responseV2
    # = contentDataKey 传递成功 = sessionKey 链路完整
    navigate_to_settings_machines(device_id)
    machine_online = wait_for_element(device_id, "online", timeout=15)

    return machine_online


def extract_deep_link_from_logs() -> str:
    """从 daemon 容器日志提取 happy://terminal? URL"""
    logs = run_shell("docker logs happy-e2e-final 2>&1")
    for line in logs.split("\n"):
        if "happy://terminal?" in line:
            idx = line.find("happy://terminal?")
            url = line[idx:].strip()
            return url.split()[0]
    raise RuntimeError(
        "daemon 日志中未发现 happy://terminal? URL，"
        "请确认 daemon 已完成启动"
    )
```

---

## sessionKey 验证（AC2b）

App 端的 `sessionKey`（`sync.encryption.contentDataKey`）是内部状态，不通过 UI 直接可见。

**替代验证方式**：确认 Settings → MACHINES 页面出现在线 machine 条目：

- MACHINES 条目出现且状态为 online = daemon 成功解密了 authApprove 返回的 `responseV2`
- `responseV2` 中携带了 `[0x00 | contentDataKey]`（`useConnectTerminal.tsx:52-55`）
- daemon 能解密 = contentDataKey 传递成功 = sessionKey 链路完整

---

## 包名速查

| 构建类型 | 包名 | 使用场景 |
|---------|------|---------|
| dev（E2E 使用） | `com.easyfan.happy.dev` | Android 模拟器 E2E 测试 |
| preview | `com.easyfan.happy.preview` | 预发布测试 |
| production | `com.easyfan.happy` | Google Play 生产版 |

adb am start 的 package name 必须与已安装的 APK 精确匹配。E2E 环境标准使用 dev build。

---

## 集成到现有 Android E2E Setup 流程

在现有 Android E2E setup（参照 `project_android_e2e_pitfalls.md` 步骤 8-9）中，将 step 9（手动扫 QR / 输入 URL）替换为：

```bash
# 原 step 9（手动配对，需人工介入）：
# App Settings → Scan QR code 或 Enter URL manually

# 新 step 9（自动化配对）：
adb_pair_daemon(device_id="emulator-5554", server_url="http://10.0.2.2:3005")
```

---

## 验收标准

| ID | 标准 | 验证方式 |
|----|------|---------|
| AC2a | adb 命令执行后，App terminal 页面（"Accept Connection" 按钮）在 5 秒内出现 | `wait_for_element(timeout=5)` 返回 True |
| AC2b | 点击接受后，MACHINES 页面出现在线 machine 条目 | `wait_for_element("online", timeout=15)` 返回 True |
| AC2c | iOS / Web E2E agent 不受影响（adb 命令仅在 Android agent 中调用） | 代码审阅确认：`adb_pair_daemon` 仅出现在 Android E2E setup 脚本中 |
