/**
 * focusTracker.spec.ts — ARCHIVED
 *
 * The Map-based focusTracker (trackConnect/trackDisconnect/hasActiveConnection/resetForTesting)
 * was replaced in e60816ed by a socket.data.appState approach (isUserActive).
 * The new API delegates to eventRouter.hasActiveNonMachineSocket() which requires
 * a live Socket.IO server to test — covered by integration tests instead.
 *
 * This file is kept as a historical record; all tests are skipped.
 */
import { describe } from 'vitest';

describe.skip('focusTracker (archived — API replaced by e60816ed)', () => {
    // Tests for trackConnect/trackDisconnect/hasActiveConnection have been
    // superseded by the socket.data.appState architecture.
    // See sources/app/push/focusTracker.ts for the new implementation.
});
