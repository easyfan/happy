/**
 * HTTP layer for file upload/download operations.
 *
 * POST /v1/uploads — upload an encrypted file blob + meta
 * DELETE /v1/uploads/:id — cancel/delete an upload
 * GET /v1/uploads/:id — download an encrypted file blob + meta
 *
 * All uploads are end-to-end encrypted before hitting the wire.
 * The server only sees ciphertexts; it never decrypts.
 */

import { apiSocket } from './apiSocket';
import { encryptFileForUpload, encryptMetaForUpload } from './fileEncryption';
import { TokenStorage } from '@/auth/tokenStorage';

// uploadId generator — Math.random-based cuid2 substitute (cuid2 may not be in the app bundle).
// Generates a 24-character url-safe random string with a 'f' prefix (for 'file').
function generateUploadId(): string {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let id = 'f';
    for (let i = 0; i < 23; i++) {
        id += chars[Math.floor(Math.random() * chars.length)];
    }
    return id;
}

export type AttachmentRef = {
    uploadId: string;
    filename: string;
    mimeType: string;
    sizeBytes: number;
};

/**
 * Upload a file to the server (App → Server).
 *
 * Uses XMLHttpRequest for upload progress support (native fetch has no
 * onUploadProgress). Returns the uploadId on success.
 */
export async function uploadFile(
    sessionKey: Uint8Array,
    file: {
        bytes: Uint8Array;
        filename: string;
        mimeType: string;
        sizeBytes: number;
    },
    sessionId: string,
    onProgress?: (percent: number) => void,
): Promise<string> {
    const uploadId = generateUploadId();

    const { encryptedBlob, nonce } = encryptFileForUpload(file.bytes, sessionKey);
    // Meta uses an independent nonce — must NOT reuse the blob nonce
    const { encryptedMeta, metaNonce } = encryptMetaForUpload(
        { filename: file.filename, mimeType: file.mimeType, sizeBytes: file.sizeBytes },
        sessionKey,
    );

    const credentials = await TokenStorage.getCredentials();
    if (!credentials) {
        throw new Error('No authentication credentials');
    }

    const endpoint = (apiSocket as any).config?.endpoint as string | undefined;
    if (!endpoint) {
        throw new Error('ApiSocket not initialized');
    }

    const url = `${endpoint}/v1/uploads`;
    const body = JSON.stringify({
        uploadId,
        encryptedBlob,
        nonce,
        encryptedMeta,
        metaNonce,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes,
        sessionId,
        direction: 'app_to_cli',
    });

    await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', url);
        xhr.setRequestHeader('Content-Type', 'application/json');
        xhr.setRequestHeader('Authorization', `Bearer ${credentials.token}`);

        if (onProgress) {
            xhr.upload.onprogress = (e) => {
                if (e.lengthComputable) {
                    onProgress(Math.round((e.loaded / e.total) * 100));
                }
            };
        }

        xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
                resolve();
            } else {
                let errorMsg = `Upload failed: ${xhr.status}`;
                try {
                    const parsed = JSON.parse(xhr.responseText);
                    if (parsed.error) errorMsg = parsed.error;
                } catch {
                    // ignore parse error
                }
                reject(new Error(errorMsg));
            }
        };

        xhr.onerror = () => reject(new Error('Network error during upload'));
        xhr.ontimeout = () => reject(new Error('Upload timed out'));
        xhr.send(body);
    });

    return uploadId;
}

/**
 * Cancel an in-flight or completed upload (before it is sent in a message).
 * Idempotent — safe to call even if the upload no longer exists.
 */
export async function cancelUpload(uploadId: string): Promise<void> {
    try {
        await apiSocket.request(`/v1/uploads/${uploadId}`, { method: 'DELETE' });
    } catch {
        // Idempotent — ignore errors (e.g. already deleted)
    }
}

/**
 * Download the encrypted blob + nonces for an upload (CLI → App direction).
 */
export async function downloadUpload(
    uploadId: string,
    sessionId: string,
): Promise<{
    encryptedBlob: string;
    nonce: string;
    encryptedMeta: string;
    metaNonce: string;
}> {
    const response = await apiSocket.request(
        `/v1/uploads/${uploadId}?sessionId=${encodeURIComponent(sessionId)}`,
    );
    if (!response.ok) {
        throw new Error(`Download failed: ${response.status}`);
    }
    return response.json();
}
