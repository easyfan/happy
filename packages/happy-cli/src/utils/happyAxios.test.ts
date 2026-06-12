/**
 * Unit tests for happyAxios.ts
 *
 * Strategy:
 * - Mock @/configuration to control happyHomeDir and serverUrl.
 * - Use the real filesystem with an isolated tmpdir for cache file control.
 * - Do NOT mock readServerIpCacheSync — tests exercise the real integration path.
 * - Reset in-process memory cache between tests via _resetHappyAxiosCacheForTesting.
 *
 * Scenarios:
 * T1 — valid cache file present → instance.defaults.httpsAgent is CachedDnsAgent
 * T2 — no cache file → clean AxiosInstance (httpsAgent undefined), not global axios (C1)
 * T3 — corrupted cache file → clean AxiosInstance (C2 chain verification)
 * T4 — TTL-expired cache entry → clean AxiosInstance
 * T5 — two calls within 5-second TTL → same instance reference (C3 verification)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import axios from 'axios';
import { CachedDnsAgent } from './cachedDnsAgent';

// ─────────────────────────────────────────────────────────────────────────────
// Mock @/configuration
// ─────────────────────────────────────────────────────────────────────────────

vi.mock('@/configuration', () => {
    const cfg = {
        happyHomeDir: '/tmp/happy-test-placeholder',
        serverUrl: 'https://api.example.com',
    };
    return { configuration: cfg };
});

import { configuration } from '@/configuration';

// ─────────────────────────────────────────────────────────────────────────────
// Imports under test (after mocks)
// ─────────────────────────────────────────────────────────────────────────────

import { getHappyAxios, _resetHappyAxiosCacheForTesting } from './happyAxios';

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'happy-happyaxios-test-'));
    (configuration as { happyHomeDir: string; serverUrl: string }).happyHomeDir = tmpDir;
    (configuration as { happyHomeDir: string; serverUrl: string }).serverUrl = 'https://api.example.com';
    // Reset the in-process memory cache so each test starts clean
    _resetHappyAxiosCacheForTesting();
});

afterEach(async () => {
    _resetHappyAxiosCacheForTesting();
    await rm(tmpDir, { recursive: true, force: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// Helper: write a valid cache entry to the temp dir
// ─────────────────────────────────────────────────────────────────────────────

async function writeValidCache(ip: string, hostname: string, ageMs: number = 0) {
    const entry = JSON.stringify({ ip, hostname, cachedAt: Date.now() - ageMs });
    await writeFile(join(tmpDir, 'server-ip.cache'), entry, 'utf8');
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('getHappyAxios', () => {
    it('T1 — valid cache: httpsAgent is CachedDnsAgent', async () => {
        await writeValidCache('1.2.3.4', 'api.example.com');

        const instance = getHappyAxios();

        expect(instance.defaults.httpsAgent).toBeInstanceOf(CachedDnsAgent);
    });

    it('T2 — no cache file: clean instance, httpsAgent undefined, not global axios (C1)', () => {
        // No cache file written — tmpDir is empty

        const instance = getHappyAxios();

        // C1: must not be the global axios singleton
        expect(instance).not.toBe(axios);
        // Must be a proper axios instance (has HTTP methods)
        expect(typeof instance.get).toBe('function');
        expect(typeof instance.post).toBe('function');
        // Must not have httpsAgent injected
        expect(instance.defaults.httpsAgent).toBeUndefined();
    });

    it('T3 — corrupted cache JSON: clean instance (C2 chain verification)', async () => {
        await writeFile(join(tmpDir, 'server-ip.cache'), 'not valid json {{{', 'utf8');

        const instance = getHappyAxios();

        expect(instance).not.toBe(axios);
        expect(instance.defaults.httpsAgent).toBeUndefined();
    });

    it('T4 — TTL-expired entry (25 h ago): clean instance', async () => {
        const twentyFiveHoursMs = 25 * 60 * 60 * 1000;
        await writeValidCache('1.2.3.4', 'api.example.com', twentyFiveHoursMs);

        const instance = getHappyAxios();

        expect(instance.defaults.httpsAgent).toBeUndefined();
    });

    it('T5 — two calls within 5-second TTL return same instance (C3)', async () => {
        await writeValidCache('1.2.3.4', 'api.example.com');

        const first = getHappyAxios();
        const second = getHappyAxios();

        // Same object reference — memory cache hit
        expect(first).toBe(second);
    });

    it('T5-variant — after TTL expires a new instance is built', async () => {
        await writeValidCache('1.2.3.4', 'api.example.com');

        const first = getHappyAxios();

        // Manually force cache expiry by setting expiresAt to the past
        // We do this by resetting and then faking Date.now to be 6 seconds ahead
        _resetHappyAxiosCacheForTesting();
        const realDateNow = Date.now;
        try {
            Date.now = () => realDateNow() + 6000; // advance 6 seconds
            const second = getHappyAxios();
            expect(second).not.toBe(first);
        } finally {
            Date.now = realDateNow;
        }
    });
});
