import { describe, expect, it, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------
const { dbMock, sessions, resetMocks } = vi.hoisted(() => {
    const sessions = new Map<string, { id: string; accountId: string; permissionMode: string | null; modelMode: string | null }>();

    const dbMock = {
        session: {
            updateMany: vi.fn(async (args: any) => {
                const { id, accountId } = args.where;
                const session = sessions.get(id);
                if (!session || session.accountId !== accountId) {
                    return { count: 0 };
                }
                Object.assign(session, args.data);
                return { count: 1 };
            }),
        },
        $transaction: vi.fn(async (fn: any) => fn(dbMock)),
    };

    const resetMocks = () => {
        sessions.clear();
        sessions.set('session-001', { id: 'session-001', accountId: 'user-1', permissionMode: null, modelMode: null });
        dbMock.session.updateMany.mockClear();
    };

    return { dbMock, sessions, resetMocks };
});

vi.mock('@/storage/db', () => ({ db: dbMock }));
vi.mock('@/storage/inTx', () => ({
    inTx: vi.fn(async (fn: any) => fn(dbMock)),
}));

import { sessionConfigUpdate } from './sessionConfigUpdate';
import { Context } from '@/context';

const ctx = Context.create('user-1');

describe('sessionConfigUpdate', () => {
    beforeEach(() => {
        resetMocks();
    });

    // ── TC-01: 正常更新 permissionMode ──────────────────────────────────────
    it('TC-01: updates permissionMode and returns true when session exists', async () => {
        const result = await sessionConfigUpdate(ctx, 'session-001', {
            permissionMode: 'bypassPermissions',
        });

        expect(result).toBe(true);
        expect(dbMock.session.updateMany).toHaveBeenCalledTimes(1);

        const call = dbMock.session.updateMany.mock.calls[0][0];
        expect(call.where).toEqual({ id: 'session-001', accountId: 'user-1' });
        expect(call.data).toEqual({ permissionMode: 'bypassPermissions' });
        // modelMode NOT included in data (undefined input -> not sent to DB)
        expect(call.data.modelMode).toBeUndefined();
    });

    // ── TC-02: session 不属于当前用户 → 返回 false ──────────────────────────
    it('TC-02: returns false (404 semantics) when session belongs to another user', async () => {
        const otherCtx = Context.create('user-99');

        const result = await sessionConfigUpdate(otherCtx, 'session-001', {
            modelMode: 'opus',
        });

        expect(result).toBe(false);
        expect(dbMock.session.updateMany).toHaveBeenCalledTimes(1);
    });

    // ── TC-03: session 不存在 → 返回 false ──────────────────────────────────
    it('TC-03: returns false when sessionId does not exist', async () => {
        const result = await sessionConfigUpdate(ctx, 'non-existent-id', {
            permissionMode: 'default',
        });

        expect(result).toBe(false);
    });

    // ── TC-04: 同时更新两个字段 ─────────────────────────────────────────────
    it('TC-04: updates both permissionMode and modelMode in a single call', async () => {
        const result = await sessionConfigUpdate(ctx, 'session-001', {
            permissionMode: 'yolo',
            modelMode: 'opus',
        });

        expect(result).toBe(true);

        const call = dbMock.session.updateMany.mock.calls[0][0];
        expect(call.data).toEqual({ permissionMode: 'yolo', modelMode: 'opus' });
    });

    // ── TC-05: null 值清除字段 ───────────────────────────────────────────────
    it('TC-05: stores null to clear a previously set permissionMode', async () => {
        const result = await sessionConfigUpdate(ctx, 'session-001', {
            permissionMode: null,
        });

        expect(result).toBe(true);

        const call = dbMock.session.updateMany.mock.calls[0][0];
        expect(call.data.permissionMode).toBeNull();
        expect(call.data.modelMode).toBeUndefined();
    });

    // ── TC-06: 只传 modelMode 时不影响 permissionMode 字段 ──────────────────
    it('TC-06: only sends modelMode when only modelMode is provided', async () => {
        const result = await sessionConfigUpdate(ctx, 'session-001', {
            modelMode: 'haiku',
        });

        expect(result).toBe(true);

        const call = dbMock.session.updateMany.mock.calls[0][0];
        expect(call.data).toEqual({ modelMode: 'haiku' });
        expect(call.data.permissionMode).toBeUndefined();
    });
});
