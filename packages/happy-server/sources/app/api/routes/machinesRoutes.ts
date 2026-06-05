import { eventRouter } from "@/app/events/eventRouter";
import { Fastify } from "../types";
import { z } from "zod";
import { db } from "@/storage/db";
import { inTx, afterTx } from "@/storage/inTx";
import { log } from "@/utils/log";
import { randomKeyNaked } from "@/utils/randomKeyNaked";
import { allocateUserSeq } from "@/storage/seq";
import { buildNewMachineUpdate, buildUpdateMachineUpdate, buildDeleteMachineUpdate } from "@/app/events/eventRouter";
import * as privacyKit from "privacy-kit";

export function machinesRoutes(app: Fastify) {
    app.post('/v1/machines', {
        preHandler: app.authenticate,
        schema: {
            body: z.object({
                id: z.string(),
                metadata: z.string(), // Encrypted metadata
                daemonState: z.string().optional(), // Encrypted daemon state
                dataEncryptionKey: z.string().nullish()
            })
        }
    }, async (request, reply) => {
        const userId = request.userId;
        const { id, metadata, daemonState, dataEncryptionKey } = request.body;

        const result = await inTx(async (tx) => {
            // Check if machine exists (like sessions do)
            const machine = await tx.machine.findFirst({
                where: {
                    accountId: userId,
                    id: id
                }
            });

            if (machine) {
                // Machine exists - update dataEncryptionKey if it was null and caller now provides one
                const needsKeyUpdate = !machine.dataEncryptionKey && !!dataEncryptionKey;
                const updatedMachine = needsKeyUpdate
                    ? await tx.machine.update({
                        where: { id: machine.id },
                        data: {
                            dataEncryptionKey: privacyKit.decodeBase64(dataEncryptionKey!),
                            metadata,
                            metadataVersion: { increment: 1 },
                        }
                    })
                    : machine;

                if (needsKeyUpdate) {
                    afterTx(tx, async () => {
                        log({ module: 'machines', machineId: id, userId }, 'Updated dataEncryptionKey for existing machine');
                        // Emit update event so App syncs the new key
                        const updSeq = await allocateUserSeq(userId);
                        const newMachinePayload = buildNewMachineUpdate(updatedMachine, updSeq, randomKeyNaked(12));
                        eventRouter.emitUpdate({
                            userId,
                            payload: newMachinePayload,
                            recipientFilter: { type: 'user-scoped-only' }
                        });
                    });
                } else {
                    log({ module: 'machines', machineId: id, userId }, 'Found existing machine');
                }

                return { type: 'existing' as const, machine: updatedMachine };
            } else {
                // Create new machine
                log({ module: 'machines', machineId: id, userId }, 'Creating new machine');

                const newMachine = await tx.machine.create({
                    data: {
                        id,
                        accountId: userId,
                        metadata,
                        metadataVersion: 1,
                        daemonState: daemonState || null,
                        daemonStateVersion: daemonState ? 1 : 0,
                        dataEncryptionKey: dataEncryptionKey ? privacyKit.decodeBase64(dataEncryptionKey) : undefined,
                        // Default to offline - in case the user does not start daemon
                        active: false,
                        // lastActiveAt and activeAt defaults to now() in schema
                    }
                });

                afterTx(tx, async () => {
                    // Emit both new-machine and update-machine events for backward compatibility
                    const updSeq1 = await allocateUserSeq(userId);
                    const updSeq2 = await allocateUserSeq(userId);

                    // Emit new-machine event with all data including dataEncryptionKey
                    const newMachinePayload = buildNewMachineUpdate(newMachine, updSeq1, randomKeyNaked(12));
                    eventRouter.emitUpdate({
                        userId,
                        payload: newMachinePayload,
                        recipientFilter: { type: 'user-scoped-only' }
                    });

                    // Emit update-machine event for backward compatibility (without dataEncryptionKey)
                    const machineMetadata = {
                        version: 1,
                        value: metadata
                    };
                    const updatePayload = buildUpdateMachineUpdate(newMachine.id, updSeq2, randomKeyNaked(12), machineMetadata);
                    eventRouter.emitUpdate({
                        userId,
                        payload: updatePayload,
                        recipientFilter: { type: 'machine-scoped-only', machineId: newMachine.id }
                    });
                });

                return { type: 'new' as const, machine: newMachine };
            }
        });

        const m = result.machine;
        return reply.send({
            machine: {
                id: m.id,
                metadata: m.metadata,
                metadataVersion: m.metadataVersion,
                daemonState: m.daemonState,
                daemonStateVersion: m.daemonStateVersion,
                dataEncryptionKey: m.dataEncryptionKey ? privacyKit.encodeBase64(m.dataEncryptionKey) : null,
                active: m.active,
                activeAt: m.lastActiveAt.getTime(),  // Return as activeAt for API consistency
                createdAt: m.createdAt.getTime(),
                updatedAt: m.updatedAt.getTime()
            }
        });
    });


    // Machines API
    app.get('/v1/machines', {
        preHandler: app.authenticate,
    }, async (request, reply) => {
        const userId = request.userId;

        const machines = await db.machine.findMany({
            where: { accountId: userId },
            orderBy: { lastActiveAt: 'desc' }
        });

        return machines.map(m => ({
            id: m.id,
            metadata: m.metadata,
            metadataVersion: m.metadataVersion,
            daemonState: m.daemonState,
            daemonStateVersion: m.daemonStateVersion,
            dataEncryptionKey: m.dataEncryptionKey ? privacyKit.encodeBase64(m.dataEncryptionKey) : null,
            seq: m.seq,
            active: m.active,
            activeAt: m.lastActiveAt.getTime(),
            createdAt: m.createdAt.getTime(),
            updatedAt: m.updatedAt.getTime()
        }));
    });

    // GET /v1/machines/:id - Get single machine by ID
    app.get('/v1/machines/:id', {
        preHandler: app.authenticate,
        schema: {
            params: z.object({
                id: z.string()
            })
        }
    }, async (request, reply) => {
        const userId = request.userId;
        const { id } = request.params;

        const machine = await db.machine.findFirst({
            where: {
                accountId: userId,
                id: id
            }
        });

        if (!machine) {
            return reply.code(404).send({ error: 'Machine not found' });
        }

        return {
            machine: {
                id: machine.id,
                metadata: machine.metadata,
                metadataVersion: machine.metadataVersion,
                daemonState: machine.daemonState,
                daemonStateVersion: machine.daemonStateVersion,
                dataEncryptionKey: machine.dataEncryptionKey ? privacyKit.encodeBase64(machine.dataEncryptionKey) : null,
                seq: machine.seq,
                active: machine.active,
                activeAt: machine.lastActiveAt.getTime(),
                createdAt: machine.createdAt.getTime(),
                updatedAt: machine.updatedAt.getTime()
            }
        };
    });

    // DELETE /v1/machines/:id - Remove a machine and its access keys.
    // Sessions spawned by this machine are preserved so history is not lost.
    app.delete('/v1/machines/:id', {
        preHandler: app.authenticate,
        schema: {
            params: z.object({
                id: z.string()
            })
        }
    }, async (request, reply) => {
        const userId = request.userId;
        const { id } = request.params;

        const deleted = await inTx(async (tx) => {
            const machine = await tx.machine.findFirst({
                where: { accountId: userId, id }
            });
            if (!machine) {
                return false;
            }

            await tx.accessKey.deleteMany({
                where: { accountId: userId, machineId: id }
            });

            await tx.machine.delete({
                where: { id }
            });

            afterTx(tx, async () => {
                const updSeq = await allocateUserSeq(userId);
                const updatePayload = buildDeleteMachineUpdate(id, updSeq, randomKeyNaked(12));
                eventRouter.emitUpdate({
                    userId,
                    payload: updatePayload,
                    recipientFilter: { type: 'user-scoped-only' }
                });
                log({ module: 'machines', machineId: id, userId }, 'Machine deleted');
            });

            return true;
        });

        if (!deleted) {
            return reply.code(404).send({ error: 'Machine not found' });
        }

        return reply.send({ success: true });
    });

}