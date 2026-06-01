import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks — must be defined before any imports that use them
// ---------------------------------------------------------------------------
const { txMock, dbMock, inTxMock, afterTxMock, emitUpdateMock, emitEphemeralMock, resetMocks } = vi.hoisted(() => {
    const emitUpdateMock = vi.fn();
    const emitEphemeralMock = vi.fn();

    const txMock: any = {
        session: {
            findUnique: vi.fn(),
            updateMany: vi.fn(async () => ({ count: 1 })),
        },
        sessionMessage: {
            findFirst: vi.fn(async () => null),
            create: vi.fn(async (args: any) => ({
                id: 'msg-1',
                sessionId: args.data.sessionId,
                seq: 1,
                content: args.data.content,
                localId: args.data.localId ?? null,
                createdAt: new Date(),
            })),
        },
        account: {
            update: vi.fn(async () => ({ seq: 1 })),
        },
    };

    // inTx executes fn immediately with txMock, then runs afterTx callbacks
    const afterTxCallbacks: (() => void)[] = [];
    const afterTxMock = vi.fn((tx: any, cb: () => void) => {
        afterTxCallbacks.push(cb);
    });
    const inTxMock = vi.fn(async (fn: (tx: any) => Promise<any>) => {
        afterTxCallbacks.length = 0;
        const result = await fn(txMock);
        for (const cb of afterTxCallbacks) {
            cb();
        }
        return result;
    });

    const dbMock: any = {
        session: {
            findUnique: vi.fn(),
            update: vi.fn(async () => ({})),
        },
        account: {
            update: vi.fn(async () => ({ seq: 1 })),
        },
    };

    const resetMocks = () => {
        txMock.session.findUnique.mockReset();
        txMock.session.updateMany.mockReset();
        txMock.session.updateMany.mockResolvedValue({ count: 1 });
        txMock.sessionMessage.findFirst.mockReset();
        txMock.sessionMessage.findFirst.mockResolvedValue(null);
        txMock.sessionMessage.create.mockReset();
        txMock.sessionMessage.create.mockResolvedValue({ id: 'msg-1', sessionId: 'sid-1', seq: 1, content: {}, localId: null, createdAt: new Date() });
        txMock.account.update.mockReset();
        txMock.account.update.mockResolvedValue({ seq: 1 });
        dbMock.session.findUnique.mockReset();
        dbMock.session.update.mockReset();
        dbMock.session.update.mockResolvedValue({});
        dbMock.account.update.mockReset();
        dbMock.account.update.mockResolvedValue({ seq: 1 });
        emitUpdateMock.mockReset();
        emitEphemeralMock.mockReset();
        inTxMock.mockClear();
        afterTxMock.mockClear();
    };

    return { txMock, dbMock, inTxMock, afterTxMock, emitUpdateMock, emitEphemeralMock, resetMocks };
});

vi.mock('@/storage/db', () => ({ db: dbMock }));
vi.mock('@/storage/inTx', () => ({
    inTx: inTxMock,
    afterTx: afterTxMock,
}));
vi.mock('@/storage/seq', () => ({
    allocateUserSeq: vi.fn(async () => 1),
    allocateSessionSeq: vi.fn(async () => 1),
}));
vi.mock('@/app/events/eventRouter', () => ({
    eventRouter: {
        emitUpdate: emitUpdateMock,
        emitEphemeral: emitEphemeralMock,
    },
    buildUpdateSessionUpdate: vi.fn(() => ({ type: 'update-session' })),
    buildNewMessageUpdate: vi.fn(() => ({ type: 'new-message' })),
    buildSessionActivityEphemeral: vi.fn(() => ({ type: 'session-activity' })),
}));
vi.mock('@/app/monitoring/metrics2', () => ({
    getMetricsLabelsFromSocket: vi.fn(() => ({})),
    websocketEventsCounter: { inc: vi.fn() },
    sessionAliveEventsCounter: { inc: vi.fn() },
}));
vi.mock('@/app/presence/sessionCache', () => ({
    activityCache: {
        isSessionValid: vi.fn(async () => true),
        queueSessionUpdate: vi.fn(),
    },
}));
vi.mock('@/utils/log', () => ({ log: vi.fn() }));
vi.mock('@/utils/randomKeyNaked', () => ({ randomKeyNaked: vi.fn(() => 'randomkey') }));

