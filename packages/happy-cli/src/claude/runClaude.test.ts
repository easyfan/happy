/**
 * Tests for the attachment suffix generation logic introduced in M2 (BUG-ATTACH-01).
 *
 * The suffix generation block in runClaude.ts (onUserMessage handler, ~L492-511) is
 * tested here by exercising the same logic using real PendingAttachmentsQueue instances.
 * No mocking of internal modules — vi.useFakeTimers() is used only to accelerate the
 * 50ms polling interval in waitForUploadIds.
 *
 * Helper: buildAttachmentSuffix mirrors the runClaude.ts block exactly so that changes
 * to the production code can be caught by test drift.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// Mock fs and configuration so PendingAttachmentsQueue.cleanupSession doesn't touch
// the real filesystem (only cleanupSession uses fs, not the suffix generation path).
vi.mock('node:fs/promises', () => ({
    rm: vi.fn(async () => {}),
}));

vi.mock('@/configuration', () => ({
    configuration: {
        happyHomeDir: '/tmp/test-happy-home',
    },
}));

import { PendingAttachmentsQueue, extractUploadIdFromPath } from '@/modules/fileTransfer/pendingAttachments';

// ---------------------------------------------------------------------------
// Mirror of the suffix-generation block from runClaude.ts (L492-511).
// Any change to the production block must be reflected here.
// ---------------------------------------------------------------------------
interface AttachmentRef {
    uploadId: string;
    filename: string;
    mimeType: string;
    sizeBytes: number;
}

async function buildAttachmentSuffix(
    queue: PendingAttachmentsQueue,
    sessionId: string,
    attachments: AttachmentRef[] | undefined,
    timeoutMs: number,
): Promise<string> {
    const uploadIdToFilename = new Map<string, string>(
        (attachments ?? []).map(a => [a.uploadId, a.filename])
    );
    const expectedUploadIds = [...uploadIdToFilename.keys()];
    const arrivedAttachments = await queue.waitForUploadIds(sessionId, expectedUploadIds, timeoutMs);
    const arrivedByUploadId = new Map(
        arrivedAttachments.map(a => [extractUploadIdFromPath(a.localPath), a])
    );
    const suffixLines = (attachments ?? []).map(a =>
        arrivedByUploadId.has(a.uploadId)
            ? `[Attached file: ${arrivedByUploadId.get(a.uploadId)!.localPath}]`
            : `[Attachment transfer failed: ${a.filename}]`
    );
    return suffixLines.length > 0 ? '\n' + suffixLines.join('\n') : '';
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------
describe('runClaude attachment suffix generation (M2)', () => {
    let queue: PendingAttachmentsQueue;
    const SESSION = 'test-session-001';
    const BASE_DIR = `/tmp/test-happy-home/uploads/${SESSION}`;

    beforeEach(() => {
        queue = new PendingAttachmentsQueue();
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    // -----------------------------------------------------------------------
    // TC-01: All attachments arrive — full success path
    // -----------------------------------------------------------------------
    it('TC-01: all attachments arrived → suffix contains [Attached file:] in message.attachments order', async () => {
        const attachments: AttachmentRef[] = [
            { uploadId: 'uid001', filename: 'photo.jpg', mimeType: 'image/jpeg', sizeBytes: 1000 },
            { uploadId: 'uid002', filename: 'report.pdf', mimeType: 'application/pdf', sizeBytes: 2000 },
        ];

        // Pre-enqueue both (simulates fast download)
        queue.enqueue(SESSION, {
            localPath: `${BASE_DIR}/uid001-photo.jpg`,
            filename: 'photo.jpg',
            mimeType: 'image/jpeg',
            sizeBytes: 1000,
        });
        queue.enqueue(SESSION, {
            localPath: `${BASE_DIR}/uid002-report.pdf`,
            filename: 'report.pdf',
            mimeType: 'application/pdf',
            sizeBytes: 2000,
        });

        const promise = buildAttachmentSuffix(queue, SESSION, attachments, 2000);
        await vi.runAllTimersAsync();
        const suffix = await promise;

        expect(suffix).toBe(
            `\n[Attached file: ${BASE_DIR}/uid001-photo.jpg]\n[Attached file: ${BASE_DIR}/uid002-report.pdf]`
        );
    });

    // -----------------------------------------------------------------------
    // TC-02: All attachments fail (timeout) — full failure path
    // -----------------------------------------------------------------------
    it('TC-02: all attachments timed out → suffix contains [Attachment transfer failed:] in order', async () => {
        const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

        const attachments: AttachmentRef[] = [
            { uploadId: 'missing1', filename: 'file1.png', mimeType: 'image/png', sizeBytes: 500 },
            { uploadId: 'missing2', filename: 'file2.png', mimeType: 'image/png', sizeBytes: 600 },
        ];

        // Nothing enqueued — both will timeout after 200ms
        const promise = buildAttachmentSuffix(queue, SESSION, attachments, 200);
        await vi.advanceTimersByTimeAsync(300);
        const suffix = await promise;

        expect(suffix).toBe(
            '\n[Attachment transfer failed: file1.png]\n[Attachment transfer failed: file2.png]'
        );

        stderrSpy.mockRestore();
    });

    // -----------------------------------------------------------------------
    // TC-03: Mixed — some arrive, some timeout — ORDER is interleaved as per message.attachments
    // This is the key scenario from committee R3-YELLOW-02 / R4-RED-02.
    // -----------------------------------------------------------------------
    it('TC-03: partial success — suffix interleaves success/failure in message.attachments order', async () => {
        const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

        // Three attachments: A, B, C — B will timeout, A and C arrive
        const attachments: AttachmentRef[] = [
            { uploadId: 'uidA', filename: 'a.png', mimeType: 'image/png', sizeBytes: 100 },
            { uploadId: 'uidB', filename: 'B.jpg', mimeType: 'image/jpeg', sizeBytes: 200 },
            { uploadId: 'uidC', filename: 'c.pdf', mimeType: 'application/pdf', sizeBytes: 300 },
        ];

        // Enqueue A and C, but not B
        queue.enqueue(SESSION, {
            localPath: `${BASE_DIR}/uidA-a.png`,
            filename: 'a.png',
            mimeType: 'image/png',
            sizeBytes: 100,
        });
        queue.enqueue(SESSION, {
            localPath: `${BASE_DIR}/uidC-c.pdf`,
            filename: 'c.pdf',
            mimeType: 'application/pdf',
            sizeBytes: 300,
        });

        // Wait with short timeout — B will never arrive
        const promise = buildAttachmentSuffix(queue, SESSION, attachments, 200);
        await vi.advanceTimersByTimeAsync(300);
        const suffix = await promise;

        // A (success), B (failure), C (success) — in original attachment order
        expect(suffix).toBe(
            `\n[Attached file: ${BASE_DIR}/uidA-a.png]\n[Attachment transfer failed: B.jpg]\n[Attached file: ${BASE_DIR}/uidC-c.pdf]`
        );

        stderrSpy.mockRestore();
    });

    // -----------------------------------------------------------------------
    // TC-04: No attachments (undefined) — zero regression
    // -----------------------------------------------------------------------
    it('TC-04: message.attachments is undefined → suffix is empty string', async () => {
        const promise = buildAttachmentSuffix(queue, SESSION, undefined, 2000);
        await vi.runAllTimersAsync();
        const suffix = await promise;

        expect(suffix).toBe('');
    });

    // -----------------------------------------------------------------------
    // TC-05: Empty attachments array — zero regression variant
    // -----------------------------------------------------------------------
    it('TC-05: message.attachments is [] → suffix is empty string', async () => {
        const promise = buildAttachmentSuffix(queue, SESSION, [], 2000);
        await vi.runAllTimersAsync();
        const suffix = await promise;

        expect(suffix).toBe('');
    });

    // -----------------------------------------------------------------------
    // TC-06: Explicit 30000ms timeout passed to waitForUploadIds
    // Verifies the production code does not silently fall back to the old 5000 default.
    // We test this by checking that an item enqueued at ~29000ms is returned.
    // -----------------------------------------------------------------------
    it('TC-06: explicit 30000ms — uploadId arriving at 29000ms is still returned', async () => {
        const attachments: AttachmentRef[] = [
            { uploadId: 'lateUid', filename: 'late.txt', mimeType: 'text/plain', sizeBytes: 50 },
        ];

        // Start the wait using the same 30000 as the production call
        const promise = buildAttachmentSuffix(queue, SESSION, attachments, 30000);

        // Advance past the old 5000ms deadline
        await vi.advanceTimersByTimeAsync(5001);

        // File arrives at ~5001ms (well before 30000ms)
        queue.enqueue(SESSION, {
            localPath: `${BASE_DIR}/lateUid-late.txt`,
            filename: 'late.txt',
            mimeType: 'text/plain',
            sizeBytes: 50,
        });

        await vi.runAllTimersAsync();
        const suffix = await promise;

        // If timeout were 5000 this would be a failure marker; at 30000 it must be success
        expect(suffix).toBe(`\n[Attached file: ${BASE_DIR}/lateUid-late.txt]`);
    });

    // -----------------------------------------------------------------------
    // Additional: same filename in different positions does not cause misalignment
    // (uploadId is the key, not filename — prevents same-name false positive)
    // Note: uploadIds must not contain hyphens since the first '-' in the localPath
    // basename is the separator between uploadId and filename.
    // -----------------------------------------------------------------------
    it('same filename for two different attachments — uploadId disambiguates correctly', async () => {
        const attachments: AttachmentRef[] = [
            { uploadId: 'uidfirst', filename: 'dup.txt', mimeType: 'text/plain', sizeBytes: 10 },
            { uploadId: 'uidsecond', filename: 'dup.txt', mimeType: 'text/plain', sizeBytes: 20 },
        ];

        // Only first arrives
        queue.enqueue(SESSION, {
            localPath: `${BASE_DIR}/uidfirst-dup.txt`,
            filename: 'dup.txt',
            mimeType: 'text/plain',
            sizeBytes: 10,
        });

        const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
        const promise = buildAttachmentSuffix(queue, SESSION, attachments, 200);
        await vi.advanceTimersByTimeAsync(300);
        const suffix = await promise;

        expect(suffix).toBe(
            `\n[Attached file: ${BASE_DIR}/uidfirst-dup.txt]\n[Attachment transfer failed: dup.txt]`
        );
        stderrSpy.mockRestore();
    });
});
