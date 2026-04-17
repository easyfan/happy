import { db } from '@/storage/db';
import { inTx } from '@/storage/inTx';

/**
 * Handles GET /v1/uploads/pending — returns notified=false PendingUploads for a CLI session.
 *
 * At-least-once semantics (current): query + mark notified=true in a single transaction.
 * If CLI crashes between receiving the list and writing to disk, those uploads are NOT
 * re-delivered because notified is already true. CLI must call DELETE after successful
 * local write to confirm consumption.
 *
 * Only returns direction='app_to_cli' records — CLI only handles App-to-CLI transfers.
 * If sessionId is provided, filters to that session; otherwise returns all pending for
 * the account (used when CLI connects without knowing which sessions have pending files).
 *
 * The query + update runs inside a serializable transaction to prevent duplicate delivery
 * when CLI reconnects concurrently on multiple processes.
 */
export async function uploadPendingList(
    accountId: string,
    sessionId?: string,
): Promise<Array<{
    uploadId: string;
    sessionId: string;
    encryptedMeta: string;
    createdAt: number;
}>> {
    return inTx(async (tx) => {
        const where = {
            accountId,
            notified: false,
            direction: 'app_to_cli' as const,
            expiresAt: { gt: new Date() },
            ...(sessionId ? { sessionId } : {}),
        };

        const uploads = await tx.pendingUpload.findMany({
            where,
            select: {
                uploadId: true,
                sessionId: true,
                encryptedMeta: true,
                createdAt: true,
            },
            orderBy: { createdAt: 'asc' },
        });

        if (uploads.length === 0) {
            return [];
        }

        // Mark all returned records as notified=true atomically
        await tx.pendingUpload.updateMany({
            where: {
                uploadId: { in: uploads.map((u) => u.uploadId) },
            },
            data: { notified: true },
        });

        return uploads.map((u) => ({
            uploadId: u.uploadId,
            sessionId: u.sessionId,
            encryptedMeta: u.encryptedMeta,
            createdAt: u.createdAt.getTime(),
        }));
    });
}
