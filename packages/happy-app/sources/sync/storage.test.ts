/**
 * Unit tests for B-02 zombie detection logic in storage.ts
 *
 * 测试目标：验证 applySessions() 中 missedCompletedIds 检测算法的正确性：
 *   - 条件 A：completedAt 在 30s 窗口内
 *   - 条件 B：本设备未曾在 seenPendingIds 中见过该 permId
 *   - 两条件同时满足 → 加入 missedCompletedIds
 *
 * 测试策略：
 *   - 直接操作真实 Zustand store（storage.getState().applySessions / applyMessagesLoaded）
 *   - 通过 storage.getState().sessionMessages[sessionId] 读取结果断言
 *   - 仅 mock native 运行环境依赖（react-native-mmkv、react-native 等），
 *     不 mock 任何业务逻辑
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// ─── vi.mock 必须在所有 import 之前（vitest 会提升）──────────────────────────

vi.mock('expo-modules-core', () => ({
    requireOptionalNativeModule: vi.fn(() => null),
    requireNativeModule: vi.fn(() => null),
    NativeModule: vi.fn(),
    EventEmitter: vi.fn(() => ({ addListener: vi.fn(), removeAllListeners: vi.fn() })),
    Platform: { OS: 'ios', select: vi.fn((obj: any) => obj.ios ?? obj.default) },
}));

vi.mock('expo-localization', () => ({
    default: { locale: 'en', locales: [{ languageCode: 'en', languageTag: 'en' }] },
    getLocales: vi.fn(() => [{ languageCode: 'en', languageTag: 'en' }]),
}));

vi.mock('@/text', () => ({
    t: vi.fn((key: string) => key),
}));

vi.mock('react-native-mmkv', () => {
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

vi.mock('@/realtime/RealtimeSession', () => ({
    getCurrentRealtimeSessionId: vi.fn(() => null),
    getVoiceSession: vi.fn(() => null),
}));

vi.mock('./projectManager', () => ({
    projectManager: {
        updateSessions: vi.fn(),
        getProjects: vi.fn(() => []),
        getProject: vi.fn(() => null),
        getProjectForSession: vi.fn(() => null),
        getProjectSessions: vi.fn(() => []),
        getProjectGitStatus: vi.fn(() => null),
        getSessionProjectGitStatus: vi.fn(() => null),
        updateSessionProjectGitStatus: vi.fn(),
    },
}));

vi.mock('@/components/tools/knownTools', () => ({
    isMutableTool: vi.fn(() => true),
}));

vi.mock('./sync', () => ({
    sync: {
        applySettings: vi.fn(),
        assumeUsers: vi.fn().mockResolvedValue(undefined),
        getCredentials: vi.fn(() => null),
    },
}));

vi.mock('./serverConfig', () => ({
    getServerUrl: vi.fn(() => 'http://localhost:3005'),
}));

vi.mock('./apiSocket', () => ({
    getHappyClientId: vi.fn(() => 'test/1.0.0'),
}));

vi.mock('./gitStatusSync', () => ({
    gitStatusSync: { start: vi.fn(), stop: vi.fn() },
}));

// ─── 导入被测模块（必须在所有 vi.mock 之后）────────────────────────────────

import { storage } from './storage';
import type { Session } from './storageTypes';

// ─── Helper：构建最小有效 Session 对象 ───────────────────────────────────────

function makeSession(overrides: Partial<Session> & { id: string }): Omit<Session, 'presence'> & { presence?: 'online' | number } {
    return {
        seq: 1,
        createdAt: Date.now() - 60000,
        updatedAt: Date.now(),
        active: false,
        activeAt: Date.now() - 60000,
        metadata: null,
        metadataVersion: 1,
        agentState: null,
        agentStateVersion: 0,
        thinking: false,
        thinkingAt: 0,
        presence: 'online',
        ...overrides,
    };
}

// ─── 每次测试前重置 store 状态 ────────────────────────────────────────────────

beforeEach(() => {
    // 重置 Zustand store 到干净状态（覆写 sessions 和 sessionMessages）
    storage.setState({
        sessions: {},
        sessionMessages: {},
    } as any);
    vi.clearAllMocks();
});

afterEach(() => {
    vi.useRealTimers();
});

// ─── TC-UT-01: 正常 zombie 场景 ───────────────────────────────────────────────

describe('TC-UT-01: 正常 zombie 场景 — 窗口内未见 pending', () => {
    it('completedAt 在 10s 前，本设备未见 pending → missedCompletedIds 包含该 permId', () => {
        const sessionId = 'session-zombie-01';
        const permId = 'perm-abc123';

        // 初始化 sessionMessages
        storage.getState().applySessions([makeSession({ id: sessionId })]);
        storage.getState().applyMessagesLoaded(sessionId);

        // 构造 agentState：completedRequests 中 completedAt 10s 前，无 pending
        const agentState = {
            completedRequests: {
                [permId]: {
                    tool: 'Bash',
                    arguments: {},
                    completedAt: Date.now() - 10000,
                    status: 'approved' as const,
                },
            },
            requests: {},
        };

        storage.getState().applySessions([makeSession({
            id: sessionId,
            agentState,
            agentStateVersion: 2,
        })]);

        const sessionMsgs = storage.getState().sessionMessages[sessionId];
        expect(sessionMsgs).toBeDefined();
        expect(sessionMsgs.missedCompletedIds.has(permId)).toBe(true);
        expect(sessionMsgs.seenPendingIds.has(permId)).toBe(false);
    });
});

// ─── TC-UT-02: 超出时效窗口 ───────────────────────────────────────────────────

describe('TC-UT-02: 超出时效窗口 — completedAt > 30s 不标记', () => {
    it('completedAt 在 35s 前 → missedCompletedIds 不包含该 permId', () => {
        const sessionId = 'session-zombie-02';
        const permId = 'perm-old123';

        storage.getState().applySessions([makeSession({ id: sessionId })]);
        storage.getState().applyMessagesLoaded(sessionId);

        const agentState = {
            completedRequests: {
                [permId]: {
                    tool: 'Bash',
                    arguments: {},
                    completedAt: Date.now() - 35000,
                    status: 'approved' as const,
                },
            },
            requests: {},
        };

        storage.getState().applySessions([makeSession({
            id: sessionId,
            agentState,
            agentStateVersion: 2,
        })]);

        const sessionMsgs = storage.getState().sessionMessages[sessionId];
        expect(sessionMsgs.missedCompletedIds.has(permId)).toBe(false);
        expect(sessionMsgs.missedCompletedIds.size).toBe(0);
    });
});

// ─── TC-UT-03: 本设备见过 pending ────────────────────────────────────────────

describe('TC-UT-03: 本设备见过 pending — seenPendingIds 包含该 permId 则不标记', () => {
    it('第一次 applySessions 看到 pending → 第二次 completedRequests 不被标记 missed', () => {
        const sessionId = 'session-zombie-03';
        const permId = 'perm-seen456';

        storage.getState().applySessions([makeSession({ id: sessionId })]);
        storage.getState().applyMessagesLoaded(sessionId);

        // 第一次：本设备看到 pending 状态
        const agentStateWithPending = {
            requests: {
                [permId]: {
                    tool: 'Bash',
                    arguments: {},
                    createdAt: Date.now() - 8000,
                },
            },
            completedRequests: {},
        };
        storage.getState().applySessions([makeSession({
            id: sessionId,
            agentState: agentStateWithPending,
            agentStateVersion: 2,
        })]);

        // 第二次：pending 已完成，completedAt 在窗口内
        const agentStateCompleted = {
            requests: {},
            completedRequests: {
                [permId]: {
                    tool: 'Bash',
                    arguments: {},
                    completedAt: Date.now() - 5000,
                    status: 'approved' as const,
                },
            },
        };
        storage.getState().applySessions([makeSession({
            id: sessionId,
            agentState: agentStateCompleted,
            agentStateVersion: 3,
        })]);

        const sessionMsgs = storage.getState().sessionMessages[sessionId];
        expect(sessionMsgs.seenPendingIds.has(permId)).toBe(true);
        expect(sessionMsgs.missedCompletedIds.has(permId)).toBe(false);
    });
});

// ─── TC-UT-04: completedAt 为 null ───────────────────────────────────────────

describe('TC-UT-04: completedAt 为 null — 不标记 missed', () => {
    it('completedAt = null → missedCompletedIds 不包含该 permId，无异常', () => {
        const sessionId = 'session-zombie-04';
        const permId = 'perm-null789';

        storage.getState().applySessions([makeSession({ id: sessionId })]);
        storage.getState().applyMessagesLoaded(sessionId);

        const agentState = {
            completedRequests: {
                [permId]: {
                    tool: 'Bash',
                    arguments: {},
                    completedAt: null,
                    status: 'approved' as const,
                },
            },
            requests: {},
        };

        expect(() => {
            storage.getState().applySessions([makeSession({
                id: sessionId,
                agentState,
                agentStateVersion: 2,
            })]);
        }).not.toThrow();

        const sessionMsgs = storage.getState().sessionMessages[sessionId];
        expect(sessionMsgs.missedCompletedIds.has(permId)).toBe(false);
    });
});

// ─── TC-UT-05: 边界值 — 29999ms 标记，30001ms 不标记 ─────────────────────────

describe('TC-UT-05: 边界值 — 29999ms 标记，30001ms 不标记', () => {
    it('perm-inside（29999ms）应标记，perm-outside（30001ms）不应标记', () => {
        vi.useFakeTimers();
        const now = Date.now();

        const sessionId = 'session-zombie-05';
        const permInside = 'perm-inside';
        const permOutside = 'perm-outside';

        storage.getState().applySessions([makeSession({ id: sessionId })]);
        storage.getState().applyMessagesLoaded(sessionId);

        const agentState = {
            completedRequests: {
                [permInside]: {
                    tool: 'Bash',
                    arguments: {},
                    completedAt: now - 29999,
                    status: 'approved' as const,
                },
                [permOutside]: {
                    tool: 'Bash',
                    arguments: {},
                    completedAt: now - 30001,
                    status: 'denied' as const,
                },
            },
            requests: {},
        };

        storage.getState().applySessions([makeSession({
            id: sessionId,
            agentState,
            agentStateVersion: 2,
        })]);

        const sessionMsgs = storage.getState().sessionMessages[sessionId];
        expect(sessionMsgs.missedCompletedIds.has(permInside)).toBe(true);
        expect(sessionMsgs.missedCompletedIds.has(permOutside)).toBe(false);

        vi.useRealTimers();
    });
});

// ─── TC-UT-06: applyMessagesLoaded 初始化 Sets 为空 Set ──────────────────────

describe('TC-UT-06: applyMessagesLoaded 初始化 Sets 为空 Set', () => {
    it('applyMessagesLoaded 后 seenPendingIds 和 missedCompletedIds 均为空 Set，isLoaded = true', () => {
        const sessionId = 'session-init-test';

        // 先注册 session
        storage.getState().applySessions([makeSession({ id: sessionId })]);

        // 初始化消息结构
        storage.getState().applyMessagesLoaded(sessionId);

        const sessionMsgs = storage.getState().sessionMessages[sessionId];
        expect(sessionMsgs).toBeDefined();
        expect(sessionMsgs.seenPendingIds).toBeInstanceOf(Set);
        expect(sessionMsgs.seenPendingIds.size).toBe(0);
        expect(sessionMsgs.missedCompletedIds).toBeInstanceOf(Set);
        expect(sessionMsgs.missedCompletedIds.size).toBe(0);
        expect(sessionMsgs.isLoaded).toBe(true);
    });
});

// ─── TC-UT-07: 重复 applySessions 不重复标记（幂等性）────────────────────────

describe('TC-UT-07: 已在 missedCompletedIds 的 permId 不重复处理（幂等性）', () => {
    it('相同 agentState 两次调用 applySessions，missedCompletedIds.size 仍为 1', () => {
        const sessionId = 'session-zombie-07';
        const permId = 'perm-dup001';

        storage.getState().applySessions([makeSession({ id: sessionId })]);
        storage.getState().applyMessagesLoaded(sessionId);

        const agentState = {
            completedRequests: {
                [permId]: {
                    tool: 'Bash',
                    arguments: {},
                    completedAt: Date.now() - 5000,
                    status: 'approved' as const,
                },
            },
            requests: {},
        };

        // 第一次调用
        storage.getState().applySessions([makeSession({
            id: sessionId,
            agentState,
            agentStateVersion: 2,
        })]);

        // 第二次调用，agentStateVersion + 1
        storage.getState().applySessions([makeSession({
            id: sessionId,
            agentState,
            agentStateVersion: 3,
        })]);

        const sessionMsgs = storage.getState().sessionMessages[sessionId];
        expect(sessionMsgs.missedCompletedIds.has(permId)).toBe(true);
        expect(sessionMsgs.missedCompletedIds.size).toBe(1);
    });
});

// ─── TC-UT-08: BUG-22 — updateSessionPermissionMode best-effort PATCH ────────

describe('TC-UT-08: BUG-22 — updateSessionPermissionMode best-effort PATCH', () => {
    it('credentials=null 时不发起 fetch，MMKV 本地状态正常更新', async () => {
        const { sync: syncMock } = await import('./sync') as any;
        syncMock.getCredentials.mockReturnValue(null);

        const globalFetch = vi.fn();
        const originalFetch = global.fetch;
        global.fetch = globalFetch;

        const sessionId = 'session-patch-permmode-01';
        storage.getState().applySessions([makeSession({ id: sessionId })]);
        storage.getState().updateSessionPermissionMode(sessionId, 'acceptEdits');

        await new Promise(resolve => setTimeout(resolve, 0));

        expect(globalFetch).not.toHaveBeenCalled();
        const updatedSession = storage.getState().sessions[sessionId];
        expect(updatedSession?.permissionMode).toBe('acceptEdits');

        global.fetch = originalFetch;
    });

    it('credentials 有效时调用 fetch PATCH 到正确 URL，body 含 permissionMode', async () => {
        const { sync: syncMock } = await import('./sync') as any;
        syncMock.getCredentials.mockReturnValue({ token: 'test-token-abc' });

        const fetchMock = vi.fn(() => Promise.resolve({ ok: true }));
        const originalFetch = global.fetch;
        global.fetch = fetchMock as any;

        const sessionId = 'session-patch-permmode-02';
        storage.getState().applySessions([makeSession({ id: sessionId })]);
        storage.getState().updateSessionPermissionMode(sessionId, 'autoApprove');

        await new Promise(resolve => setTimeout(resolve, 0));

        expect(fetchMock).toHaveBeenCalledOnce();
        expect(fetchMock).toHaveBeenCalledWith(
            expect.stringContaining(`/v1/sessions/${sessionId}`),
            expect.objectContaining({
                method: 'PATCH',
                headers: expect.objectContaining({
                    'Authorization': 'Bearer test-token-abc',
                }),
                body: JSON.stringify({ permissionMode: 'autoApprove' }),
            })
        );

        global.fetch = originalFetch;
    });
});

// ─── TC-UT-09: BUG-22 — updateSessionModelMode best-effort PATCH ─────────────

describe('TC-UT-09: BUG-22 — updateSessionModelMode best-effort PATCH', () => {
    it('credentials=null 时不发起 fetch，MMKV 本地状态正常更新', async () => {
        const { sync: syncMock } = await import('./sync') as any;
        syncMock.getCredentials.mockReturnValue(null);

        const globalFetch = vi.fn();
        const originalFetch = global.fetch;
        global.fetch = globalFetch;

        const sessionId = 'session-patch-modelmode-01';
        storage.getState().applySessions([makeSession({ id: sessionId })]);
        storage.getState().updateSessionModelMode(sessionId, 'sonnet');

        await new Promise(resolve => setTimeout(resolve, 0));

        expect(globalFetch).not.toHaveBeenCalled();
        const updatedSession = storage.getState().sessions[sessionId];
        expect(updatedSession?.modelMode).toBe('sonnet');

        global.fetch = originalFetch;
    });

    it('credentials 有效时 PATCH body 含 modelMode（非 permissionMode）', async () => {
        const { sync: syncMock } = await import('./sync') as any;
        syncMock.getCredentials.mockReturnValue({ token: 'test-token-xyz' });

        const fetchMock = vi.fn(() => Promise.resolve({ ok: true }));
        const originalFetch = global.fetch;
        global.fetch = fetchMock as any;

        const sessionId = 'session-patch-modelmode-02';
        storage.getState().applySessions([makeSession({ id: sessionId })]);
        storage.getState().updateSessionModelMode(sessionId, 'opus');

        await new Promise(resolve => setTimeout(resolve, 0));

        expect(fetchMock).toHaveBeenCalledOnce();
        // 确保 body 含 modelMode 而非 permissionMode（关键差异验证）
        expect(fetchMock).toHaveBeenCalledWith(
            expect.stringContaining(`/v1/sessions/${sessionId}`),
            expect.objectContaining({
                method: 'PATCH',
                headers: expect.objectContaining({
                    'Authorization': 'Bearer test-token-xyz',
                }),
                body: JSON.stringify({ modelMode: 'opus' }),
            })
        );

        global.fetch = originalFetch;
    });

    it('fetch 抛出异常时静默失败，本地 state 正常', async () => {
        const { sync: syncMock } = await import('./sync') as any;
        syncMock.getCredentials.mockReturnValue({ token: 'test-token-fail' });

        const fetchMock = vi.fn(() => Promise.reject(new Error('Network error')));
        const originalFetch = global.fetch;
        global.fetch = fetchMock as any;

        const sessionId = 'session-patch-fail-01';
        storage.getState().applySessions([makeSession({ id: sessionId })]);

        expect(() => {
            storage.getState().updateSessionModelMode(sessionId, 'sonnet');
        }).not.toThrow();

        await new Promise(resolve => setTimeout(resolve, 0));

        const updatedSession = storage.getState().sessions[sessionId];
        expect(updatedSession?.modelMode).toBe('sonnet');

        global.fetch = originalFetch;
    });
});
