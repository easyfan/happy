import { describe, expect, it } from 'vitest';
import { AttachmentRefSchema, FileShareContentSchema, UserMessageSchema } from './legacyProtocol';

describe('AttachmentRefSchema', () => {
    it('parses a valid AttachmentRef', () => {
        const result = AttachmentRefSchema.safeParse({
            uploadId: 'abc123',
            filename: 'photo.jpg',
            mimeType: 'image/jpeg',
            sizeBytes: 204800,
        });
        expect(result.success).toBe(true);
    });

    it('rejects missing uploadId', () => {
        const result = AttachmentRefSchema.safeParse({
            filename: 'photo.jpg',
            mimeType: 'image/jpeg',
            sizeBytes: 204800,
        });
        expect(result.success).toBe(false);
    });

    it('rejects non-positive sizeBytes', () => {
        const result = AttachmentRefSchema.safeParse({
            uploadId: 'abc123',
            filename: 'photo.jpg',
            mimeType: 'image/jpeg',
            sizeBytes: 0,
        });
        expect(result.success).toBe(false);
    });

    it('rejects float sizeBytes', () => {
        const result = AttachmentRefSchema.safeParse({
            uploadId: 'abc123',
            filename: 'photo.jpg',
            mimeType: 'image/jpeg',
            sizeBytes: 1.5,
        });
        expect(result.success).toBe(false);
    });
});

describe('FileShareContentSchema', () => {
    it('parses a valid FileShareContent without description', () => {
        const result = FileShareContentSchema.safeParse({
            type: 'file_share',
            uploadId: 'upload-xyz',
            filename: 'report.pdf',
            mimeType: 'application/pdf',
            sizeBytes: 1024000,
        });
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.description).toBeUndefined();
        }
    });

    it('parses a valid FileShareContent with description', () => {
        const result = FileShareContentSchema.safeParse({
            type: 'file_share',
            uploadId: 'upload-xyz',
            filename: 'report.pdf',
            mimeType: 'application/pdf',
            sizeBytes: 1024000,
            description: 'Monthly report',
        });
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.description).toBe('Monthly report');
        }
    });

    it('rejects wrong type literal', () => {
        const result = FileShareContentSchema.safeParse({
            type: 'image',
            uploadId: 'upload-xyz',
            filename: 'photo.jpg',
            mimeType: 'image/jpeg',
            sizeBytes: 204800,
        });
        expect(result.success).toBe(false);
    });

    it('rejects missing filename', () => {
        const result = FileShareContentSchema.safeParse({
            type: 'file_share',
            uploadId: 'upload-xyz',
            mimeType: 'application/pdf',
            sizeBytes: 1024000,
        });
        expect(result.success).toBe(false);
    });
});

describe('UserMessageSchema with attachments', () => {
    it('parses a message without attachments (backward compatibility)', () => {
        const result = UserMessageSchema.safeParse({
            role: 'user',
            content: { type: 'text', text: 'hello' },
        });
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.attachments).toBeUndefined();
        }
    });

    it('parses a message with an empty attachments array', () => {
        const result = UserMessageSchema.safeParse({
            role: 'user',
            content: { type: 'text', text: 'look at this' },
            attachments: [],
        });
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.attachments).toEqual([]);
        }
    });

    it('parses a message with valid attachments', () => {
        const result = UserMessageSchema.safeParse({
            role: 'user',
            content: { type: 'text', text: 'see attached' },
            attachments: [
                {
                    uploadId: 'up-001',
                    filename: 'screenshot.png',
                    mimeType: 'image/png',
                    sizeBytes: 50000,
                },
            ],
        });
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.attachments).toHaveLength(1);
            expect(result.data.attachments![0].uploadId).toBe('up-001');
        }
    });

    it('rejects a message with invalid attachment (zero sizeBytes)', () => {
        const result = UserMessageSchema.safeParse({
            role: 'user',
            content: { type: 'text', text: 'see attached' },
            attachments: [
                {
                    uploadId: 'up-001',
                    filename: 'screenshot.png',
                    mimeType: 'image/png',
                    sizeBytes: 0,
                },
            ],
        });
        expect(result.success).toBe(false);
    });
});
