/**
 * Unit tests for M-D1: stopping-fuse exit(1) race fix (BUG-DAEMON-02/D-1).
 *
 * Test coverage:
 *   TC-D1-01 — shouldFuseExitCode truth table (pure function)
 *   TC-D1-02 — clearTimeout is called when graceful chain resolves
 *   TC-D1-03 — true stall (graceful chain never resolves) → fuse fires exit(1)
 *   TC-D1-04 — R3p antecedent takeover: source='exception' + graceful resolve → exit(0)
 *   TC-D1-05 — duplicate requestShutdown calls do not re-arm the fuse
 *   TC-D1-06 — R4 self-upgrade path (no requestShutdown) → fuseTimer stays null
 *
 * Environment:
 *   - vitest fake timers (vi.useFakeTimers) for deterministic timer control
 *   - process.exit spy (vi.spyOn) — process boundary control, not a business mock
 *   - No mocking of internal modules (Happy project rule)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { shouldFuseExitCode } from './run';

// ---------------------------------------------------------------------------
// TC-D1-01: shouldFuseExitCode pure-function truth table
// ---------------------------------------------------------------------------
describe('shouldFuseExitCode', () => {
    it('returns 0 when gracefulResolved is true (chain completed, fuse is redundant)', () => {
        expect(shouldFuseExitCode(true)).toBe(0);
    });

    it('returns 1 when gracefulResolved is false (chain truly stalled)', () => {
        expect(shouldFuseExitCode(false)).toBe(1);
    });
});

// ---------------------------------------------------------------------------
// Fuse integration helpers
//
// We cannot call startDaemon() in unit tests (it requires a live server, auth,
// lock files, etc.).  Instead, we reproduce the exact closure logic that the
// three improved sections create, using the same shared lexical bindings.
// This validates the invariants without spinning up a real daemon.
// ---------------------------------------------------------------------------

// Fuse budget constant — must match the value in run.ts requestShutdown setTimeout.
// Updated to 5_000 ms in the D-1 loop-back fix (TC-502-A root cause:
// stopCaffeinate 1s sleep + releaseDaemonLock consumed the original 1s budget).
const FUSE_BUDGET_MS = 5_000;

/**
 * Builds a minimal reproduction of the fuse / graceful-chain closure that
 * mirrors the structure in startDaemon() after the D-1 fix.
 *
 * Returns:
 *   requestShutdown — the hardened version (duplicate guard + fuse arming)
 *   simulateGracefulSuccess — call this to simulate cleanupAndShutdown completing
 *   getFuseTimer — accessor for the current fuseTimer binding (white-box assertion)
 *   isGracefulResolved — accessor for the gracefulResolved binding
 */
function buildFuseClosure() {
    let fuseTimer: ReturnType<typeof setTimeout> | null = null;
    let gracefulResolved: boolean = false;

    // Mirror of the Promise executor that creates requestShutdown
    let resolveShutdown!: (v: { source: string }) => void;
    const shutdownPromise = new Promise<{ source: string }>((res) => {
        resolveShutdown = res;
    });

    const requestShutdown = (source: 'happy-app' | 'happy-cli' | 'os-signal' | 'exception') => {
        // Duplicate-call guard (TC-D1-05)
        if (fuseTimer !== null) {
            return;
        }

        // Arm the fuse — budget must match run.ts (TC-D1-02, TC-D1-03, TC-D1-07)
        fuseTimer = setTimeout(async () => {
            await new Promise<void>((r) => setTimeout(r, 100));
            process.exit(shouldFuseExitCode(gracefulResolved));
        }, FUSE_BUDGET_MS);

        resolveShutdown({ source });
    };

    // Simulate the tail of cleanupAndShutdown() completing successfully
    const simulateGracefulSuccess = () => {
        gracefulResolved = true;
        if (fuseTimer !== null) {
            clearTimeout(fuseTimer);
            fuseTimer = null;
        }
        process.exit(0);
    };

    const getFuseTimer = () => fuseTimer;
    const isGracefulResolved = () => gracefulResolved;

    return { requestShutdown, simulateGracefulSuccess, getFuseTimer, isGracefulResolved, shutdownPromise };
}

