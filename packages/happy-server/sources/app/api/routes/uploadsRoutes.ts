import { z } from 'zod';
import { type Fastify } from '../types';
import { uploadCreate } from '@/app/upload/uploadCreate';
import { uploadGet } from '@/app/upload/uploadGet';
import { uploadDelete } from '@/app/upload/uploadDelete';
import { uploadPendingList } from '@/app/upload/uploadPendingList';

const ALLOWED_MIME_TYPES = [
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'application/pdf',
    'text/plain',
] as const;

const MAX_BODY_BYTES = 15 * 1024 * 1024; // 15 MB to accommodate 10 MB file + base64 overhead (~13.3 MB)

export function uploadsRoutes(app: Fastify) {

    // POST /v1/uploads — idempotent upload (App or CLI)
    app.post('/v1/uploads', {
        preHandler: app.authenticate,
        bodyLimit: MAX_BODY_BYTES,
        schema: {
            body: z.object({
                uploadId: z.string(),
                encryptedBlob: z.string(),
                nonce: z.string(),
                encryptedMeta: z.string(),
                metaNonce: z.string(),
                mimeType: z.string(),
                sizeBytes: z.number().int().positive(),
                sessionId: z.string(),
                direction: z.enum(['app_to_cli', 'cli_to_app']),
            }),
        },
    }, async (request, reply) => {
        const accountId = request.userId;
        const { uploadId, mimeType, sizeBytes } = request.body;

        // MIME allowlist enforcement (server-side)
        if (!ALLOWED_MIME_TYPES.includes(mimeType as any)) {
            return reply.status(400).send({
                error: 'UNSUPPORTED_FILE_TYPE',
                allowedTypes: [...ALLOWED_MIME_TYPES],
            });
        }

        await uploadCreate(accountId, request.body);
        return reply.status(200).send({ uploadId });
    });

    // GET /v1/uploads/pending — CLI polls on connect for undelivered uploads
    // Must be registered before /:uploadId so find-my-way matches the static segment first
    app.get('/v1/uploads/pending', {
        preHandler: app.authenticate,
        schema: {
            querystring: z.object({
                sessionId: z.string().optional(),
            }),
        },
    }, async (request, reply) => {
        const accountId = request.userId;
        const { sessionId } = request.query;
        const list = await uploadPendingList(accountId, sessionId);
        return reply.send({ uploads: list });
    });

    // GET /v1/uploads/:uploadId — download encrypted blob (CLI or App)
    app.get('/v1/uploads/:uploadId', {
        preHandler: app.authenticate,
        schema: {
            params: z.object({ uploadId: z.string() }),
            querystring: z.object({ sessionId: z.string() }),
        },
    }, async (request, reply) => {
        const accountId = request.userId;
        const { uploadId } = request.params;
        const { sessionId } = request.query;

        const result = await uploadGet(accountId, uploadId, sessionId);
        if (!result) {
            return reply.status(404).send({ error: 'NOT_FOUND' });
        }
        return reply.send(result);
    });

    // DELETE /v1/uploads/:uploadId — consume confirmation (CLI after write, App on cancel)
    app.delete('/v1/uploads/:uploadId', {
        preHandler: app.authenticate,
        schema: {
            params: z.object({ uploadId: z.string() }),
        },
    }, async (request, reply) => {
        const accountId = request.userId;
        const { uploadId } = request.params;

        try {
            await uploadDelete(accountId, uploadId);
        } catch (err: any) {
            if (err.statusCode === 403) {
                return reply.status(403).send({ error: 'FORBIDDEN' });
            }
            throw err;
        }

        return reply.status(204).send();
    });
}
