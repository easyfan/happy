import { randomBytes, createHash } from 'node:crypto';

// Shim for expo-crypto in Node.js/vitest test environment.
// Uses Node.js built-in crypto to provide getRandomBytes, digest, and
// CryptoDigestAlgorithm. This is test infrastructure only — the real crypto
// algorithms (libsodium) remain unmocked.

export function getRandomBytes(byteCount: number): Uint8Array {
    return new Uint8Array(randomBytes(byteCount));
}

// Mirror the CryptoDigestAlgorithm enum from expo-crypto
export const CryptoDigestAlgorithm = {
    SHA1: 'SHA-1',
    SHA256: 'SHA-256',
    SHA384: 'SHA-384',
    SHA512: 'SHA-512',
    MD5: 'MD5',
} as const;

type CryptoDigestAlgorithmValue = typeof CryptoDigestAlgorithm[keyof typeof CryptoDigestAlgorithm];

// Map expo-crypto algorithm strings to Node.js hash algorithm names
const ALGO_MAP: Record<string, string> = {
    'SHA-1': 'sha1',
    'SHA-256': 'sha256',
    'SHA-384': 'sha384',
    'SHA-512': 'sha512',
    'MD5': 'md5',
};

export async function digest(
    algorithm: CryptoDigestAlgorithmValue,
    data: Uint8Array | ArrayBuffer
): Promise<ArrayBuffer> {
    const nodeAlgo = ALGO_MAP[algorithm];
    if (!nodeAlgo) {
        throw new Error(`Unsupported hash algorithm: ${algorithm}`);
    }
    const hash = createHash(nodeAlgo);
    hash.update(data instanceof Uint8Array ? data : new Uint8Array(data));
    const buf = hash.digest();
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

export function randomUUID(): string {
    return randomBytes(16).toString('hex').replace(
        /(.{8})(.{4})(.{4})(.{4})(.{12})/,
        '$1-$2-$3-$4-$5'
    );
}
