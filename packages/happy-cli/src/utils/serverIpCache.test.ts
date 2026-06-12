/**
 * Unit tests for serverIpCache.ts
 *
 * Strategy: mock `@/configuration` with a mutable object so tests can control
 * happyHomeDir and serverUrl. Real filesystem with isolated temp dirs per test.
 *
 * NOTE: vi.mock factory is hoisted to the top of the file by vitest — variables
 * declared below the mock call are NOT accessible inside the factory. The mutable
 * shared object pattern (define inside factory, export reference) is the correct
 * approach for this use case.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// ─────────────────────────────────────────────────────────────────────────────
// Mock @/configuration
// The factory creates a mutable object whose properties are reassigned per test.
// ─────────────────────────────────────────────────────────────────────────────

vi.mock('@/configuration', () => {
    const cfg = {
        happyHomeDir: '/tmp/happy-test-placeholder',
        serverUrl: 'https://api.example.com',
    };
    return { configuration: cfg };
});

// Import the (mocked) configuration object AFTER the mock is registered
import { configuration } from '@/configuration';

// Import the module under test (will use the mocked configuration)
import {
    readServerIpCache,
    readServerIpCacheSync,
    writeServerIpCache,
    makeCachedLookup,
} from './serverIpCache';

// ─────────────────────────────────────────────────────────────────────────────
// Test fixture helpers
// ─────────────────────────────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'happy-ipcache-test-'));
    // Point configuration at the isolated tmp dir
    (configuration as { happyHomeDir: string; serverUrl: string }).happyHomeDir = tmpDir;
    (configuration as { happyHomeDir: string; serverUrl: string }).serverUrl =
        'https://api.example.com';
});

afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// Group 1: readServerIpCache / writeServerIpCache TTL behaviour
// ─────────────────────────────────────────────────────────────────────────────

describe('readServerIpCache', () => {
    it('write then read returns { ip, hostname }', async () => {
        await writeServerIpCache('1.2.3.4', 'api.example.com');
        const result = await readServerIpCache();
        expect(result).toEqual({ ip: '1.2.3.4', hostname: 'api.example.com' });
    });

    it('expired entry (25 h ago) returns null', async () => {
        const stale = JSON.stringify({
            ip: '1.2.3.4',
            hostname: 'api.example.com',
            cachedAt: Date.now() - 25 * 60 * 60 * 1000,
        });
        await writeFile(join(tmpDir, 'server-ip.cache'), stale);
        const result = await readServerIpCache();
        expect(result).toBeNull();
    });

    it('missing file returns null (no throw)', async () => {
        const result = await readServerIpCache();
        expect(result).toBeNull();
    });

    it('malformed JSON returns null (no throw)', async () => {
        await writeFile(join(tmpDir, 'server-ip.cache'), 'not valid json {{{');
        const result = await readServerIpCache();
        expect(result).toBeNull();
    });

    it('hostname mismatch with current serverUrl returns null', async () => {
        // Write cache for old-server, but configuration.serverUrl is api.example.com
        const entry = JSON.stringify({
            ip: '1.2.3.4',
            hostname: 'old-server.example.com',
            cachedAt: Date.now(),
        });
        await writeFile(join(tmpDir, 'server-ip.cache'), entry);
        const result = await readServerIpCache();
        expect(result).toBeNull();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Group 1b: readServerIpCacheSync — synchronous variant
// ─────────────────────────────────────────────────────────────────────────────

import { writeFileSync } from 'node:fs';
import { join as pathJoin } from 'node:path';

describe('readServerIpCacheSync', () => {
    it('S1 — file does not exist → returns null (no throw) (C2)', () => {
        // tmpDir is empty — no cache file
        const result = readServerIpCacheSync();
        expect(result).toBeNull();
    });

    it('S2 — JSON-corrupted file → returns null (no throw) (C2)', () => {
        writeFileSync(pathJoin(tmpDir, 'server-ip.cache'), 'not valid json {{{', 'utf8');
        const result = readServerIpCacheSync();
        expect(result).toBeNull();
    });

    it('S3 — TTL expired (25 h ago) → returns null', () => {
        const stale = JSON.stringify({
            ip: '1.2.3.4',
            hostname: 'api.example.com',
            cachedAt: Date.now() - 25 * 60 * 60 * 1000,
        });
        writeFileSync(pathJoin(tmpDir, 'server-ip.cache'), stale, 'utf8');
        const result = readServerIpCacheSync();
        expect(result).toBeNull();
    });

    it('S4 — hostname mismatch with current serverUrl → returns null', () => {
        const entry = JSON.stringify({
            ip: '1.2.3.4',
            hostname: 'old-server.example.com',
            cachedAt: Date.now(),
        });
        writeFileSync(pathJoin(tmpDir, 'server-ip.cache'), entry, 'utf8');
        const result = readServerIpCacheSync();
        expect(result).toBeNull();
    });

    it('S5 — valid file, TTL not expired, hostname matches → returns { ip, hostname }', () => {
        const entry = JSON.stringify({
            ip: '1.2.3.4',
            hostname: 'api.example.com',
            cachedAt: Date.now(),
        });
        writeFileSync(pathJoin(tmpDir, 'server-ip.cache'), entry, 'utf8');
        const result = readServerIpCacheSync();
        expect(result).toEqual({ ip: '1.2.3.4', hostname: 'api.example.com' });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Group 2: makeCachedLookup — three callback signature branches
// ─────────────────────────────────────────────────────────────────────────────

describe('makeCachedLookup', () => {
    it('options.all = true → callback receives LookupAddress[]', async () => {
        const lookup = makeCachedLookup('1.2.3.4');

        await new Promise<void>((resolve, reject) => {
            (lookup as unknown as (
                h: string,
                o: { all: true },
                cb: (err: NodeJS.ErrnoException | null, addresses: import('node:dns').LookupAddress[]) => void
            ) => void)('any-hostname', { all: true }, (err, addresses) => {
                if (err) { reject(err); return; }
                try {
                    expect(Array.isArray(addresses)).toBe(true);
                    expect(addresses[0].address).toBe('1.2.3.4');
                    expect(addresses[0].family).toBe(4);
                    resolve();
                } catch (assertErr) {
                    reject(assertErr);
                }
            });
        });
    });

    it('options.all = false → callback receives (address, family)', async () => {
        const lookup = makeCachedLookup('1.2.3.4');

        await new Promise<void>((resolve, reject) => {
            (lookup as unknown as (
                h: string,
                o: { all: false },
                cb: (err: NodeJS.ErrnoException | null, address: string, family: number) => void
            ) => void)('any-hostname', { all: false }, (err, address, family) => {
                if (err) { reject(err); return; }
                try {
                    expect(address).toBe('1.2.3.4');
                    expect(family).toBe(4);
                    resolve();
                } catch (assertErr) {
                    reject(assertErr);
                }
            });
        });
    });

    it('options is a number (legacy signature) → callback receives (address, family)', async () => {
        const lookup = makeCachedLookup('1.2.3.4');

        await new Promise<void>((resolve, reject) => {
            (lookup as unknown as (
                h: string,
                f: number,
                cb: (err: NodeJS.ErrnoException | null, a: string, fam: number) => void
            ) => void)('any-hostname', 4, (err, address, family) => {
                if (err) { reject(err); return; }
                try {
                    expect(address).toBe('1.2.3.4');
                    expect(family).toBe(4);
                    resolve();
                } catch (assertErr) {
                    reject(assertErr);
                }
            });
        });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Group 3: writeServerIpCache concurrent safety
// ─────────────────────────────────────────────────────────────────────────────

describe('writeServerIpCache concurrent safety', () => {
    it('10 concurrent writes produce a valid JSON file (no corruption)', async () => {
        await Promise.all(
            Array.from({ length: 10 }, (_, i) =>
                writeServerIpCache(`1.2.3.${i}`, 'api.example.com'),
            ),
        );

        const result = await readServerIpCache();
        // File must be valid (not null) — last-writer-wins, exact IP is non-deterministic
        expect(result).not.toBeNull();
        expect(result!.hostname).toBe('api.example.com');
        expect(result!.ip).toMatch(/^1\.2\.3\.\d+$/);
    });
});
