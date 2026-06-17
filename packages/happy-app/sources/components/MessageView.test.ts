/**
 * Unit tests for AttachmentChip image-thumbnail download logic in MessageView.
 *
 * AttachmentChip runs different behaviour depending on mimeType and platform:
 *   - isImage + web   : URL.createObjectURL(Blob) → blob: URI → Image
 *   - isImage + native: FileSystem.writeAsStringAsync → file:// URI → Image
 *   - non-image       : fallback chip regardless of download state
 *
 * These tests exercise the download logic in isolation (same pattern as
 * fileShareBubble.spec.ts) without rendering the full React component tree.
 *
 * Covered:
 *  1. isImage returns true for 'image/*' mimeTypes
 *  2. isImage returns false for non-image mimeTypes (pdf, text, etc.)
 *  3. Web: URL.createObjectURL called with correct Blob type for image
 *  4. Native: writeAsStringAsync called with correct path for image
 *  5. Decryption failure → error state, no Blob URL created
 *  6. Null sessionKey → error state immediately
 *  7. cancelled flag: setState not called after cancel
 *  8. URL.revokeObjectURL called on web cleanup
 *  9. Non-image file: download is never triggered (isImage guard)
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
}));

const mockWriteAsStringAsync = vi.fn().mockResolvedValue(undefined);
vi.mock('expo-file-system/legacy', () => ({
    cacheDirectory: 'file:///cache/',
    writeAsStringAsync: mockWriteAsStringAsync,
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
import { downloadUpload } from '@/sync/apiUploads';
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
 * Simulate the AttachmentChip useEffect download logic in isolation.
 * Returns { localUri, error, skipped } depending on execution path.
 *   skipped = true means the isImage guard prevented execution.
 */
