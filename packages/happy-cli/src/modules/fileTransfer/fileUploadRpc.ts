/**
 * RPC handler for 'file:upload' — invoked by the App when it has uploaded a file
 * to the server and wants the CLI to download, decrypt, and queue it for injection.
 *
 * The RPC method name is prefixed by RpcHandlerManager with the session ID:
 *   registered as  'file:upload'
 *   wire name      '<sessionId>:file:upload'
 *   App calls via  apiSocket.sessionRPC(sessionId, 'file:upload', params)
 *
 * processUpload is exported for reuse by fetchPendingUploads in apiSession.ts.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { RpcHandlerManager } from '@/api/rpc/RpcHandlerManager';
import { configuration } from '@/configuration';
import { logger } from '@/ui/logger';
import { filesApiClient } from './filesApiClient';
import { decryptFileBlob, decryptFileMeta } from './fileEncryption';
import { type PendingAttachmentsQueue } from './pendingAttachments';

interface FileUploadRpcParams {
    uploadId: string;
    filename: string;
    mimeType: string;
    sizeBytes: number;
}

interface FileUploadRpcResult {
    success: boolean;
    error?: string;
}

/**
 * Download, decrypt, save, and enqueue a single upload.
 * Shared by the RPC handler and the pending-uploads fetch on connect.
 */
export async function processUpload(
    token: string,
    sessionId: string,
    encryptionKey: Uint8Array,
    pendingAttachments: PendingAttachmentsQueue,
    params: FileUploadRpcParams,
): Promise<FileUploadRpcResult> {
    const response = await filesApiClient.get(token, params.uploadId, sessionId);
    if (!response) {
        logger.debug('[fileUpload] Upload not found or expired', params.uploadId);
        return { success: false, error: 'Upload not found or expired' };
    }

    const decryptedBytes = decryptFileBlob(response.encryptedBlob, response.nonce, encryptionKey);
    if (!decryptedBytes) {
        logger.debug('[fileUpload] Blob decryption failed for', params.uploadId);
        return { success: false, error: 'Blob decryption failed' };
    }

    const meta = decryptFileMeta(response.encryptedMeta, response.metaNonce, encryptionKey);
    const filename = meta?.filename ?? params.filename;
    const mimeType = meta?.mimeType ?? params.mimeType;
    const sizeBytes = meta?.sizeBytes ?? params.sizeBytes;

    const uploadDir = path.join(configuration.happyHomeDir, 'uploads', sessionId);
    await fs.mkdir(uploadDir, { recursive: true });
    const localPath = path.join(uploadDir, `${params.uploadId}-${filename}`);
    await fs.writeFile(localPath, Buffer.from(decryptedBytes));
    logger.debug('[fileUpload] File saved to', localPath);

    // Consume confirmation — idempotent if it fails
    await filesApiClient.delete(token, params.uploadId).catch((err) => {
        logger.debug('[fileUpload] DELETE confirmation failed (non-fatal)', err?.message);
    });

    pendingAttachments.enqueue(sessionId, {
        localPath,
        filename,
        mimeType,
        sizeBytes,
    });

    return { success: true };
}

/**
 * Registers the 'file:upload' RPC handler on the given RpcHandlerManager.
 *
 * Flow:
 *   1. GET /v1/uploads/:uploadId?sessionId=<sessionId> — fetch encrypted blob + nonces
 *   2. Decrypt blob using session encryption key and blob nonce
 *   3. Decrypt meta using session encryption key and meta nonce (independent nonce)
 *   4. Write decrypted bytes to ~/.happy[-dev]/uploads/<sessionId>/<uploadId>-<filename>
 *   5. DELETE /v1/uploads/:uploadId — consume confirmation
 *   6. Push localPath into pendingAttachments queue for next-message injection
 */
export function registerFileUploadRpcHandler(
    rpcHandlerManager: RpcHandlerManager,
    sessionId: string,
    encryptionKey: Uint8Array,
    token: string,
    pendingAttachments: PendingAttachmentsQueue,
): void {
    rpcHandlerManager.registerHandler<FileUploadRpcParams, FileUploadRpcResult>(
        'file:upload',
        async (params) => {
            logger.debug('[fileUpload] RPC received', params);
            return processUpload(token, sessionId, encryptionKey, pendingAttachments, params);
        },
    );
}
