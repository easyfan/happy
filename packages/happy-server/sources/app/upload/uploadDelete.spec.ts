import { describe, expect, it, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------
const { dbMock, unlinkSyncMock, resetMocks } = vi.hoisted(() => {
    const store = new Map<string, any>();

    const dbMock = {
        pendingUpload: {
            findUnique: vi.fn(async (args: any) => {
                const id = args?.where?.uploadId;
                return store.has(id) ? { ...store.get(id) } : null;
            }),
            delete: vi.fn(async (args: any) => {
                store.delete(args?.where?.uploadId);
            }),
        },
    };

    const unlinkSyncMock = vi.fn();

    const seedUpload = (record: any) => {
        store.set(record.uploadId, record);
    };

    const resetMocks = () => {
        store.clear();
        dbMock.pendingUpload.findUnique.mockClear();
        dbMock.pendingUpload.delete.mockClear();
        unlinkSyncMock.mockClear();

        // Seed a default valid upload
        seedUpload({ uploadId: 'upload-abc', accountId: 'user-1' });
    };

    return { dbMock, unlinkSyncMock, resetMocks, seedUpload };
});

vi.mock('@/storage/db', () => ({ db: dbMock }));
vi.mock('@/storage/files', () => ({
    isLocalStorage: vi.fn(() => true),
    getLocalFilesDir: vi.fn(() => '/tmp/test-files'),
    s3client: null,
    s3bucket: '',
}));
vi.mock('fs', async (importOriginal) => {
    const actual = await importOriginal<typeof import('fs')>();
    return {
        ...actual,
        unlinkSync: unlinkSyncMock,
    };
});

import { uploadDelete } from './uploadDelete';

describe('uploadDelete', () => {
    beforeEach(() => {
        resetMocks();
    });

    it('deletes record and blob successfully', async () => {
        await uploadDelete('user-1', 'upload-abc');

        expect(unlinkSyncMock).toHaveBeenCalledTimes(1);
        expect(dbMock.pendingUpload.delete).toHaveBeenCalledTimes(1);
    });

    it('is idempotent — does nothing when upload does not exist', async () => {
        await uploadDelete('user-1', 'nonexistent-upload');

        expect(unlinkSyncMock).not.toHaveBeenCalled();
        expect(dbMock.pendingUpload.delete).not.toHaveBeenCalled();
    });

    it('throws FORBIDDEN when accountId does not match', async () => {
        await expect(uploadDelete('other-user', 'upload-abc')).rejects.toThrow('FORBIDDEN');
        expect(dbMock.pendingUpload.delete).not.toHaveBeenCalled();
    });

    it('silently handles storage deletion errors (blob may already be gone)', async () => {
        unlinkSyncMock.mockImplementation(() => {
            throw new Error('ENOENT: no such file');
        });

        // Should NOT throw — storage errors are best-effort
        await expect(uploadDelete('user-1', 'upload-abc')).resolves.toBeUndefined();
        // DB record should still be deleted
        expect(dbMock.pendingUpload.delete).toHaveBeenCalledTimes(1);
    });
});
