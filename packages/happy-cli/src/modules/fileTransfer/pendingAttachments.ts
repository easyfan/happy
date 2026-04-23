/**
 * Per-session FIFO queue for attachments that have been downloaded and decrypted
 * from the server but not yet injected into a Claude message.
 *
 * Lifecycle:
 *   enqueue  — called by fileUploadRpc handler after successful local write
 *   dequeueAll — called before sending a user message to attach files to the request
 *   cleanupSession — called when the session loop exits; deletes all temp files and the queue
 *
 * This is a process-singleton (one instance per CLI process).
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { configuration } from '@/configuration';

export interface PendingAttachment {
    /** Absolute local path: ~/.happy[-dev]/uploads/<sessionId>/<uploadId>-<filename> */
    localPath: string;
    filename: string;
    mimeType: string;
    sizeBytes: number;
}

export class PendingAttachmentsQueue {
    private queues = new Map<string, PendingAttachment[]>();

    /**
     * Add an attachment to the queue for the given session.
     */
    enqueue(sessionId: string, attachment: PendingAttachment): void {
        if (!this.queues.has(sessionId)) {
            this.queues.set(sessionId, []);
        }
        this.queues.get(sessionId)!.push(attachment);
    }

    /**
     * Remove and return all pending attachments for the session.
     * Clears the queue after draining — consumers are responsible for deleting local files.
     */
    dequeueAll(sessionId: string): PendingAttachment[] {
        const items = this.queues.get(sessionId) ?? [];
        this.queues.set(sessionId, []);
        return items;
    }

    /**
     * Delete all queued attachments and the upload directory for the session.
     * Called when the session loop exits.
     */
    async cleanupSession(sessionId: string): Promise<void> {
        this.queues.delete(sessionId);
        const uploadDir = path.join(configuration.happyHomeDir, 'uploads', sessionId);
        await fs.rm(uploadDir, { recursive: true, force: true });
    }
}

/** Process-level singleton shared between apiSession and the loop. */
export const pendingAttachments = new PendingAttachmentsQueue();
