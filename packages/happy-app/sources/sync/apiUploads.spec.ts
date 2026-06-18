/**
 * Unit tests for apiUploads.ts
 *
 * uploadFile and downloadUpload depend on apiSocket, TokenStorage, and
 * XMLHttpRequest — all mocked here so these tests run in Node without a server.
 *
 * What we test:
 * 1. uploadFile returns an uploadId that starts with 'f' and has 24 chars
 * 2. uploadFile produces unique ids on successive calls
 * 3. uploadFile rejects when XHR returns non-2xx
 * 4. uploadFile rejects on network error and timeout
 * 5. uploadFile rejects when no credentials available
 * 6. cancelUpload is idempotent (swallows errors from apiSocket)
 * 7. downloadUpload rejects when the response is not ok
 */

import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';

// ─── Mocks (vi.mock is hoisted, so avoid top-level var references inside) ────

vi.mock('expo-crypto', () => ({
    getRandomBytes: (n: number) => {
        const buf = new Uint8Array(n);
        crypto.getRandomValues(buf);
        return buf;
    },
}));

// New imports added in IT38-FEAT-12a (thumbnail persistence) — stub out for spec tests.
// Note: vi.mock factories are hoisted, so all values must be inline (no top-level vars).
vi.mock('react-native', () => ({
    Platform: { OS: 'ios' },
}));

vi.mock('expo-file-system/legacy', () => ({
    documentDirectory: 'file:///documents/',
    cacheDirectory: 'file:///cache/',
    writeAsStringAsync: vi.fn().mockResolvedValue(undefined),
    makeDirectoryAsync: vi.fn().mockResolvedValue(undefined),
    getInfoAsync: vi.fn().mockResolvedValue({ exists: false }),
    deleteAsync: vi.fn().mockResolvedValue(undefined),
    readDirectoryAsync: vi.fn().mockResolvedValue([]),
    EncodingType: { Base64: 'base64' },
}));

vi.mock('@/auth/tokenStorage', () => ({
    TokenStorage: {
        // Plain vi.fn() — we configure return values in each test via the import
        getCredentials: vi.fn(),
    },
}));

// apiSocket mock — keep the object shape stable; tests reach into it via import
vi.mock('./apiSocket', () => ({
    apiSocket: {
        config: { endpoint: 'http://localhost:3005' },
        request: vi.fn(),
    },
}));

// libsodium — replace native lib with web build
import _sodium from 'libsodium-wrappers';
vi.mock('@/encryption/libsodium.lib', async () => {
    await _sodium.ready;
    return { default: _sodium };
});

// ─── XHR stub ────────────────────────────────────────────────────────────────
//
// vitest/node has no XMLHttpRequest. Install a minimal stub whose send()
// fires one of four outcomes controlled by xhrBehavior.

type XhrBehavior = 'success' | 'error' | 'timeout' | 'http-error';
let xhrBehavior: XhrBehavior = 'success';

type XhrStub = {
    status: number;
    responseText: string;
    onload: (() => void) | null;
    onerror: (() => void) | null;
    ontimeout: (() => void) | null;
    upload: { onprogress: ((e: any) => void) | null };
    open: ReturnType<typeof vi.fn>;
    setRequestHeader: ReturnType<typeof vi.fn>;
    send: ReturnType<typeof vi.fn>;
};

function XHRStub(this: XhrStub) {
    this.status = 200;
    this.responseText = '{}';
    this.onload = null;
    this.onerror = null;
    this.ontimeout = null;
    this.upload = { onprogress: null };
    this.open = vi.fn();
    this.setRequestHeader = vi.fn();
    this.send = vi.fn().mockImplementation(function(this: XhrStub) {
        // Fire the chosen callback on the next microtask so Promise chains settle
        setTimeout(() => {
            if (xhrBehavior === 'success') {
                this.status = 200;
                this.onload?.();
            } else if (xhrBehavior === 'http-error') {
                this.status = 400;
                this.responseText = JSON.stringify({ error: 'MIME type not allowed' });
                this.onload?.();
            } else if (xhrBehavior === 'error') {
                this.onerror?.();
            } else if (xhrBehavior === 'timeout') {
                this.ontimeout?.();
            }
        }, 0);
    }.bind(this));
}

(global as any).XMLHttpRequest = XHRStub;

// ─── Module under test ───────────────────────────────────────────────────────

import { uploadFile, cancelUpload, downloadUpload, saveThumbnailLocally, cleanupOldThumbnails } from './apiUploads';
import { TokenStorage } from '@/auth/tokenStorage';
import { apiSocket } from './apiSocket';
import * as FileSystem from 'expo-file-system/legacy';
import { Platform } from 'react-native';

