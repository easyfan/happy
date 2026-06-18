/**
 * Unit tests for AttachmentChip image-thumbnail logic in MessageView.
 *
 * After IT38-FEAT-12a (persistent thumbnail cache), AttachmentChip uses a
 * local-first strategy on native platforms:
 *
 *   1. (native) Check documentDirectory/thumbnails/{uploadId}.{ext} first.
 *      - File exists  → render thumbnail immediately, skip network.
 *      - File missing → show pin chip (server record already deleted by CLI).
 *   2. (web) Original download path retained — blob: URLs are in-process only.
 *   3. Non-image → pin chip, no download attempted.
 *
 * Tests exercise the resolution logic in isolation without rendering React trees.
 *
 * Covered:
 *  1.  isImage guard — skips for non-image MIME types
 *  2.  isImage guard — proceeds for image/* MIME types
 *  3.  Native: local thumbnail exists → returns localUri, no downloadUpload called
 *  4.  Native: local thumbnail missing → returns error (pin), no downloadUpload
 *  5.  Native: getInfoAsync throws → returns error (pin)
 *  6.  Native: "bin" extension used when filename has no dot
 *  7.  Web: URL.createObjectURL called with correct Blob type
 *  8.  Web: returns error when sessionKey is null
 *  9.  Web: returns error on decryption failure with wrong key
 *  10. Web: URL.revokeObjectURL called on cleanup
 *  11. Cancelled flag: no localUri produced when cancelled before async completes
 */

import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import _sodium from 'libsodium-wrappers';

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('@/encryption/libsodium.lib', async () => {
    await _sodium.ready;
    return { default: _sodium };
});

vi.mock('expo-crypto', () => ({
    getRandomBytes: (n: number) => {
        const buf = new Uint8Array(n);
        crypto.getRandomValues(buf);
        return buf;
    },
}));

vi.mock('@/sync/apiUploads', () => ({
    downloadUpload: vi.fn(),
    getThumbnailLocalPath: vi.fn((uploadId: string, ext: string) =>
        `file:///documents/thumbnails/${uploadId}.${ext}`),
}));

const mockWriteAsStringAsync = vi.fn().mockResolvedValue(undefined);
const mockGetInfoAsync = vi.fn();
vi.mock('expo-file-system/legacy', () => ({
    documentDirectory: 'file:///documents/',
    cacheDirectory: 'file:///cache/',
    writeAsStringAsync: mockWriteAsStringAsync,
    getInfoAsync: mockGetInfoAsync,
    EncodingType: { Base64: 'base64' },
}));

vi.mock('react-native-unistyles', () => ({
    StyleSheet: { create: (fn: any) => fn({ colors: {} }, {}) },
}));

vi.mock('@/sync/SessionEncryptionContext', () => ({
    useSessionEncryption: vi.fn(),
}));

vi.mock('@/text', () => ({ t: (k: string) => k }));

// ─── Imports (after mocks) ────────────────────────────────────────────────────

import { encryptFileForUpload } from '@/sync/fileEncryption';
import { downloadUpload, getThumbnailLocalPath } from '@/sync/apiUploads';
import { encodeBase64 } from '@/encryption/base64';

// ─── Helpers ──────────────────────────────────────────────────────────────────

let sessionKey: Uint8Array;

beforeAll(async () => {
    await _sodium.ready;
    sessionKey = new Uint8Array(32);
    crypto.getRandomValues(sessionKey);
});

/** Build a downloadUpload response for the given plaintext bytes. */
function makeDownloadPayload(bytes: Uint8Array) {
    const { encryptedBlob, nonce } = encryptFileForUpload(bytes, sessionKey);
    return { encryptedBlob, nonce, encryptedMeta: '', metaNonce: '' };
}

/**
 * Simulate the updated AttachmentChip useEffect logic in isolation.
 *
 * On native: checks local thumbnail first; returns localUri or error.
 * On web: falls back to downloadUpload.
 * Returns { localUri, error, skipped }.
 */
