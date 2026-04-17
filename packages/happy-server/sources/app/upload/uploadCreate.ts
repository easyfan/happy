import { db } from '@/storage/db';
import { inTx } from '@/storage/inTx';
import { putLocalFile, s3client, s3bucket, isLocalStorage } from '@/storage/files';

/**
 * Handles POST /v1/uploads — idempotent upsert of PendingUpload record + blob storage.
 *
 * Flow:
 * 1. Check if uploadId already exists; if so, return early (idempotent).
 * 2. Validate sizeBytes <= 10MB (server-side enforcement).
 * 3. Decode encryptedBlob (Base64) and write to storage (local or S3).
 *    Storage path: uploads/<accountId>/<uploadId>
 *    File writes are intentionally outside the DB transaction.
 * 4. Upsert PendingUpload record in a DB transaction.
 *    encryptedMeta column stores JSON: { nonce, metaNonce, encryptedMeta } — all Base64.
 *    expiresAt = now + 24h, notified = false (initial state).
 *
 * Idempotency: if uploadId already exists in DB, blob write and DB upsert are both skipped.
 * If DB fails after blob write, blob becomes an orphan (24h TTL cleanup handles this).
 */
export async function uploadCreate(
    accountId: string,
    params: {
        uploadId: string;
        encryptedBlob: string;
        nonce: string;
        encryptedMeta: string;
        metaNonce: string;
        mimeType: string;
        sizeBytes: number;
        sessionId: string;
        direction: 'app_to_cli' | 'cli_to_app';
    },
): Promise<void> {
    const MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

    if (params.sizeBytes > MAX_SIZE_BYTES) {
        throw Object.assign(new Error('FILE_TOO_LARGE'), { statusCode: 400 });
    }

    // Check idempotency: if record already exists, skip blob write and DB upsert
    const existing = await db.pendingUpload.findUnique({
        where: { uploadId: params.uploadId },
        select: { uploadId: true },
    });

    if (existing) {
        return;
    }

    // Decode Base64 blob and write to storage
    const blobBuffer = Buffer.from(params.encryptedBlob, 'base64');
    const storagePath = `uploads/${accountId}/${params.uploadId}`;

    if (isLocalStorage()) {
        await putLocalFile(storagePath, blobBuffer);
    } else {
        await s3client.putObject(s3bucket, storagePath, blobBuffer, blobBuffer.length, {
            'Content-Type': 'application/octet-stream',
        });
    }

    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // +24h

    // Serialize nonce + metaNonce + encryptedMeta into a single column as JSON
    const metaEnvelope = JSON.stringify({
        nonce: params.nonce,
        metaNonce: params.metaNonce,
        encryptedMeta: params.encryptedMeta,
    });

    await inTx(async (tx) => {
        await tx.pendingUpload.upsert({
            where: { uploadId: params.uploadId },
            create: {
                uploadId: params.uploadId,
                accountId,
                sessionId: params.sessionId,
                encryptedMeta: metaEnvelope,
                sizeBytes: params.sizeBytes,
                direction: params.direction,
                notified: false,
                expiresAt,
            },
            update: {
                // On race-condition retry after blob already written, update non-sensitive fields.
                sessionId: params.sessionId,
                sizeBytes: params.sizeBytes,
                direction: params.direction,
                expiresAt,
            },
        });
    });
}
