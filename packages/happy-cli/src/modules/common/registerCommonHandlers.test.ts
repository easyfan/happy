import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile as fsWriteFile, readFile as fsReadFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';
import { RpcHandlerManager } from '../../api/rpc/RpcHandlerManager';
import { encrypt, decrypt, encodeBase64, decodeBase64 } from '../../api/encryption';
import { registerCommonHandlers } from './registerCommonHandlers';

// Helper: encrypt params and call handler, decrypt response
async function callHandler(
    mgr: RpcHandlerManager,
    key: Uint8Array,
    scopePrefix: string,
    method: string,
    params: unknown
): Promise<unknown> {
    const encryptedParams = encodeBase64(encrypt(key, 'legacy', params));
    const encryptedResponse = await mgr.handleRequest({
        method: `${scopePrefix}:${method}`,
        params: encryptedParams,
    });
    return decrypt(key, 'legacy', decodeBase64(encryptedResponse as string));
}

// Build a RpcHandlerManager with a fresh random 32-byte key
function makeManager(scopePrefix = 'test-scope'): { mgr: RpcHandlerManager; key: Uint8Array } {
    const key = new Uint8Array(randomBytes(32));
    const mgr = new RpcHandlerManager({
        scopePrefix,
        encryptionKey: key,
        encryptionVariant: 'legacy',
        logger: () => {},
    });
    return { mgr, key };
}

describe('registerCommonHandlers — machine-scoped (workingDirectory = null)', () => {
    let mgr: RpcHandlerManager;
    let key: Uint8Array;

    beforeEach(() => {
        ({ mgr, key } = makeManager());
        registerCommonHandlers(mgr, null);
    });

    it('scenario 1: bash handler executes commands with cwd outside process.cwd()', async () => {
        // os.tmpdir() is typically outside process.cwd() (which is the repo root during tests)
        const result = await callHandler(mgr, key, 'test-scope', 'bash', {
            command: 'echo hello',
            cwd: tmpdir(),
        }) as { success: boolean; stdout?: string };

        expect(result.success).toBe(true);
        expect(result.stdout).toContain('hello');
    });

    it('scenario 2: readFile handler reads files outside process.cwd()', async () => {
        // Write a temp file in tmpdir (outside process.cwd())
        const tmpDir = await mkdtemp(join(tmpdir(), 'rpc-test-'));
        const filePath = join(tmpDir, 'test-machine-read.txt');
        const content = 'machine-scoped-read-content';
        await fsWriteFile(filePath, content, 'utf8');

        try {
            const result = await callHandler(mgr, key, 'test-scope', 'readFile', {
                path: filePath,
            }) as { success: boolean; content?: string };

            expect(result.success).toBe(true);
            const decoded = Buffer.from(result.content!, 'base64').toString('utf8');
            expect(decoded).toBe(content);
        } finally {
            await rm(tmpDir, { recursive: true, force: true });
        }
    });
});

describe('registerCommonHandlers — session-scoped (workingDirectory = string) regression', () => {
    let mgr: RpcHandlerManager;
    let key: Uint8Array;
    let tmpDir: string;

    beforeEach(async () => {
        ({ mgr, key } = makeManager());
        tmpDir = await mkdtemp(join(tmpdir(), 'rpc-session-test-'));
        registerCommonHandlers(mgr, tmpDir);
    });

    afterEach(async () => {
        await rm(tmpDir, { recursive: true, force: true });
    });

    it('scenario 3: readFile handler succeeds for paths inside workspace', async () => {
        const filePath = join(tmpDir, 'test.txt');
        await fsWriteFile(filePath, 'session-content', 'utf8');

        const result = await callHandler(mgr, key, 'test-scope', 'readFile', {
            path: filePath,
        }) as { success: boolean; content?: string };

        expect(result.success).toBe(true);
        const decoded = Buffer.from(result.content!, 'base64').toString('utf8');
        expect(decoded).toBe('session-content');
    });

    it('scenario 4: readFile handler denies access to paths outside workspace', async () => {
        const result = await callHandler(mgr, key, 'test-scope', 'readFile', {
            path: '/etc/hosts',
        }) as { success: boolean; error?: string };

        expect(result.success).toBe(false);
        expect(result.error).toMatch(/outside the working directory|Access denied/i);
    });

    it('scenario 5: readFile handler blocks path traversal attacks', async () => {
        const result = await callHandler(mgr, key, 'test-scope', 'readFile', {
            path: '../../etc/passwd',
        }) as { success: boolean; error?: string };

        expect(result.success).toBe(false);
        expect(result.error).toContain('outside the working directory');
    });
});

describe('registerCommonHandlers — null mode relative path resolve', () => {
    let mgr: RpcHandlerManager;
    let key: Uint8Array;
    let tmpFilePath: string;

    beforeEach(async () => {
        ({ mgr, key } = makeManager());
        registerCommonHandlers(mgr, null);
        // Write a file relative to process.cwd() so we can read it with a relative path
        tmpFilePath = join(process.cwd(), 'tmp-rpc-cwd-resolve-test.txt');
        await fsWriteFile(tmpFilePath, 'resolve-test-content', 'utf8');
    });

    afterEach(async () => {
        try {
            await rm(tmpFilePath, { force: true });
        } catch {
            // ignore
        }
    });

    it('scenario 6: resolve() correctly converts relative path to absolute in null mode', async () => {
        // Pass a relative path — checkPath should resolve it via path.resolve(targetPath)
        const result = await callHandler(mgr, key, 'test-scope', 'readFile', {
            path: 'tmp-rpc-cwd-resolve-test.txt',
        }) as { success: boolean; content?: string };

        expect(result.success).toBe(true);
        const decoded = Buffer.from(result.content!, 'base64').toString('utf8');
        expect(decoded).toBe('resolve-test-content');
    });
});
