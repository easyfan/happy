/**
 * Custom HTTPS Agent for DNS-resilient connections.
 *
 * Bypasses DNS resolution by connecting directly to a cached IP address
 * while preserving the correct TLS SNI hostname for certificate validation.
 *
 * ## Why not just replace the URL hostname with the IP?
 * engine.io-client detects `net.isIP(host) === true` and sets `servername`
 * to an empty string, breaking TLS certificate validation (P0 risk).
 * By overriding `createConnection` we control `host` (IP for TCP) and
 * `servername` (real hostname for TLS SNI) independently.
 */

import * as https from 'node:https';
import * as tls from 'node:tls';

export class CachedDnsAgent extends https.Agent {
    constructor(
        private readonly cachedIp: string,
        private readonly realHostname: string,
    ) {
        super();
    }

    createConnection(options: tls.ConnectionOptions, callback: (...args: unknown[]) => void): tls.TLSSocket {
        return tls.connect(
            {
                ...options,
                host: this.cachedIp,           // TCP target: cached IP (bypasses DNS)
                servername: this.realHostname, // TLS SNI: real hostname (cert validation)
            },
            callback,
        );
    }
}
