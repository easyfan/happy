import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks — must be defined before any imports that use them
// ---------------------------------------------------------------------------
const { emitUpdateMock, dbMock, startedTasks, resetMocks } = vi.hoisted(() => {
    const emitUpdateMock = vi.fn();
    const startedTasks: Array<() => Promise<void>> = [];

    // In-memory session store keyed by id
    const sessions = new Map<string, any>();

    const dbMock = {
        session: {
            findMany: vi.fn(async (args: any) => {
                const where = args?.where ?? {};
                return Array.from(sessions.values()).filter((s) => {
                    // agentState: { not: null }
                    if (where.agentState?.not === null && s.agentState === null) return false;
                    // lastActiveAt: { lte: staleBefore }
                    if (where.lastActiveAt?.lte && s.lastActiveAt > where.lastActiveAt.lte) return false;
                    return true;
                });
            }),
            findUnique: vi.fn(async (args: any) => {
                return sessions.get(args?.where?.id) ?? null;
            }),
            updateManyAndReturn: vi.fn(async (args: any) => {
                const id = args?.where?.id;
                const s = sessions.get(id);
                if (!s) return [];
                // idempotent guard: agentState: { not: null }
                if (args?.where?.agentState?.not === null && s.agentState === null) return [];
                const newAgentStateVersion = (s.agentStateVersion ?? 0) + 1;
                const updated = {
                    ...s,
                    agentState: args.data?.agentState ?? null,
                    agentStateVersion: newAgentStateVersion,
                };
                sessions.set(id, updated);
                return [updated];
            }),
        },
    };

    const resetMocks = () => {
        emitUpdateMock.mockReset();
        startedTasks.length = 0;
        sessions.clear();
        dbMock.session.findMany.mockClear();
        dbMock.session.findUnique.mockClear();
        dbMock.session.updateManyAndReturn.mockClear();
    };

    return { emitUpdateMock, dbMock, startedTasks, resetMocks };
});

vi.mock('@/storage/db', () => ({ db: dbMock }));

// Capture the callback passed to forever() so tests can invoke it manually
vi.mock('@/utils/forever', () => ({
    forever: vi.fn((_name: string, callback: () => Promise<void>) => {
        startedTasks.push(callback);
    }),
}));

// delay() resolves immediately in tests (no real waiting)
vi.mock('@/utils/delay', () => ({
    delay: vi.fn(async () => {}),
}));

vi.mock('@/app/events/eventRouter', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/app/events/eventRouter')>();
    return {
        ...actual,
        eventRouter: {
            emitUpdate: emitUpdateMock,
        },
    };
});

// allocateUserSeq returns a predictable sequence
vi.mock('@/storage/seq', () => ({
    allocateUserSeq: vi.fn(async () => 42),
}));

import { startAgentStateCleanup } from './agentStateCleanup';

