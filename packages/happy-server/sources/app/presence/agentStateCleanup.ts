import { db } from "@/storage/db";
import { delay } from "@/utils/delay";
import { forever } from "@/utils/forever";
import { shutdownSignal } from "@/utils/shutdown";
import { buildUpdateSessionUpdate, eventRouter } from "@/app/events/eventRouter";
import { allocateUserSeq } from "@/storage/seq";
import { randomKeyNaked } from "@/utils/randomKeyNaked";

const STALE_THRESHOLD_MS = 1000 * 60 * 5;  // 5 minutes
const SCAN_INTERVAL_MS = 1000 * 60 * 2;    // 2 minutes

/**
 * Background task that clears residual agentState on sessions whose daemon has
 * crashed or disconnected without sending an explicit null agentState.
 *
 * Pattern mirrors timeout.ts exactly:
 *   forever() wraps a while(true) loop; delay(ms, shutdownSignal) exits on shutdown.
 *   No inTx/afterTx needed — each updateManyAndReturn is an atomic top-level write,
 *   and emitUpdate is called immediately after, equivalent to afterTx ordering.
 */
export function startAgentStateCleanup(): void {
    forever('agent-state-cleanup', async () => {
        while (true) {
            const staleBefore = new Date(Date.now() - STALE_THRESHOLD_MS);

            const sessions = await db.session.findMany({
                where: {
                    agentState: { not: null },
                    lastActiveAt: { lte: staleBefore }
                },
                select: {
                    id: true,
                    accountId: true,
                    agentStateVersion: true
                }
            });

            for (const session of sessions) {
                const updated = await db.session.updateManyAndReturn({
                    where: {
                        id: session.id,
                        agentState: { not: null }   // idempotent CAS guard
                    },
                    data: {
                        agentState: null,
                        agentStateVersion: { increment: 1 }
                    },
                    select: {
                        id: true,
                        agentStateVersion: true
                    }
                });

                if (updated.length === 0) {
                    continue;   // already cleared by CLI or concurrent cleanup run
                }

                const newVersion = updated[0].agentStateVersion;
                const updSeq = await allocateUserSeq(session.accountId);
                const payload = buildUpdateSessionUpdate(
                    session.id,
                    updSeq,
                    randomKeyNaked(12),
                    undefined,
                    { value: null, version: newVersion }
                );

                eventRouter.emitUpdate({
                    userId: session.accountId,
                    payload,
                    recipientFilter: {
                        type: 'all-interested-in-session',
                        sessionId: session.id
                    }
                });
            }

            await delay(SCAN_INTERVAL_MS, shutdownSignal);
        }
    });
}
