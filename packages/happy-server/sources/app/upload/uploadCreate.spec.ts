import { describe, expect, it, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks — must be defined before any imports that use them
// ---------------------------------------------------------------------------
const { dbMock, putLocalFileMock, resetMocks } = vi.hoisted(() => {
    const uploads = new Map<string, any>();

    const dbMock = {
        pendingUpload: {
            findUnique: vi.fn(async (args: any) => {
                const id = args?.where?.uploadId;
                return uploads.has(id) ? uploads.get(id) : null;
            }),
            upsert: vi.fn(async (args: any) => {
                const record = {
                    ...args.create,
                };
                uploads.set(record.uploadId, record);
                return record;
            }),
        },
        $transaction: vi.fn(async (fn: any) => fn(dbMock)),
    };

    const putLocalFileMock = vi.fn(async () => {});

    const resetMocks = () => {
        uploads.clear();
        dbMock.pendingUpload.findUnique.mockClear();
        dbMock.pendingUpload.upsert.mockClear();
        putLocalFileMock.mockClear();
    };

    return { dbMock, putLocalFileMock, resetMocks };
});

vi.mock('@/storage/db', () => ({ db: dbMock }));
vi.mock('@/storage/files', () => ({
    isLocalStorage: vi.fn(() => true),
    putLocalFile: putLocalFileMock,
    s3client: null,
    s3bucket: '',
}));
vi.mock('@/storage/inTx', () => ({
    inTx: vi.fn(async (fn: any) => fn(dbMock)),
}));

import { uploadCreate } from './uploadCreate';

const BASE_PARAMS = {
    uploadId: 'test-upload-id',
    encryptedBlob: Buffer.from('hello world').toString('base64'),
    nonce: Buffer.from('nonce111111111111111111111').toString('base64'),
    encryptedMeta: Buffer.from('meta').toString('base64'),
    metaNonce: Buffer.from('mnonce11111111111111111111').toString('base64'),
    mimeType: 'image/jpeg',
    sizeBytes: 11,
    sessionId: 'session-abc',
    direction: 'app_to_cli' as const,
};

describe('uploadCreate', () => {
    beforeEach(() => {
        resetMocks();
    });

    it('creates a new upload record and writes blob to storage', async () => {
        await uploadCreate('user-1', BASE_PARAMS);

        expect(putLocalFileMock).toHaveBeenCalledTimes(1);
        expect(dbMock.pendingUpload.upsert).toHaveBeenCalledTimes(1);

        const upsertCall = dbMock.pendingUpload.upsert.mock.calls[0][0];
        expect(upsertCall.create.uploadId).toBe(BASE_PARAMS.uploadId);
        expect(upsertCall.create.accountId).toBe('user-1');
        expect(upsertCall.create.sessionId).toBe(BASE_PARAMS.sessionId);
        expect(upsertCall.create.direction).toBe('app_to_cli');
        expect(upsertCall.create.notified).toBe(false);
    });

    it('is idempotent — skips blob write and DB upsert if uploadId already exists', async () => {
        // Seed the record as if it already exists
        dbMock.pendingUpload.findUnique.mockResolvedValueOnce({ uploadId: BASE_PARAMS.uploadId });

        await uploadCreate('user-1', BASE_PARAMS);

        expect(putLocalFileMock).not.toHaveBeenCalled();
        expect(dbMock.pendingUpload.upsert).not.toHaveBeenCalled();
    });

    it('rejects files exceeding 10 MB', async () => {
        const oversizedParams = {
            ...BASE_PARAMS,
            sizeBytes: 11 * 1024 * 1024, // 11 MB
        };

        await expect(uploadCreate('user-1', oversizedParams)).rejects.toThrow('FILE_TOO_LARGE');
        expect(putLocalFileMock).not.toHaveBeenCalled();
    });

    it('stores nonce, metaNonce and encryptedMeta as JSON envelope in encryptedMeta column', async () => {
        await uploadCreate('user-1', BASE_PARAMS);

        const upsertCall = dbMock.pendingUpload.upsert.mock.calls[0][0];
        const envelope = JSON.parse(upsertCall.create.encryptedMeta);
        expect(envelope.nonce).toBe(BASE_PARAMS.nonce);
        expect(envelope.metaNonce).toBe(BASE_PARAMS.metaNonce);
        expect(envelope.encryptedMeta).toBe(BASE_PARAMS.encryptedMeta);
    });
});
