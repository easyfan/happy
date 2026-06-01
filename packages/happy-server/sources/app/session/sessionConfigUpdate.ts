import { Context } from "@/context";
import { inTx } from "@/storage/inTx";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Input schema (also used by sessionRoutes.ts for body validation)
// ---------------------------------------------------------------------------
export const SessionConfigUpdateBodySchema = z.object({
    permissionMode: z.string().nullish(),
    modelMode: z.string().nullish(),
}).refine(
    (data) => data.permissionMode !== undefined || data.modelMode !== undefined,
    { message: "At least one field must be provided" }
);

export type SessionConfigUpdateBody = z.infer<typeof SessionConfigUpdateBodySchema>;

/**
 * Update session configuration fields (permissionMode, modelMode).
 *
 * Logic:
 * - Uses inTx to wrap the DB update for consistency.
 * - Uses updateMany with accountId guard to ensure the session belongs to the user.
 * - Returns true if the session was found and updated, false if not found (404 case).
 * - No afterTx event is emitted: this is a best-effort PATCH with last-write-wins
 *   semantics; other devices pick up the change on the next fetchSessions call.
 * - null values are stored as-is, clearing the previous configuration.
 *
 * @param ctx       - Request context (contains uid)
 * @param sessionId - Target session ID (cuid)
 * @param body      - Validated update payload (at least one field required)
 * @returns true if updated, false if session not found or not owned by user
 */
export async function sessionConfigUpdate(
    ctx: Context,
    sessionId: string,
    body: SessionConfigUpdateBody,
): Promise<boolean> {
    return await inTx(async (tx) => {
        const data: { permissionMode?: string | null; modelMode?: string | null } = {};

        if (body.permissionMode !== undefined) {
            data.permissionMode = body.permissionMode ?? null;
        }
        if (body.modelMode !== undefined) {
            data.modelMode = body.modelMode ?? null;
        }

        const result = await tx.session.updateMany({
            where: {
                id: sessionId,
                accountId: ctx.uid,
            },
            data,
        });

        return result.count > 0;
    });
}
