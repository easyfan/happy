/**
 * Unit tests for decryptFetchedSessions (BUG-21)
 *
 * Tests run in vitest/Node.js. The rn-encryption shim stubs out AES-GCM, so all
 * sessions in these tests use dataEncryptionKey=null (legacy SecretBox path via
 * libsodium, which IS available in the test environment).
 *
 * TC-2 exercises the key-decryption-failure path by passing a corrupted
 * dataEncryptionKey whose version byte forces decryptEncryptionKey to return null.
 *
 * TC-3 exercises the metadata-failure path by corrupting the base64 metadata
 * of one session so that decryption returns null.
 *
 * NOTE: sync.ts has many native dependencies. vi.mock calls below satisfy the
 * import graph so the module can load in Node.js. We do NOT mock the encryption
 * stack (Encryption, SessionEncryption, encryptionCache, libsodium, base64)
 * since those are the real components under test.
 */

import { describe, it, expect, vi, beforeAll } from 'vitest';

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

// expo-crypto is handled by vitest.config alias → sources/dev/expoCryptoShim.ts
// No vi.mock needed here — the shim provides getRandomBytes via Node.js crypto.

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
    })),
}));

vi.mock('@/utils/errors', () => ({
    NotFoundError: class NotFoundError extends Error {},
    HappyError: class HappyError extends Error {},
}));

// ─── Real imports (after all vi.mock) ────────────────────────────────────────

import sodium from '@/encryption/libsodium.lib';
import { getRandomBytes } from 'expo-crypto';
import { Encryption } from '@/sync/encryption/encryption';
import { encodeBase64 } from '@/encryption/base64';
import { decryptFetchedSessions, RawSession } from './sync';

