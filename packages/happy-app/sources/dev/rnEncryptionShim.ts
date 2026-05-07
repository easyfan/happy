// Shim for rn-encryption in Node.js/vitest test environment.
// BoxEncryption does not use AES, so these stubs are not exercised
// by the encryptor.spec.ts tests. Providing them here only to
// satisfy the import graph so that vitest can load encryptor.ts.
export const decryptAESGCMString = async (_data: string, _key: string): Promise<string | null> => null;
export const encryptAESGCMString = async (_data: string, _key: string): Promise<string> => '';
