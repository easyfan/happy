/**
 * Factory for DNS-resilient axios instances.
 *
 * `getHappyAxios()` returns a fresh `axios.create()` instance (never the global
 * axios singleton — C1) configured with a `CachedDnsAgent` when a valid IP
 * cache entry is available, or a plain instance when there is no cache.
 *
 * A 5-second in-process memory cache (C3) makes the function fully synchronous
 * so callers such as synchronous constructors can use it without `await`.
 *
 * Decision flow:
 *  1. Check in-memory cache (_cached). If hit and not expired → return instance.
 *  2. Call readServerIpCacheSync() (synchronous fs read, never throws — C2).
 *     - Cache hit → axios.create({ httpsAgent: new CachedDnsAgent(ip, hostname) })
 *     - No cache  → axios.create({})   ← C1: clean instance, not global axios
 *  3. Store result in _cached with a 5-second expiry.
 *  4. Return instance.
 */

import axios, { type AxiosInstance } from 'axios';
import { CachedDnsAgent } from '@/utils/cachedDnsAgent';
import { readServerIpCacheSync } from '@/utils/serverIpCache';

// ─────────────────────────────────────────────────────────────────────────────
// In-process memory cache (C3)
// ─────────────────────────────────────────────────────────────────────────────

interface HappyAxiosCacheEntry {
    instance: AxiosInstance;
    expiresAt: number;  // Unix ms
}

const MEMORY_TTL_MS = 5000;  // 5 seconds

let _cached: HappyAxiosCacheEntry | null = null;

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Return a DNS-resilient axios instance, synchronously.
 *
 * - If a valid server IP cache entry exists, the instance uses `CachedDnsAgent`
 *   to bypass DNS resolution for HTTPS connections.
 * - If no cache entry exists (first start, expired, or corrupt), returns a
 *   plain `axios.create({})` instance — never the global `axios` singleton.
 * - Results are cached in-process for 5 seconds so repeated calls within a
 *   session startup sequence all get the same instance without extra fs I/O.
 */
export function getHappyAxios(): AxiosInstance {
    const now = Date.now();

    // Return cached instance if still valid
    if (_cached !== null && now < _cached.expiresAt) {
        return _cached.instance;
    }

    // Build a fresh instance
    const serverIpCache = readServerIpCacheSync();

    const instance: AxiosInstance = serverIpCache !== null
        ? axios.create({ httpsAgent: new CachedDnsAgent(serverIpCache.ip, serverIpCache.hostname) })
        : axios.create({});  // C1: clean instance, not the global axios singleton

    // Store in memory cache
    _cached = { instance, expiresAt: now + MEMORY_TTL_MS };

    return instance;
}

/**
 * Reset the in-process memory cache.
 * Exposed for testing only — do not use in production code.
 *
 * @internal
 */
export function _resetHappyAxiosCacheForTesting(): void {
    _cached = null;
}