// ─── Helpers ─────────────────────────────────────────────────────────────────

let sessionKey: Uint8Array;

beforeAll(async () => {
    await _sodium.ready;
    sessionKey = new Uint8Array(32);
    crypto.getRandomValues(sessionKey);
});

const sampleFile = () => ({
    bytes: new Uint8Array([1, 2, 3]),
    filename: 'test.txt',
    mimeType: 'text/plain',
    sizeBytes: 3,
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('uploadFile', () => {
    beforeEach(() => {
        xhrBehavior = 'success';
        vi.mocked(TokenStorage.getCredentials).mockResolvedValue({
            token: 'test-token',
            accountId: 'acc-1',
            sessionId: 'sess-1',
        } as any);
    });

    it('returns an uploadId starting with "f" and 24 chars long', async () => {
        const uploadId = await uploadFile(sessionKey, sampleFile(), 'session-abc');

        expect(typeof uploadId).toBe('string');
        expect(uploadId[0]).toBe('f');
        expect(uploadId.length).toBe(24);
    });

    it('each call returns a unique uploadId', async () => {
        const id1 = await uploadFile(sessionKey, sampleFile(), 'session-1');
        const id2 = await uploadFile(sessionKey, sampleFile(), 'session-2');

        expect(id1).not.toBe(id2);
    });

    it('rejects with the server error message when server returns non-2xx', async () => {
        xhrBehavior = 'http-error';

        await expect(
            uploadFile(sessionKey, { ...sampleFile(), mimeType: 'application/octet-stream' }, 'session-x'),
        ).rejects.toThrow('MIME type not allowed');
    });

    it('rejects on network error', async () => {
        xhrBehavior = 'error';

        await expect(uploadFile(sessionKey, sampleFile(), 'session-y')).rejects.toThrow(
            'Network error during upload',
        );
    });

    it('rejects on timeout', async () => {
        xhrBehavior = 'timeout';

        await expect(uploadFile(sessionKey, sampleFile(), 'session-z')).rejects.toThrow(
            'Upload timed out',
        );
    });

    it('rejects when no credentials available', async () => {
        vi.mocked(TokenStorage.getCredentials).mockResolvedValue(null);

        await expect(uploadFile(sessionKey, sampleFile(), 'session-no-creds')).rejects.toThrow(
            'No authentication credentials',
        );
    });
});

describe('cancelUpload', () => {
    beforeEach(() => {
        vi.mocked(apiSocket.request).mockReset();
    });

    it('calls apiSocket.request with DELETE method and correct path', async () => {
        vi.mocked(apiSocket.request).mockResolvedValue(undefined as any);
        await cancelUpload('upload-to-cancel');

        expect(apiSocket.request).toHaveBeenCalledWith('/v1/uploads/upload-to-cancel', { method: 'DELETE' });
    });

    it('is idempotent — swallows errors silently', async () => {
        vi.mocked(apiSocket.request).mockRejectedValue(new Error('Not found'));

        await expect(cancelUpload('upload-gone')).resolves.toBeUndefined();
    });
});

describe('downloadUpload', () => {
    beforeEach(() => {
        vi.mocked(apiSocket.request).mockReset();
    });

    it('calls apiSocket.request with the correct URL including sessionId', async () => {
        vi.mocked(apiSocket.request).mockResolvedValue({
            ok: true,
            json: async () => ({
                encryptedBlob: 'blob-data',
                nonce: 'nonce-1',
                encryptedMeta: 'meta-data',
                metaNonce: 'nonce-2',
            }),
        } as any);

        const result = await downloadUpload('upload-dl-1', 'sess-dl');

        expect(apiSocket.request).toHaveBeenCalledWith('/v1/uploads/upload-dl-1?sessionId=sess-dl');
        expect(result.encryptedBlob).toBe('blob-data');
        expect(result.nonce).toBe('nonce-1');
        expect(result.encryptedMeta).toBe('meta-data');
        expect(result.metaNonce).toBe('nonce-2');
    });

    it('rejects with NotFoundError on 404', async () => {
        vi.mocked(apiSocket.request).mockResolvedValue({ ok: false, status: 404 } as any);

        await expect(downloadUpload('upload-missing', 'sess-1')).rejects.toThrow('Upload not found: upload-missing');
    });

    it('rejects with generic error on non-404 failure', async () => {
        vi.mocked(apiSocket.request).mockResolvedValue({ ok: false, status: 500 } as any);

        await expect(downloadUpload('upload-missing', 'sess-1')).rejects.toThrow('Download failed: 500');
    });
});

// ─── saveThumbnailLocally ─────────────────────────────────────────────────────

describe('saveThumbnailLocally', () => {
    beforeEach(() => {
        vi.mocked(FileSystem.makeDirectoryAsync).mockReset();
        vi.mocked(FileSystem.writeAsStringAsync).mockReset();
        vi.mocked(FileSystem.makeDirectoryAsync).mockResolvedValue(undefined);
        vi.mocked(FileSystem.writeAsStringAsync).mockResolvedValue(undefined);
        // Default: native platform
        (Platform as any).OS = 'ios';
    });

    it('writes image bytes as base64 into documentDirectory/thumbnails/ on native', async () => {
        const bytes = new Uint8Array([137, 80, 78, 71]); // PNG magic
        await saveThumbnailLocally('fimg001', 'png', bytes);

        expect(FileSystem.makeDirectoryAsync).toHaveBeenCalledWith(
            'file:///documents/thumbnails/',
            { intermediates: true },
        );
        expect(FileSystem.writeAsStringAsync).toHaveBeenCalledWith(
            'file:///documents/thumbnails/fimg001.png',
            expect.any(String), // base64-encoded bytes
            { encoding: 'base64' },
        );
    });

    it('skips all file-system operations on web', async () => {
        (Platform as any).OS = 'web';
        await saveThumbnailLocally('fimg002', 'png', new Uint8Array([1, 2, 3]));

        expect(FileSystem.makeDirectoryAsync).not.toHaveBeenCalled();
        expect(FileSystem.writeAsStringAsync).not.toHaveBeenCalled();
    });

    it('resolves without throwing even when writeAsStringAsync fails', async () => {
        vi.mocked(FileSystem.writeAsStringAsync).mockRejectedValue(new Error('disk full'));

        await expect(
            saveThumbnailLocally('fimg003', 'jpg', new Uint8Array([255, 216, 255])),
        ).resolves.toBeUndefined();
    });
});

// ─── cleanupOldThumbnails ─────────────────────────────────────────────────────

describe('cleanupOldThumbnails', () => {
    const DIR = 'file:///documents/thumbnails/';
    const nowSec = Math.floor(Date.now() / 1000);
    const thirtyOneDaysAgoSec = nowSec - 31 * 24 * 60 * 60;
    const oneDayAgoSec = nowSec - 1 * 24 * 60 * 60;

    beforeEach(() => {
        vi.mocked(FileSystem.makeDirectoryAsync).mockReset();
        vi.mocked(FileSystem.getInfoAsync).mockReset();
        vi.mocked(FileSystem.readDirectoryAsync).mockReset();
        vi.mocked(FileSystem.deleteAsync).mockReset();
        (Platform as any).OS = 'ios';
        vi.mocked(FileSystem.deleteAsync).mockResolvedValue(undefined);
    });

    it('deletes files whose modificationTime is older than 30 days', async () => {
        // dir check
        vi.mocked(FileSystem.getInfoAsync)
            .mockResolvedValueOnce({ exists: true } as any) // dir exists
            .mockResolvedValueOnce({ exists: true, modificationTime: thirtyOneDaysAgoSec } as any); // old.png

        vi.mocked(FileSystem.readDirectoryAsync).mockResolvedValue(['old.png']);

        await cleanupOldThumbnails();

        expect(FileSystem.deleteAsync).toHaveBeenCalledWith(
            `${DIR}old.png`,
            { idempotent: true },
        );
    });

    it('keeps files whose modificationTime is within 30 days', async () => {
        vi.mocked(FileSystem.getInfoAsync)
            .mockResolvedValueOnce({ exists: true } as any) // dir
            .mockResolvedValueOnce({ exists: true, modificationTime: oneDayAgoSec } as any); // fresh.png

        vi.mocked(FileSystem.readDirectoryAsync).mockResolvedValue(['fresh.png']);

        await cleanupOldThumbnails();

        expect(FileSystem.deleteAsync).not.toHaveBeenCalled();
    });

    it('does NOT delete files when modificationTime is undefined — conservative keep', async () => {
        vi.mocked(FileSystem.getInfoAsync)
            .mockResolvedValueOnce({ exists: true } as any) // dir
            .mockResolvedValueOnce({ exists: true } as any); // no modificationTime field

        vi.mocked(FileSystem.readDirectoryAsync).mockResolvedValue(['unknown-age.png']);

        await cleanupOldThumbnails();

        expect(FileSystem.deleteAsync).not.toHaveBeenCalled();
    });

    it('does nothing when thumbnails directory does not exist', async () => {
        vi.mocked(FileSystem.getInfoAsync).mockResolvedValue({ exists: false } as any);

        await cleanupOldThumbnails();

        expect(FileSystem.readDirectoryAsync).not.toHaveBeenCalled();
        expect(FileSystem.deleteAsync).not.toHaveBeenCalled();
    });
});
