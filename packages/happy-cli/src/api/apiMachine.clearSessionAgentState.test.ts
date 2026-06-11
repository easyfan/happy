/**
 * Unit tests for ApiMachineClient.clearSessionAgentState
 *
 * Tests the logic paths of clearSessionAgentState:
 *  - success path: emitWithAck returns success
 *  - socket not connected: returns without emitting
 *  - version-mismatch + server already null: success (already achieved)
 *  - version-mismatch + server non-null: retries once with new version
 *  - version-mismatch + retry succeeds
 *  - version-mismatch + retry also mismatches but server becomes null: success
 *  - error result: silently ignored
 *  - emitWithAck throws: error is propagated (caller handles)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

// Mock serverIpCache so connect() resolves synchronously
vi.mock('@/utils/serverIpCache', () => ({
    readServerIpCache: vi.fn().mockResolvedValue(null),
    writeServerIpCache: vi.fn().mockResolvedValue(undefined),
    lookupWithCache: vi.fn().mockResolvedValue(null),
    makeCachedLookup: vi.fn(),
}));

// ----- Socket stub factory -----

function makeSocketStub(connected: boolean = true) {
    const handlers: Record<string, Array<(...args: unknown[]) => void>> = {};
    const emitWithAck = vi.fn();

    const stub = {
        on(event: string, handler: (...args: unknown[]) => void) {
            handlers[event] = handlers[event] ?? [];
            handlers[event].push(handler);
            return stub;
        },
        connect: vi.fn(),
        close: vi.fn(),
        connected,
        io: { on: vi.fn(), opts: {} },
        emitWithAck,
        emit: vi.fn(),
        volatile: { emit: vi.fn() },
    };

    return { stub, emitWithAck };
}

let lastSocketStub: ReturnType<typeof makeSocketStub> | null = null;

vi.mock('socket.io-client', () => ({
    io: vi.fn((..._args: unknown[]) => {
        lastSocketStub = makeSocketStub(true);
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
    vi.clearAllMocks();
});

afterEach(() => {
    vi.clearAllMocks();
});

// ----- Tests -----

describe('ApiMachineClient.clearSessionAgentState', () => {
    it('emits update-state with agentState=null and resolves on success', async () => {
        const client = new ApiMachineClient('token-abc', makeMachine());
        await client.connect();

        lastSocketStub!.emitWithAck.mockResolvedValueOnce({
            result: 'success',
            version: 2,
            agentState: null,
        });

        await client.clearSessionAgentState('session-id-1', 1);

        expect(lastSocketStub!.emitWithAck).toHaveBeenCalledTimes(1);
        expect(lastSocketStub!.emitWithAck).toHaveBeenCalledWith('update-state', {
            sid: 'session-id-1',
            expectedVersion: 1,
            agentState: null,
        });
    });

    it('does not emit when socket is not connected', async () => {
        // Create a disconnected socket stub
        const disconnectedStub = makeSocketStub(false);
        const { io } = await import('socket.io-client');
        vi.mocked(io).mockReturnValueOnce(disconnectedStub.stub as any);
        lastSocketStub = disconnectedStub;

        const client = new ApiMachineClient('token-abc', makeMachine());
        await client.connect();

        await client.clearSessionAgentState('session-id-2', 0);

        expect(disconnectedStub.emitWithAck).not.toHaveBeenCalled();
    });

    it('treats version-mismatch + server agentState already null as success (no retry)', async () => {
        const client = new ApiMachineClient('token-abc', makeMachine());
        await client.connect();

        lastSocketStub!.emitWithAck.mockResolvedValueOnce({
            result: 'version-mismatch',
            version: 5,
            agentState: null,
        });

        await client.clearSessionAgentState('session-id-3', 3);

        // Should not retry since agentState is already null
        expect(lastSocketStub!.emitWithAck).toHaveBeenCalledTimes(1);
    });

    it('retries once on version-mismatch with non-null server agentState', async () => {
        const client = new ApiMachineClient('token-abc', makeMachine());
        await client.connect();

        // First call: version-mismatch with non-null agentState
        lastSocketStub!.emitWithAck.mockResolvedValueOnce({
            result: 'version-mismatch',
            version: 7,
            agentState: 'encrypted-state-data',
        });
        // Second call: success
        lastSocketStub!.emitWithAck.mockResolvedValueOnce({
            result: 'success',
            version: 8,
            agentState: null,
        });

        await client.clearSessionAgentState('session-id-4', 5);

        expect(lastSocketStub!.emitWithAck).toHaveBeenCalledTimes(2);
        // Second call uses the version from the mismatch response
        expect(lastSocketStub!.emitWithAck).toHaveBeenNthCalledWith(2, 'update-state', {
            sid: 'session-id-4',
            expectedVersion: 7,
            agentState: null,
        });
    });

    it('stops after one retry even if retry also version-mismatches with non-null agentState', async () => {
        const client = new ApiMachineClient('token-abc', makeMachine());
        await client.connect();

        lastSocketStub!.emitWithAck.mockResolvedValueOnce({
            result: 'version-mismatch',
            version: 10,
            agentState: 'non-null-data',
        });
        lastSocketStub!.emitWithAck.mockResolvedValueOnce({
            result: 'version-mismatch',
            version: 11,
            agentState: 'still-non-null',
        });

        // Should not throw — failure is silently ignored
        await expect(client.clearSessionAgentState('session-id-5', 8)).resolves.toBeUndefined();
        // Exactly 2 calls (initial + one retry)
        expect(lastSocketStub!.emitWithAck).toHaveBeenCalledTimes(2);
    });

    it('treats retry version-mismatch with null agentState as success', async () => {
        const client = new ApiMachineClient('token-abc', makeMachine());
        await client.connect();

        lastSocketStub!.emitWithAck.mockResolvedValueOnce({
            result: 'version-mismatch',
            version: 12,
            agentState: 'non-null',
        });
        lastSocketStub!.emitWithAck.mockResolvedValueOnce({
            result: 'version-mismatch',
            version: 13,
            agentState: null, // Server cleared it concurrently
        });

        await client.clearSessionAgentState('session-id-6', 10);

        // Both calls made, no throw
        expect(lastSocketStub!.emitWithAck).toHaveBeenCalledTimes(2);
    });

    it('silently ignores error result from server', async () => {
        const client = new ApiMachineClient('token-abc', makeMachine());
        await client.connect();

        lastSocketStub!.emitWithAck.mockResolvedValueOnce({
            result: 'error',
        });

        await expect(client.clearSessionAgentState('session-id-7', 0)).resolves.toBeUndefined();
        expect(lastSocketStub!.emitWithAck).toHaveBeenCalledTimes(1);
    });

    it('propagates rejection from emitWithAck (caller handles error)', async () => {
        const client = new ApiMachineClient('token-abc', makeMachine());
        await client.connect();

        lastSocketStub!.emitWithAck.mockRejectedValueOnce(new Error('socket-timeout'));

        await expect(client.clearSessionAgentState('session-id-8', 0)).rejects.toThrow('socket-timeout');
    });

    it('sends agentState=null (not encrypted) in the payload', async () => {
        const client = new ApiMachineClient('token-abc', makeMachine());
        await client.connect();

        lastSocketStub!.emitWithAck.mockResolvedValueOnce({
            result: 'success',
            version: 2,
            agentState: null,
        });

        await client.clearSessionAgentState('session-clear-check', 1);

        const callArgs = lastSocketStub!.emitWithAck.mock.calls[0];
        expect(callArgs[1]).toMatchObject({ agentState: null });
        // agentState must be null literal, not a base64 string
        expect(callArgs[1].agentState).toBeNull();
    });
});
