import { db } from '@/storage/db';
import { getLocalFilesDir, s3client, s3bucket, isLocalStorage } from '@/storage/files';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Handles DELETE /v1/uploads/:uploadId — idempotent delete of PendingUpload record + blob.
 *
 * Flow:
 * 1. Look up the record; if not found, return silently (idempotent).
 * 2. Verify accountId ownership — return 403 if mismatch.
 * 3. Delete blob from storage (local or S3); ignore storage errors (orphan cleanup handled by TTL).
 * 4. Delete DB record.
 *
 * Called by CLI after successful local write (consume confirmation),
 * or by App when user cancels a pending attachment.
 */
export async function uploadDelete(
    accountId: string,
    uploadId: string,
): Promise<void> {
    const upload = await db.pendingUpload.findUnique({
        where: { uploadId },
        select: { accountId: true },
    });

    if (!upload) {
        // Idempotent — not found means already deleted
        return;
    }

    if (upload.accountId !== accountId) {
        throw Object.assign(new Error('FORBIDDEN'), { statusCode: 403 });
    }

    // Delete blob (best-effort, TTL handles orphans)
    const storagePath = `uploads/${accountId}/${uploadId}`;
    try {
        if (isLocalStorage()) {
            const fullPath = path.join(getLocalFilesDir(), storagePath);
            fs.unlinkSync(fullPath);
        } else {
            await s3client.removeObject(s3bucket, storagePath);
        }
    } catch {
        // Storage deletion is best-effort; TTL lifecycle rules handle orphaned blobs
    }

    await db.pendingUpload.delete({
        where: { uploadId },
    });
}
