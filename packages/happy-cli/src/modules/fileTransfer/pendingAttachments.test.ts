import { describe, expect, it, vi, beforeEach } from 'vitest';

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
