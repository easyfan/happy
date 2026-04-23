/**
 * CLI-side file encryption/decryption using tweetnacl secretbox (XSalsa20-Poly1305).
 * Compatible with App-side libsodium secretbox — same primitive, different library wrapper.
 *
 * Key design:
 *  - blob and meta MUST use independent, randomly generated nonces.
 *  - Reusing the same nonce for two plaintexts under the same key enables a two-time-pad
 *    attack where an attacker can XOR the two ciphertexts and recover plaintext XOR plaintext.
 *    Since meta is highly predictable JSON, this could partially reveal the file content.
 *  - Wire format: { encryptedBlob, nonce, encryptedMeta, metaNonce } — all Base64.
 */

import tweetnacl from 'tweetnacl';
import { encodeBase64, decodeBase64, getRandomBytes } from '@/api/encryption';

export interface EncryptedFileBlob {
    encryptedBlob: string; // Base64 ciphertext
    nonce: string;         // Base64, 24-byte random nonce (blob-specific)
}

export interface EncryptedFileMeta {
    encryptedMeta: string; // Base64 ciphertext
    metaNonce: string;     // Base64, 24-byte random nonce (meta-specific, independent of blob nonce)
}

export interface FileMeta {
    filename: string;
    mimeType: string;
    sizeBytes: number;
}

/**
 * Encrypts raw file bytes using the session key.
 * Returns Base64-encoded ciphertext and a freshly generated nonce.
 * Never share the nonce with encryptFileMeta — each call generates its own independent nonce.
 */
export function encryptFileBlob(
    fileBytes: Uint8Array,
    encryptionKey: Uint8Array,
): EncryptedFileBlob {
    const nonce = getRandomBytes(tweetnacl.secretbox.nonceLength); // 24 bytes
    const encrypted = tweetnacl.secretbox(fileBytes, nonce, encryptionKey);
    return {
        encryptedBlob: encodeBase64(encrypted),
        nonce: encodeBase64(nonce),
    };
}

/**
 * Encrypts file metadata (filename, mimeType, sizeBytes) using the session key.
 * Uses a completely independent nonce from the blob nonce (prevents two-time-pad attack).
 */
export function encryptFileMeta(
    meta: FileMeta,
    encryptionKey: Uint8Array,
): EncryptedFileMeta {
    const metaNonce = getRandomBytes(tweetnacl.secretbox.nonceLength); // independent 24-byte nonce
    const metaBytes = new TextEncoder().encode(JSON.stringify(meta));
    const encrypted = tweetnacl.secretbox(metaBytes, metaNonce, encryptionKey);
    return {
        encryptedMeta: encodeBase64(encrypted),
        metaNonce: encodeBase64(metaNonce),
    };
}

/**
 * Decrypts a file blob using the session key and blob-specific nonce.
 * Returns null if decryption fails (bad key, corrupted data, or wrong nonce).
 */
export function decryptFileBlob(
    encryptedBlobB64: string,
    nonceB64: string,
    encryptionKey: Uint8Array,
): Uint8Array | null {
    try {
        const nonce = decodeBase64(nonceB64);
        const encrypted = decodeBase64(encryptedBlobB64);
        return tweetnacl.secretbox.open(encrypted, nonce, encryptionKey);
    } catch {
        return null;
    }
}

/**
 * Decrypts file metadata using the session key and meta-specific nonce.
 * Returns null if decryption or JSON parse fails.
 */
export function decryptFileMeta(
    encryptedMetaB64: string,
    metaNonceB64: string,
    encryptionKey: Uint8Array,
): FileMeta | null {
    try {
        const metaNonce = decodeBase64(metaNonceB64);
        const encrypted = decodeBase64(encryptedMetaB64);
        const decrypted = tweetnacl.secretbox.open(encrypted, metaNonce, encryptionKey);
        if (!decrypted) {
            return null;
        }
        return JSON.parse(new TextDecoder().decode(decrypted)) as FileMeta;
    } catch {
        return null;
    }
}
