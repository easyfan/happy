import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// Mock fs and configuration so cleanupSession doesn't touch the real filesystem
vi.mock('node:fs/promises', () => ({
    rm: vi.fn(async () => {}),
}));

vi.mock('@/configuration', () => ({
    configuration: {
        happyHomeDir: '/tmp/test-happy-home',
    },
}));

import { PendingAttachmentsQueue, extractUploadIdFromPath } from './pendingAttachments';
import * as fsPromises from 'node:fs/promises';

describe('PendingAttachmentsQueue', () => {
    let queue: PendingAttachmentsQueue;

    beforeEach(() => {
        queue = new PendingAttachmentsQueue();
        vi.mocked(fsPromises.rm).mockClear();
    });

    it('enqueues and dequeues attachments for a session', () => {
        const attachment = {
            localPath: '/tmp/test-happy-home/uploads/session-1/up-001-photo.jpg',
            filename: 'photo.jpg',
            mimeType: 'image/jpeg',
            sizeBytes: 204800,
        };

        queue.enqueue('session-1', attachment);
        const result = queue.dequeueAll('session-1');

        expect(result).toHaveLength(1);
        expect(result[0].filename).toBe('photo.jpg');
    });

    it('dequeueAll clears the queue (second call returns empty)', () => {
        queue.enqueue('session-1', {
            localPath: '/tmp/x',
            filename: 'a.txt',
            mimeType: 'text/plain',
            sizeBytes: 10,
        });

        queue.dequeueAll('session-1');
        const second = queue.dequeueAll('session-1');

        expect(second).toHaveLength(0);
    });

    it('returns empty array for unknown session', () => {
        const result = queue.dequeueAll('nonexistent-session');
        expect(result).toHaveLength(0);
    });

    it('maintains independent queues per session', () => {
        queue.enqueue('session-A', {
            localPath: '/tmp/a',
            filename: 'a.png',
            mimeType: 'image/png',
            sizeBytes: 1000,
        });
        queue.enqueue('session-B', {
            localPath: '/tmp/b',
            filename: 'b.pdf',
            mimeType: 'application/pdf',
            sizeBytes: 2000,
        });

        const a = queue.dequeueAll('session-A');
        const b = queue.dequeueAll('session-B');

        expect(a).toHaveLength(1);
        expect(a[0].filename).toBe('a.png');
        expect(b).toHaveLength(1);
        expect(b[0].filename).toBe('b.pdf');
    });

    it('ignores duplicate enqueue for the same uploadId (idempotent)', () => {
        const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

        const attachment = {
            localPath: '/tmp/test-happy-home/uploads/session-1/abc123-doc.pdf',
            filename: 'doc.pdf',
            mimeType: 'application/pdf',
            sizeBytes: 1024,
        };

        queue.enqueue('session-1', attachment);
        queue.enqueue('session-1', attachment); // duplicate

        const result = queue.dequeueAll('session-1');
        expect(result).toHaveLength(1);
        expect(result[0].filename).toBe('doc.pdf');

        // Should have logged a duplicate warning
        expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('abc123'));
        stderrSpy.mockRestore();
    });

    it('allows same uploadId in different sessions', () => {
        const base = {
            filename: 'file.txt',
            mimeType: 'text/plain',
            sizeBytes: 10,
        };

        queue.enqueue('session-A', { ...base, localPath: '/tmp/test-happy-home/uploads/session-A/idxxx-file.txt' });
        queue.enqueue('session-B', { ...base, localPath: '/tmp/test-happy-home/uploads/session-B/idxxx-file.txt' });

        expect(queue.dequeueAll('session-A')).toHaveLength(1);
        expect(queue.dequeueAll('session-B')).toHaveLength(1);
    });

    it('enqueues multiple items and dequeues in FIFO order', () => {
        for (let i = 0; i < 3; i++) {
            queue.enqueue('session-1', {
                localPath: `/tmp/f${i}`,
                filename: `file-${i}.txt`,
                mimeType: 'text/plain',
                sizeBytes: i * 100,
            });
        }

        const result = queue.dequeueAll('session-1');
        expect(result.map((a) => a.filename)).toEqual(['file-0.txt', 'file-1.txt', 'file-2.txt']);
    });

    it('cleanupSession removes the queue and deletes the upload directory', async () => {
        queue.enqueue('session-1', {
            localPath: '/tmp/x',
            filename: 'f.txt',
            mimeType: 'text/plain',
            sizeBytes: 5,
        });

        await queue.cleanupSession('session-1');

        // Queue should be gone
        expect(queue.dequeueAll('session-1')).toHaveLength(0);

        // fs.rm should have been called with the session upload dir
        expect(vi.mocked(fsPromises.rm)).toHaveBeenCalledWith(
            '/tmp/test-happy-home/uploads/session-1',
            { recursive: true, force: true },
        );
    });
});

