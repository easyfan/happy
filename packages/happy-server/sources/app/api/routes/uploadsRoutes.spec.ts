import { describe, expect, it, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------
const { uploadCreateMock, resetMocks } = vi.hoisted(() => {
    const uploadCreateMock = vi.fn(async () => {});
    const resetMocks = () => { uploadCreateMock.mockClear(); };
    return { uploadCreateMock, resetMocks };
});

vi.mock('@/app/upload/uploadCreate', () => ({ uploadCreate: uploadCreateMock }));
vi.mock('@/app/upload/uploadGet', () => ({ uploadGet: vi.fn(async () => null) }));
vi.mock('@/app/upload/uploadDelete', () => ({ uploadDelete: vi.fn(async () => {}) }));
vi.mock('@/app/upload/uploadPendingList', () => ({ uploadPendingList: vi.fn(async () => []) }));

import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler, ZodTypeProvider } from 'fastify-type-provider-zod';
import { uploadsRoutes } from './uploadsRoutes';
import type { Fastify as AppFastify } from '../types';

// ---------------------------------------------------------------------------
// Test fixture — minimal authenticated Fastify instance
// ---------------------------------------------------------------------------
function buildApp() {
    const app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    const typed = app.withTypeProvider<ZodTypeProvider>() as unknown as AppFastify;

    // Stub authenticate decorator: sets userId on every request
    typed.decorate('authenticate', async (request: any) => {
        request.userId = 'test-user';
    });

    uploadsRoutes(typed);
    return typed;
}

const BASE_BODY = {
    uploadId: 'uid-001',
    encryptedBlob: Buffer.from('data').toString('base64'),
    nonce: Buffer.from('nonce111111111111111111111').toString('base64'),
    encryptedMeta: Buffer.from('meta').toString('base64'),
    metaNonce: Buffer.from('mnonce11111111111111111111').toString('base64'),
    sizeBytes: 4,
    sessionId: 'sess-abc',
    direction: 'app_to_cli',
};

describe('POST /v1/uploads — MIME allowlist', () => {
    let app: ReturnType<typeof buildApp>;

    beforeEach(async () => {
        resetMocks();
        app = buildApp();
        await app.ready();
    });

    // ── Allowed: images ──────────────────────────────────────────────────────

    it.each([
        ['image/jpeg'],
        ['image/png'],
        ['image/gif'],
        ['image/webp'],
    ])('accepts %s', async (mimeType) => {
        const res = await app.inject({
            method: 'POST',
            url: '/v1/uploads',
            payload: { ...BASE_BODY, mimeType },
        });
        expect(res.statusCode).toBe(200);
        expect(uploadCreateMock).toHaveBeenCalledTimes(1);
    });

    // ── Allowed: documents ───────────────────────────────────────────────────

    it.each([
        ['application/pdf'],
        ['text/plain'],
    ])('accepts %s', async (mimeType) => {
        const res = await app.inject({
            method: 'POST',
            url: '/v1/uploads',
            payload: { ...BASE_BODY, mimeType },
        });
        expect(res.statusCode).toBe(200);
    });

    // ── Allowed: MS Office legacy ─────────────────────────────────────────────

    it.each([
        ['application/msword', '.doc'],
        ['application/vnd.ms-excel', '.xls'],
        ['application/vnd.ms-powerpoint', '.ppt'],
    ])('accepts %s (%s)', async (mimeType) => {
        const res = await app.inject({
            method: 'POST',
            url: '/v1/uploads',
            payload: { ...BASE_BODY, mimeType },
        });
        expect(res.statusCode).toBe(200);
        expect(uploadCreateMock).toHaveBeenCalledTimes(1);
    });

    // ── Allowed: MS Office OOXML ──────────────────────────────────────────────

    it.each([
        ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.docx'],
        ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.xlsx'],
        ['application/vnd.openxmlformats-officedocument.presentationml.presentation', '.pptx'],
    ])('accepts %s (%s)', async (mimeType) => {
        const res = await app.inject({
            method: 'POST',
            url: '/v1/uploads',
            payload: { ...BASE_BODY, mimeType },
        });
        expect(res.statusCode).toBe(200);
        expect(uploadCreateMock).toHaveBeenCalledTimes(1);
    });

    // ── Rejected: unlisted types ──────────────────────────────────────────────

    it.each([
        ['application/zip'],
        ['application/x-rar-compressed'],
        ['application/octet-stream'],
        ['video/mp4'],
        ['audio/mpeg'],
        ['text/html'],
        ['application/javascript'],
        ['application/x-sh'],
    ])('rejects %s with 400 UNSUPPORTED_FILE_TYPE', async (mimeType) => {
        const res = await app.inject({
            method: 'POST',
            url: '/v1/uploads',
            payload: { ...BASE_BODY, mimeType },
        });
        expect(res.statusCode).toBe(400);
        const body = res.json();
        expect(body.error).toBe('UNSUPPORTED_FILE_TYPE');
        expect(body.allowedTypes).toBeInstanceOf(Array);
        expect(body.allowedTypes.length).toBeGreaterThan(0);
        expect(uploadCreateMock).not.toHaveBeenCalled();
    });

    // ── Response shape ────────────────────────────────────────────────────────

    it('returns { uploadId } on success', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/v1/uploads',
            payload: { ...BASE_BODY, mimeType: 'application/pdf' },
        });
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ uploadId: BASE_BODY.uploadId });
    });

    it('includes all currently-allowed types in the 400 response allowedTypes list', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/v1/uploads',
            payload: { ...BASE_BODY, mimeType: 'video/mp4' },
        });
        const { allowedTypes } = res.json();
        // Verify all six Office types are in the list
        expect(allowedTypes).toContain('application/msword');
        expect(allowedTypes).toContain('application/vnd.ms-excel');
        expect(allowedTypes).toContain('application/vnd.ms-powerpoint');
        expect(allowedTypes).toContain('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
        expect(allowedTypes).toContain('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        expect(allowedTypes).toContain('application/vnd.openxmlformats-officedocument.presentationml.presentation');
    });
});
