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

import { uploadFile, cancelUpload, downloadUpload } from './apiUploads';
import { TokenStorage } from '@/auth/tokenStorage';
import { apiSocket } from './apiSocket';

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

    it('rejects when response is not ok', async () => {
        vi.mocked(apiSocket.request).mockResolvedValue({ ok: false, status: 404 } as any);

        await expect(downloadUpload('upload-missing', 'sess-1')).rejects.toThrow('Download failed: 404');
    });
});
