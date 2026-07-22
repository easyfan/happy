import { describe, expect, it, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------
const { dbMock, sessions, resetMocks } = vi.hoisted(() => {
    const sessions = new Map<string, {
        id: string;
        accountId: string;
        permissionMode: string | null;
        modelMode: string | null;
        effortLevel: string | null;
        permissionModeUpdatedAt: Date | null;
        modelModeUpdatedAt: Date | null;
        effortLevelUpdatedAt: Date | null;
    }>();

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
        sessions.set('session-001', {
            id: 'session-001',
            accountId: 'user-1',
            permissionMode: null,
            modelMode: null,
            effortLevel: null,
            permissionModeUpdatedAt: null,
            modelModeUpdatedAt: null,
            effortLevelUpdatedAt: null,
        });
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
        expect(call.data.permissionMode).toBe('bypassPermissions');
        expect(call.data.permissionModeUpdatedAt).toBeInstanceOf(Date);
        // modelMode and effortLevel NOT included in data (undefined input -> not sent to DB)
        expect(call.data.modelMode).toBeUndefined();
        expect(call.data.effortLevel).toBeUndefined();
        expect(call.data.modelModeUpdatedAt).toBeUndefined();
        expect(call.data.effortLevelUpdatedAt).toBeUndefined();
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
        expect(call.data.permissionMode).toBe('yolo');
        expect(call.data.modelMode).toBe('opus');
        expect(call.data.permissionModeUpdatedAt).toBeInstanceOf(Date);
        expect(call.data.modelModeUpdatedAt).toBeInstanceOf(Date);
        // effortLevel not sent
        expect(call.data.effortLevel).toBeUndefined();
        expect(call.data.effortLevelUpdatedAt).toBeUndefined();
    });

    // ── TC-05: null 值清除字段 ───────────────────────────────────────────────
    it('TC-05: stores null to clear a previously set permissionMode', async () => {
        const result = await sessionConfigUpdate(ctx, 'session-001', {
            permissionMode: null,
        });

        expect(result).toBe(true);

        const call = dbMock.session.updateMany.mock.calls[0][0];
        expect(call.data.permissionMode).toBeNull();
        expect(call.data.permissionModeUpdatedAt).toBeInstanceOf(Date);
        expect(call.data.modelMode).toBeUndefined();
    });

    // ── TC-06: 只传 modelMode 时不影响 permissionMode 字段 ──────────────────
    it('TC-06: only sends modelMode when only modelMode is provided', async () => {
        const result = await sessionConfigUpdate(ctx, 'session-001', {
            modelMode: 'haiku',
        });

        expect(result).toBe(true);

        const call = dbMock.session.updateMany.mock.calls[0][0];
        expect(call.data.modelMode).toBe('haiku');
        expect(call.data.modelModeUpdatedAt).toBeInstanceOf(Date);
        expect(call.data.permissionMode).toBeUndefined();
        expect(call.data.permissionModeUpdatedAt).toBeUndefined();
    });

    // ── TC-07: 新增 effortLevel 字段 ─────────────────────────────────────────
    it('TC-07: updates effortLevel and sets effortLevelUpdatedAt timestamp', async () => {
        const before = Date.now();
        const result = await sessionConfigUpdate(ctx, 'session-001', {
            effortLevel: 'high',
        });
        const after = Date.now();

        expect(result).toBe(true);

        const call = dbMock.session.updateMany.mock.calls[0][0];
        expect(call.data.effortLevel).toBe('high');
        expect(call.data.effortLevelUpdatedAt).toBeInstanceOf(Date);
        expect(call.data.effortLevelUpdatedAt.getTime()).toBeGreaterThanOrEqual(before);
        expect(call.data.effortLevelUpdatedAt.getTime()).toBeLessThanOrEqual(after);
        // permissionMode and modelMode NOT included
        expect(call.data.permissionMode).toBeUndefined();
        expect(call.data.permissionModeUpdatedAt).toBeUndefined();
        expect(call.data.modelMode).toBeUndefined();
        expect(call.data.modelModeUpdatedAt).toBeUndefined();
    });

    // ── TC-08: effortLevel null 清空仍赋时间戳 ──────────────────────────────
    it('TC-08: stores null effortLevel and still sets effortLevelUpdatedAt', async () => {
        const result = await sessionConfigUpdate(ctx, 'session-001', {
            effortLevel: null,
        });

        expect(result).toBe(true);

        const call = dbMock.session.updateMany.mock.calls[0][0];
        expect(call.data.effortLevel).toBeNull();
        expect(call.data.effortLevelUpdatedAt).toBeInstanceOf(Date);
    });

    // ── TC-09: 三字段同时更新 ────────────────────────────────────────────────
    it('TC-09: updates all three fields with independent timestamps', async () => {
        const result = await sessionConfigUpdate(ctx, 'session-001', {
            permissionMode: 'bypassPermissions',
            modelMode: 'claude-opus-4-5',
            effortLevel: 'low',
        });

        expect(result).toBe(true);

        const call = dbMock.session.updateMany.mock.calls[0][0];
        expect(call.data.permissionMode).toBe('bypassPermissions');
        expect(call.data.modelMode).toBe('claude-opus-4-5');
        expect(call.data.effortLevel).toBe('low');
        expect(call.data.permissionModeUpdatedAt).toBeInstanceOf(Date);
        expect(call.data.modelModeUpdatedAt).toBeInstanceOf(Date);
        expect(call.data.effortLevelUpdatedAt).toBeInstanceOf(Date);
    });

    // ── TC-10: effortLevel + permissionMode，不动 modelModeUpdatedAt ─────────
    it('TC-10: only sets *UpdatedAt for fields present in body', async () => {
        const result = await sessionConfigUpdate(ctx, 'session-001', {
            permissionMode: 'bypassPermissions',
            effortLevel: 'low',
        });

        expect(result).toBe(true);

        const call = dbMock.session.updateMany.mock.calls[0][0];
        expect(call.data.permissionModeUpdatedAt).toBeInstanceOf(Date);
        expect(call.data.effortLevelUpdatedAt).toBeInstanceOf(Date);
        // modelMode absent → modelModeUpdatedAt NOT in data object
        expect(call.data.modelModeUpdatedAt).toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// Schema validation tests (no DB needed)
// ---------------------------------------------------------------------------
describe('SessionConfigUpdateBodySchema', () => {
    // Import schema directly to test Zod validation
    let SessionConfigUpdateBodySchema: any;

    beforeEach(async () => {
        const mod = await import('./sessionConfigUpdate');
        SessionConfigUpdateBodySchema = mod.SessionConfigUpdateBodySchema;
    });

    it('SCHEMA-01: accepts effortLevel only', () => {
        const result = SessionConfigUpdateBodySchema.safeParse({ effortLevel: 'high' });
        expect(result.success).toBe(true);
    });

    it('SCHEMA-02: accepts all three fields', () => {
        const result = SessionConfigUpdateBodySchema.safeParse({
            permissionMode: 'default',
            modelMode: 'haiku',
            effortLevel: 'medium',
        });
        expect(result.success).toBe(true);
    });

    it('SCHEMA-03: rejects empty body (refine: at least one field required)', () => {
        const result = SessionConfigUpdateBodySchema.safeParse({});
        expect(result.success).toBe(false);
    });

    it('SCHEMA-04: accepts null values for each field', () => {
        const result = SessionConfigUpdateBodySchema.safeParse({
            effortLevel: null,
        });
        expect(result.success).toBe(true);
    });

    it('SCHEMA-05: rejects non-string effortLevel', () => {
        const result = SessionConfigUpdateBodySchema.safeParse({ effortLevel: 42 });
        expect(result.success).toBe(false);
    });
});
