import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { InvalidateSync } from './sync';
import { NotFoundError } from './errors';
import { createBackoff } from './time';

describe('createBackoff — shouldStop', () => {
    it('TC-03: stops on first attempt when shouldStop returns true', async () => {
        const sentinel = new NotFoundError('STOP');
        let attempts = 0;
        const bf = createBackoff({
            minDelay: 0,
            maxDelay: 0,
            shouldStop: (e) => e instanceof NotFoundError,
        });
        await expect(bf(async () => {
            attempts++;
            throw sentinel;
        })).rejects.toBe(sentinel);
        expect(attempts).toBe(1);
    });

    it('retries when shouldStop returns false', async () => {
        let attempts = 0;
        const bf = createBackoff({
            minDelay: 0,
            maxDelay: 0,
            shouldStop: (e) => e instanceof NotFoundError,
        });
        await expect(bf(async () => {
            attempts++;
            if (attempts < 3) {
                throw new Error('transient error');
            }
        })).resolves.toBeUndefined();
        expect(attempts).toBe(3);
    });
});

describe('InvalidateSync — NotFoundError stops polling', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('TC-01: stops polling when command throws NotFoundError', async () => {
        let callCount = 0;
        const sync = new InvalidateSync(async () => {
            callCount++;
            throw new NotFoundError('Session not found: test-session');
        });
        sync.invalidate();

        // Advance timers to let the syncBackoff delay (250ms default) resolve quickly,
        // then drain microtasks so the backoff's shouldStop path runs to completion.
        await vi.runAllTimersAsync();

        // After stop(), _stopped=true, so awaitQueue returns immediately.
        await sync.awaitQueue();

        const countAfterStop = callCount;

        // A subsequent invalidate() should be a no-op because _stopped=true.
        sync.invalidate();
        await vi.runAllTimersAsync();

        expect(countAfterStop).toBe(1);
        expect(callCount).toBe(1);
    });

    it('TC-02: retries on non-404 errors until success', async () => {
        let callCount = 0;
        const sync = new InvalidateSync(async () => {
            callCount++;
            if (callCount < 3) {
                throw new Error('500 server error');
            }
        });
        sync.invalidate();

        // Keep advancing timers until the sync has settled (success path resolves).
        // We run timers in a loop to handle repeated backoff delays.
        let settled = false;
        const awaitPromise = sync.awaitQueue().then(() => { settled = true; });
        for (let i = 0; i < 10 && !settled; i++) {
            await vi.runAllTimersAsync();
        }
        await awaitPromise;

        expect(callCount).toBe(3);
    });
});
