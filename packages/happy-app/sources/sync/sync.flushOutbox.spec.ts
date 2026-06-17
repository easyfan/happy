/**
 * Unit tests for buildConfirmMessages (BUG-MSG-02)
 *
 * buildConfirmMessages is a pure function exported from sync.ts.
 * It takes the server's POST /v3/sessions/:id/messages response messages
 * and returns NormalizedMessage entries that are fed into enqueueMessages,
 * triggering maybeConfirmOptimisticMessage to clear the isOptimistic flag.
 *
 * These tests exercise the filtering/mapping logic without instantiating
 * the full InvalidateSync class, keeping them fast and dependency-free.
 *
 * NOTE: sync.ts has many native dependencies. vi.mock calls below satisfy
 * the import graph so the module can load in Node.js.
 */

import { describe, it, expect, vi } from 'vitest';

// ─── vi.mock must precede all imports (vitest hoists these) ─────────────────

vi.mock('react-native-mmkv', () => {
    const storage = new Map<string, string | boolean | number | ArrayBuffer>();
    const instance = {
        clearAll: () => storage.clear(),
        delete: (key: string) => storage.delete(key),
        set: (key: string, value: string | boolean | number | ArrayBuffer) => storage.set(key, value),
        getString: (key: string) => { const v = storage.get(key); return typeof v === 'string' ? v : undefined; },
        getNumber: (key: string) => { const v = storage.get(key); return typeof v === 'number' ? v : undefined; },
        getBoolean: (key: string) => { const v = storage.get(key); return typeof v === 'boolean' ? v : undefined; },
        getBuffer: (key: string) => { const v = storage.get(key); return v instanceof ArrayBuffer ? v : undefined; },
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

vi.mock('expo-modules-core', () => ({
    requireOptionalNativeModule: vi.fn(() => null),
    requireNativeModule: vi.fn(() => null),
    NativeModule: vi.fn(),
    EventEmitter: vi.fn(() => ({ addListener: vi.fn(), removeAllListeners: vi.fn() })),
    Platform: { OS: 'ios', select: vi.fn((obj: any) => obj.ios ?? obj.default) },
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
    storage: {
        getState: vi.fn(() => ({
            applySessions: vi.fn(),
            applyMachines: vi.fn(),
        })),
    },
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
        invalidateAndAwait: vi.fn(),
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
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), log: vi.fn() },
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

vi.mock('@/utils/parseToken', () => ({
    parseToken: vi.fn(() => ({ sub: 'test-user' })),
}));

vi.mock('@/utils/lock', () => ({
    AsyncLock: vi.fn().mockImplementation(() => ({
        acquire: vi.fn((fn: () => any) => fn()),
        inLock: vi.fn((fn: () => any) => fn()),
    })),
}));

vi.mock('@/utils/errors', () => ({
    NotFoundError: class NotFoundError extends Error {},
    HappyError: class HappyError extends Error {},
}));

// ─── Real imports (after all vi.mock) ────────────────────────────────────────

import { buildConfirmMessages } from './sync';

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('buildConfirmMessages (BUG-MSG-02)', () => {

    // TC-1: 所有条目均有 localId，返回正确的 confirm 消息列表
    it('TC-1: 所有条目有 localId — 返回含正确 id/localId/role 的确认消息', () => {
        const serverMessages = [
            { id: 'server-id-1', seq: 10, localId: 'local-uuid-1', createdAt: 1700000001000, updatedAt: 1700000001000 },
            { id: 'server-id-2', seq: 11, localId: 'local-uuid-2', createdAt: 1700000002000, updatedAt: 1700000002000 },
        ];

        const result = buildConfirmMessages(serverMessages);

        expect(result).toHaveLength(2);

        // 第一条
        expect(result[0].id).toBe('server-id-1');
        expect(result[0].localId).toBe('local-uuid-1');
        expect(result[0].role).toBe('user');
        expect(result[0].createdAt).toBe(1700000001000);
        expect(result[0].isSidechain).toBe(false);
        expect((result[0] as any).content).toEqual({ type: 'text', text: '' });

        // 第二条
        expect(result[1].id).toBe('server-id-2');
        expect(result[1].localId).toBe('local-uuid-2');

        // isOptimistic 必须为 undefined（不设置），否则 maybeConfirmOptimisticMessage guard 失效
        expect(result[0].isOptimistic).toBeUndefined();
        expect(result[1].isOptimistic).toBeUndefined();
    });

    // TC-2: 所有条目均无 localId（老版 server / system messages），返回空数组
    it('TC-2: 所有条目无 localId — 返回空数组，安全降级', () => {
        const serverMessages = [
            { id: 'x1', seq: 1, localId: null, createdAt: 1000, updatedAt: 1000 },
            { id: 'x2', seq: 2, localId: null, createdAt: 2000, updatedAt: 2000 },
        ];

        const result = buildConfirmMessages(serverMessages);

        expect(result).toHaveLength(0);
        expect(result).toEqual([]);
    });

    // TC-3: 部分有 localId、部分无 localId，仅返回有 localId 的条目
    it('TC-3: 部分有 localId — 仅过滤有效条目，过滤数量正确', () => {
        const serverMessages = [
            { id: 'srv-1', seq: 10, localId: 'uuid-1', createdAt: 1000, updatedAt: 1000 },
            { id: 'srv-2', seq: 11, localId: null,     createdAt: 2000, updatedAt: 2000 },
            { id: 'srv-3', seq: 12, localId: 'uuid-3', createdAt: 3000, updatedAt: 3000 },
        ];

        const result = buildConfirmMessages(serverMessages);

        expect(result).toHaveLength(2);

        const ids = result.map((m) => m.id);
        expect(ids).toContain('srv-1');
        expect(ids).toContain('srv-3');
        expect(ids).not.toContain('srv-2');

        const localIds = result.map((m) => m.localId);
        expect(localIds).toContain('uuid-1');
        expect(localIds).toContain('uuid-3');
    });

    // TC-4: 空数组输入，返回空数组
    it('TC-4: 空数组输入 — 返回空数组', () => {
        const result = buildConfirmMessages([]);
        expect(result).toHaveLength(0);
    });

    // TC-5: 单条消息有 localId，验证 content placeholder 不会含用户真实内容
    it('TC-5: content 是空 text placeholder，不含真实用户内容', () => {
        const serverMessages = [
            { id: 'srv-x', seq: 5, localId: 'local-x', createdAt: 999, updatedAt: 999 },
        ];

        const result = buildConfirmMessages(serverMessages);

        expect(result).toHaveLength(1);
        // content 是纯 placeholder，text 必须为空字符串
        expect((result[0] as any).content.type).toBe('text');
        expect((result[0] as any).content.text).toBe('');
    });
});
