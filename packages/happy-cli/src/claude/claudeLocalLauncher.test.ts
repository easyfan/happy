import { describe, it, expect, vi, beforeEach } from 'vitest';
import { claudeLocalLauncher } from './claudeLocalLauncher';
import type { Session } from './session';
import type { EnhancedMode } from './loop';
import { MessageQueue2 } from '@/utils/MessageQueue2';

// Use vi.hoisted so mock factories can access the hoisted references
const {
    mockClaudeLocal,
    mockCreateSessionScanner,
} = vi.hoisted(() => ({
    mockClaudeLocal: vi.fn(),
    mockCreateSessionScanner: vi.fn(),
}));

vi.mock('./claudeLocal', () => ({
    claudeLocal: mockClaudeLocal,
    ExitCodeError: class ExitCodeError extends Error {
        exitCode: number;
        constructor(code: number) {
            super(`Exit code ${code}`);
            this.exitCode = code;
        }
    },
}));

vi.mock('./utils/sessionScanner', () => ({
    createSessionScanner: mockCreateSessionScanner,
}));

vi.mock('@/ui/logger', () => ({
    logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    },
}));

// Helper: create a deferred promise so tests can control when claudeLocal resolves
function createDeferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (err: unknown) => void } {
    let resolve!: (value: T) => void;
    let reject!: (err: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

// Build a minimal mock Session
function buildMockSession(): {
    session: Session;
    mockCloseClaudeSessionTurn: ReturnType<typeof vi.fn>;
    queue: MessageQueue2<EnhancedMode>;
    rpcHandlers: Map<string, () => Promise<void>>;
    sessionFoundCallbacks: Array<(id: string) => void>;
} {
    const mockCloseClaudeSessionTurn = vi.fn();
    const mockSendClaudeSessionMessage = vi.fn();
    const mockSendSessionEvent = vi.fn();
    const rpcHandlers = new Map<string, () => Promise<void>>();

    const rpcHandlerManager = {
        registerHandler: vi.fn((name: string, handler: () => Promise<void>) => {
            rpcHandlers.set(name, handler);
        }),
    };

    const sessionFoundCallbacks: Array<(id: string) => void> = [];

    const queue = new MessageQueue2<EnhancedMode>((mode) => JSON.stringify(mode));

    const session = {
        path: '/tmp/test-session',
        sessionId: null,
        claudeEnvVars: undefined,
        claudeArgs: [],
        mcpServers: {},
        allowedTools: undefined,
        hookSettingsPath: '/tmp/test-hook-settings.json',
        sandboxConfig: undefined,
        queue,
        client: {
            closeClaudeSessionTurn: mockCloseClaudeSessionTurn,
            sendClaudeSessionMessage: mockSendClaudeSessionMessage,
            sendSessionEvent: mockSendSessionEvent,
            rpcHandlerManager,
            keepAlive: vi.fn(),
        },
        onThinkingChange: vi.fn(),
        onSessionFound: vi.fn(),
        consumeOneTimeFlags: vi.fn(),
        addSessionFoundCallback: vi.fn((cb: (id: string) => void) => {
            sessionFoundCallbacks.push(cb);
        }),
        removeSessionFoundCallback: vi.fn((cb: (id: string) => void) => {
            const idx = sessionFoundCallbacks.indexOf(cb);
            if (idx !== -1) sessionFoundCallbacks.splice(idx, 1);
        }),
    } as unknown as Session;

    return { session, mockCloseClaudeSessionTurn, queue, rpcHandlers, sessionFoundCallbacks };
}

describe('claudeLocalLauncher', () => {
    beforeEach(() => {
        vi.clearAllMocks();

        // Default scanner mock: return minimal scanner object
        mockCreateSessionScanner.mockResolvedValue({
            onNewSession: vi.fn(),
            cleanup: vi.fn().mockResolvedValue(undefined),
        });
    });

    it('does not abort local Claude Code when an app message requests remote control', async () => {
        const { session, mockCloseClaudeSessionTurn, queue } = buildMockSession();

        // Control when claudeLocal resolves
        const localRun = createDeferred<void>();
        let localAbortSignal: AbortSignal | null = null;
        let queueHandler: ((message: string, mode: EnhancedMode) => void) | null = null;

        mockClaudeLocal.mockImplementation((opts: { abort: AbortSignal }) => {
            localAbortSignal = opts.abort;
            return localRun.promise;
        });

        // Capture the onMessage handler installed by claudeLocalLauncher
        const origSetOnMessage = queue.setOnMessage.bind(queue);
        vi.spyOn(queue, 'setOnMessage').mockImplementation((handler) => {
            if (handler !== null) {
                queueHandler = handler;
            }
            origSetOnMessage(handler);
        });

        // Start the launcher (do not await yet — it runs concurrently)
        const launcherPromise = claudeLocalLauncher(session);

        // Wait until claudeLocal has been called (both signal + queueHandler available)
        await vi.waitFor(() => {
            expect(localAbortSignal).not.toBeNull();
            expect(queueHandler).not.toBeNull();
        });

        // Simulate: app sends a remote message while local process is running
        const mode: EnhancedMode = { permissionMode: 'default' };
        queue.push('hello from remote', mode);

        // Give the microtask queue a tick to let doSwitch() run
        await new Promise((r) => setImmediate(r));

        // Assert: local process was NOT aborted
        expect(localAbortSignal!.aborted).toBe(false);

        // Assert: 'cancelled' signal was NOT sent to app
        expect(mockCloseClaudeSessionTurn).not.toHaveBeenCalledWith('cancelled');

        // Now let claudeLocal complete normally
        localRun.resolve();

        const result = await launcherPromise;

        // Assert: launcher returns { type: 'switch' }
        expect(result).toEqual({ type: 'switch' });

        // Assert: 'completed' was sent when local exited naturally
        expect(mockCloseClaudeSessionTurn).toHaveBeenCalledWith('completed');
    });

    it('returns exit when local completes naturally with no queued messages', async () => {
        const { session } = buildMockSession();

        mockClaudeLocal.mockResolvedValue(undefined);

        const result = await claudeLocalLauncher(session);

        expect(result).toEqual({ type: 'exit', code: 0 });
    });

    it('returns switch immediately if queue has messages before launch', async () => {
        const { session, queue } = buildMockSession();

        // Push a message before launcher starts
        const mode: EnhancedMode = { permissionMode: 'default' };
        queue.push('pre-existing message', mode);

        const result = await claudeLocalLauncher(session);

        // Should return switch without ever launching claudeLocal
        expect(result).toEqual({ type: 'switch' });
        expect(mockClaudeLocal).not.toHaveBeenCalled();
    });

    it('doAbort RPC handler forces abort and sends cancelled signal', async () => {
        const { session, mockCloseClaudeSessionTurn, rpcHandlers } = buildMockSession();

        const localRun = createDeferred<void>();
        mockClaudeLocal.mockImplementation(() => localRun.promise);

        const launcherPromise = claudeLocalLauncher(session);

        // Wait until abort RPC handler is registered
        await vi.waitFor(() => {
            expect(rpcHandlers.has('abort')).toBe(true);
        });

        // Call the abort RPC handler
        const abortHandler = rpcHandlers.get('abort')!;
        void abortHandler();

        // Resolve local process to unblock launcher
        localRun.resolve();

        const result = await launcherPromise;

        expect(result).toEqual({ type: 'switch' });
        expect(mockCloseClaudeSessionTurn).toHaveBeenCalledWith('cancelled');
    });

    it('switch RPC handler sets switchRequested without aborting process', async () => {
        const { session, mockCloseClaudeSessionTurn, rpcHandlers } = buildMockSession();

        const localRun = createDeferred<void>();
        let capturedAbortSignal: AbortSignal | null = null;

        mockClaudeLocal.mockImplementation((opts: { abort: AbortSignal }) => {
            capturedAbortSignal = opts.abort;
            return localRun.promise;
        });

        const launcherPromise = claudeLocalLauncher(session);

        await vi.waitFor(() => {
            expect(rpcHandlers.has('switch')).toBe(true);
            expect(capturedAbortSignal).not.toBeNull();
        });

        // Call the switch RPC handler
        const switchHandler = rpcHandlers.get('switch')!;
        await switchHandler();

        // Local process should still be running (not aborted)
        expect(capturedAbortSignal!.aborted).toBe(false);
        expect(mockCloseClaudeSessionTurn).not.toHaveBeenCalledWith('cancelled');

        // Let local process finish naturally
        localRun.resolve();

        const result = await launcherPromise;

        expect(result).toEqual({ type: 'switch' });
        expect(mockCloseClaudeSessionTurn).toHaveBeenCalledWith('completed');
    });
});