describe('PendingAttachmentsQueue.waitForUploadIds', () => {
    let queue: PendingAttachmentsQueue;

    beforeEach(() => {
        queue = new PendingAttachmentsQueue();
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('returns immediately when uploadIds is empty', async () => {
        const promise = queue.waitForUploadIds('s1', []);
        // Advance no time — should resolve without polling
        await vi.runAllTimersAsync();
        const result = await promise;
        expect(result).toHaveLength(0);
    });

    it('returns immediately when requested uploadId is already queued', async () => {
        queue.enqueue('s1', {
            localPath: '/tmp/test-happy-home/uploads/s1/abc123-photo.jpg',
            filename: 'photo.jpg',
            mimeType: 'image/jpeg',
            sizeBytes: 1000,
        });

        const promise = queue.waitForUploadIds('s1', ['abc123']);
        await vi.runAllTimersAsync();
        const result = await promise;

        expect(result).toHaveLength(1);
        expect(result[0].filename).toBe('photo.jpg');
    });

    it('waits for uploadId to be enqueued after polling cycles', async () => {
        const promise = queue.waitForUploadIds('s1', ['xyz789'], 2000);

        // First poll tick — nothing yet
        await vi.advanceTimersByTimeAsync(50);

        // Simulate RPC handler enqueuing the file after 100ms
        queue.enqueue('s1', {
            localPath: '/tmp/test-happy-home/uploads/s1/xyz789-report.pdf',
            filename: 'report.pdf',
            mimeType: 'application/pdf',
            sizeBytes: 5000,
        });

        await vi.runAllTimersAsync();
        const result = await promise;

        expect(result).toHaveLength(1);
        expect(result[0].filename).toBe('report.pdf');
    });

    it('waits for all uploadIds when multiple are declared', async () => {
        // uploadIds use cuid2-style (no hyphens before the filename separator)
        const promise = queue.waitForUploadIds('s1', ['idaaa', 'idbbb'], 2000);

        await vi.advanceTimersByTimeAsync(50);

        // Enqueue one — still waiting
        queue.enqueue('s1', {
            localPath: '/tmp/test-happy-home/uploads/s1/idaaa-a.txt',
            filename: 'a.txt',
            mimeType: 'text/plain',
            sizeBytes: 10,
        });

        await vi.advanceTimersByTimeAsync(50);

        // Enqueue second — now all ready
        queue.enqueue('s1', {
            localPath: '/tmp/test-happy-home/uploads/s1/idbbb-b.png',
            filename: 'b.png',
            mimeType: 'image/png',
            sizeBytes: 200,
        });

        await vi.runAllTimersAsync();
        const result = await promise;

        expect(result).toHaveLength(2);
        expect(result.map(a => a.filename).sort()).toEqual(['a.txt', 'b.png']);
    });

    it('times out and returns whatever was queued, with stderr warning', async () => {
        const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

        // Enqueue one of two expected files (cuid2-style uploadIds, no hyphens)
        queue.enqueue('s1', {
            localPath: '/tmp/test-happy-home/uploads/s1/idaaa-a.txt',
            filename: 'a.txt',
            mimeType: 'text/plain',
            sizeBytes: 10,
        });

        const promise = queue.waitForUploadIds('s1', ['idaaa', 'idmissing'], 500);
        await vi.advanceTimersByTimeAsync(600);
        const result = await promise;

        // Returns whatever was queued (idaaa arrived, idmissing did not)
        expect(result).toHaveLength(1);
        expect(result[0].filename).toBe('a.txt');

        // Warns about the missing uploadId
        expect(stderrSpy).toHaveBeenCalledWith(
            expect.stringContaining('idmissing'),
        );

        stderrSpy.mockRestore();
    });

    it('queue is drained after waitForUploadIds resolves', async () => {
        queue.enqueue('s1', {
            localPath: '/tmp/test-happy-home/uploads/s1/id1aaa-f.txt',
            filename: 'f.txt',
            mimeType: 'text/plain',
            sizeBytes: 5,
        });

        const promise = queue.waitForUploadIds('s1', ['id1aaa']);
        await vi.runAllTimersAsync();
        await promise;

        // Queue should be empty now
        expect(queue.dequeueAll('s1')).toHaveLength(0);
    });

    it('does not bleed across sessions', async () => {
        queue.enqueue('s2', {
            localPath: '/tmp/test-happy-home/uploads/s2/idxxx-other.txt',
            filename: 'other.txt',
            mimeType: 'text/plain',
            sizeBytes: 1,
        });

        // Waiting for s1, but only s2 has something — should timeout
        const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
        const promise = queue.waitForUploadIds('s1', ['idxxx'], 200);
        await vi.advanceTimersByTimeAsync(300);
        const result = await promise;

        expect(result).toHaveLength(0);
        expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('idxxx'));
        stderrSpy.mockRestore();

        // s2 queue untouched
        expect(queue.dequeueAll('s2')).toHaveLength(1);
    });

    // TC-M1-DEFAULT-TIMEOUT: verify the default changed from 5000 to 30000
    // An uploadId that arrives at 29000ms must be returned (not treated as timed-out)
    it('TC-M1-DEFAULT-TIMEOUT: default timeoutMs is 30000 (uploadId arriving at 29s is returned)', async () => {
        const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

        // Call with no explicit timeoutMs — must rely on the new 30000 default
        const promise = queue.waitForUploadIds('s1', ['lateId']);

        // Advance to just before the old 5000ms deadline — must still be waiting
        await vi.advanceTimersByTimeAsync(4999);

        // Enqueue the file at ~29000ms (between the old 5s and new 30s threshold)
        // We do this right after advancing 4999ms so the next poll will see it
        queue.enqueue('s1', {
            localPath: '/tmp/test-happy-home/uploads/s1/lateId-late-file.txt',
            filename: 'late-file.txt',
            mimeType: 'text/plain',
            sizeBytes: 100,
        });

        await vi.runAllTimersAsync();
        const result = await promise;

        // Must be 1 (not 0): proves default is 30000, not 5000
        expect(result).toHaveLength(1);
        expect(result[0].filename).toBe('late-file.txt');

        // No timeout warning should have been emitted
        expect(stderrSpy).not.toHaveBeenCalledWith(expect.stringContaining('lateId'));
        stderrSpy.mockRestore();
    });
});

describe('extractUploadIdFromPath', () => {
    it('extracts uploadId from a standard path', () => {
        const localPath = '/home/user/.happy/uploads/sess1/abc123-photo.jpg';
        expect(extractUploadIdFromPath(localPath)).toBe('abc123');
    });

    it('extracts uploadId when filename itself contains hyphens', () => {
        // uploadId = "uid001", filename = "my-long-filename.png"
        const localPath = '/tmp/uploads/s1/uid001-my-long-filename.png';
        expect(extractUploadIdFromPath(localPath)).toBe('uid001');
    });

    it('returns full base when there is no hyphen', () => {
        const localPath = '/tmp/uploads/s1/nohyphenhere';
        expect(extractUploadIdFromPath(localPath)).toBe('nohyphenhere');
    });

    it('handles cuid2-style uploadIds (no internal hyphens)', () => {
        const localPath = '/tmp/uploads/s2/clgxt3w9k0000qzrmkxf1hv8k-document.pdf';
        expect(extractUploadIdFromPath(localPath)).toBe('clgxt3w9k0000qzrmkxf1hv8k');
    });

    it('handles path with multiple directories', () => {
        const localPath = '/very/deep/path/structure/uploads/session-xyz/uploadid42-file.txt';
        expect(extractUploadIdFromPath(localPath)).toBe('uploadid42');
    });
});
