/**
 * Server IP cache for DNS resilience.
 *
 * When VPN DNS-over-TLS or upstream DNS fails, the daemon loses all hostname
 * resolution. This module persists the last known IP for the Happy server so
 * that both the HTTP health-check path (Plan B) and the Socket.IO reconnect
 * path (Plan C) can fall back to a direct IP connection while DNS recovers.
 *
 * ## File layout
 * - Cache path: `configuration.happyHomeDir + '/server-ip.cache'`
 * - Format: JSON `{ ip, hostname, cachedAt }` — written atomically via rename.
 *
 * ## Concurrency
 * Plan B and Plan C may both call `writeServerIpCache` concurrently.
 * `atomicFileWrite` uses a per-write temp file + POSIX rename, so every write
 * is atomic and the final state is always a valid JSON file (last-writer-wins).
 */

import dns, { type LookupOptions, type LookupAddress } from 'node:dns';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import net from 'node:net';
import { configuration } from '@/configuration';
import { atomicFileWrite } from '@/utils/fileAtomic';

// ─────────────────────────────────────────────────────────────────────────────
// Types & constants
// ─────────────────────────────────────────────────────────────────────────────

/**
 * JSON format written to the cache file on disk.
 */
interface ServerIpCacheEntry {
    /** Cached IPv4 address */
    ip: string;
    /** Hostname at the time of caching — used to invalidate if serverUrl changes */
    hostname: string;
    /** Unix timestamp in milliseconds when the entry was written */
    cachedAt: number;
}

/** 24-hour TTL prevents permanently pinning a stale IP after CDN/LB changes */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