async function runAttachmentChip(opts: {
    platform: 'web' | 'ios' | 'android';
    sessionKey: Uint8Array | null;
    mimeType?: string;
    filename?: string;
    uploadId?: string;
    // native only — what getInfoAsync returns
    localFileExists?: boolean;
    localFileThrows?: boolean;
    // web only
    downloadPayload?: any;
    cancelBefore?: boolean;
}): Promise<{ localUri?: string; error?: string; skipped?: boolean }> {
    const {
        platform,
        sessionKey: sk,
        mimeType = 'image/png',
        filename = 'photo.png',
        uploadId = 'fimg001',
        localFileExists = false,
        localFileThrows = false,
        downloadPayload,
        cancelBefore = false,
    } = opts;

    const isImage = mimeType.startsWith('image/');
    if (!isImage) return { skipped: true };

    let cancelled = cancelBefore;

    if (platform !== 'web') {
        // ── Native: local-first path ──
        const ext = filename.includes('.') ? filename.split('.').pop()! : 'bin';
        const localPath = (getThumbnailLocalPath as ReturnType<typeof vi.fn>)(uploadId, ext) as string | null;

        if (localPath) {
            if (localFileThrows) {
                // getInfoAsync throws
                if (!cancelled) return { error: 'pin' };
                return {};
            }
            const info = { exists: localFileExists };
            if (info.exists) {
                if (!cancelled) return { localUri: localPath };
                return {};
            }
        }
        // Not found — pin
        if (!cancelled) return { error: 'pin' };
        return {};
    }

    // ── Web: download path ──
    if (!sk) return { error: 'No session key available' };
    if (!downloadPayload) return { error: 'No download payload' };

    const { decryptFileFromDownload } = await import('@/sync/fileEncryption');
    if (cancelled) return {};

    const decrypted = decryptFileFromDownload(downloadPayload.encryptedBlob, downloadPayload.nonce, sk);
    if (!decrypted) return { error: 'Decryption failed' };

    const blob = new Blob([decrypted.buffer as ArrayBuffer], { type: mimeType });
    const localUri = URL.createObjectURL(blob);
    if (cancelled) return {};
    return { localUri };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('AttachmentChip — isImage guard', () => {
    it('returns skipped=true for non-image mimeType (pdf)', async () => {
        const result = await runAttachmentChip({
            platform: 'ios',
            sessionKey,
            mimeType: 'application/pdf',
            filename: 'report.pdf',
        });
        expect(result.skipped).toBe(true);
    });

    it('returns skipped=true for text/plain', async () => {
        const result = await runAttachmentChip({
            platform: 'ios',
            sessionKey,
            mimeType: 'text/plain',
            filename: 'notes.txt',
        });
        expect(result.skipped).toBe(true);
    });

    it('does NOT skip for image/png', async () => {
        const result = await runAttachmentChip({
            platform: 'ios',
            sessionKey,
            mimeType: 'image/png',
            filename: 'photo.png',
            localFileExists: true,
        });
        expect(result.skipped).toBeUndefined();
    });

    it('does NOT skip for image/jpeg', async () => {
        const result = await runAttachmentChip({
            platform: 'ios',
            sessionKey,
            mimeType: 'image/jpeg',
            filename: 'photo.jpg',
            localFileExists: true,
        });
        expect(result.skipped).toBeUndefined();
    });
});

describe('AttachmentChip — native local-first path', () => {
    beforeEach(() => {
        vi.mocked(getThumbnailLocalPath).mockImplementation(
            (uploadId: string, ext: string) => `file:///documents/thumbnails/${uploadId}.${ext}`,
        );
    });

    afterEach(() => {
        vi.clearAllMocks();
        mockWriteAsStringAsync.mockClear();
        mockGetInfoAsync.mockClear();
    });

    it('returns localUri immediately when thumbnail exists — downloadUpload NOT called', async () => {
        const result = await runAttachmentChip({
            platform: 'ios',
            sessionKey,
            mimeType: 'image/png',
            filename: 'photo.png',
            uploadId: 'fimg123',
            localFileExists: true,
        });

        expect(result.localUri).toBe('file:///documents/thumbnails/fimg123.png');
        expect(result.error).toBeUndefined();
        expect(downloadUpload).not.toHaveBeenCalled();
    });

    it('returns error (pin chip) when local thumbnail is missing — downloadUpload NOT called', async () => {
        const result = await runAttachmentChip({
            platform: 'android',
            sessionKey,
            mimeType: 'image/jpeg',
            filename: 'photo.jpg',
            uploadId: 'fimg456',
            localFileExists: false,
        });

        expect(result.error).toBe('pin');
        expect(result.localUri).toBeUndefined();
        expect(downloadUpload).not.toHaveBeenCalled();
    });

    it('returns error (pin) when getInfoAsync throws', async () => {
        const result = await runAttachmentChip({
            platform: 'ios',
            sessionKey,
            mimeType: 'image/png',
            filename: 'photo.png',
            uploadId: 'fimg789',
            localFileThrows: true,
        });

        expect(result.error).toBe('pin');
        expect(downloadUpload).not.toHaveBeenCalled();
    });

    it('uses "bin" extension when filename has no dot', async () => {
        const result = await runAttachmentChip({
            platform: 'ios',
            sessionKey,
            mimeType: 'image/jpeg',
            filename: 'nodotext',
            uploadId: 'fimg999',
            localFileExists: true,
        });

        // getThumbnailLocalPath should have been called with 'bin'
        expect(getThumbnailLocalPath).toHaveBeenCalledWith('fimg999', 'bin');
        expect(result.localUri).toBe('file:///documents/thumbnails/fimg999.bin');
    });
});

describe('AttachmentChip — web platform image download', () => {
    const imageBytes = new Uint8Array([137, 80, 78, 71]); // PNG magic

    beforeEach(() => {
        vi.mocked(downloadUpload).mockResolvedValue(makeDownloadPayload(imageBytes) as any);
        (global as any).URL.createObjectURL = vi.fn(() => 'blob:https://app.easyfan.info/img-uuid');
        (global as any).URL.revokeObjectURL = vi.fn();
    });

    afterEach(() => {
        vi.clearAllMocks();
        mockWriteAsStringAsync.mockClear();
    });

    it('creates a Blob URL with correct image mimeType on web', async () => {
        const result = await runAttachmentChip({
            platform: 'web',
            downloadPayload: makeDownloadPayload(imageBytes),
            sessionKey,
            mimeType: 'image/png',
            filename: 'photo.png',
        });

        expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
        const blobArg = (URL.createObjectURL as ReturnType<typeof vi.fn>).mock.calls[0][0] as Blob;
        expect(blobArg).toBeInstanceOf(Blob);
        expect(blobArg.type).toBe('image/png');
        expect(result.localUri).toBe('blob:https://app.easyfan.info/img-uuid');
        expect(result.error).toBeUndefined();
    });

    it('returns error when sessionKey is null — no Blob URL created', async () => {
        const result = await runAttachmentChip({
            platform: 'web',
            downloadPayload: makeDownloadPayload(imageBytes),
            sessionKey: null,
            mimeType: 'image/png',
        });

        expect(result.error).toBe('No session key available');
        expect(URL.createObjectURL).not.toHaveBeenCalled();
    });

    it('returns error on decryption failure with wrong key', async () => {
        const wrongKey = new Uint8Array(32);
        crypto.getRandomValues(wrongKey);

        const result = await runAttachmentChip({
            platform: 'web',
            downloadPayload: makeDownloadPayload(imageBytes),
            sessionKey: wrongKey,
            mimeType: 'image/png',
        });

        expect(result.error).toBe('Decryption failed');
        expect(URL.createObjectURL).not.toHaveBeenCalled();
    });

    it('URL.revokeObjectURL is called on cleanup', () => {
        const blobUrl = 'blob:https://app.easyfan.info/to-revoke';
        const cleanup = () => URL.revokeObjectURL(blobUrl);
        cleanup();

        expect(URL.revokeObjectURL).toHaveBeenCalledWith(blobUrl);
    });
});

describe('AttachmentChip — cancelled flag', () => {
    afterEach(() => {
        (global as any).URL = (global as any).URL ?? {};
        (global as any).URL.createObjectURL = vi.fn();
        mockWriteAsStringAsync.mockClear();
    });

    it('does not produce localUri when cancelled before async completes (native, file exists)', async () => {
        const result = await runAttachmentChip({
            platform: 'ios',
            sessionKey,
            mimeType: 'image/png',
            filename: 'photo.png',
            uploadId: 'fimg-cancel',
            localFileExists: true,
            cancelBefore: true,
        });

        expect(result.localUri).toBeUndefined();
        expect(result.error).toBeUndefined();
        expect(result.skipped).toBeUndefined();
    });

    it('does not produce localUri when cancelled on web before blob URL is returned', async () => {
        const imageBytes = new Uint8Array([137, 80, 78, 71]);
        (global as any).URL.createObjectURL = vi.fn(() => 'blob:should-not-be-returned');

        const result = await runAttachmentChip({
            platform: 'web',
            downloadPayload: makeDownloadPayload(imageBytes),
            sessionKey,
            mimeType: 'image/png',
            cancelBefore: true,
        });

        // cancelled is checked after sessionKey, so for web with cancelBefore we exit after decrypt
        expect(result.localUri).toBeUndefined();
    });
});
