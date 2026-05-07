import { describe, it, expect, beforeAll } from 'vitest';
import { BoxEncryption } from './encryptor';
import { encryptBox } from '@/encryption/libsodium';
import { encodeUTF8 } from '@/encryption/text';
import sodium from '@/encryption/libsodium.lib';
import { getRandomBytes } from 'expo-crypto';

beforeAll(async () => {
    // libsodium-wrappers requires initialization before use
    await (sodium as any).ready;
});

describe('BoxEncryption.decrypt', () => {
    it('decrypts all valid items correctly', async () => {
        const seed = getRandomBytes(32);
        const encryptor = new BoxEncryption(seed);

        const items = [{ a: 1 }, { b: 'hello' }, { c: [1, 2, 3] }];
        const encrypted = await encryptor.encrypt(items);
        const decrypted = await encryptor.decrypt(encrypted);

        expect(decrypted).toEqual(items);
    });

    it('corrupt item does not block subsequent items', async () => {
        const seed = getRandomBytes(32);
        const encryptor = new BoxEncryption(seed);

        const validItems = [{ a: 1 }, { c: 3 }];
        const encrypted = await encryptor.encrypt(validItems);

        // Insert a random-byte corrupt item that cannot be decrypted
        const corrupt = new Uint8Array(64).fill(0xff);
        const mixed = [encrypted[0], corrupt, encrypted[1]];

        const result = await encryptor.decrypt(mixed);

        expect(result).toHaveLength(3);
        expect(result[0]).toEqual({ a: 1 });
        expect(result[1]).toBeNull();
        expect(result[2]).toEqual({ c: 3 });
    });

    it('returns all nulls when all items are corrupt', async () => {
        const seed = getRandomBytes(32);
        const encryptor = new BoxEncryption(seed);

        const corrupt = new Uint8Array(64).fill(0xde);
        const result = await encryptor.decrypt([corrupt, corrupt, corrupt]);

        expect(result).toHaveLength(3);
        expect(result.every((r) => r === null)).toBe(true);
    });

    it('returns empty array for empty input', async () => {
        const seed = getRandomBytes(32);
        const encryptor = new BoxEncryption(seed);

        const result = await encryptor.decrypt([]);
        expect(result).toEqual([]);
    });

    it('corrupt JSON payload (decryptBox succeeds but JSON.parse fails) does not block subsequent items', async () => {
        const seed = getRandomBytes(32);
        const encryptor = new BoxEncryption(seed);

        const validItems = [{ before: true }, { after: true }];
        const encrypted = await encryptor.encrypt(validItems);

        // Construct an item that decrypts successfully but produces invalid JSON:
        // encrypt raw bytes that are valid UTF-8 but not valid JSON.
        const keypair = sodium.crypto_box_seed_keypair(seed);
        const corruptJsonItem = encryptBox(encodeUTF8('not-valid-json{{{'), keypair.publicKey);
        const mixed = [encrypted[0], corruptJsonItem, encrypted[1]];

        const result = await encryptor.decrypt(mixed);

        expect(result).toHaveLength(3);
        expect(result[0]).toEqual({ before: true });
        expect(result[1]).toBeNull();  // JSON.parse error caught → null
        expect(result[2]).toEqual({ after: true });
    });

    it('output array length always equals input array length', async () => {
        const seed = getRandomBytes(32);
        const encryptor = new BoxEncryption(seed);

        // Mix of valid and corrupt items
        const validItems = [{ x: 'first' }, { x: 'last' }];
        const encrypted = await encryptor.encrypt(validItems);
        const corrupt1 = new Uint8Array(10).fill(0xab);
        const corrupt2 = new Uint8Array(1).fill(0x00);
        const mixed = [encrypted[0], corrupt1, corrupt2, encrypted[1]];

        const result = await encryptor.decrypt(mixed);

        expect(result).toHaveLength(4);
        expect(result[0]).toEqual({ x: 'first' });
        expect(result[1]).toBeNull();
        expect(result[2]).toBeNull();
        expect(result[3]).toEqual({ x: 'last' });
    });
});
