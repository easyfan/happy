import { db } from '@/storage/db';
import { getLocalFilesDir, s3client, s3bucket, isLocalStorage } from '@/storage/files';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Handles GET /v1/uploads/:uploadId — returns encrypted blob + nonces + meta for CLI or App to decrypt.
 *
 * Security checks:
 *   upload.accountId === accountId  (prevents cross-account access)
 *   upload.sessionId === sessionId  (validates CLI session ownership)
 *   upload.expiresAt > now          (rejects expired uploads)
 *
 * On success, updates downloadedAt to record first download time (informational only).
 * Does NOT delete the record — CLI calls DELETE after successful local write.
 *
 * Returns null if not found, expired, or ownership check fails.
 */
export async function uploadGet(
    accountId: string,
    uploadId: string,
    sessionId: string,
): Promise<{
    encryptedBlob: string;
    nonce: string;
    encryptedMeta: string;
    metaNonce: string;
    direction: 'app_to_cli' | 'cli_to_app';
} | null> {
    const upload = await db.pendingUpload.findUnique({
        where: { uploadId },
    });

    if (!upload) {
        return null;
    }

    if (upload.accountId !== accountId) {
        return null;
    }

    if (upload.sessionId !== sessionId) {
        return null;
    }

    if (upload.expiresAt <= new Date()) {
        return null;
    }

    // Mark downloadedAt on first access (fire-and-forget, non-critical)
    if (!upload.downloadedAt) {
        db.pendingUpload.update({
            where: { uploadId },
            data: { downloadedAt: new Date() },
        }).catch(() => {});
    }

    // Read the blob from storage
    const storagePath = `uploads/${accountId}/${uploadId}`;
    let blobBuffer: Buffer;

    if (isLocalStorage()) {
        const fullPath = path.join(getLocalFilesDir(), storagePath);
        blobBuffer = fs.readFileSync(fullPath);
    } else {
        const stream = await s3client.getObject(s3bucket, storagePath);
        blobBuffer = await new Promise<Buffer>((resolve, reject) => {
            const chunks: Buffer[] = [];
            stream.on('data', (chunk: Buffer) => chunks.push(chunk));
            stream.on('end', () => resolve(Buffer.concat(chunks)));
            stream.on('error', reject);
        });
    }

    const encryptedBlob = blobBuffer.toString('base64');

    // Parse nonce envelope from encryptedMeta column
    const envelope = JSON.parse(upload.encryptedMeta) as {
        nonce: string;
        metaNonce: string;
        encryptedMeta: string;
    };

    return {
        encryptedBlob,
        nonce: envelope.nonce,
        encryptedMeta: envelope.encryptedMeta,
        metaNonce: envelope.metaNonce,
        direction: upload.direction as 'app_to_cli' | 'cli_to_app',
    };
}
