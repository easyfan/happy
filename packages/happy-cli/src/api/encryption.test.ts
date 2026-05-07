import { describe, it, expect } from 'vitest';
import tweetnacl from 'tweetnacl';
import { encryptLegacy, decryptLegacy } from '@/api/encryption';

describe('decryptLegacy', () => {

    it('returns null when decrypted bytes are not valid JSON', () => {
        // Construct a payload encrypted with valid key but containing non-JSON content
        // This tests the "decrypt succeeds but JSON.parse fails" path
        const secret = tweetnacl.randomBytes(tweetnacl.secretbox.keyLength);
        const corruptPayload = new TextEncoder().encode('this is not json {{{');
        const nonce = tweetnacl.randomBytes(tweetnacl.secretbox.nonceLength);
        const encrypted = tweetnacl.secretbox(corruptPayload, nonce, secret);
        const data = new Uint8Array(nonce.length + encrypted.length);
        data.set(nonce);
        data.set(encrypted, nonce.length);

        // Should not throw, should return null
        expect(() => decryptLegacy(data, secret)).not.toThrow();
        expect(decryptLegacy(data, secret)).toBeNull();
    });

    it('returns null when decrypted bytes are empty', () => {
        // JSON.parse('') throws SyntaxError — edge case for empty payload
        const secret = tweetnacl.randomBytes(tweetnacl.secretbox.keyLength);
        const emptyPayload = new Uint8Array(0);
        const nonce = tweetnacl.randomBytes(tweetnacl.secretbox.nonceLength);
        const encrypted = tweetnacl.secretbox(emptyPayload, nonce, secret);
        const data = new Uint8Array(nonce.length + encrypted.length);
        data.set(nonce);
        data.set(encrypted, nonce.length);

        expect(() => decryptLegacy(data, secret)).not.toThrow();
        expect(decryptLegacy(data, secret)).toBeNull();
    });

    it('correctly decrypts valid JSON payload', () => {
        // Happy path: ensure the fix does not break normal decryption
        const secret = tweetnacl.randomBytes(tweetnacl.secretbox.keyLength);
        const payload = { hello: 'world', num: 42 };
        const data = encryptLegacy(payload, secret);

        const result = decryptLegacy(data, secret);
        expect(result).toEqual(payload);
    });

    it('returns null when wrong key is used', () => {
        // Wrong key: secretbox.open returns null — original logic path, unaffected by this fix
        const secret = tweetnacl.randomBytes(tweetnacl.secretbox.keyLength);
        const wrongSecret = tweetnacl.randomBytes(tweetnacl.secretbox.keyLength);
        const data = encryptLegacy({ x: 1 }, secret);

        expect(decryptLegacy(data, wrongSecret)).toBeNull();
    });

});