describe('agentStateCleanup', () => {
    beforeEach(() => {
        resetMocks();
    });

    it('registers a forever task on startAgentStateCleanup()', async () => {
        const { forever } = await import('@/utils/forever');
        startAgentStateCleanup();
        expect(forever).toHaveBeenCalledWith('agent-state-cleanup', expect.any(Function));
        expect(startedTasks).toHaveLength(1);
    });

    it('does not emit for sessions with agentState already null', async () => {
        // findMany returns empty (agentState null sessions are filtered out by WHERE)
        dbMock.session.findMany.mockResolvedValueOnce([]);

        startAgentStateCleanup();
        const { delay } = await import('@/utils/delay');
        (delay as any).mockImplementationOnce(async () => { throw new Error('stop-loop'); });

        await expect(startedTasks[0]()).rejects.toThrow('stop-loop');
        expect(emitUpdateMock).not.toHaveBeenCalled();
    });

    it('does not emit for sessions with agentState set but lastActiveAt recent (<5min)', async () => {
        // findMany returns empty (recent session filtered out by WHERE lastActiveAt lte)
        dbMock.session.findMany.mockResolvedValueOnce([]);

        startAgentStateCleanup();
        const { delay } = await import('@/utils/delay');
        (delay as any).mockImplementationOnce(async () => { throw new Error('stop-loop'); });

        await expect(startedTasks[0]()).rejects.toThrow('stop-loop');
        expect(emitUpdateMock).not.toHaveBeenCalled();
    });

    it('clears agentState and emits update for stale session (>5min, agentState != null)', async () => {
        const sessionId = 'stale-session-1';
        const accountId = 'acct-1';

        dbMock.session.findMany.mockResolvedValueOnce([{
            id: sessionId,
            accountId,
            agentState: 'stale-encrypted-state',
            agentStateVersion: 0,
            lastActiveAt: new Date(Date.now() - 1000 * 60 * 6),
        }]);

        // updateManyAndReturn succeeds: returns updated row with version incremented
        dbMock.session.updateManyAndReturn.mockResolvedValueOnce([{
            id: sessionId,
            agentStateVersion: 1,
        }]);

        startAgentStateCleanup();
        const { delay } = await import('@/utils/delay');
        (delay as any).mockImplementationOnce(async () => { throw new Error('stop-loop'); });

        await expect(startedTasks[0]()).rejects.toThrow('stop-loop');

        // emitUpdate must have been called once with the correct payload shape
        expect(emitUpdateMock).toHaveBeenCalledOnce();
        const [call] = emitUpdateMock.mock.calls;
        const { payload, recipientFilter } = call[0];
        expect(payload.body.t).toBe('update-session');
        expect(payload.body.agentState).toEqual({ value: null, version: 1 });
        expect(recipientFilter).toEqual({
            type: 'all-interested-in-session',
            sessionId,
        });
    });

    it('handles concurrent execution idempotently (second run skips already-null sessions)', async () => {
        const sessionId = 'stale-session-2';
        const accountId = 'acct-2';

        // First iteration: findMany returns stale session
        dbMock.session.findMany
            .mockResolvedValueOnce([{
                id: sessionId,
                accountId,
                agentState: 'some-state',
                agentStateVersion: 0,
                lastActiveAt: new Date(Date.now() - 1000 * 60 * 8),
            }])
            // Second iteration: already cleared, findMany returns nothing
            .mockResolvedValueOnce([]);

        // First updateManyAndReturn succeeds
        dbMock.session.updateManyAndReturn
            .mockResolvedValueOnce([{ id: sessionId, agentStateVersion: 1 }]);

        startAgentStateCleanup();
        const { delay } = await import('@/utils/delay');

        let callCount = 0;
        (delay as any).mockImplementation(async () => {
            callCount++;
            if (callCount >= 2) throw new Error('stop-loop');
        });

        await expect(startedTasks[0]()).rejects.toThrow('stop-loop');

        // emitUpdate should only have been called once (first iteration only)
        expect(emitUpdateMock).toHaveBeenCalledOnce();
    });

    it('processes multiple stale sessions independently', async () => {
        const id1 = 'stale-a';
        const id2 = 'stale-b';
        const accountId = 'acct-3';

        dbMock.session.findMany.mockResolvedValueOnce([
            {
                id: id1,
                accountId,
                agentState: 'state-a',
                agentStateVersion: 0,
                lastActiveAt: new Date(Date.now() - 1000 * 60 * 7),
            },
            {
                id: id2,
                accountId,
                agentState: 'state-b',
                agentStateVersion: 0,
                lastActiveAt: new Date(Date.now() - 1000 * 60 * 9),
            },
        ]);

        dbMock.session.updateManyAndReturn
            .mockResolvedValueOnce([{ id: id1, agentStateVersion: 1 }])
            .mockResolvedValueOnce([{ id: id2, agentStateVersion: 1 }]);

        startAgentStateCleanup();
        const { delay } = await import('@/utils/delay');
        (delay as any).mockImplementationOnce(async () => { throw new Error('stop-loop'); });

        await expect(startedTasks[0]()).rejects.toThrow('stop-loop');

        expect(emitUpdateMock).toHaveBeenCalledTimes(2);

        // Both sessions should have been cleared (checked via updateManyAndReturn calls)
        expect(dbMock.session.updateManyAndReturn).toHaveBeenCalledTimes(2);
        const call1 = dbMock.session.updateManyAndReturn.mock.calls[0][0];
        const call2 = dbMock.session.updateManyAndReturn.mock.calls[1][0];
        expect(call1.where.id).toBe(id1);
        expect(call1.data.agentState).toBeNull();
        expect(call2.where.id).toBe(id2);
        expect(call2.data.agentState).toBeNull();
    });
});