import { sessionUpdateHandler } from './sessionUpdateHandler';

// Helper: create a mock socket with event registration
function createMockSocket() {
    const handlers: Record<string, Function> = {};
    return {
        on: vi.fn((event: string, handler: Function) => {
            handlers[event] = handler;
        }),
        emit: vi.fn(),
        id: 'socket-test-1',
        _handlers: handlers,
    };
}

const TEST_USER_ID = 'user-test-1';
const TEST_CONNECTION: any = {
    connectionType: 'user-scoped',
};
const VALID_SESSION: any = {
    id: 'sid-1',
    accountId: TEST_USER_ID,
    metadata: '{"title":"test"}',
    metadataVersion: 0,
    agentState: null,
    agentStateVersion: 0,
};

describe('sessionUpdateHandler — TECH-07 Zod validation', () => {
    beforeEach(() => {
        resetMocks();
    });

    // ---- update-metadata ----

    it('update-metadata: null data → callback({ result: "error" }), no DB access', async () => {
        const socket = createMockSocket();
        sessionUpdateHandler(TEST_USER_ID, socket as any, TEST_CONNECTION);

        const callback = vi.fn();
        await socket._handlers['update-metadata'](null, callback);

        expect(callback).toHaveBeenCalledOnce();
        expect(callback).toHaveBeenCalledWith({ result: 'error' });
        expect(inTxMock).not.toHaveBeenCalled();
    });

    it('update-metadata: sid is empty string → callback({ result: "error" })', async () => {
        const socket = createMockSocket();
        sessionUpdateHandler(TEST_USER_ID, socket as any, TEST_CONNECTION);

        const callback = vi.fn();
        await socket._handlers['update-metadata']({ sid: '', metadata: 'data', expectedVersion: 0 }, callback);

        expect(callback).toHaveBeenCalledWith({ result: 'error' });
        expect(inTxMock).not.toHaveBeenCalled();
    });

    it('update-metadata: expectedVersion is negative → callback({ result: "error" })', async () => {
        const socket = createMockSocket();
        sessionUpdateHandler(TEST_USER_ID, socket as any, TEST_CONNECTION);

        const callback = vi.fn();
        await socket._handlers['update-metadata']({ sid: 'sid-1', metadata: 'data', expectedVersion: -1 }, callback);

        expect(callback).toHaveBeenCalledWith({ result: 'error' });
        expect(inTxMock).not.toHaveBeenCalled();
    });

    it('update-metadata: expectedVersion is float → callback({ result: "error" })', async () => {
        const socket = createMockSocket();
        sessionUpdateHandler(TEST_USER_ID, socket as any, TEST_CONNECTION);

        const callback = vi.fn();
        await socket._handlers['update-metadata']({ sid: 'sid-1', metadata: 'data', expectedVersion: 1.5 }, callback);

        expect(callback).toHaveBeenCalledWith({ result: 'error' });
        expect(inTxMock).not.toHaveBeenCalled();
    });

    // ---- update-state ----

    it('update-state: agentState is a number → callback({ result: "error" })', async () => {
        const socket = createMockSocket();
        sessionUpdateHandler(TEST_USER_ID, socket as any, TEST_CONNECTION);

        const callback = vi.fn();
        await socket._handlers['update-state']({ sid: 'sid-1', agentState: 42, expectedVersion: 0 }, callback);

        expect(callback).toHaveBeenCalledWith({ result: 'error' });
        expect(inTxMock).not.toHaveBeenCalled();
    });

    // ---- message (silent discard) ----

    it('message: null data → no callback called (silent discard)', async () => {
        const socket = createMockSocket();
        sessionUpdateHandler(TEST_USER_ID, socket as any, TEST_CONNECTION);

        // message handler has no callback param
        await socket._handlers['message'](null);

        expect(inTxMock).not.toHaveBeenCalled();
        expect(emitUpdateMock).not.toHaveBeenCalled();
    });

    it('message: message field is empty string → silent discard (min(1) violated)', async () => {
        const socket = createMockSocket();
        sessionUpdateHandler(TEST_USER_ID, socket as any, TEST_CONNECTION);

        await socket._handlers['message']({ sid: 'sid-1', message: '' });

        expect(inTxMock).not.toHaveBeenCalled();
        expect(emitUpdateMock).not.toHaveBeenCalled();
    });

    it('message: missing sid → silent discard', async () => {
        const socket = createMockSocket();
        sessionUpdateHandler(TEST_USER_ID, socket as any, TEST_CONNECTION);

        await socket._handlers['message']({ message: 'encrypted-content' });

        expect(inTxMock).not.toHaveBeenCalled();
        expect(emitUpdateMock).not.toHaveBeenCalled();
    });

    // ---- session-alive ----

    it('session-alive: null data → silent return', async () => {
        const socket = createMockSocket();
        sessionUpdateHandler(TEST_USER_ID, socket as any, TEST_CONNECTION);

        await socket._handlers['session-alive'](null);

        expect(emitEphemeralMock).not.toHaveBeenCalled();
    });

    it('session-alive: time is string → silent return', async () => {
        const socket = createMockSocket();
        sessionUpdateHandler(TEST_USER_ID, socket as any, TEST_CONNECTION);

        await socket._handlers['session-alive']({ sid: 'sid-1', time: 'not-a-number' });

        expect(emitEphemeralMock).not.toHaveBeenCalled();
    });

    // ---- session-end ----

    it('session-end: null data → silent return', async () => {
        const socket = createMockSocket();
        sessionUpdateHandler(TEST_USER_ID, socket as any, TEST_CONNECTION);

        await socket._handlers['session-end'](null);

        expect(dbMock.session.findUnique).not.toHaveBeenCalled();
    });

    it('session-end: time field missing → silent return', async () => {
        const socket = createMockSocket();
        sessionUpdateHandler(TEST_USER_ID, socket as any, TEST_CONNECTION);

        await socket._handlers['session-end']({ sid: 'sid-1' });

        expect(dbMock.session.findUnique).not.toHaveBeenCalled();
    });
});

