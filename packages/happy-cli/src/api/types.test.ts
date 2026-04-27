import { describe, expect, it } from 'vitest';
import { UserMessageSchema } from './types';

describe('UserMessageSchema — attachments field', () => {
    const base = {
        role: 'user' as const,
        content: { type: 'text' as const, text: 'hello' },
    };

    it('parses a message without attachments (backward compat)', () => {
        const result = UserMessageSchema.safeParse(base);
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.attachments).toBeUndefined();
        }
    });

    it('parses a message with a valid attachment', () => {
        const msg = {
            ...base,
            attachments: [{
                uploadId: 'up-001',
                filename: 'photo.jpg',
                mimeType: 'image/jpeg',
                sizeBytes: 204800,
            }],
        };
        const result = UserMessageSchema.safeParse(msg);
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.attachments).toHaveLength(1);
            expect(result.data.attachments![0].uploadId).toBe('up-001');
            expect(result.data.attachments![0].filename).toBe('photo.jpg');
        }
    });

    it('parses a message with an empty attachments array', () => {
        const result = UserMessageSchema.safeParse({ ...base, attachments: [] });
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.attachments).toEqual([]);
        }
    });

    it('parses a message with multiple attachments', () => {
        const msg = {
            ...base,
            attachments: [
                { uploadId: 'id-1', filename: 'a.jpg', mimeType: 'image/jpeg', sizeBytes: 1000 },
                { uploadId: 'id-2', filename: 'b.pdf', mimeType: 'application/pdf', sizeBytes: 5000 },
            ],
        };
        const result = UserMessageSchema.safeParse(msg);
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.attachments).toHaveLength(2);
            expect(result.data.attachments!.map(a => a.uploadId)).toEqual(['id-1', 'id-2']);
        }
    });

    it('rejects an attachment with zero sizeBytes', () => {
        const msg = {
            ...base,
            attachments: [{ uploadId: 'id-x', filename: 'f.jpg', mimeType: 'image/jpeg', sizeBytes: 0 }],
        };
        const result = UserMessageSchema.safeParse(msg);
        expect(result.success).toBe(false);
    });

    it('rejects an attachment missing uploadId', () => {
        const msg = {
            ...base,
            attachments: [{ filename: 'f.jpg', mimeType: 'image/jpeg', sizeBytes: 100 }],
        };
        const result = UserMessageSchema.safeParse(msg);
        expect(result.success).toBe(false);
    });

    it('rejects an attachment with float sizeBytes', () => {
        const msg = {
            ...base,
            attachments: [{ uploadId: 'id-x', filename: 'f.jpg', mimeType: 'image/jpeg', sizeBytes: 1.5 }],
        };
        const result = UserMessageSchema.safeParse(msg);
        expect(result.success).toBe(false);
    });
});
