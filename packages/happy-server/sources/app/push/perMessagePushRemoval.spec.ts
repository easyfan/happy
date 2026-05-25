import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * perMessagePushRemoval.spec.ts
 *
 * UP-06: Verifies that per-message push notifications have been removed.
 *
 * Design rationale:
 * - pushDispatch.ts was deleted (per-message push was fire-and-forget on every
 *   new message received, causing excessive notification fatigue).
 * - Session-event push (pushSend + pushRoutes token registration) is retained.
 * - These tests confirm the removal is complete and the session-event path is intact.
 */

const sourcesRoot = path.resolve(__dirname, '../../../../sources');

describe('UP-06: per-message push removal', () => {
    it('positive: pushSend module still exists (session-event push infrastructure intact)', async () => {
        // pushSend is the low-level Expo dispatch used by session-event push.
        // Importing it must succeed after pushDispatch deletion.
        const mod = await import('./pushSend');
        expect(typeof mod.pushSend).toBe('function');
    });

    it('positive: focusTracker module still exists (online-suppression logic intact — now uses socket.data.appState)', async () => {
        // e60816ed replaced Map-based trackConnect/trackDisconnect with socket.data.appState approach.
        // focusTracker now exports isUserActive (async, delegates to eventRouter).
        const mod = await import('./focusTracker');
        expect(typeof mod.isUserActive).toBe('function');
    });

    it('negative: pushDispatch.ts file has been deleted', () => {
        const filePath = path.join(__dirname, 'pushDispatch.ts');
        expect(fs.existsSync(filePath)).toBe(false);
    });

    it('negative: v3SessionRoutes.ts does not contain pushDispatch reference', () => {
        const filePath = path.resolve(
            __dirname,
            '../api/routes/v3SessionRoutes.ts'
        );
        const content = fs.readFileSync(filePath, 'utf-8');
        expect(content).not.toContain('pushDispatch');
    });

    it('negative: sessionUpdateHandler.ts does not contain pushDispatch reference', () => {
        const filePath = path.resolve(
            __dirname,
            '../api/socket/sessionUpdateHandler.ts'
        );
        const content = fs.readFileSync(filePath, 'utf-8');
        expect(content).not.toContain('pushDispatch');
    });
});
