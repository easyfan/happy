/**
 * IT43 — HTTPS guard for CachedDnsAgent injection (apiMachine).
 *
 * Same regression as apiSession (see apiSession.httpsGuard.test.ts): CachedDnsAgent
 * is an https.Agent (TLS). Injecting it into socket.io's `agent` option on a plain
 * HTTP (ws://) server causes a TLS handshake on a cleartext port that never
 * completes, hanging the socket. The fix guards both injection points in apiMachine
 * with `const isHttps = serverUrl.startsWith('https://')` so the cache is only read
 * (and the agent only injected) for HTTPS servers.
 *
 * Exercises BOTH apiMachine paths:
 *   - connect() (initial connection, async readServerIpCache)
 *   - startSmartReconnect / connectWithCachedAgent (reconnect, async readServerIpCache)
 *
 * Assertion strategy: assert on the exact `agent` value that reaches socket.io —
 * for connect() the opts passed to io(); for reconnect the agent mutated onto
 * socket.io.opts. Only external collaborators are stubbed; the guard runs for real.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiMachineClient } from './apiMachine';
import type { Machine } from './types';

type SocketHandler = (...args: any[]) => void;

const {
    FakeCachedDnsAgent, mutableConfig, mockReadAsync, mockResolveFreshIp, mockIo, ioState,
} = vi.hoisted(() => {
    class FakeCachedDnsAgent {
        constructor(public ip: string, public hostname: string) {}
    }
    // Shared mutable state for the socket.io stub. Hoisted so the io() factory
    // (also hoisted) can close over it.
    const ioState: {
        lastIoOpts: Record<string, any> | undefined;
        lastSocketStub: any;
        socketHandlers: Record<string, ((...args: any[]) => void)[]>;
    } = { lastIoOpts: undefined, lastSocketStub: undefined, socketHandlers: {} };

    const mockIo = vi.fn((_url: string, opts: Record<string, any>) => {
        ioState.lastIoOpts = opts;
        for (const k of Object.keys(ioState.socketHandlers)) delete ioState.socketHandlers[k];
        const stub: any = {
            on(event: string, handler: (...args: any[]) => void) {
                (ioState.socketHandlers[event] ||= []).push(handler);
                return stub;
            },
            connect: vi.fn(),
            close: vi.fn(),
            connected: false,
            io: { on: vi.fn(), opts },
            emitWithAck: vi.fn().mockResolvedValue({ result: 'success', version: 1, daemonState: '' }),
            emit: vi.fn(),
            volatile: { emit: vi.fn() },
        };
        ioState.lastSocketStub = stub;
        return stub;
    });

    return {
        FakeCachedDnsAgent,
        mutableConfig: { serverUrl: 'https://server.test', currentCliVersion: '0.0.0-test' },
        mockReadAsync: vi.fn<() => Promise<{ ip: string; hostname: string } | null>>(async () => null),
        mockResolveFreshIp: vi.fn<() => Promise<string | null>>(async () => null),
        mockIo,
        ioState,
    };
});

vi.mock('@/ui/logger', () => ({ logger: { debug: vi.fn(), debugLargeJson: vi.fn() } }));
vi.mock('@/configuration', () => ({ configuration: mutableConfig }));
vi.mock('@/utils/cachedDnsAgent', () => ({ CachedDnsAgent: FakeCachedDnsAgent }));
vi.mock('@/utils/detectCLI', () => ({
    detectCLIAvailability: vi.fn(() => ({
        claude: false, codex: false, gemini: false, openclaw: false, detectedAt: 0,
    })),
}));
vi.mock('@/resume/localHappyAgentAuth', () => ({
    detectResumeSupport: vi.fn(() => ({
        rpcAvailable: false, requiresSameMachine: false,
        requiresHappyAgentAuth: false, happyAgentAuthenticated: false, detectedAt: 0,
    })),
}));
// shouldReconnect true so the reconnect path actually fires the guarded closure.
vi.mock('@/utils/lidState', () => ({ shouldReconnect: vi.fn(() => true) }));
vi.mock('@/modules/common/registerCommonHandlers', () => ({ registerCommonHandlers: vi.fn() }));
vi.mock('@/utils/serverIpCache', () => ({
    readServerIpCache: mockReadAsync,
    writeServerIpCache: vi.fn().mockResolvedValue(undefined),
    resolveFreshIp: mockResolveFreshIp,
    makeCachedLookup: vi.fn(),
}));

vi.mock('socket.io-client', () => ({ io: mockIo }));

function makeMachine(): Machine {
    return {
        id: 'machine-test-id',
        encryptionKey: new Uint8Array(32),
        encryptionVariant: 'legacy',
        metadata: {
            host: 'test', platform: 'linux', happyCliVersion: '0.0.0', homeDir: '/home/test',
        },
        metadataVersion: 0,
        daemonState: null,
        daemonStateVersion: 0,
    } as unknown as Machine;
}

const emitSocketEvent = (event: string, ...args: any[]) => {
    (ioState.socketHandlers[event] || []).forEach((h: SocketHandler) => h(...args));
};

describe('apiMachine HTTPS guard for CachedDnsAgent (IT43)', () => {
    const CACHE_ENTRY = { ip: '5.6.7.8', hostname: 'server.test' };

    beforeEach(() => {
        vi.clearAllMocks();
        ioState.lastIoOpts = undefined;
        for (const k of Object.keys(ioState.socketHandlers)) delete ioState.socketHandlers[k];
        // Default: matching cache hit. Injection is decided by the guard, not by
        // an empty cache.
        mockReadAsync.mockResolvedValue({ ...CACHE_ENTRY });
    });

    afterEach(() => {
        vi.useRealTimers();
        mutableConfig.serverUrl = 'https://server.test';
    });

    // ─── connect() — initial connection ────────────────────────────────────────

    describe('connect() (initial)', () => {
        it('http:// server URL → cache read skipped, NO agent injected (even with matching cache)', async () => {
            mutableConfig.serverUrl = 'http://server.test';
            const client = new ApiMachineClient('fake-token', makeMachine());

            await client.connect();

            expect(mockReadAsync).not.toHaveBeenCalled();
            expect(ioState.lastIoOpts).toBeDefined();
            expect(ioState.lastIoOpts!.agent).toBeUndefined();

            client.shutdown();
        });

        it('https:// server URL → cache read runs, CachedDnsAgent injected on match (regression protection)', async () => {
            mutableConfig.serverUrl = 'https://server.test';
            const client = new ApiMachineClient('fake-token', makeMachine());

            await client.connect();

            expect(mockReadAsync).toHaveBeenCalledTimes(1);
            expect(ioState.lastIoOpts!.agent).toBeInstanceOf(FakeCachedDnsAgent);
            expect(ioState.lastIoOpts!.agent.ip).toBe('5.6.7.8');
            expect(ioState.lastIoOpts!.agent.hostname).toBe('server.test');

            client.shutdown();
        });
    });

    // ─── startSmartReconnect() — reconnect attempts ─────────────────────────────

    describe('startSmartReconnect() (reconnect)', () => {
        it('http:// server URL → async cache read skipped, agent removed from socket opts', async () => {
            vi.useFakeTimers();
            mutableConfig.serverUrl = 'http://server.test';
            const client = new ApiMachineClient('fake-token', makeMachine());
            await client.connect();

            // Pre-seed a stale agent to prove the guarded path deletes it.
            ioState.lastSocketStub.io.opts.agent = { stale: true };
            mockReadAsync.mockClear();

            // Trigger reconnect via connect_error.
            emitSocketEvent('connect_error', new Error('ECONNREFUSED'));
            await vi.advanceTimersByTimeAsync(3100);

            expect(mockReadAsync).not.toHaveBeenCalled();
            expect(ioState.lastSocketStub.io.opts.agent).toBeUndefined();

            client.shutdown();
        });

        it('https:// server URL → async cache read runs, CachedDnsAgent injected on match', async () => {
            vi.useFakeTimers();
            mutableConfig.serverUrl = 'https://server.test';
            const client = new ApiMachineClient('fake-token', makeMachine());
            await client.connect();

            mockReadAsync.mockClear();
            mockReadAsync.mockResolvedValue({ ...CACHE_ENTRY });

            emitSocketEvent('connect_error', new Error('ECONNREFUSED'));
            await vi.advanceTimersByTimeAsync(3100);

            expect(mockReadAsync).toHaveBeenCalled();
            expect(ioState.lastSocketStub.io.opts.agent).toBeInstanceOf(FakeCachedDnsAgent);

            client.shutdown();
        });
    });
});
