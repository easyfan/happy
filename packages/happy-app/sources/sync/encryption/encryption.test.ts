/**
 * Unit tests for encryption.ts — decryptEncryptionKey resilience (0efede47)
 *
 * 测试目标：
 *   - decryptEncryptionKey: try/catch 包裹后，抛出异常时返回 null 而非 propagate
 *   - decryptEncryptionKey: 正常路径（version byte != 0）返回 null
 *   - decryptEncryptionKey: 正常路径（decryptBox 返回 null）返回 null
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── vi.mock 必须在所有 import 之前 ─────────────────────────────────────────

vi.mock('expo-modules-core', () => ({
    requireOptionalNativeModule: vi.fn(() => null),
    requireNativeModule: vi.fn(() => null),
    NativeModule: vi.fn(),
    EventEmitter: vi.fn(() => ({ addListener: vi.fn(), removeAllListeners: vi.fn() })),
    Platform: { OS: 'ios', select: vi.fn((obj: any) => obj.ios ?? obj.default) },
}));

vi.mock('expo-localization', () => ({
    default: { locale: 'en', locales: [{ languageCode: 'en', languageTag: 'en' }] },
    getLocales: vi.fn(() => [{ languageCode: 'en', languageTag: 'en' }]),
}));

vi.mock('@/text', () => ({
    t: vi.fn((key: string) => key),
}));

vi.mock('react-native-mmkv', () => {
    const store = new Map<string, string>();
    return {
        MMKV: vi.fn(() => ({
            set: (k: string, v: string) => store.set(k, v),
            getString: (k: string) => store.get(k),
            delete: (k: string) => store.delete(k),
        })),
    };
});

vi.mock('@/sync/persistence', () => ({
    persistence: { getSettings: vi.fn(() => ({})), setSettings: vi.fn() },
}));

import sodium from '@/encryption/libsodium.lib';
import { Encryption } from './encryption';

// Helper: create a real Encryption instance from a random masterSecret
async function createTestEncryption(): Promise<Encryption> {
    await sodium.ready;
    const masterSecret = sodium.randombytes_buf(32);
    return Encryption.create(masterSecret);
}

describe('Encryption.decryptEncryptionKey', () => {
    it('returns null when version byte is not 0 (invalid encrypted key)', async () => {
        const enc = await createTestEncryption();

        // Build a base64 payload whose first byte is 1 (not 0)
        const payload = new Uint8Array(65);
        payload[0] = 1; // wrong version
        const base64 = Buffer.from(payload).toString('base64');

        const result = await enc.decryptEncryptionKey(base64);
        expect(result).toBeNull();
    });

    it('returns null when decryptBox returns null (bad ciphertext)', async () => {
        const enc = await createTestEncryption();

        // Version byte 0, followed by random bytes that won't decrypt validly
        const payload = new Uint8Array(65);
        payload[0] = 0; // correct version
        // Rest is random junk — decryptBox will return null
        sodium.randombytes_buf(64).forEach((b, i) => { payload[i + 1] = b; });
        const base64 = Buffer.from(payload).toString('base64');

        const result = await enc.decryptEncryptionKey(base64);
        expect(result).toBeNull();
    });

    it('returns null (not throws) when decodeBase64 throws on malformed input', async () => {
        const enc = await createTestEncryption();

        // Pass a string that is not valid base64 — decodeBase64 may throw
        // The try/catch in decryptEncryptionKey should catch and return null
        const result = await enc.decryptEncryptionKey('!!!not-valid-base64!!!');
        expect(result).toBeNull();
    });

    it('returns decrypted key when encryption round-trip succeeds', async () => {
        const enc = await createTestEncryption();

        // Generate a real AES key
        await sodium.ready;
        const originalKey = sodium.randombytes_buf(32);

        // Encrypt it using the same Encryption instance
        const encryptedBytes = await enc.encryptEncryptionKey(originalKey);
        // Encode to base64 as the server would send it
        const base64 = Buffer.from(encryptedBytes).toString('base64');

        const result = await enc.decryptEncryptionKey(base64);
        expect(result).not.toBeNull();
        expect(result).toEqual(originalKey);
    });
});
