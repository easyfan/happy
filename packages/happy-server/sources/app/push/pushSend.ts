import { Expo, type ExpoPushMessage } from 'expo-server-sdk';

/**
 * pushSend — send push notification to one or more Expo push tokens.
 *
 * Filters out invalid tokens via Expo.isExpoPushToken before sending.
 * Chunks messages to respect Expo rate limits.
 * Silent on failure — push is best-effort and must never block message flow.
 *
 * Notification body is generic because the server cannot decrypt E2E content.
 */

/** Singleton Expo client — reuses HTTP connection pool internally. */
const expo = new Expo();

export async function pushSend(
    tokens: string[],
    body?: string
): Promise<void> {
    const messages: ExpoPushMessage[] = tokens
        .filter(token => Expo.isExpoPushToken(token))
        .map(token => ({
            to: token,
            sound: 'default' as const,
            body: body ?? 'New activity in your session',
            data: { type: 'new-message' },
        }));

    if (messages.length === 0) {
        return;
    }

    const chunks = expo.chunkPushNotifications(messages);
    for (const chunk of chunks) {
        try {
            await expo.sendPushNotificationsAsync(chunk);
            // Receipt checking is a follow-up optimization (RISK-002).
        } catch (error) {
            // Best-effort: swallow error, never propagate to caller.
            console.error('pushSend failed:', error);
        }
    }
}
