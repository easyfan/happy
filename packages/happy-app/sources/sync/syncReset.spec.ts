/**
 * Unit tests for syncReset() — restore-account-sync feature.
 *
 * 测试目标：验证 syncReset() 的三个核心行为：
 *   1. clearPersistence() 清除 MMKV 持久化数据（AC-2 核心）
 *   2. syncReset() 重置 isInitialized 标志（解锁 syncCreate 入口）
 *   3. syncReset() 幂等性（多次调用不抛出异常）
 *
 * 测试架构说明：
 *   sync.ts 有大量 native 依赖（react-native、expo-*、socket.io 等），
 *   因此 UT-1/UT-3 直接从 persistence.ts 和 apiSocket 测试（更精准、依赖更少）。
 *   UT-2 通过 console.warn spy 间接验证 isInitialized 标志重置行为。
 *
 * Native 依赖替换（运行环境适配，非业务逻辑 mock）：
 *   - react-native-mmkv → createMockMMKV（官方提供的内存 Map 实现）
 *   - react-native → 最小化 stub
 *   - expo-constants / expo-crypto / expo-notifications / expo-updates → 最小化 stub
 *   - socket.io-client → 最小化 stub
 *   - 所有 @/sync/*, @/auth/*, @/track, @/config 内部依赖 → 最小化 stub
 *
 * 业务函数（syncReset、clearPersistence、loadSettings、saveSettings）均为真实实现。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── 所有 vi.mock 必须在 import 语句之前（vitest 会提升）────────────────────

vi.mock('react-native-mmkv', () => {
    // 内存 Map 实现，与 react-native-mmkv 官方 createMockMMKV 等价
    const storage = new Map<string, string | boolean | number | ArrayBuffer>();
    const instance = {
        clearAll: () => storage.clear(),
        delete: (key: string) => storage.delete(key),
        set: (key: string, value: string | boolean | number | ArrayBuffer) => storage.set(key, value),
        getString: (key: string) => {
            const v = storage.get(key);
            return typeof v === 'string' ? v : undefined;
        },
        getNumber: (key: string) => {
            const v = storage.get(key);
            return typeof v === 'number' ? v : undefined;
        },
        getBoolean: (key: string) => {
            const v = storage.get(key);
            return typeof v === 'boolean' ? v : undefined;
        },
        getBuffer: (key: string) => {
            const v = storage.get(key);
            return v instanceof ArrayBuffer ? v : undefined;
        },
        getAllKeys: () => Array.from(storage.keys()),
        contains: (key: string) => storage.has(key),
        recrypt: () => {},
        size: 0,
        isReadOnly: false,
        trim: () => {},
    };
    return { MMKV: vi.fn(() => instance) };
});

vi.mock('react-native', () => ({
    Platform: { OS: 'ios', select: vi.fn((obj: any) => obj.ios ?? obj.default) },
    AppState: {
        currentState: 'active',
        addEventListener: vi.fn(() => ({ remove: vi.fn() })),
    },
    NativeEventEmitter: vi.fn(() => ({
        addListener: vi.fn(() => ({ remove: vi.fn() })),
    })),
}));

vi.mock('expo-constants', () => ({
    default: { expoConfig: { version: '0.0.0' }, manifest: {} },
}));

vi.mock('expo-crypto', () => ({
    randomUUID: vi.fn(() => 'test-uuid-1234'),
    getRandomBytes: vi.fn((n: number) => new Uint8Array(n)),
}));

vi.mock('expo-notifications', () => ({
    default: {},
    addNotificationReceivedListener: vi.fn(() => ({ remove: vi.fn() })),
    addNotificationResponseReceivedListener: vi.fn(() => ({ remove: vi.fn() })),
    setNotificationHandler: vi.fn(),
    getPermissionsAsync: vi.fn().mockResolvedValue({ status: 'undetermined' }),
    requestPermissionsAsync: vi.fn().mockResolvedValue({ status: 'denied' }),
    getExpoPushTokenAsync: vi.fn().mockResolvedValue({ data: '' }),
    scheduleNotificationAsync: vi.fn(),
    cancelAllScheduledNotificationsAsync: vi.fn(),
    getPresentedNotificationsAsync: vi.fn().mockResolvedValue([]),
    dismissAllNotificationsAsync: vi.fn(),
}));

vi.mock('expo-updates', () => ({
    reloadAsync: vi.fn().mockResolvedValue(undefined),
    checkForUpdateAsync: vi.fn().mockResolvedValue({ isAvailable: false }),
    fetchUpdateAsync: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('socket.io-client', () => ({
    io: vi.fn(() => ({
        on: vi.fn(),
        off: vi.fn(),
        emit: vi.fn(),
        disconnect: vi.fn(),
        connected: false,
    })),
}));

vi.mock('@/sync/storage', () => ({
    storage: { get: vi.fn(), set: vi.fn() },
}));

vi.mock('@/auth/tokenStorage', () => ({
    TokenStorage: {
        getCredentials: vi.fn().mockResolvedValue(null),
        setCredentials: vi.fn().mockResolvedValue(true),
        removeCredentials: vi.fn().mockResolvedValue(undefined),
    },
}));

vi.mock('@/utils/sync', () => ({
    InvalidateSync: vi.fn().mockImplementation(() => ({
        invalidate: vi.fn(),
        schedule: vi.fn(),
    })),
}));

vi.mock('@/track', () => ({
    initializeTracking: vi.fn(),
    trackGitHubConnected: vi.fn(),
    trackMessageSent: vi.fn(),
    tracking: { identify: vi.fn(), reset: vi.fn() },
    trackLogout: vi.fn(),
    trackPaywallCancelled: vi.fn(),
    trackPaywallError: vi.fn(),
    trackPaywallPresented: vi.fn(),
    trackPaywallPurchased: vi.fn(),
    trackPaywallRestored: vi.fn(),
}));

vi.mock('@/config', () => ({
    config: { serverUrl: 'http://localhost:3005' },
}));

vi.mock('@/log', () => ({
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('@/utils/platform', () => ({
    isRunningOnMac: vi.fn(() => false),
}));

vi.mock('@/realtime/hooks/voiceHooks', () => ({
    voiceHooks: { onCallStarted: vi.fn(), onCallEnded: vi.fn() },
}));

vi.mock('./pushRegistration', () => ({
    syncCurrentPushToken: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./serverConfig', () => ({
    getServerUrl: vi.fn(() => 'http://localhost:3005'),
}));

vi.mock('./revenueCat', () => ({
    RevenueCat: { configure: vi.fn(), getCustomerInfo: vi.fn() },
    LogLevel: { DEBUG: 'DEBUG' },
    PaywallResult: { PURCHASED: 'PURCHASED' },
}));

vi.mock('./gitStatusSync', () => ({
    gitStatusSync: { start: vi.fn(), stop: vi.fn() },
}));

vi.mock('./projectManager', () => ({
    projectManager: { load: vi.fn(), save: vi.fn() },
}));

vi.mock('@/sync/encryption/encryption', () => ({
    Encryption: {
        create: vi.fn().mockResolvedValue({
            encrypt: vi.fn(),
            decrypt: vi.fn(),
        }),
    },
}));

vi.mock('./encryption/encryptionCache', () => ({
    EncryptionCache: vi.fn().mockImplementation(() => ({
        get: vi.fn(),
        set: vi.fn(),
    })),
}));

vi.mock('./prompt/systemPrompt', () => ({
    systemPrompt: vi.fn(() => ''),
}));

vi.mock('./apiArtifacts', () => ({
    fetchArtifact: vi.fn(),
    fetchArtifacts: vi.fn(),
    createArtifact: vi.fn(),
    updateArtifact: vi.fn(),
}));

vi.mock('./encryption/artifactEncryption', () => ({
    ArtifactEncryption: vi.fn().mockImplementation(() => ({
        encrypt: vi.fn(),
        decrypt: vi.fn(),
    })),
}));

vi.mock('./apiFriends', () => ({
    getFriendsList: vi.fn(),
    getUserProfile: vi.fn(),
}));

vi.mock('./apiFeed', () => ({
    fetchFeed: vi.fn(),
}));

vi.mock('./messageMeta', () => ({
    resolveMessageModeMeta: vi.fn(),
}));

vi.mock('./reducer/activityUpdateAccumulator', () => ({
    ActivityUpdateAccumulator: vi.fn().mockImplementation(() => ({
        add: vi.fn(),
        flush: vi.fn(),
    })),
}));

vi.mock('@/encryption/base64', () => ({
    decodeBase64: vi.fn((s: string) => new Uint8Array(Buffer.from(s, 'base64'))),
    encodeBase64: vi.fn((b: Uint8Array) => Buffer.from(b).toString('base64')),
}));

vi.mock('@/utils/parseToken', () => ({
    parseToken: vi.fn(() => ({ sub: 'test-user' })),
}));

vi.mock('@/utils/lock', () => ({
    AsyncLock: vi.fn().mockImplementation(() => ({
        acquire: vi.fn((fn: () => any) => fn()),
    })),
}));

// ─── 导入被测模块（必须在所有 vi.mock 之后）────────────────────────────────

import { syncReset, syncCreate } from '@/sync/sync';
import { loadSettings, saveSettings, clearPersistence } from '@/sync/persistence';

// ─── 每次测试前清理 MMKV 状态 ───────────────────────────────────────────────

beforeEach(() => {
    clearPersistence();
    vi.clearAllMocks();
});

// ─── UT-1：clearPersistence() 清除 MMKV 数据（syncReset 的核心步骤 #2）─────

describe('syncReset() — persistence（AC-2）', () => {
    it('UT-1a: syncReset() 后 MMKV 中 settings 数据应被清除', () => {
        // 写入账号 A 的 settings
        saveSettings({ language: 'en' } as any, 999);

        // 验证写入成功
        const before = loadSettings();
        expect(before.version).toBe(999);

        // 执行 reset
        syncReset();

        // 验证数据已清除
        const after = loadSettings();
        expect(after.version).toBeNull();
    });

    it('UT-1b: clearPersistence() 后再写入新数据能正常读取', () => {
        saveSettings({ language: 'zh-Hans' } as any, 1);
        clearPersistence();
        saveSettings({ language: 'en' } as any, 2);
        const result = loadSettings();
        expect(result.version).toBe(2);
    });
});

// ─── UT-2：syncReset() 重置 isInitialized 标志（AC-2）────────────────────

describe('syncReset() — isInitialized 重置（AC-2）', () => {
    it('UT-2: syncReset() 后 syncCreate() 不被 isInitialized 守卫拦截', async () => {
        const warnSpy = vi.spyOn(console, 'warn');

        // 先调用一次 syncCreate（设置 isInitialized=true）
        // Encryption.create 已被 mock，但 isInitialized 会在 syncInit 前被设为 true
        try {
            await syncCreate({ token: 'tok', secret: 'bad-secret' });
        } catch {
            // 预期可能失败，忽略
        }

        // 重置
        syncReset();
        vi.clearAllMocks();
        const warnSpy2 = vi.spyOn(console, 'warn');

        // 再次调用 syncCreate，不应被守卫拦截
        try {
            await syncCreate({ token: 'tok2', secret: 'also-bad' });
        } catch {
            // 预期可能失败，忽略
        }

        // 关键断言：console.warn 未输出 "Sync already initialized"
        expect(warnSpy2).not.toHaveBeenCalledWith('Sync already initialized: ignoring');
        warnSpy.mockRestore();
        warnSpy2.mockRestore();
    });
});

// ─── UT-3：syncReset() 幂等性（AC-2/AC-4）────────────────────────────────

describe('syncReset() — 幂等性（AC-4）', () => {
    it('UT-3a: 在 isInitialized=false 时多次调用 syncReset() 不抛出异常', () => {
        expect(() => {
            syncReset();
            syncReset();
            syncReset();
        }).not.toThrow();
    });

    it('UT-3b: syncReset() 后 MMKV 为空，再次调用 syncReset() MMKV 仍为空', () => {
        saveSettings({ language: 'zh-Hans' } as any, 100);
        syncReset();
        expect(loadSettings().version).toBeNull();

        // 第二次调用（空 MMKV 上的幂等调用）
        expect(() => syncReset()).not.toThrow();
        expect(loadSettings().version).toBeNull();
    });
});

// ─── UT-4：首次登录场景不受 syncReset 影响（AC-4）───────────────────────

describe('syncReset() — 首次登录场景安全（AC-4）', () => {
    it('UT-4a: 未初始化状态下调用 syncReset() 不抛出异常', () => {
        // 全新状态：isInitialized=false
        expect(() => syncReset()).not.toThrow();
    });

    it('UT-4b: 首次 syncReset() 后 syncCreate() 能正常执行（不被守卫拦截）', async () => {
        const warnSpy = vi.spyOn(console, 'warn');

        syncReset(); // isInitialized=false，确保清洁状态
        vi.clearAllMocks();
        const warnSpy2 = vi.spyOn(console, 'warn');

        try {
            await syncCreate({ token: 'first-login', secret: 'bad' });
        } catch {
            // 预期可能失败，忽略
        }

        expect(warnSpy2).not.toHaveBeenCalledWith('Sync already initialized: ignoring');
        warnSpy.mockRestore();
        warnSpy2.mockRestore();
    });
});
