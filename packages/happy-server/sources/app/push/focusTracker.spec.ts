import { describe, it, expect, beforeEach } from 'vitest';
import {
    trackConnect,
    trackDisconnect,
    hasActiveConnection,
    resetForTesting
} from './focusTracker';

describe('focusTracker', () => {
    beforeEach(() => {
        resetForTesting();
    });

    it('focusTracker-connect: trackConnect increments, hasActiveConnection returns true', () => {
        // Initial state: no connection
        expect(hasActiveConnection('user-1')).toBe(false);

        trackConnect('user-1');

        expect(hasActiveConnection('user-1')).toBe(true);
    });

    it('focusTracker-disconnect: trackDisconnect decrements, last disconnect returns false', () => {
        trackConnect('user-1');
        expect(hasActiveConnection('user-1')).toBe(true);

        trackDisconnect('user-1');

        expect(hasActiveConnection('user-1')).toBe(false);
    });

    it('focusTracker-multi: multiple connects require multiple disconnects', () => {
        trackConnect('user-1');
        trackConnect('user-1');
        trackConnect('user-1');

        trackDisconnect('user-1');
        // Still 2 connections
        expect(hasActiveConnection('user-1')).toBe(true);

        trackDisconnect('user-1');
        // Still 1 connection
        expect(hasActiveConnection('user-1')).toBe(true);

        trackDisconnect('user-1');
        // All connections disconnected
        expect(hasActiveConnection('user-1')).toBe(false);
    });

    it('focusTracker-underflow: trackDisconnect on unknown user does not go negative', () => {
        // Call trackDisconnect on a user that never connected
        expect(() => trackDisconnect('unknown-user')).not.toThrow();
        expect(hasActiveConnection('unknown-user')).toBe(false);

        // trackConnect after underflow should work correctly
        trackConnect('unknown-user');
        expect(hasActiveConnection('unknown-user')).toBe(true);
    });
});
