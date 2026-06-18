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

import { getRandomBytes } from 'expo-crypto';
import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { apiSocket } from './apiSocket';
import { encryptFileForUpload, encryptMetaForUpload } from './fileEncryption';
import { TokenStorage } from '@/auth/tokenStorage';
import { NotFoundError } from '@/utils/errors';
import { encodeBase64 } from '@/encryption/base64';

/** Subdirectory under documentDirectory used to cache sent-image thumbnails. */
const THUMBNAILS_DIR = 'thumbnails/';

/**
 * Compute the local path for a sent-image thumbnail.
 * Returns null on web (no documentDirectory available).
 */
export function getThumbnailLocalPath(uploadId: string, ext: string): string | null {
    if (Platform.OS === 'web') return null;
    if (!FileSystem.documentDirectory) return null;
    return `${FileSystem.documentDirectory}${THUMBNAILS_DIR}${uploadId}.${ext}`;
}

/**
 * Persist a copy of sent image bytes to documentDirectory so that
 * AttachmentChip can render a thumbnail after the server-side upload
 * record is deleted by the CLI.
 *
 * - Only runs on iOS/Android (Platform.OS !== 'web').
 * - Silently swallows any error so failures never block the send path.
 * - Uses documentDirectory (persists across reboots, survives OS cache evictions).
 */
export async function saveThumbnailLocally(
    uploadId: string,
    ext: string,
    imageBytes: Uint8Array,
): Promise<void> {
    if (Platform.OS === 'web') return;
    if (!FileSystem.documentDirectory) return;
    try {
        const dir = `${FileSystem.documentDirectory}${THUMBNAILS_DIR}`;
        await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
        const filePath = `${dir}${uploadId}.${ext}`;
        await FileSystem.writeAsStringAsync(filePath, encodeBase64(imageBytes), {
            encoding: FileSystem.EncodingType.Base64,
        });
    } catch {
        // Silently degrade — thumbnail unavailability is cosmetic only
    }
}

/**
 * Delete a locally-cached thumbnail (e.g. when upload is cancelled).
 * Silently swallows errors.
 */
export async function deleteThumbnailLocally(uploadId: string, ext: string): Promise<void> {
    if (Platform.OS === 'web') return;
    const path = getThumbnailLocalPath(uploadId, ext);
    if (!path) return;
    try {
        const info = await FileSystem.getInfoAsync(path);
        if (info.exists) {
            await FileSystem.deleteAsync(path, { idempotent: true });
        }
    } catch {
        // Silently ignore
    }
}

/**
 * Scan the thumbnails directory and delete files older than 30 days,
 * keeping at most the newest `maxFiles` files.
 *
 * Called once at app startup (sync initialisation) — errors are suppressed
 * so startup is never blocked.
 */
export async function cleanupOldThumbnails(maxFiles = 200): Promise<void> {
    if (Platform.OS === 'web') return;
    if (!FileSystem.documentDirectory) return;
    try {
        const dir = `${FileSystem.documentDirectory}${THUMBNAILS_DIR}`;
        const dirInfo = await FileSystem.getInfoAsync(dir);
        if (!dirInfo.exists) return;

        const files = await FileSystem.readDirectoryAsync(dir);
        if (files.length === 0) return;

        const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;

        // Gather modification times.
        // modificationTime is typed as optional in expo-file-system — treat undefined
        // as "unknown age" and never delete that file (conservative: prefer accumulation
        // over accidental deletion of a thumbnail the user may still need).
        const entries = await Promise.all(
            files.map(async (name) => {
                const path = `${dir}${name}`;
                try {
                    const info = await FileSystem.getInfoAsync(path, { md5: false });
                    const rawMod = info.exists ? (info as any).modificationTime : undefined;
                    // Keep as undefined when not available so downstream guards treat it as "keep".
                    const modTime: number | undefined =
                        typeof rawMod === 'number' && rawMod > 0 ? rawMod : undefined;
                    return { path, modTime };
                } catch {
                    return { path, modTime: undefined as number | undefined };
                }
            }),
        );

        // Delete files older than 30 days.
        // Skip entries whose modTime is undefined — conservative: unknown age → keep.
        for (const entry of entries) {
            if (entry.modTime !== undefined && entry.modTime * 1000 < thirtyDaysAgo) {
                try { await FileSystem.deleteAsync(entry.path, { idempotent: true }); } catch { /* ignore */ }
            }
        }

        // Keep at most `maxFiles` newest files (sort descending by modTime).
        // Entries with undefined modTime sort to the end (treated as oldest) so they
        // are candidates for eviction only when the directory is very full — still
        // preferable to silently deleting files we know are fresh.
        const remaining = entries.filter(e =>
            e.modTime === undefined || e.modTime * 1000 >= thirtyDaysAgo,
        );
        if (remaining.length > maxFiles) {
            // undefined modTime sorts to end (value 0) so those files are evicted last.
            remaining.sort((a, b) => (b.modTime ?? 0) - (a.modTime ?? 0));
            const toDelete = remaining.slice(maxFiles);
            for (const entry of toDelete) {
                try { await FileSystem.deleteAsync(entry.path, { idempotent: true }); } catch { /* ignore */ }
            }
        }
    } catch {
        // Never block startup
    }
}

// uploadId generator — crypto-random, 24-character url-safe string with 'f' prefix.
function generateUploadId(): string {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    const randomBytes = getRandomBytes(23);
    let id = 'f';
    for (let i = 0; i < 23; i++) {
        id += chars[randomBytes[i] % chars.length];
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

    // Persist a local thumbnail copy for images so that AttachmentChip can render
    // the thumbnail after the server-side upload record has been deleted by the CLI.
    // Fire-and-forget: failure must never surface to the caller.
    if (file.mimeType.startsWith('image/')) {
        const ext = file.filename.includes('.') ? file.filename.split('.').pop()! : 'bin';
        saveThumbnailLocally(uploadId, ext, file.bytes);
    }

    return uploadId;
}

/**
 * Cancel an in-flight or completed upload (before it is sent in a message).
 * Idempotent — safe to call even if the upload no longer exists.
 *
 * @param filename - If provided together with uploadId, any locally-cached
 *   thumbnail for this upload will also be deleted.
 */
export async function cancelUpload(uploadId: string, filename?: string): Promise<void> {
    try {
        await apiSocket.request(`/v1/uploads/${uploadId}`, { method: 'DELETE' });
    } catch {
        // Idempotent — ignore errors (e.g. already deleted)
    }
    // Also remove any locally-persisted thumbnail.
    if (filename) {
        const ext = filename.includes('.') ? filename.split('.').pop()! : 'bin';
        deleteThumbnailLocally(uploadId, ext);
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
        if (response.status === 404) {
            throw new NotFoundError(`Upload not found: ${uploadId}`);
        }
        throw new Error(`Download failed: ${response.status}`);
    }
    return response.json();
}
