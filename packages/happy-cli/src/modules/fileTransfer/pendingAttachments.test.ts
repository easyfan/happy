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

import { PendingAttachmentsQueue } from './pendingAttachments';
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
        const promise = queue.waitForUploadIds('s1', ['id-A', 'id-B'], 2000);

        await vi.advanceTimersByTimeAsync(50);

        // Enqueue one — still waiting
        queue.enqueue('s1', {
            localPath: '/tmp/test-happy-home/uploads/s1/id-A-a.txt',
            filename: 'a.txt',
            mimeType: 'text/plain',
            sizeBytes: 10,
        });

        await vi.advanceTimersByTimeAsync(50);

        // Enqueue second — now all ready
        queue.enqueue('s1', {
            localPath: '/tmp/test-happy-home/uploads/s1/id-B-b.png',
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

        // Enqueue one of two expected files
        queue.enqueue('s1', {
            localPath: '/tmp/test-happy-home/uploads/s1/id-A-a.txt',
            filename: 'a.txt',
            mimeType: 'text/plain',
            sizeBytes: 10,
        });

        const promise = queue.waitForUploadIds('s1', ['id-A', 'id-missing'], 500);
        await vi.advanceTimersByTimeAsync(600);
        const result = await promise;

        // Returns whatever was queued (id-A arrived, id-missing did not)
        expect(result).toHaveLength(1);
        expect(result[0].filename).toBe('a.txt');

        // Warns about the missing uploadId
        expect(stderrSpy).toHaveBeenCalledWith(
            expect.stringContaining('id-missing'),
        );

        stderrSpy.mockRestore();
    });

    it('queue is drained after waitForUploadIds resolves', async () => {
        queue.enqueue('s1', {
            localPath: '/tmp/test-happy-home/uploads/s1/id-1-f.txt',
            filename: 'f.txt',
            mimeType: 'text/plain',
            sizeBytes: 5,
        });

        const promise = queue.waitForUploadIds('s1', ['id-1']);
        await vi.runAllTimersAsync();
        await promise;

        // Queue should be empty now
        expect(queue.dequeueAll('s1')).toHaveLength(0);
    });

    it('does not bleed across sessions', async () => {
        queue.enqueue('s2', {
            localPath: '/tmp/test-happy-home/uploads/s2/id-X-other.txt',
            filename: 'other.txt',
            mimeType: 'text/plain',
            sizeBytes: 1,
        });

        // Waiting for s1, but only s2 has something — should timeout
        const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
        const promise = queue.waitForUploadIds('s1', ['id-X'], 200);
        await vi.advanceTimersByTimeAsync(300);
        const result = await promise;

        expect(result).toHaveLength(0);
        expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('id-X'));
        stderrSpy.mockRestore();

        // s2 queue untouched
        expect(queue.dequeueAll('s2')).toHaveLength(1);
    });
});
