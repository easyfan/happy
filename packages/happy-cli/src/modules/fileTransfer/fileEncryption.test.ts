import { describe, expect, it } from 'vitest';
import tweetnacl from 'tweetnacl';
import {
    encryptFileBlob,
    encryptFileMeta,
    decryptFileBlob,
    decryptFileMeta,
} from './fileEncryption';

function makeKey(): Uint8Array {
    return tweetnacl.randomBytes(tweetnacl.secretbox.keyLength); // 32 bytes
}

describe('fileEncryption — blob roundtrip', () => {
    it('encrypts and decrypts a file blob correctly', () => {
        const key = makeKey();
        const original = new TextEncoder().encode('Hello, binary world! 🌍');

        const { encryptedBlob, nonce } = encryptFileBlob(original, key);
        const decrypted = decryptFileBlob(encryptedBlob, nonce, key);

        expect(decrypted).not.toBeNull();
        expect(new TextDecoder().decode(decrypted!)).toBe('Hello, binary world! 🌍');
    });

    it('returns null when decrypting blob with wrong key', () => {
        const key = makeKey();
        const wrongKey = makeKey();
        const original = new Uint8Array([1, 2, 3, 4, 5]);

        const { encryptedBlob, nonce } = encryptFileBlob(original, key);
        const result = decryptFileBlob(encryptedBlob, nonce, wrongKey);

        expect(result).toBeNull();
    });

    it('returns null when decrypting blob with tampered ciphertext', () => {
        const key = makeKey();
        const original = new Uint8Array([10, 20, 30]);

        const { nonce } = encryptFileBlob(original, key);
        const result = decryptFileBlob('dGhpcyBpcyBub3QgZW5jcnlwdGVk', nonce, key);

        expect(result).toBeNull();
    });

    it('generates a different nonce on each call (non-deterministic)', () => {
        const key = makeKey();
        const data = new Uint8Array([0, 1, 2]);

        const r1 = encryptFileBlob(data, key);
        const r2 = encryptFileBlob(data, key);

        expect(r1.nonce).not.toBe(r2.nonce);
        expect(r1.encryptedBlob).not.toBe(r2.encryptedBlob);
    });
});

describe('fileEncryption — meta roundtrip', () => {
    const meta = {
        filename: 'photo.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 204800,
    };

    it('encrypts and decrypts file metadata correctly', () => {
        const key = makeKey();

        const { encryptedMeta, metaNonce } = encryptFileMeta(meta, key);
        const decrypted = decryptFileMeta(encryptedMeta, metaNonce, key);

        expect(decrypted).not.toBeNull();
        expect(decrypted!.filename).toBe('photo.jpg');
        expect(decrypted!.mimeType).toBe('image/jpeg');
        expect(decrypted!.sizeBytes).toBe(204800);
    });

    it('returns null when decrypting meta with wrong key', () => {
        const key = makeKey();
        const wrongKey = makeKey();

        const { encryptedMeta, metaNonce } = encryptFileMeta(meta, key);
        const result = decryptFileMeta(encryptedMeta, metaNonce, wrongKey);

        expect(result).toBeNull();
    });
});

describe('fileEncryption — nonce independence', () => {
    it('blob nonce and meta nonce are always different', () => {
        const key = makeKey();
        const fileBytes = new Uint8Array([1, 2, 3]);
        const meta = { filename: 'f.txt', mimeType: 'text/plain', sizeBytes: 3 };

        const { nonce } = encryptFileBlob(fileBytes, key);
        const { metaNonce } = encryptFileMeta(meta, key);

        // With overwhelming probability, independently generated 24-byte nonces differ
        expect(nonce).not.toBe(metaNonce);
    });

    it('can correctly decrypt blob and meta independently (no nonce cross-contamination)', () => {
        const key = makeKey();
        const fileBytes = new TextEncoder().encode('file content');
        const meta = { filename: 'doc.pdf', mimeType: 'application/pdf', sizeBytes: 12 };

        const { encryptedBlob, nonce } = encryptFileBlob(fileBytes, key);
        const { encryptedMeta, metaNonce } = encryptFileMeta(meta, key);

        // Decrypt blob with blob's nonce
        const decryptedBlob = decryptFileBlob(encryptedBlob, nonce, key);
        expect(decryptedBlob).not.toBeNull();

        // Decrypt meta with meta's nonce
        const decryptedMeta = decryptFileMeta(encryptedMeta, metaNonce, key);
        expect(decryptedMeta).not.toBeNull();

        // Cross-nonce decryption must fail (proves independence)
        const crossBlob = decryptFileBlob(encryptedBlob, metaNonce, key);
        expect(crossBlob).toBeNull();
    });
});
