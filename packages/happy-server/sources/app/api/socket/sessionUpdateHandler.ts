import { getMetricsLabelsFromSocket, sessionAliveEventsCounter, websocketEventsCounter } from "@/app/monitoring/metrics2";
import { activityCache } from "@/app/presence/sessionCache";
import { buildNewMessageUpdate, buildSessionActivityEphemeral, buildUpdateSessionUpdate, ClientConnection, eventRouter } from "@/app/events/eventRouter";
import { db } from "@/storage/db";
import { afterTx, inTx } from "@/storage/inTx";
import { allocateSessionSeq, allocateUserSeq } from "@/storage/seq";
import { AsyncLock } from "@/utils/lock";
import { log } from "@/utils/log";
import { randomKeyNaked } from "@/utils/randomKeyNaked";
import { pushDispatch } from "@/app/push/pushDispatch";
import { Socket } from "socket.io";
import { z } from "zod";

// Zod schemas for TECH-07 input validation
const UpdateMetadataInput = z.object({
    sid: z.string().min(1),
    metadata: z.string(),
    expectedVersion: z.number().int().min(0),
});

const UpdateStateInput = z.object({
    sid: z.string().min(1),
    agentState: z.string().nullable(),
    expectedVersion: z.number().int().min(0),
});

const MessageInput = z.object({
    sid: z.string().min(1),
    message: z.string().min(1),
    localId: z.string().optional(),
});

const SessionAliveInput = z.object({
    sid: z.string().min(1),
    time: z.number(),
    thinking: z.boolean().optional(),
});

const SessionEndInput = z.object({
    sid: z.string().min(1),
    time: z.number(),
});

