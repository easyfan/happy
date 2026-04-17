/**
 * Unit tests for App-side file encryption (libsodium secretbox).
 *
 * @/encryption/libsodium.lib is stubbed out with libsodium-wrappers (the
 * web-compatible build) so these tests run in Node without any native module.
 * expo-crypto's getRandomBytes is replaced with crypto.getRandomValues.
 *
 * Structure mirrors happy-cli/src/modules/fileTransfer/fileEncryption.test.ts.
 */

import { describe, expect, it, vi, beforeAll } from 'vitest';
import _sodium from 'libsodium-wrappers';

// ─── Mocks (must be declared before importing the module under test) ──────────

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

// ─── Modules under test (imported after mocks are in place) ──────────────────

import {
    encryptFileForUpload,
    encryptMetaForUpload,
    decryptFileFromDownload,
} from './fileEncryption';

// ─── Helpers ─────────────────────────────────────────────────────────────────

let key32: Uint8Array;
let wrongKey32: Uint8Array;

beforeAll(async () => {
    await _sodium.ready;
    key32 = new Uint8Array(32);
    wrongKey32 = new Uint8Array(32);
    crypto.getRandomValues(key32);
    crypto.getRandomValues(wrongKey32);
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('encryptFileForUpload / decryptFileFromDownload — blob roundtrip', () => {
    it('encrypts and decrypts a bytes array correctly', () => {
        const original = new TextEncoder().encode('Hello, file world! 🌍');

        const { encryptedBlob, nonce } = encryptFileForUpload(original, key32);
        const decrypted = decryptFileFromDownload(encryptedBlob, nonce, key32);

        expect(decrypted).not.toBeNull();
        expect(new TextDecoder().decode(decrypted!)).toBe('Hello, file world! 🌍');
    });

    it('returns null when decrypting with wrong key', () => {
        const original = new Uint8Array([1, 2, 3, 4, 5]);
        const { encryptedBlob, nonce } = encryptFileForUpload(original, key32);
        const result = decryptFileFromDownload(encryptedBlob, nonce, wrongKey32);

        expect(result).toBeNull();
    });

    it('returns null when ciphertext is tampered', () => {
        const original = new Uint8Array([10, 20, 30]);
        const { nonce } = encryptFileForUpload(original, key32);
        // Random base64 that is not valid ciphertext for this key+nonce
        const result = decryptFileFromDownload(
            btoa(String.fromCharCode(...new Uint8Array(48).fill(0xFF))),
            nonce,
            key32,
        );

        expect(result).toBeNull();
    });

    it('generates a different nonce on each call (non-deterministic)', () => {
        const data = new Uint8Array([0, 1, 2]);
        const r1 = encryptFileForUpload(data, key32);
        const r2 = encryptFileForUpload(data, key32);

        expect(r1.nonce).not.toBe(r2.nonce);
        expect(r1.encryptedBlob).not.toBe(r2.encryptedBlob);
    });
});

describe('encryptMetaForUpload — meta roundtrip (via decryptFileFromDownload)', () => {
    const meta = { filename: 'photo.jpg', mimeType: 'image/jpeg', sizeBytes: 204800 };

    it('encrypts and decrypts metadata correctly', () => {
        const { encryptedMeta, metaNonce } = encryptMetaForUpload(meta, key32);

        // encryptedMeta is a secretbox of JSON-encoded meta; decrypt and parse
        const decrypted = decryptFileFromDownload(encryptedMeta, metaNonce, key32);
        expect(decrypted).not.toBeNull();
        const parsed = JSON.parse(new TextDecoder().decode(decrypted!));
        expect(parsed.filename).toBe('photo.jpg');
        expect(parsed.mimeType).toBe('image/jpeg');
        expect(parsed.sizeBytes).toBe(204800);
    });

    it('returns null when decrypting meta with wrong key', () => {
        const { encryptedMeta, metaNonce } = encryptMetaForUpload(meta, key32);
        const result = decryptFileFromDownload(encryptedMeta, metaNonce, wrongKey32);

        expect(result).toBeNull();
    });

    it('generates a different metaNonce per call', () => {
        const r1 = encryptMetaForUpload(meta, key32);
        const r2 = encryptMetaForUpload(meta, key32);

        expect(r1.metaNonce).not.toBe(r2.metaNonce);
    });
});

describe('nonce independence (two-time-pad prevention)', () => {
    it('blob nonce and meta nonce are always different', () => {
        const fileBytes = new Uint8Array([1, 2, 3]);
        const meta = { filename: 'f.txt', mimeType: 'text/plain', sizeBytes: 3 };

        const { nonce } = encryptFileForUpload(fileBytes, key32);
        const { metaNonce } = encryptMetaForUpload(meta, key32);

        // Two independent 24-byte random values — overwhelmingly likely to differ
        expect(nonce).not.toBe(metaNonce);
    });

    it('cross-nonce decryption fails (proves independence)', () => {
        const fileBytes = new TextEncoder().encode('file content');
        const meta = { filename: 'doc.pdf', mimeType: 'application/pdf', sizeBytes: 12 };

        const { encryptedBlob, nonce } = encryptFileForUpload(fileBytes, key32);
        const { encryptedMeta, metaNonce } = encryptMetaForUpload(meta, key32);

        // Decrypt each with its own nonce — must succeed
        expect(decryptFileFromDownload(encryptedBlob, nonce, key32)).not.toBeNull();
        expect(decryptFileFromDownload(encryptedMeta, metaNonce, key32)).not.toBeNull();

        // Decrypt blob with meta nonce — must fail
        const crossDecrypt = decryptFileFromDownload(encryptedBlob, metaNonce, key32);
        expect(crossDecrypt).toBeNull();
    });
});
