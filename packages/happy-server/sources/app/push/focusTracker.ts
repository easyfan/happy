/**
 * focusTracker — tracks active user-scoped socket connection counts per userId.
 *
 * A user-scoped connection represents the App (iOS/Android/Web).
 * If at least one user-scoped connection exists, the user is "in focus" and
 * push notifications should be suppressed (they are already online).
 *
 * Multi-process note: each process holds its own local map.
 * In a multi-process Redis deployment, hasActiveConnection() only checks the
 * current process. This is a conservative false-negative: a redundant push
 * is preferable to missing one.
 */

const activeConnections = new Map<string, number>();

/** Called when a user-scoped socket connects. */
export function trackConnect(userId: string): void {
    activeConnections.set(userId, (activeConnections.get(userId) ?? 0) + 1);
}

/** Called when a user-scoped socket disconnects. */
export function trackDisconnect(userId: string): void {
    const count = (activeConnections.get(userId) ?? 0) - 1;
    if (count <= 0) {
        activeConnections.delete(userId);
    } else {
        activeConnections.set(userId, count);
    }
}

/** Returns true if the user has at least one active user-scoped connection. */
export function hasActiveConnection(userId: string): boolean {
    return (activeConnections.get(userId) ?? 0) > 0;
}

/** Reset all state — for use in tests only. */
export function resetForTesting(): void {
    activeConnections.clear();
}
