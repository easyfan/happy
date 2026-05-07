import { randomBytes } from 'node:crypto';

// Shim for expo-crypto in Node.js/vitest test environment.
// Uses Node.js built-in crypto to provide getRandomBytes.
// This is test infrastructure only — the real crypto algorithms (libsodium) remain unmocked.

export function getRandomBytes(byteCount: number): Uint8Array {
    return new Uint8Array(randomBytes(byteCount));
}