describe('sessionUpdateHandler — TECH-03 inTx + happy path', () => {
    beforeEach(() => {
        resetMocks();
    });

    it('update-metadata: session not found → return without callback', async () => {
        txMock.session.findUnique.mockResolvedValue(null);

        const socket = createMockSocket();
        sessionUpdateHandler(TEST_USER_ID, socket as any, TEST_CONNECTION);

        const callback = vi.fn();
        await socket._handlers['update-metadata']({ sid: 'sid-1', metadata: 'data', expectedVersion: 0 }, callback);

        expect(inTxMock).toHaveBeenCalledOnce();
        expect(callback).not.toHaveBeenCalled();
        expect(emitUpdateMock).not.toHaveBeenCalled();
    });

    it('update-metadata: version mismatch → callback({ result: "version-mismatch" }), no emit', async () => {
        txMock.session.findUnique.mockResolvedValue({ ...VALID_SESSION, metadataVersion: 5 });

        const socket = createMockSocket();
        sessionUpdateHandler(TEST_USER_ID, socket as any, TEST_CONNECTION);

        const callback = vi.fn();
        await socket._handlers['update-metadata']({ sid: 'sid-1', metadata: 'data', expectedVersion: 0 }, callback);

        expect(callback).toHaveBeenCalledWith({ result: 'version-mismatch', version: 5, metadata: VALID_SESSION.metadata });
        expect(emitUpdateMock).not.toHaveBeenCalled();
    });

    it('update-metadata: success → callback({ result: "success" }) called after inTx, emitUpdate triggered', async () => {
        txMock.session.findUnique.mockResolvedValue({ ...VALID_SESSION, metadataVersion: 0 });

        const socket = createMockSocket();
        sessionUpdateHandler(TEST_USER_ID, socket as any, TEST_CONNECTION);

        const callback = vi.fn();
        const callOrder: string[] = [];
        emitUpdateMock.mockImplementation(() => callOrder.push('emitUpdate'));
        callback.mockImplementation(() => callOrder.push('callback'));

        await socket._handlers['update-metadata']({ sid: 'sid-1', metadata: 'new-data', expectedVersion: 0 }, callback);

        expect(inTxMock).toHaveBeenCalledOnce();
        expect(callback).toHaveBeenCalledWith({ result: 'success', version: 1, metadata: 'new-data' });
        expect(emitUpdateMock).toHaveBeenCalledOnce();
        // afterTx callbacks run before inTx returns, so emitUpdate fires before callback
        expect(callOrder).toEqual(['emitUpdate', 'callback']);
    });

    it('message: valid data → inTx called, emitUpdate triggered via afterTx', async () => {
        txMock.session.findUnique.mockResolvedValue(VALID_SESSION);

        const socket = createMockSocket();
        sessionUpdateHandler(TEST_USER_ID, socket as any, TEST_CONNECTION);

        await socket._handlers['message']({ sid: 'sid-1', message: 'encrypted-base64-content' });

        expect(inTxMock).toHaveBeenCalledOnce();
        expect(txMock.sessionMessage.create).toHaveBeenCalledOnce();
        expect(emitUpdateMock).toHaveBeenCalledOnce();
    });

    it('message: duplicate localId → no new message created, no emitUpdate', async () => {
        txMock.session.findUnique.mockResolvedValue(VALID_SESSION);
        txMock.sessionMessage.findFirst.mockResolvedValue({ id: 'existing-msg' });

        const socket = createMockSocket();
        sessionUpdateHandler(TEST_USER_ID, socket as any, TEST_CONNECTION);

        await socket._handlers['message']({ sid: 'sid-1', message: 'encrypted-content', localId: 'local-123' });

        expect(txMock.sessionMessage.create).not.toHaveBeenCalled();
        expect(emitUpdateMock).not.toHaveBeenCalled();
    });

    it('update-state: string agentState → emitUpdate called with { value: string, version }', async () => {
        txMock.session.findUnique.mockResolvedValue({
            ...VALID_SESSION,
            agentStateVersion: 2
        });

        const socket = createMockSocket();
        sessionUpdateHandler(TEST_USER_ID, socket as any, TEST_CONNECTION);

        const callback = vi.fn();
        await socket._handlers['update-state']({
            sid: 'sid-1',
            agentState: 'encrypted-state-payload',
            expectedVersion: 2
        }, callback);

        expect(callback).toHaveBeenCalledWith({ result: 'success', version: 3, agentState: 'encrypted-state-payload' });
        expect(emitUpdateMock).toHaveBeenCalledOnce();

        const { buildUpdateSessionUpdate } = await import('@/app/events/eventRouter');
        expect(buildUpdateSessionUpdate).toHaveBeenCalledWith(
            'sid-1', 1, 'randomkey', undefined,
            { value: 'encrypted-state-payload', version: 3 }
        );
    });

    it('update-state: null agentState → emitUpdate called with { value: null, version } (C2 null fanout fix)', async () => {
        txMock.session.findUnique.mockResolvedValue({
            ...VALID_SESSION,
            agentState: 'old-encrypted-state',
            agentStateVersion: 5
        });

        const socket = createMockSocket();
        sessionUpdateHandler(TEST_USER_ID, socket as any, TEST_CONNECTION);

        const callback = vi.fn();
        await socket._handlers['update-state']({
            sid: 'sid-1',
            agentState: null,
            expectedVersion: 5
        }, callback);

        expect(callback).toHaveBeenCalledWith({ result: 'success', version: 6, agentState: null });
        expect(emitUpdateMock).toHaveBeenCalledOnce();

        const { buildUpdateSessionUpdate } = await import('@/app/events/eventRouter');
        // Before fix: would have been called with undefined as 5th arg
        // After fix: must be called with { value: null, version: 6 }
        expect(buildUpdateSessionUpdate).toHaveBeenCalledWith(
            'sid-1', 1, 'randomkey', undefined,
            { value: null, version: 6 }
        );
    });
});