beforeAll(async () => {
    // libsodium-wrappers requires initialization before use in Node.js
    await (sodium as any).ready;
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeMasterSecret(): Uint8Array {
    return getRandomBytes(32);
}

/**
 * Create a minimal RawSession that uses dataEncryptionKey=null (legacy path).
 * In the test environment, the legacy SecretBoxEncryption (libsodium) works correctly,
 * whereas AES256Encryption (rn-encryption) is shimmed to no-ops.
 *
 * The encryption instance is used to encrypt metadata and agentState directly
 * via the legacy encryptor (encryptRaw) so the round-trip succeeds in tests.
 */
async function makeLegacySession(
    encryption: Encryption,
    overrides: Partial<RawSession> = {}
): Promise<RawSession> {
    const id = overrides.id ?? `session-${Math.random().toString(36).slice(2)}`;

    // encryptRaw uses the legacy SecretBoxEncryption (libsodium) — works in test env
    const metadataPlain = { path: '/test/project', host: 'test-host' };
    const agentStatePlain = {};

    const metadataEncrypted = await encryption.encryptRaw(metadataPlain);
    const agentStateEncrypted = await encryption.encryptRaw(agentStatePlain);

    return {
        id,
        tag: 'test',
        seq: overrides.seq ?? 1,
        metadata: overrides.metadata ?? metadataEncrypted,
        metadataVersion: overrides.metadataVersion ?? 1,
        agentState: overrides.agentState ?? agentStateEncrypted,
        agentStateVersion: overrides.agentStateVersion ?? 1,
        dataEncryptionKey: null, // legacy SecretBox path — works in test env
        active: true,
        activeAt: Date.now(),
        createdAt: Date.now(),
        updatedAt: Date.now(),
        lastMessage: null,
        ...overrides,
    };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('decryptFetchedSessions', () => {

    // TC-1: 5 sessions parallel decryption — all decrypt correctly
    it('TC-1: 5 sessions in parallel — all decrypt correctly', async () => {
        const encryption = await Encryption.create(makeMasterSecret());

        const sessions = await Promise.all([
            makeLegacySession(encryption, { id: 'sess-1', seq: 1 }),
            makeLegacySession(encryption, { id: 'sess-2', seq: 2 }),
            makeLegacySession(encryption, { id: 'sess-3', seq: 3 }),
            makeLegacySession(encryption, { id: 'sess-4', seq: 4 }),
            makeLegacySession(encryption, { id: 'sess-5', seq: 5 }),
        ]);

        const result = await decryptFetchedSessions(encryption, sessions);

        expect(result).toHaveLength(5);

        const resultIds = result.map(s => s.id).sort();
        expect(resultIds).toEqual(['sess-1', 'sess-2', 'sess-3', 'sess-4', 'sess-5']);

        for (const session of result) {
            expect(session.thinking).toBe(false);
            expect(session.thinkingAt).toBe(0);
            // Legacy SecretBox path: metadata decrypts successfully
            expect(session.metadata).not.toBeNull();
            expect(session.metadata).toMatchObject({ path: '/test/project', host: 'test-host' });
            expect(session.agentState).toEqual({});
        }
    });

    // TC-2: session with bad dataEncryptionKey is excluded; others succeed
    it('TC-2: session with corrupted dataEncryptionKey is excluded; others succeed', async () => {
        const encryption = await Encryption.create(makeMasterSecret());

        const goodSessions = await Promise.all([
            makeLegacySession(encryption, { id: 'sess-1' }),
            makeLegacySession(encryption, { id: 'sess-3' }),
            makeLegacySession(encryption, { id: 'sess-4' }),
            makeLegacySession(encryption, { id: 'sess-5' }),
        ]);

        // Session 2: dataEncryptionKey with wrong version byte (0x01 instead of 0x00)
        // decryptEncryptionKey checks encryptedKey[0] !== 0 and returns null immediately
        const badKeyBytes = new Uint8Array(33);
        badKeyBytes[0] = 0x01; // wrong version byte
        const badKeySession: RawSession = {
            id: 'sess-2',
            tag: 'test',
            seq: 2,
            metadata: goodSessions[0].metadata,
            metadataVersion: 1,
            agentState: goodSessions[0].agentState,
            agentStateVersion: 1,
            dataEncryptionKey: encodeBase64(badKeyBytes), // non-null but decryption will fail
            active: true,
            activeAt: Date.now(),
            createdAt: Date.now(),
            updatedAt: Date.now(),
            lastMessage: null,
        };

        const sessions = [
            goodSessions[0],  // sess-1 (good, null key)
            badKeySession,    // sess-2 (bad key — version 0x01 → null → excluded)
            goodSessions[1],  // sess-3 (good, null key)
            goodSessions[2],  // sess-4 (good, null key)
            goodSessions[3],  // sess-5 (good, null key)
        ];

        const result = await decryptFetchedSessions(encryption, sessions);

        // sess-2 excluded because key decryption returned null
        expect(result).toHaveLength(4);
        const resultIds = result.map(s => s.id).sort();
        expect(resultIds).toEqual(['sess-1', 'sess-3', 'sess-4', 'sess-5']);
        expect(resultIds).not.toContain('sess-2');
    });

    // TC-3: session with corrupted metadata returns metadata: null; others unaffected
    it('TC-3: session with corrupted metadata returns null metadata; others unaffected', async () => {
        const encryption = await Encryption.create(makeMasterSecret());

        const sessions = await Promise.all([
            makeLegacySession(encryption, { id: 'sess-1' }),
            makeLegacySession(encryption, { id: 'sess-2' }),
            makeLegacySession(encryption, { id: 'sess-3' }),
            makeLegacySession(encryption, { id: 'sess-4' }),
            makeLegacySession(encryption, { id: 'sess-5' }),
        ]);

        // Corrupt session 3's metadata: replace with random bytes that cannot decrypt
        // SecretBox decryption on garbage bytes returns null → metadata: null
        const corruptBytes = getRandomBytes(48);
        sessions[2] = {
            ...sessions[2],
            metadata: encodeBase64(corruptBytes),
            metadataVersion: 999, // ensure no cache hit
        };

        const result = await decryptFetchedSessions(encryption, sessions);

        // All 5 sessions included — metadata failure does not exclude a session
        expect(result).toHaveLength(5);

        const sess3 = result.find(s => s.id === 'sess-3');
        expect(sess3).toBeDefined();
        expect(sess3!.metadata).toBeNull(); // corrupted metadata → null

        // Other sessions have valid metadata
        const others = result.filter(s => s.id !== 'sess-3');
        for (const s of others) {
            expect(s.metadata).not.toBeNull();
            expect(s.metadata).toMatchObject({ path: '/test/project', host: 'test-host' });
        }
    });

    // TC-4: empty sessions array returns empty result
    it('TC-4: empty sessions array returns empty result', async () => {
        const encryption = await Encryption.create(makeMasterSecret());
        const result = await decryptFetchedSessions(encryption, []);
        expect(result).toEqual([]);
    });

    // TC-5: second call with same sessions (same versions) returns identical results (cache hit)
    it('TC-5: second call with same sessions returns identical results (cache hit)', async () => {
        const encryption = await Encryption.create(makeMasterSecret());

        const sessions = await Promise.all([
            makeLegacySession(encryption, { id: 'sess-a', metadataVersion: 1, agentStateVersion: 1 }),
            makeLegacySession(encryption, { id: 'sess-b', metadataVersion: 1, agentStateVersion: 1 }),
        ]);

        const firstResult = await decryptFetchedSessions(encryption, sessions);
        const secondResult = await decryptFetchedSessions(encryption, sessions);

        expect(secondResult).toHaveLength(firstResult.length);
        expect(secondResult[0].metadata).toEqual(firstResult[0].metadata);
        expect(secondResult[1].metadata).toEqual(firstResult[1].metadata);
    });
});
