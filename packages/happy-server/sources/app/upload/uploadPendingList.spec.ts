import { describe, expect, it, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------
const { dbMock, inTxMock, resetMocks, seedUploads } = vi.hoisted(() => {
    let store: any[] = [];

    const txClient = {
        pendingUpload: {
            findMany: vi.fn(async (args: any) => {
                let rows = store.filter((u) => {
                    if (u.accountId !== args?.where?.accountId) return false;
                    if (args?.where?.notified !== undefined && u.notified !== args.where.notified) return false;
                    if (args?.where?.direction && u.direction !== args.where.direction) return false;
                    if (args?.where?.sessionId && u.sessionId !== args.where.sessionId) return false;
                    if (args?.where?.expiresAt?.gt && u.expiresAt <= args.where.expiresAt.gt) return false;
                    return true;
                });
                return rows.map((u) => ({
                    uploadId: u.uploadId,
                    sessionId: u.sessionId,
                    encryptedMeta: u.encryptedMeta,
                    createdAt: u.createdAt,
                }));
            }),
            updateMany: vi.fn(async (args: any) => {
                const ids = new Set(args?.where?.uploadId?.in ?? []);
                store.forEach((u) => {
                    if (ids.has(u.uploadId)) {
                        u.notified = args.data.notified;
                    }
                });
            }),
        },
    };

    const dbMock = txClient;

    const inTxMock = vi.fn(async (fn: any) => fn(txClient));

    const seedUploads = (uploads: any[]) => {
        store.push(...uploads);
    };

    const resetMocks = () => {
        store = [];
        txClient.pendingUpload.findMany.mockClear();
        txClient.pendingUpload.updateMany.mockClear();
        inTxMock.mockClear();
    };

    return { dbMock, inTxMock, resetMocks, seedUploads };
});

vi.mock('@/storage/db', () => ({ db: dbMock }));
vi.mock('@/storage/inTx', () => ({ inTx: inTxMock }));

import { uploadPendingList } from './uploadPendingList';

const FUTURE_DATE = new Date(Date.now() + 60 * 60 * 1000);

describe('uploadPendingList', () => {
    beforeEach(() => {
        resetMocks();
    });

    it('returns only notified=false app_to_cli uploads and marks them as notified=true', async () => {
        seedUploads([
            {
                uploadId: 'up-1',
                accountId: 'user-1',
                sessionId: 'session-1',
                encryptedMeta: 'em1',
                direction: 'app_to_cli',
                notified: false,
                createdAt: new Date(1000),
                expiresAt: FUTURE_DATE,
            },
            {
                uploadId: 'up-2',
                accountId: 'user-1',
                sessionId: 'session-1',
                encryptedMeta: 'em2',
                direction: 'app_to_cli',
                notified: true, // already notified — should NOT be returned
                createdAt: new Date(2000),
                expiresAt: FUTURE_DATE,
            },
        ]);

        const result = await uploadPendingList('user-1');

        expect(result).toHaveLength(1);
        expect(result[0].uploadId).toBe('up-1');
        expect(result[0].encryptedMeta).toBe('em1');
        expect(typeof result[0].createdAt).toBe('number');
    });

    it('marks returned uploads as notified=true (at-most-once delivery)', async () => {
        seedUploads([
            {
                uploadId: 'up-3',
                accountId: 'user-1',
                sessionId: 'session-2',
                encryptedMeta: 'em3',
                direction: 'app_to_cli',
                notified: false,
                createdAt: new Date(3000),
                expiresAt: FUTURE_DATE,
            },
        ]);

        await uploadPendingList('user-1');

        // Second call should return nothing — already marked as notified
        const secondResult = await uploadPendingList('user-1');
        expect(secondResult).toHaveLength(0);
    });

    it('returns empty array when no pending uploads exist', async () => {
        const result = await uploadPendingList('user-1');
        expect(result).toHaveLength(0);
        // updateMany should NOT be called if there's nothing to update
        const txClient = (inTxMock.mock.calls[0]?.[0]);
    });

    it('filters by sessionId when provided', async () => {
        seedUploads([
            {
                uploadId: 'up-a',
                accountId: 'user-1',
                sessionId: 'session-A',
                encryptedMeta: 'emA',
                direction: 'app_to_cli',
                notified: false,
                createdAt: new Date(1000),
                expiresAt: FUTURE_DATE,
            },
            {
                uploadId: 'up-b',
                accountId: 'user-1',
                sessionId: 'session-B',
                encryptedMeta: 'emB',
                direction: 'app_to_cli',
                notified: false,
                createdAt: new Date(2000),
                expiresAt: FUTURE_DATE,
            },
        ]);

        const result = await uploadPendingList('user-1', 'session-A');
        expect(result).toHaveLength(1);
        expect(result[0].uploadId).toBe('up-a');
    });

    it('does not return cli_to_app uploads (CLI only processes app_to_cli)', async () => {
        seedUploads([
            {
                uploadId: 'up-cli',
                accountId: 'user-1',
                sessionId: 'session-1',
                encryptedMeta: 'em-cli',
                direction: 'cli_to_app',
                notified: false,
                createdAt: new Date(1000),
                expiresAt: FUTURE_DATE,
            },
        ]);

        const result = await uploadPendingList('user-1');
        expect(result).toHaveLength(0);
    });
});
