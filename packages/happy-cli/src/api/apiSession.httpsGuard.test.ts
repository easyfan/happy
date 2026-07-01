/**
 * IT43 — HTTPS guard for CachedDnsAgent injection (apiSession).
 *
 * Regression: CachedDnsAgent extends https.Agent (a TLS agent). If a valid
 * server-ip.cache entry exists whose hostname matches the current serverUrl,
 * the previous code injected CachedDnsAgent into socket.io's `agent` option
 * REGARDLESS of protocol. For a plain-HTTP (ws://) server this makes socket.io
 * attempt a TLS handshake on a cleartext port, which never completes — the
 * socket hangs forever. In BUG-06 this hang caused awaitConnected(10000) to
 * time out, sendSessionDeath() to be dropped, and zombie sessions to persist.
 *
 * The fix adds `const isHttps = serverUrl.startsWith('https://')` and only reads
 * the cache (and therefore only injects the agent) when isHttps is true.
 *
 * These tests exercise BOTH injection paths in apiSession:
 *   - constructor (synchronous readServerIpCacheSync)
 *   - startSmartReconnect / connectWithCachedAgent (async readServerIpCache)
 *
 * Assertion strategy: assert directly on what reaches socket.io.
 *   - constructor: the `agent` field of the opts object passed to io()
 *   - reconnect:  the `agent` field mutated onto socket.io.opts
 * No mocking of the module under test — only its external collaborators
 * (socket.io transport, configuration, the cache reader, logger) are stubbed,
 * exactly as the existing apiSession.test.ts does. The guard logic itself runs
 * for real.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiSessionClient } from './apiSession';

const { FakeCachedDnsAgent, mockIo, mockShouldReconnect, mutableConfig, mockReadSync, mockReadAsync } = vi.hoisted(() => {
    // A sentinel class so we can identify "a CachedDnsAgent was constructed".
    // Defined inside vi.hoisted so it is available to the hoisted vi.mock factories.
    class FakeCachedDnsAgent {
        constructor(public ip: string, public hostname: string) {}
    }
    return {
        FakeCachedDnsAgent,
        mockIo: vi.fn(),
        mockShouldReconnect: vi.fn(() => true),
        // Mutable so each test can flip serverUrl between http:// and https://.
        mutableConfig: { serverUrl: 'https://server.test', currentCliVersion: '0.0.0-test' },
        mockReadSync: vi.fn<() => { ip: string; hostname: string } | null>(() => null),
        mockReadAsync: vi.fn<() => Promise<{ ip: string; hostname: string } | null>>(async () => null),
    };
});

vi.mock('socket.io-client', () => ({ io: mockIo }));

vi.mock('@/utils/serverIpCache', () => ({
    readServerIpCacheSync: mockReadSync,
    readServerIpCache: mockReadAsync,
}));

vi.mock('@/utils/cachedDnsAgent', () => ({ CachedDnsAgent: FakeCachedDnsAgent }));

vi.mock('@/configuration', () => ({ configuration: mutableConfig }));

vi.mock('@/ui/logger', () => ({
    logger: { debug: vi.fn(), debugLargeJson: vi.fn() },
}));

vi.mock('@/api/rpc/RpcHandlerManager', () => ({
    RpcHandlerManager: class {
        onSocketConnect = vi.fn();
        onSocketDisconnect = vi.fn();
        handleRequest = vi.fn(async () => '');
        registerHandler = vi.fn();
    },
}));

vi.mock('@/modules/common/registerCommonHandlers', () => ({ registerCommonHandlers: vi.fn() }));
vi.mock('@/modules/fileTransfer/fileUploadRpc', () => ({
    registerFileUploadRpcHandler: vi.fn(),
    processUpload: vi.fn(),
}));
vi.mock('@/modules/fileTransfer/filesApiClient', () => ({
    filesApiClient: { pending: vi.fn(async () => []) },
}));
vi.mock('@/utils/time', () => ({
    backoff: vi.fn(async (cb: () => Promise<unknown>) => cb()),
    delay: vi.fn(async () => undefined),
}));
vi.mock('@/utils/lidState', () => ({ shouldReconnect: mockShouldReconnect }));

type SocketHandler = (...args: any[]) => void;

function makeSession() {
    return {
        id: 'test-session-id',
        seq: 0,
        metadata: {
            path: '/tmp', host: 'localhost', homeDir: '/home/user',
            happyHomeDir: '/home/user/.happy', happyLibDir: '/home/user/.happy/lib',
            happyToolsDir: '/home/user/.happy/tools',
        },
        metadataVersion: 0,
        agentState: null,
        agentStateVersion: 0,
        encryptionKey: new Uint8Array(32),
        encryptionVariant: 'legacy' as const,
    };
}

describe('apiSession HTTPS guard for CachedDnsAgent (IT43)', () => {
    let socketHandlers: Record<string, SocketHandler[]>;
    let mockSocket: any;
    const CACHE_ENTRY = { ip: '1.2.3.4', hostname: 'server.test' };

    const emitSocketEvent = (event: string, ...args: any[]) => {
        (socketHandlers[event] || []).forEach((h) => h(...args));
    };

    beforeEach(() => {
        vi.clearAllMocks();
        mockShouldReconnect.mockReturnValue(true);
        // Default: cache hit whose hostname matches server.test. Individual tests
        // rely on the guard — NOT on the cache being empty — to decide injection.
        mockReadSync.mockReturnValue({ ...CACHE_ENTRY });
        mockReadAsync.mockResolvedValue({ ...CACHE_ENTRY });
        socketHandlers = {};
        mockSocket = {
            connected: true,
            connect: vi.fn(),
            on: vi.fn((event: string, handler: SocketHandler) => {
                (socketHandlers[event] ||= []).push(handler);
            }),
            off: vi.fn(),
            emit: vi.fn(),
            emitWithAck: vi.fn(async () => ({ result: 'error' })),
            volatile: { emit: vi.fn() },
            close: vi.fn(),
            io: { opts: {} },
        };
        mockIo.mockReturnValue(mockSocket);
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
        mutableConfig.serverUrl = 'https://server.test';
    });

    // ─── Constructor path (readServerIpCacheSync) ──────────────────────────────

    describe('constructor (sync path)', () => {
        it('http:// server URL → cache read is skipped and NO agent is injected (even with a matching cache)', () => {
            mutableConfig.serverUrl = 'http://server.test';

            const client = new ApiSessionClient('fake-token', makeSession());

            // Guard must short-circuit the read entirely.
            expect(mockReadSync).not.toHaveBeenCalled();
            const opts = mockIo.mock.calls[0][1];
            expect(opts.agent).toBeUndefined();

            client.close();
        });

        it('https:// server URL → cache is read and CachedDnsAgent IS injected on a match (regression protection)', () => {
            mutableConfig.serverUrl = 'https://server.test';

            const client = new ApiSessionClient('fake-token', makeSession());

            expect(mockReadSync).toHaveBeenCalledTimes(1);
            const opts = mockIo.mock.calls[0][1];
            expect(opts.agent).toBeInstanceOf(FakeCachedDnsAgent);
            expect(opts.agent.ip).toBe('1.2.3.4');
            expect(opts.agent.hostname).toBe('server.test');

            client.close();
        });
    });

    // ─── Reconnect path (readServerIpCache, async) ─────────────────────────────

    describe('startSmartReconnect (async path)', () => {
        it('http:// server URL → async cache read is skipped and agent is removed from socket opts', async () => {
            vi.useFakeTimers();
            mutableConfig.serverUrl = 'http://server.test';
            mockSocket.connected = false;
            // Pre-seed a stale agent to prove the guard path deletes it.
            mockSocket.io.opts.agent = { stale: true };

            const client = new ApiSessionClient('fake-token', makeSession());
            emitSocketEvent('disconnect', 'transport close');

            await vi.advanceTimersByTimeAsync(3100);

            expect(mockReadAsync).not.toHaveBeenCalled();
            expect(mockSocket.io.opts.agent).toBeUndefined();

            await client.close();
        });

        it('https:// server URL → async cache read runs and CachedDnsAgent IS injected on a match', async () => {
            vi.useFakeTimers();
            mutableConfig.serverUrl = 'https://server.test';
            mockSocket.connected = false;

            const client = new ApiSessionClient('fake-token', makeSession());
            emitSocketEvent('disconnect', 'transport close');

            await vi.advanceTimersByTimeAsync(3100);

            expect(mockReadAsync).toHaveBeenCalled();
            expect(mockSocket.io.opts.agent).toBeInstanceOf(FakeCachedDnsAgent);

            await client.close();
        });
    });
});
