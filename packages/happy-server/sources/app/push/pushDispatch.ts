import { db } from '@/storage/db';
import { hasActiveConnection } from './focusTracker';
import { pushSend } from './pushSend';

/**
 * pushDispatch — dispatch push notification for a new message event.
 *
 * Called from afterTx callbacks in sessionUpdateHandler and v3SessionRoutes.
 * Must not throw — any error is swallowed to avoid affecting message delivery.
 *
 * Logic:
 * 1. If user has an active user-scoped socket connection, skip (they are online).
 * 2. Load all registered push tokens for the user from DB.
 * 3. If no tokens, skip.
 * 4. Delegate to pushSend with the token list.
 *
 * sessionId is accepted as a parameter for future use (e.g., per-session muting),
 * but is currently unused.
 */
export async function pushDispatch(userId: string, sessionId: string): Promise<void> {
    try {
        if (hasActiveConnection(userId)) {
            return;
        }

        const tokenRecords = await db.accountPushToken.findMany({
            where: { accountId: userId },
            select: { token: true },
        });

        if (tokenRecords.length === 0) {
            return;
        }

        const tokens = tokenRecords.map(t => t.token);
        await pushSend(tokens);
    } catch (error) {
        // Best-effort: never let push failure affect message flow.
        console.error('pushDispatch error:', error);
    }
}
