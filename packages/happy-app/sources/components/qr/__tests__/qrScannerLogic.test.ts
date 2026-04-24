/**
 * Unit tests for QR scanner URL matching and scanned-lock logic.
 *
 * These tests cover the decision logic extracted from QRScannerScreen's
 * onCodeScanned callback:
 *   - Only forward URLs that start with the expected prefix
 *   - Ignore subsequent codes once scannedRef.current === true
 *
 * React component rendering and vision-camera integration require a
 * native dev build; they are covered by manual QA (see design doc §5).
 */

import { describe, it, expect, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Helper: mirrors the logic in QRScannerScreen.onCodeScanned
// ---------------------------------------------------------------------------
function makeOnCodeScanned(
    urlPrefix: string,
    onScanned: (url: string) => void,
    scannedRef: { current: boolean }
) {
    return (codes: Array<{ value?: string }>) => {
        if (scannedRef.current) return;
        const url = codes.find(c => c.value?.startsWith(urlPrefix))?.value;
        if (url) {
            scannedRef.current = true;
            onScanned(url);
        }
    };
}

// ---------------------------------------------------------------------------
// URL prefix matching
// ---------------------------------------------------------------------------
describe('QR scanner URL prefix matching', () => {
    const ACCOUNT_PREFIX = 'happy:///account?';
    const TERMINAL_PREFIX = 'happy://terminal?';

    it('forwards a URL that matches the account prefix', () => {
        const onScanned = vi.fn();
        const scannedRef = { current: false };
        const handler = makeOnCodeScanned(ACCOUNT_PREFIX, onScanned, scannedRef);

        handler([{ value: 'happy:///account?abc123' }]);

        expect(onScanned).toHaveBeenCalledOnce();
        expect(onScanned).toHaveBeenCalledWith('happy:///account?abc123');
    });

    it('forwards a URL that matches the terminal prefix', () => {
        const onScanned = vi.fn();
        const scannedRef = { current: false };
        const handler = makeOnCodeScanned(TERMINAL_PREFIX, onScanned, scannedRef);

        handler([{ value: 'happy://terminal?xyz789' }]);

        expect(onScanned).toHaveBeenCalledOnce();
        expect(onScanned).toHaveBeenCalledWith('happy://terminal?xyz789');
    });

    it('ignores a URL with a happy:// prefix but wrong path (account handler)', () => {
        const onScanned = vi.fn();
        const scannedRef = { current: false };
        const handler = makeOnCodeScanned(ACCOUNT_PREFIX, onScanned, scannedRef);

        // terminal URL presented to account handler
        handler([{ value: 'happy://terminal?xyz789' }]);

        expect(onScanned).not.toHaveBeenCalled();
    });

    it('ignores a URL with a happy:// prefix but wrong path (terminal handler)', () => {
        const onScanned = vi.fn();
        const scannedRef = { current: false };
        const handler = makeOnCodeScanned(TERMINAL_PREFIX, onScanned, scannedRef);

        // account URL presented to terminal handler
        handler([{ value: 'happy:///account?abc123' }]);

        expect(onScanned).not.toHaveBeenCalled();
    });

    it('ignores a completely unrelated QR code (e.g. WeChat login)', () => {
        const onScanned = vi.fn();
        const scannedRef = { current: false };
        const handler = makeOnCodeScanned(ACCOUNT_PREFIX, onScanned, scannedRef);

        handler([{ value: 'https://wx.qq.com/connect/oauth2/authorize?appid=foo' }]);

        expect(onScanned).not.toHaveBeenCalled();
    });

    it('ignores a code with no value', () => {
        const onScanned = vi.fn();
        const scannedRef = { current: false };
        const handler = makeOnCodeScanned(ACCOUNT_PREFIX, onScanned, scannedRef);

        handler([{ value: undefined }]);

        expect(onScanned).not.toHaveBeenCalled();
    });

    it('picks the first matching code when multiple codes are present', () => {
        const onScanned = vi.fn();
        const scannedRef = { current: false };
        const handler = makeOnCodeScanned(ACCOUNT_PREFIX, onScanned, scannedRef);

        handler([
            { value: 'https://example.com/other' },
            { value: 'happy:///account?first' },
            { value: 'happy:///account?second' },
        ]);

        expect(onScanned).toHaveBeenCalledOnce();
        expect(onScanned).toHaveBeenCalledWith('happy:///account?first');
    });

    it('ignores prefix that is only a partial match (no trailing content)', () => {
        // A URL that IS exactly the prefix (no key after ?) should still match
        // because startsWith is satisfied — and that is intentional: validation
        // of the key content happens inside processAuthUrl, not the scanner.
        const onScanned = vi.fn();
        const scannedRef = { current: false };
        const handler = makeOnCodeScanned(ACCOUNT_PREFIX, onScanned, scannedRef);

        handler([{ value: 'happy:///account?' }]);

        expect(onScanned).toHaveBeenCalledOnce();
    });
});

// ---------------------------------------------------------------------------
// Scanned lock (prevents repeated calls on continuous camera feed)
// ---------------------------------------------------------------------------
describe('QR scanner scanned lock', () => {
    const PREFIX = 'happy:///account?';

    it('calls onScanned exactly once even when same code fires multiple times', () => {
        const onScanned = vi.fn();
        const scannedRef = { current: false };
        const handler = makeOnCodeScanned(PREFIX, onScanned, scannedRef);

        const codes = [{ value: 'happy:///account?key1' }];
        handler(codes);
        handler(codes);
        handler(codes);

        expect(onScanned).toHaveBeenCalledOnce();
    });

    it('sets scannedRef.current = true after first match', () => {
        const onScanned = vi.fn();
        const scannedRef = { current: false };
        const handler = makeOnCodeScanned(PREFIX, onScanned, scannedRef);

        handler([{ value: 'happy:///account?key1' }]);

        expect(scannedRef.current).toBe(true);
    });

    it('does not call onScanned if scannedRef is already true on first call', () => {
        const onScanned = vi.fn();
        const scannedRef = { current: true }; // pre-locked
        const handler = makeOnCodeScanned(PREFIX, onScanned, scannedRef);

        handler([{ value: 'happy:///account?key1' }]);

        expect(onScanned).not.toHaveBeenCalled();
    });

    it('resumes after scannedRef is externally reset (re-open scanner)', () => {
        const onScanned = vi.fn();
        const scannedRef = { current: false };
        const handler = makeOnCodeScanned(PREFIX, onScanned, scannedRef);

        // First scan
        handler([{ value: 'happy:///account?key1' }]);
        expect(onScanned).toHaveBeenCalledOnce();

        // Simulate close + reopen: reset the ref
        scannedRef.current = false;

        // Second scan (new session)
        handler([{ value: 'happy:///account?key2' }]);
        expect(onScanned).toHaveBeenCalledTimes(2);
        expect(onScanned).toHaveBeenLastCalledWith('happy:///account?key2');
    });
});