export function sessionUpdateHandler(userId: string, socket: Socket, connection: ClientConnection) {
    const labels = getMetricsLabelsFromSocket(socket);
    socket.on('update-metadata', async (data: unknown, callback: (response: any) => void) => {
        try {
            // TECH-07: Zod validation
            const parsed = UpdateMetadataInput.safeParse(data);
            if (!parsed.success) {
                callback({ result: 'error' });
                return;
            }
            const { sid, metadata, expectedVersion } = parsed.data;

            // TECH-03: wrap all DB operations in a single transaction
            const result = await inTx(async (tx) => {
                // Resolve session
                const session = await tx.session.findUnique({
                    where: { id: sid, accountId: userId }
                });
                if (!session) {
                    return { type: 'not-found' as const };
                }

                // Check version
                if (session.metadataVersion !== expectedVersion) {
                    return { type: 'version-mismatch' as const, version: session.metadataVersion, metadata: session.metadata };
                }

                // Update metadata
                const { count } = await tx.session.updateMany({
                    where: { id: sid, metadataVersion: expectedVersion },
                    data: {
                        metadata: metadata,
                        metadataVersion: expectedVersion + 1
                    }
                });
                if (count === 0) {
                    return { type: 'version-mismatch' as const, version: session.metadataVersion, metadata: session.metadata };
                }

                // Allocate seq inside transaction for atomicity
                const updSeq = await allocateUserSeq(userId, tx);
                const metadataUpdate = { value: metadata, version: expectedVersion + 1 };

                // Emit after transaction commits
                afterTx(tx, () => {
                    const updatePayload = buildUpdateSessionUpdate(sid, updSeq, randomKeyNaked(12), metadataUpdate);
                    eventRouter.emitUpdate({
                        userId,
                        payload: updatePayload,
                        recipientFilter: { type: 'all-interested-in-session', sessionId: sid }
                    });
                });

                return { type: 'success' as const, version: expectedVersion + 1, metadata };
            });

            // Invoke callback after inTx returns (transaction committed)
            if (result.type === 'not-found') {
                return;
            }
            if (result.type === 'version-mismatch') {
                callback({ result: 'version-mismatch', version: result.version, metadata: result.metadata });
                return;
            }
            callback({ result: 'success', version: result.version, metadata: result.metadata });
        } catch (error) {
            log({ module: 'websocket', level: 'error' }, `Error in update-metadata: ${error}`);
            if (callback) {
                callback({ result: 'error' });
            }
        }
    });

    socket.on('update-state', async (data: unknown, callback: (response: any) => void) => {
        try {
            // TECH-07: Zod validation
            const parsed = UpdateStateInput.safeParse(data);
            if (!parsed.success) {
                callback({ result: 'error' });
                return;
            }
            const { sid, agentState, expectedVersion } = parsed.data;

            // TECH-03: wrap all DB operations in a single transaction
            const result = await inTx(async (tx) => {
                // Resolve session
                const session = await tx.session.findUnique({
                    where: { id: sid, accountId: userId }
                });
                if (!session) {
                    return { type: 'not-found' as const };
                }

                // Check version
                if (session.agentStateVersion !== expectedVersion) {
                    return { type: 'version-mismatch' as const, version: session.agentStateVersion, agentState: session.agentState };
                }

                // Update agent state
                const { count } = await tx.session.updateMany({
                    where: { id: sid, agentStateVersion: expectedVersion },
                    data: {
                        agentState: agentState,
                        agentStateVersion: expectedVersion + 1
                    }
                });
                if (count === 0) {
                    return { type: 'version-mismatch' as const, version: session.agentStateVersion, agentState: session.agentState };
                }

                // Allocate seq inside transaction for atomicity
                const updSeq = await allocateUserSeq(userId, tx);
                const agentStateUpdate = agentState !== null ? { value: agentState, version: expectedVersion + 1 } : undefined;

                // Emit after transaction commits
                afterTx(tx, () => {
                    const updatePayload = buildUpdateSessionUpdate(sid, updSeq, randomKeyNaked(12), undefined, agentStateUpdate);
                    eventRouter.emitUpdate({
                        userId,
                        payload: updatePayload,
                        recipientFilter: { type: 'all-interested-in-session', sessionId: sid }
                    });
                });

                return { type: 'success' as const, version: expectedVersion + 1, agentState };
            });

            // Invoke callback after inTx returns (transaction committed)
            if (result.type === 'not-found') {
                callback({ result: 'error' });
                return;
            }
            if (result.type === 'version-mismatch') {
                callback({ result: 'version-mismatch', version: result.version, agentState: result.agentState });
                return;
            }
            callback({ result: 'success', version: result.version, agentState: result.agentState });
        } catch (error) {
            log({ module: 'websocket', level: 'error' }, `Error in update-state: ${error}`);
            if (callback) {
                callback({ result: 'error' });
            }
        }
    });

    socket.on('session-alive', async (data: unknown) => {
        try {
            // Track metrics
            websocketEventsCounter.inc({ event_type: 'session-alive', ...labels });
            sessionAliveEventsCounter.inc();

            // TECH-07: Zod validation (silent return on failure)
            const parsed = SessionAliveInput.safeParse(data);
            if (!parsed.success) {
                return;
            }

            let t = parsed.data.time;
            if (t > Date.now()) {
                t = Date.now();
            }
            if (t < Date.now() - 1000 * 60 * 10) {
                return;
            }

            const { sid, thinking } = parsed.data;

            // Check session validity using cache
            const isValid = await activityCache.isSessionValid(sid, userId);
            if (!isValid) {
                return;
            }

            // Queue database update (will only update if time difference is significant)
            activityCache.queueSessionUpdate(sid, t);

            // Emit session activity update
            const sessionActivity = buildSessionActivityEphemeral(sid, true, t, thinking || false);
            eventRouter.emitEphemeral({
                userId,
                payload: sessionActivity,
                recipientFilter: { type: 'user-scoped-only' }
            });
        } catch (error) {
            log({ module: 'websocket', level: 'error' }, `Error in session-alive: ${error}`);
        }
    });

    const receiveMessageLock = new AsyncLock();
    socket.on('message', async (data: unknown) => {
        await receiveMessageLock.inLock(async () => {
            try {
                websocketEventsCounter.inc({ event_type: 'message', ...labels });

                // TECH-07: Zod validation (silent return on failure, inside lock outside inTx)
                const parsed = MessageInput.safeParse(data);
                if (!parsed.success) {
                    return;
                }
                const { sid, message, localId } = parsed.data;

                log({ module: 'websocket' }, `Received message from socket ${socket.id}: sessionId=${sid}, messageLength=${message.length} bytes, connectionType=${connection.connectionType}, connectionSessionId=${connection.connectionType === 'session-scoped' ? connection.sessionId : 'N/A'}`);

                // TECH-03: wrap all DB operations in a single transaction (AsyncLock is outer layer)
                await inTx(async (tx) => {
                    // Resolve session
                    const session = await tx.session.findUnique({
                        where: { id: sid, accountId: userId }
                    });
                    if (!session) {
                        return;
                    }

                    const useLocalId = typeof localId === 'string' ? localId : null;

                    // Create encrypted message
                    const msgContent: PrismaJson.SessionMessageContent = {
                        t: 'encrypted',
                        c: message
                    };

                    // Resolve seq inside transaction for atomicity
                    const updSeq = await allocateUserSeq(userId, tx);
                    const msgSeq = await allocateSessionSeq(sid, tx);

                    // Check if message already exists (idempotency)
                    if (useLocalId) {
                        const existing = await tx.sessionMessage.findFirst({
                            where: { sessionId: sid, localId: useLocalId }
                        });
                        if (existing) {
                            return;
                        }
                    }

                    // Create message
                    const msg = await tx.sessionMessage.create({
                        data: {
                            sessionId: sid,
                            seq: msgSeq,
                            content: msgContent,
                            localId: useLocalId
                        }
                    });

                    // Emit after transaction commits
                    afterTx(tx, () => {
                        const updatePayload = buildNewMessageUpdate(msg, sid, updSeq, randomKeyNaked(12));
                        eventRouter.emitUpdate({
                            userId,
                            payload: updatePayload,
                            recipientFilter: { type: 'all-interested-in-session', sessionId: sid },
                            skipSenderConnection: connection
                        });
                        // BUG-16: Trigger push notification for offline users (fire-and-forget)
                        pushDispatch(userId, sid);
                    });
                });
            } catch (error) {
                log({ module: 'websocket', level: 'error' }, `Error in message handler: ${error}`);
            }
        });
    });

    socket.on('session-end', async (data: unknown) => {
        try {
            // TECH-07: Zod validation (silent return on failure)
            const parsed = SessionEndInput.safeParse(data);
            if (!parsed.success) {
                return;
            }

            const { sid } = parsed.data;
            let t = parsed.data.time;
            if (t > Date.now()) {
                t = Date.now();
            }
            if (t < Date.now() - 1000 * 60 * 10) { // Ignore if time is in the past 10 minutes
                return;
            }

            // Resolve session
            const session = await db.session.findUnique({
                where: { id: sid, accountId: userId }
            });
            if (!session) {
                return;
            }

            // Update last active at
            await db.session.update({
                where: { id: sid },
                data: { lastActiveAt: new Date(t), active: false }
            });

            // Emit session activity update (sequential await ensures DB write completes first)
            const sessionActivity = buildSessionActivityEphemeral(sid, false, t, false);
            eventRouter.emitEphemeral({
                userId,
                payload: sessionActivity,
                recipientFilter: { type: 'user-scoped-only' }
            });
        } catch (error) {
            log({ module: 'websocket', level: 'error' }, `Error in session-end: ${error}`);
        }
    });

}