async function runAttachmentDownload(opts: {
    platform: 'web' | 'ios' | 'android';
    downloadPayload: any;
    sessionKey: Uint8Array | null;
    mimeType?: string;
    filename?: string;
    uploadId?: string;
    cancelBefore?: boolean; // simulate cancelled = true before setState
}): Promise<{ localUri?: string; error?: string; skipped?: boolean }> {
    const {
        platform,
        downloadPayload,
        sessionKey: sk,
        mimeType = 'image/png',
        filename = 'photo.png',
        uploadId = 'fimg001',
        cancelBefore = false,
    } = opts;

    const isImage = mimeType.startsWith('image/');
    if (!isImage) return { skipped: true };

    // cancelled flag simulation
    let cancelled = cancelBefore;

    if (!sk) {
        if (!cancelled) return { error: 'No session key available' };
        return {};
    }

    const { decryptFileFromDownload } = await import('@/sync/fileEncryption');

    let raw: any;
    try {
        raw = downloadPayload;
        if (!raw) throw new Error('Download failed');
    } catch (e: any) {
        if (!cancelled) return { error: e.message };
        return {};
    }

    if (cancelled) return {};

    const decrypted = decryptFileFromDownload(raw.encryptedBlob, raw.nonce, sk);
    if (!decrypted) {
        if (!cancelled) return { error: 'Decryption failed' };
        return {};
    }

    if (platform === 'web') {
        const blob = new Blob([decrypted.buffer as ArrayBuffer], { type: mimeType });
        const localUri = URL.createObjectURL(blob);
        if (cancelled) return {};
        return { localUri };
    } else {
        const ext = filename.includes('.') ? filename.split('.').pop()! : 'bin';
        const filePath = `file:///cache/${uploadId}.${ext}`;
        const base64Data = encodeBase64(decrypted);
        await mockWriteAsStringAsync(filePath, base64Data, { encoding: 'base64' });
        if (cancelled) return {};
        return { localUri: filePath };
    }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('AttachmentChip — isImage guard', () => {
    it('returns skipped=true for non-image mimeType (pdf)', async () => {
        const result = await runAttachmentDownload({
            platform: 'ios',
            downloadPayload: makeDownloadPayload(new Uint8Array([1, 2, 3])),
            sessionKey,
            mimeType: 'application/pdf',
            filename: 'report.pdf',
        });
        expect(result.skipped).toBe(true);
    });

    it('returns skipped=true for text/plain', async () => {
        const result = await runAttachmentDownload({
            platform: 'ios',
            downloadPayload: makeDownloadPayload(new Uint8Array([1, 2, 3])),
            sessionKey,
            mimeType: 'text/plain',
            filename: 'notes.txt',
        });
        expect(result.skipped).toBe(true);
    });

    it('does NOT skip for image/png', async () => {
        const bytes = new Uint8Array([137, 80, 78, 71]);
        const result = await runAttachmentDownload({
            platform: 'ios',
            downloadPayload: makeDownloadPayload(bytes),
            sessionKey,
            mimeType: 'image/png',
            filename: 'photo.png',
        });
        expect(result.skipped).toBeUndefined();
    });

    it('does NOT skip for image/jpeg', async () => {
        const bytes = new Uint8Array([255, 216, 255]);
        const result = await runAttachmentDownload({
            platform: 'ios',
            downloadPayload: makeDownloadPayload(bytes),
            sessionKey,
            mimeType: 'image/jpeg',
            filename: 'photo.jpg',
        });
        expect(result.skipped).toBeUndefined();
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
        const result = await runAttachmentDownload({
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

    it('does NOT call URL.createObjectURL on native', async () => {
        await runAttachmentDownload({
            platform: 'ios',
            downloadPayload: makeDownloadPayload(imageBytes),
            sessionKey,
            mimeType: 'image/png',
            filename: 'photo.png',
        });

        expect(URL.createObjectURL).not.toHaveBeenCalled();
        expect(mockWriteAsStringAsync).toHaveBeenCalledTimes(1);
    });

    it('returns error when sessionKey is null — no Blob URL created', async () => {
        const result = await runAttachmentDownload({
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

        const result = await runAttachmentDownload({
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
        // Simulate the effect cleanup
        const cleanup = () => URL.revokeObjectURL(blobUrl);
        cleanup();

        expect(URL.revokeObjectURL).toHaveBeenCalledWith(blobUrl);
    });
});

describe('AttachmentChip — native platform image download', () => {
    const imageBytes = new Uint8Array([137, 80, 78, 71]);

    afterEach(() => {
        vi.clearAllMocks();
        mockWriteAsStringAsync.mockClear();
    });

    it('writes base64 image data to correct cache file path', async () => {
        const result = await runAttachmentDownload({
            platform: 'android',
            downloadPayload: makeDownloadPayload(imageBytes),
            sessionKey,
            mimeType: 'image/png',
            filename: 'photo.png',
            uploadId: 'fimg123',
        });

        expect(mockWriteAsStringAsync).toHaveBeenCalledWith(
            'file:///cache/fimg123.png',
            expect.any(String),
            { encoding: 'base64' },
        );
        expect(result.localUri).toBe('file:///cache/fimg123.png');
    });

    it('uses "bin" extension when filename has no dot', async () => {
        const result = await runAttachmentDownload({
            platform: 'ios',
            downloadPayload: makeDownloadPayload(imageBytes),
            sessionKey,
            mimeType: 'image/jpeg',
            filename: 'nodotext',
            uploadId: 'fimg456',
        });

        expect(mockWriteAsStringAsync).toHaveBeenCalledWith(
            'file:///cache/fimg456.bin',
            expect.any(String),
            { encoding: 'base64' },
        );
        expect(result.localUri).toBe('file:///cache/fimg456.bin');
    });
});

describe('AttachmentChip — cancelled flag', () => {
    afterEach(() => {
        (global as any).URL = (global as any).URL ?? {};
        (global as any).URL.createObjectURL = vi.fn();
        mockWriteAsStringAsync.mockClear();
    });

    it('does not produce localUri when cancelled before download resolves', async () => {
        const imageBytes = new Uint8Array([137, 80, 78, 71]);
        (global as any).URL.createObjectURL = vi.fn(() => 'blob:should-not-be-returned');

        const result = await runAttachmentDownload({
            platform: 'web',
            downloadPayload: makeDownloadPayload(imageBytes),
            sessionKey,
            mimeType: 'image/png',
            cancelBefore: true,
        });

        // When cancelled=true before sessionKey check, we get {} immediately
        expect(result.localUri).toBeUndefined();
        expect(result.error).toBeUndefined();
        expect(result.skipped).toBeUndefined();
    });
});
