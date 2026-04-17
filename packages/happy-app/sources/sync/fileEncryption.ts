/**
 * File encryption/decryption utilities for bidirectional file transfer.
 *
 * Uses libsodium secretbox (XSalsa20-Poly1305), the same primitive used
 * for session message encryption.
 *
 * Blob and meta MUST use independent nonces to prevent two-time-pad attacks:
 * if the same (key, nonce) pair is used for two different plaintexts, an
 * attacker can XOR the ciphertexts to cancel the keystream, recovering
 * plaintext_blob XOR plaintext_meta. Because meta is structured JSON, this
 * could partially expose the file content.
 */

import { getRandomBytes } from 'expo-crypto';
import sodium from '@/encryption/libsodium.lib';
import { encodeBase64, decodeBase64 } from '@/encryption/base64';

/**
 * Encrypt file bytes for upload (App → Server → CLI direction).
 *
 * Generates a fresh random 24-byte nonce dedicated to the blob.
 * The caller must also call encryptMetaForUpload separately, which
 * generates its own independent nonce — never reuse the blob nonce for meta.
 */
export function encryptFileForUpload(
    fileBytes: Uint8Array,
    sessionKey: Uint8Array,
): { encryptedBlob: string; nonce: string } {
    const nonce = getRandomBytes(sodium.crypto_secretbox_NONCEBYTES); // 24 bytes
    const encrypted = sodium.crypto_secretbox_easy(fileBytes, nonce, sessionKey);
    return {
        encryptedBlob: encodeBase64(encrypted),
        nonce: encodeBase64(nonce),
    };
}

/**
 * Encrypt file metadata for upload using an independent nonce.
 *
 * Must NOT share the nonce used for encryptFileForUpload. Both are
 * independently generated 24-byte random values. The server stores both
 * nonces and returns them on download so the recipient can decrypt each piece.
 */
export function encryptMetaForUpload(
    meta: { filename: string; mimeType: string; sizeBytes: number },
    sessionKey: Uint8Array,
): { encryptedMeta: string; metaNonce: string } {
    const metaNonce = getRandomBytes(sodium.crypto_secretbox_NONCEBYTES); // independent 24-byte nonce
    const metaBytes = new TextEncoder().encode(JSON.stringify(meta));
    const encrypted = sodium.crypto_secretbox_easy(metaBytes, metaNonce, sessionKey);
    return {
        encryptedMeta: encodeBase64(encrypted),
        metaNonce: encodeBase64(metaNonce),
    };
}

/**
 * Decrypt a file blob downloaded from the server (CLI → Server → App direction).
 *
 * Returns null if decryption fails (wrong key, corrupted data, etc.).
 * Callers should show an error and a retry button rather than crash.
 */
export function decryptFileFromDownload(
    encryptedBlobB64: string,
    nonceB64: string,
    sessionKey: Uint8Array,
): Uint8Array | null {
    try {
        const nonce = decodeBase64(nonceB64);
        const encrypted = decodeBase64(encryptedBlobB64);
        return sodium.crypto_secretbox_open_easy(encrypted, nonce, sessionKey);
    } catch {
        return null;
    }
}
