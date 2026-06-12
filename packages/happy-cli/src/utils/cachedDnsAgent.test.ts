import { describe, expect, it, vi } from 'vitest';
import * as tls from 'node:tls';
import { CachedDnsAgent } from './cachedDnsAgent';

const { mockTlsConnect } = vi.hoisted(() => ({
    mockTlsConnect: vi.fn(),
}));

vi.mock('node:tls', async (importOriginal) => {
    const actual = await importOriginal<typeof tls>();
    return {
        ...actual,
        connect: mockTlsConnect,
    };
});

describe('CachedDnsAgent.createConnection', () => {
    it('passes cached IP as host and real hostname as servername to tls.connect', () => {
        const cachedIp = '49.232.236.231';
        const realHostname = 'happy.easyfan.info';
        const agent = new CachedDnsAgent(cachedIp, realHostname);

        const fakeTlsSocket = {} as tls.TLSSocket;
        mockTlsConnect.mockReturnValueOnce(fakeTlsSocket);

        const callback = vi.fn();
        const incomingOptions: tls.ConnectionOptions = {
            host: realHostname,
            port: 443,
            servername: realHostname,
        };

        agent.createConnection(incomingOptions, callback);

        expect(mockTlsConnect).toHaveBeenCalledTimes(1);

        const calledOptions = mockTlsConnect.mock.calls[0][0] as tls.ConnectionOptions;

        // TCP target must use the cached IP — bypasses DNS
        expect(calledOptions.host).toBe(cachedIp);

        // TLS SNI must use the real hostname — ensures certificate validation passes
        expect(calledOptions.servername).toBe(realHostname);

        // Other options (e.g. port) must be preserved from the original options
        expect(calledOptions.port).toBe(443);

        // Callback must be forwarded unchanged
        expect(mockTlsConnect.mock.calls[0][1]).toBe(callback);
    });

    it('returns the TLSSocket produced by tls.connect', () => {
        const agent = new CachedDnsAgent('10.0.0.1', 'example.com');
        const fakeTlsSocket = { isSocket: true } as unknown as tls.TLSSocket;
        mockTlsConnect.mockReturnValueOnce(fakeTlsSocket);

        const result = agent.createConnection({}, vi.fn());

        expect(result).toBe(fakeTlsSocket);
    });
});
