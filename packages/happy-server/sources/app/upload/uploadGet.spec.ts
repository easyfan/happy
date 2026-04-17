import { describe, expect, it, vi, beforeEach } from 'vitest';
import * as fs from 'fs';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------
const { dbMock, readFileSyncMock, resetMocks } = vi.hoisted(() => {
    const store = new Map<string, any>();

    const dbMock = {
        pendingUpload: {
            findUnique: vi.fn(async (args: any) => {
                const id = args?.where?.uploadId;
                return store.has(id) ? { ...store.get(id) } : null;
            }),
            update: vi.fn(async () => {}),
        },
    };

    const readFileSyncMock = vi.fn(() => Buffer.from('encrypted-content'));

    const seedUpload = (record: any) => {
        store.set(record.uploadId, record);
    };

    const resetMocks = () => {
        store.clear();
        dbMock.pendingUpload.findUnique.mockClear();
        dbMock.pendingUpload.update.mockClear();
        readFileSyncMock.mockClear();
    };

    return { dbMock, readFileSyncMock, resetMocks, seedUpload };
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
        readFileSync: readFileSyncMock,
    };
});

import { uploadGet } from './uploadGet';

function makeEnvelope(nonce: string, metaNonce: string, encryptedMeta: string) {
    return JSON.stringify({ nonce, metaNonce, encryptedMeta });
}

const FUTURE_DATE = new Date(Date.now() + 60 * 60 * 1000); // 1h from now

describe('uploadGet', () => {
    beforeEach(() => {
        resetMocks();
        // Default: seed a valid upload
        (vi.mocked as any); // suppress type-only usage
        dbMock.pendingUpload.findUnique.mockImplementation(async (args: any) => {
            if (args?.where?.uploadId === 'valid-upload') {
                return {
                    uploadId: 'valid-upload',
                    accountId: 'user-1',
                    sessionId: 'session-1',
                    encryptedMeta: makeEnvelope('nonce-b64', 'metaNonce-b64', 'encMeta-b64'),
                    sizeBytes: 100,
                    direction: 'app_to_cli',
                    notified: false,
                    expiresAt: FUTURE_DATE,
                    downloadedAt: null,
                };
            }
            return null;
        });
    });

    it('returns encrypted blob and nonces for valid request', async () => {
        const result = await uploadGet('user-1', 'valid-upload', 'session-1');

        expect(result).not.toBeNull();
        expect(result!.nonce).toBe('nonce-b64');
        expect(result!.metaNonce).toBe('metaNonce-b64');
        expect(result!.encryptedMeta).toBe('encMeta-b64');
        expect(result!.direction).toBe('app_to_cli');
        expect(typeof result!.encryptedBlob).toBe('string');
    });

    it('returns null when upload does not exist', async () => {
        const result = await uploadGet('user-1', 'nonexistent', 'session-1');
        expect(result).toBeNull();
    });

    it('returns null when accountId does not match (unauthorized)', async () => {
        const result = await uploadGet('other-user', 'valid-upload', 'session-1');
        expect(result).toBeNull();
    });

    it('returns null when sessionId does not match', async () => {
        const result = await uploadGet('user-1', 'valid-upload', 'wrong-session');
        expect(result).toBeNull();
    });

    it('returns null when upload is expired', async () => {
        dbMock.pendingUpload.findUnique.mockResolvedValueOnce({
            uploadId: 'expired-upload',
            accountId: 'user-1',
            sessionId: 'session-1',
            encryptedMeta: makeEnvelope('n', 'mn', 'em'),
            sizeBytes: 100,
            direction: 'app_to_cli',
            notified: false,
            expiresAt: new Date(Date.now() - 1000), // already expired
            downloadedAt: null,
        });

        const result = await uploadGet('user-1', 'expired-upload', 'session-1');
        expect(result).toBeNull();
    });
});
