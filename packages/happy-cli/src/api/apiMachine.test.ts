/**
 * Unit tests for ApiMachineClient.setOnConnectCallback
 *
 * Verifies that the onConnect hook mechanism works correctly:
 *  - Callback registered via setOnConnectCallback is invoked on connect
 *  - Errors from the callback are caught and do not propagate to the caller
 *  - Callback is NOT called before a connect event fires
 *
 * NOTE: These tests exercise the callback registration/firing contract only.
 * The actual cleanup logic (cancelOrphanedPermissions in run.ts) is covered by
 * permissionHandler.test.ts and daemon.integration.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApiMachineClient } from './apiMachine';
import type { Machine } from './types';

// ----- Module mocks -----

vi.mock('@/ui/logger', () => ({
    logger: {
        debug: vi.fn(),
        debugLargeJson: vi.fn(),
    },
}));

vi.mock('@/configuration', () => ({
    configuration: {
        serverUrl: 'http://localhost:3005',
        currentCliVersion: '0.0.0-test',
    },
}));

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

vi.mock('@/utils/lidState', () => ({
    shouldReconnect: vi.fn(() => false),
}));

vi.mock('@/modules/common/registerCommonHandlers', () => ({
    registerCommonHandlers: vi.fn(),
}));

// ----- Socket stub factory -----

/**
 * Creates a controllable socket stub and exposes a `fireConnect()` helper that
 * synchronously triggers all registered 'connect' handlers — mirroring what the
 * real socket.io-client does when the WebSocket handshake completes.
 */
function makeSocketStub() {
    const handlers: Record<string, Array<(...args: unknown[]) => void>> = {};

    const stub = {
        on(event: string, handler: (...args: unknown[]) => void) {
            handlers[event] = handlers[event] ?? [];
            handlers[event].push(handler);
            return stub;
        },
        connect: vi.fn(),
        close: vi.fn(),
        connected: false,
        io: { on: vi.fn() },
        emitWithAck: vi.fn().mockResolvedValue({ result: 'success', version: 1, daemonState: '' }),
        emit: vi.fn(),
        volatile: { emit: vi.fn() },
    };

    function fireConnect() {
        for (const h of handlers['connect'] ?? []) h();
    }

    return { stub, fireConnect };
}

// Keep track of the most recently created stub so tests can fire connect
let lastSocketStub: ReturnType<typeof makeSocketStub> | null = null;

vi.mock('socket.io-client', () => ({
    io: vi.fn((..._args: unknown[]) => {
        lastSocketStub = makeSocketStub();
        return lastSocketStub.stub;
    }),
}));

// ----- Helpers -----

function makeMachine(): Machine {
    return {
        id: 'machine-test-id',
        encryptionKey: new Uint8Array(32),
        encryptionVariant: 'legacy',
        metadata: {
            host: 'test',
            platform: 'linux',
            happyCliVersion: '0.0.0',
            homeDir: '/home/test',
            happyHomeDir: '/home/test/.happy',
            happyLibDir: '/home/test/.happy/lib',
        },
        metadataVersion: 0,
        daemonState: null,
        daemonStateVersion: 0,
    };
}

beforeEach(() => {
    lastSocketStub = null;
});

// ----- Tests -----

describe('ApiMachineClient.setOnConnectCallback', () => {
    it('invokes the callback when the socket fires a connect event', async () => {
        const client = new ApiMachineClient('token-abc', makeMachine());
        const callback = vi.fn(() => Promise.resolve());
        client.setOnConnectCallback(callback);
        client.connect();

        // Simulate the WebSocket handshake completing
        lastSocketStub!.fireConnect();

        // Callback is fire-and-forget — flush pending microtasks
        await Promise.resolve();
        expect(callback).toHaveBeenCalledTimes(1);
    });

    it('does NOT invoke the callback before a connect event fires', () => {
        const client = new ApiMachineClient('token-abc', makeMachine());
        const callback = vi.fn(() => Promise.resolve());
        client.setOnConnectCallback(callback);
        client.connect();
        // fireConnect() NOT called
        expect(callback).not.toHaveBeenCalled();
    });

    it('swallows errors thrown by the callback and does not propagate them', async () => {
        const client = new ApiMachineClient('token-abc', makeMachine());
        const failingCallback = vi.fn(() => Promise.reject(new Error('callback-error')));
        client.setOnConnectCallback(failingCallback);
        client.connect();
        lastSocketStub!.fireConnect();

        // Flush microtask + one macrotask to let the internal .catch run
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(failingCallback).toHaveBeenCalledTimes(1);
        // No unhandled rejection — test infrastructure would fail if one occurred
    });

    it('works without any registered callback (no-op)', () => {
        const client = new ApiMachineClient('token-abc', makeMachine());
        // No setOnConnectCallback call
        client.connect();
        expect(() => lastSocketStub!.fireConnect()).not.toThrow();
    });

    it('re-invokes the callback on subsequent reconnects', async () => {
        const client = new ApiMachineClient('token-abc', makeMachine());
        const callback = vi.fn(() => Promise.resolve());
        client.setOnConnectCallback(callback);
        client.connect();

        // First connect
        lastSocketStub!.fireConnect();
        await Promise.resolve();
        expect(callback).toHaveBeenCalledTimes(1);

        // Second connect (reconnect scenario)
        lastSocketStub!.fireConnect();
        await Promise.resolve();
        expect(callback).toHaveBeenCalledTimes(2);
    });
});
