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

/**
 * Extract uploadId from a local path of the form:
 *   <uploadDir>/<uploadId>-<filename>
 *
 * This is the single source of truth for uploadId extraction across the codebase.
 * Used both internally by PendingAttachmentsQueue and externally by runClaude.ts
 * for set-difference computation when building the attachment suffix.
 */
export function extractUploadIdFromPath(localPath: string): string {
    const base = localPath.split('/').pop() ?? '';
    const dashIdx = base.indexOf('-');
    return dashIdx >= 0 ? base.slice(0, dashIdx) : base;
}

export class PendingAttachmentsQueue {
    private queues = new Map<string, PendingAttachment[]>();

    /**
     * Add an attachment to the queue for the given session.
     * Idempotent: if an attachment with the same uploadId is already queued,
     * the duplicate is silently dropped (guards against RPC retry double-enqueue).
     */
    enqueue(sessionId: string, attachment: PendingAttachment): void {
        if (!this.queues.has(sessionId)) {
            this.queues.set(sessionId, []);
        }
        const queue = this.queues.get(sessionId)!;
        const uploadId = extractUploadIdFromPath(attachment.localPath);
        if (queue.some(a => extractUploadIdFromPath(a.localPath) === uploadId)) {
            process.stderr.write(`[pendingAttachments] duplicate enqueue ignored for uploadId: ${uploadId}\n`);
            return;
        }
        queue.push(attachment);
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
     * Wait until all specified uploadIds have been enqueued for the session,
     * then dequeue and return them (plus any extras already in the queue).
     *
     * Polls every 50ms up to timeoutMs. On timeout, logs a warning and returns
     * whatever is already queued — never throws, never blocks the message loop.
     */
    async waitForUploadIds(
        sessionId: string,
        uploadIds: string[],
        timeoutMs = 30000,
    ): Promise<PendingAttachment[]> {
        if (uploadIds.length === 0) {
            return this.dequeueAll(sessionId);
        }

        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            const queued = this.queues.get(sessionId) ?? [];
            const queuedIds = new Set(queued.map(a => extractUploadIdFromPath(a.localPath)));
            const allReady = uploadIds.every(id => queuedIds.has(id));
            if (allReady) {
                return this.dequeueAll(sessionId);
            }
            await new Promise(resolve => setTimeout(resolve, 50));
        }

        // Timeout — return whatever arrived, don't block the session
        const queued = this.queues.get(sessionId) ?? [];
        const missing = uploadIds.filter(id => {
            return !queued.some(a => extractUploadIdFromPath(a.localPath) === id);
        });
        if (missing.length > 0) {
            // Log to stderr so it appears in daemon logs without disrupting output
            process.stderr.write(`[pendingAttachments] waitForUploadIds timeout after ${timeoutMs}ms, missing: ${missing.join(', ')}\n`);
        }
        return this.dequeueAll(sessionId);
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