function getCachePath(): string {
    return join(configuration.happyHomeDir, 'server-ip.cache');
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Read the server IP cache.
 *
 * Returns null (never throws) when:
 * - File does not exist
 * - JSON is malformed
 * - TTL has expired (> 24 h)
 * - Cached hostname does not match the current `configuration.serverUrl`
 *   (protects against stale entries after `happy env:use` URL switches)
 */
export async function readServerIpCache(): Promise<{ ip: string; hostname: string } | null> {
    try {
        const raw = await readFile(getCachePath(), 'utf8');
        const entry = JSON.parse(raw) as ServerIpCacheEntry;

        // TTL check
        if (Date.now() - entry.cachedAt > CACHE_TTL_MS) return null;

        // Field integrity
        if (typeof entry.ip !== 'string' || !entry.ip) return null;
        if (typeof entry.hostname !== 'string' || !entry.hostname) return null;

        // Hostname consistency — if the user switched serverUrl, discard old cache
        const currentHostname = new URL(configuration.serverUrl).hostname;
        if (entry.hostname !== currentHostname) return null;

        // If the serverUrl hostname is already a bare IP, DNS caching adds no value.
        // Skip to avoid a bogus DNS re-resolution of an IP address (which can return
        // a different address from Bonjour / mDNS and corrupt the cache).
        if (net.isIP(currentHostname) !== 0) return null;

        return { ip: entry.ip, hostname: entry.hostname };
    } catch {
        return null;
    }
}

/**
 * Synchronous version of readServerIpCache.
 *
 * Returns null (never throws) when:
 * - File does not exist
 * - JSON is malformed
 * - TTL has expired (> 24 h)
 * - Cached hostname does not match the current `configuration.serverUrl`
 * - Any field has unexpected type
 *
 * Satisfies C2: entire body wrapped in try-catch; no error is ever propagated.
 */
export function readServerIpCacheSync(): { ip: string; hostname: string } | null {
    try {
        const raw = readFileSync(getCachePath(), 'utf8');
        const entry = JSON.parse(raw) as ServerIpCacheEntry;

        // TTL check
        if (Date.now() - entry.cachedAt > CACHE_TTL_MS) return null;

        // Field integrity
        if (typeof entry.ip !== 'string' || !entry.ip) return null;
        if (typeof entry.hostname !== 'string' || !entry.hostname) return null;

        // Hostname consistency — if the user switched serverUrl, discard old cache
        const currentHostname = new URL(configuration.serverUrl).hostname;
        if (entry.hostname !== currentHostname) return null;

        // If the serverUrl hostname is already a bare IP, DNS caching adds no value.
        // Skip to avoid a bogus DNS re-resolution of an IP address (which can return
        // a different address from Bonjour / mDNS and corrupt the cache).
        if (net.isIP(currentHostname) !== 0) return null;

        return { ip: entry.ip, hostname: entry.hostname };
    } catch {
        return null;
    }
}

/**
 * Write the server IP cache (atomic write — safe under concurrent callers).
 *
 * Does not throw. Write failures are silently ignored since the cache is a
 * best-effort optimization; the main connection path is unaffected.
 */
export async function writeServerIpCache(ip: string, hostname: string): Promise<void> {
    // No point caching a resolved IP for a hostname that is itself an IP address.
    // Doing so can corrupt the cache when DNS resolution of a bare IP returns a
    // Bonjour / mDNS virtual address (e.g. 198.18.x.x) that is unreachable.
    if (net.isIP(hostname) !== 0) return;
    const entry: ServerIpCacheEntry = { ip, hostname, cachedAt: Date.now() };
    try {
        await atomicFileWrite(getCachePath(), JSON.stringify(entry));
    } catch {
        // Intentionally swallowed — cache write failure is non-fatal
    }
}

/**
 * Return a `dns.LookupFunction` that short-circuits all DNS resolution and
 * always returns `cachedIp`.
 *
 * **Critical**: Node 20 + axios 1.x default to `options.all = true`, expecting
 * the callback to receive `dns.LookupAddress[]` rather than `(address, family)`.
 * Returning the wrong shape causes `Invalid IP address: undefined` deep inside
 * the HTTP adapter.  This function handles all three call signatures:
 *
 * | options shape         | callback signature                         |
 * |-----------------------|--------------------------------------------|
 * | `{ all: true }`       | `(err, addresses: LookupAddress[]) => void` |
 * | `{ all: false/unset}` | `(err, address: string, family: number) => void` |
 * | number (legacy)       | `(err, address: string, family: number) => void` |
 */
// Inline type alias — dns.LookupFunction is not exported by the node:dns module typings
type LookupFunction = (
    hostname: string,
    options: LookupOptions | number,
    callback: unknown,
) => void;

export function makeCachedLookup(cachedIp: string): LookupFunction {
    return (hostname: string, options: LookupOptions | number, cb: unknown) => {
        const opts = typeof options === 'object' ? options : {};
        if ((opts as LookupOptions).all) {
            // axios 1.x + Node 20+ default path: expects LookupAddress[]
            (cb as (err: NodeJS.ErrnoException | null, addresses: LookupAddress[]) => void)(
                null,
                [{ address: cachedIp, family: 4 }],
            );
        } else {
            // Legacy path: (err, address, family)
            (cb as (err: NodeJS.ErrnoException | null, address: string, family: number) => void)(
                null,
                cachedIp,
                4,
            );
        }
    };
}

/**
 * Resolve `hostname` to its first IPv4 address via `dns.promises.resolve4`.
 *
 * Intended for fire-and-forget cache refresh after a successful connection.
 * Returns null on any error (DNS still down, no IPv4 record, etc.) — never
 * throws.
 *
 * Renamed from `lookupWithCache` — the old name was misleading since this
 * function performs a fresh DNS lookup rather than reading from a cache.
 */
export async function resolveFreshIp(hostname: string): Promise<string | null> {
    // Resolving a bare IP address via DNS is meaningless and can return a wrong
    // address from Bonjour / mDNS (e.g. 198.18.x.x on macOS), which would then
    // be written back to the cache and poison all subsequent connections.
    if (net.isIP(hostname) !== 0) return null;
    try {
        const addresses = await dns.promises.resolve4(hostname);
        return addresses[0] ?? null;
    } catch {
        return null;
    }
}