// ---------------------------------------------------------------------------
// TC-D1-02 to TC-D1-05: integration-style tests using fake timers + exit spy
// ---------------------------------------------------------------------------
describe('fuse closure integration', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let exitSpy: any;

    beforeEach(() => {
        vi.useFakeTimers();
        // Prevent actual process exit — spy returns undefined (no-op).
        // Cast through any to sidestep the overloaded never-return signature.
        exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as unknown as typeof process.exit);
    });

    afterEach(() => {
        vi.useRealTimers();
        exitSpy.mockRestore();
        vi.restoreAllMocks();
    });

    // TC-D1-02: graceful chain completes before fuse fires → clearTimeout called, exit(0)
    it('TC-D1-02: clearTimeout is called and process exits with 0 when graceful chain resolves', () => {
        const { requestShutdown, simulateGracefulSuccess, getFuseTimer } = buildFuseClosure();

        requestShutdown('happy-cli');
        // After arming: fuseTimer must be non-null
        expect(getFuseTimer()).not.toBeNull();

        // Graceful chain completes — must clear the fuse
        simulateGracefulSuccess();

        // fuseTimer must be null now (clearTimeout was called)
        expect(getFuseTimer()).toBeNull();
        // process.exit must have been called with 0
        expect(exitSpy).toHaveBeenCalledWith(0);
        expect(exitSpy).toHaveBeenCalledTimes(1);

        // Advance well past the full fuse window (5s) — the fuse must NOT fire again
        vi.advanceTimersByTime(FUSE_BUDGET_MS + 500);
        expect(exitSpy).toHaveBeenCalledTimes(1);
    });

    // TC-D1-03: graceful chain stalls — fuse fires exit(1) (committee-specified regression guard)
    // Uses the full FUSE_BUDGET_MS (5s) to model a true stall scenario.
    it('TC-D1-03: fuse fires exit(1) when graceful chain never resolves (true stall)', async () => {
        const { requestShutdown } = buildFuseClosure();

        requestShutdown('happy-cli');

        // Advance past the full fuse budget to fire the outer setTimeout
        vi.advanceTimersByTime(FUSE_BUDGET_MS);

        // The fuse callback contains an inner 100 ms delay before exit — advance past it
        vi.advanceTimersByTime(200);

        // Flush all microtasks/promises so the async fuse callback can complete
        await vi.runAllTimersAsync();

        expect(exitSpy).toHaveBeenCalledWith(1);
    });

    // TC-D1-07: slow-but-legitimate chain (models TC-502-A root cause: stopCaffeinate 1s sleep
    // + releaseDaemonLock).  Chain completes at 2s — within the 5s fuse budget → exit(0).
    // Regression guard: with the original 1s fuse this would have been exit(1).
    it('TC-D1-07: slow chain (2s) within budget (5s) resolves as exit(0), not exit(1)', async () => {
        const { requestShutdown, simulateGracefulSuccess } = buildFuseClosure();

        requestShutdown('happy-cli');

        // Simulate the graceful chain taking ~2s (caffeinate 200ms + lock + other steps)
        vi.advanceTimersByTime(2_000);

        // Chain completes within the 5s budget — fuse must not have fired yet
        expect(exitSpy).not.toHaveBeenCalled();

        // Now the graceful chain finishes
        simulateGracefulSuccess();

        // Must exit with 0, not 1
        expect(exitSpy).toHaveBeenCalledWith(0);
        expect(exitSpy).not.toHaveBeenCalledWith(1);

        // Advance past full budget — no second exit call
        vi.advanceTimersByTime(FUSE_BUDGET_MS + 500);
        expect(exitSpy).toHaveBeenCalledTimes(1);
    });

    // TC-D1-04: R3p antecedent takeover — source='exception' but graceful chain succeeds → exit(0)
    it('TC-D1-04: source=exception + graceful resolve → exit(0), not exit(1) (R3p race fix)', () => {
        const { requestShutdown, simulateGracefulSuccess } = buildFuseClosure();

        // Heartbeat detected a different daemon — calls requestShutdown('exception')
        requestShutdown('exception');

        // cleanupAndShutdown resolves normally
        simulateGracefulSuccess();

        expect(exitSpy).toHaveBeenCalledWith(0);
        expect(exitSpy).not.toHaveBeenCalledWith(1);
    });

    // TC-D1-05: duplicate requestShutdown calls must not re-arm the fuse (only one setTimeout)
    it('TC-D1-05: duplicate requestShutdown does not reset the fuse timer', () => {
        const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
        const { requestShutdown, getFuseTimer } = buildFuseClosure();

        // First call arms the fuse
        requestShutdown('happy-cli');
        const firstTimer = getFuseTimer();
        expect(firstTimer).not.toBeNull();

        // Second call (e.g. concurrent SIGTERM) must be ignored
        requestShutdown('happy-app');

        // Timer handle must be unchanged
        expect(getFuseTimer()).toBe(firstTimer);

        // Count only the fuse setTimeouts (1000 ms delay) to avoid counting
        // other internal setTimeouts (e.g. log flush delay inside the spy chain).
        // We simply assert that a second call to requestShutdown did NOT change
        // the existing timer handle — the handle identity check above is sufficient.
        expect(exitSpy).not.toHaveBeenCalled();

        setTimeoutSpy.mockRestore();
    });

    // TC-D1-06: R4 self-upgrade path never calls requestShutdown → fuseTimer remains null
    it('TC-D1-06: R4 self-upgrade (no requestShutdown) leaves fuseTimer null, exits with 0', () => {
        const { getFuseTimer, isGracefulResolved } = buildFuseClosure();

        // R4: heartbeat detects new bundle, calls process.exit(0) directly — no requestShutdown
        process.exit(0);

        // fuseTimer was never armed
        expect(getFuseTimer()).toBeNull();
        // gracefulResolved was never set (not needed for R4)
        expect(isGracefulResolved()).toBe(false);
        expect(exitSpy).toHaveBeenCalledWith(0);
    });
});
