import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import fastify, { FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler, ZodTypeProvider } from 'fastify-type-provider-zod';
import { type Fastify } from '../types';

// ---------------------------------------------------------------------------
// Hoisted mocks — in-memory session store
// ---------------------------------------------------------------------------
const { state, dbMock, configUpdateMock, resetState } = vi.hoisted(() => {
    interface MockSession {
        id: string;
        tag: string;
        accountId: string;
        seq: number;
        metadata: string;
        metadataVersion: number;
        agentState: string | null;
        agentStateVersion: number;
        dataEncryptionKey: Uint8Array | null;
        active: boolean;
        lastActiveAt: Date;
        createdAt: Date;
        updatedAt: Date;
        permissionMode: string | null;
        modelMode: string | null;
        effortLevel: string | null;
        permissionModeUpdatedAt: Date | null;
        modelModeUpdatedAt: Date | null;
        effortLevelUpdatedAt: Date | null;
    }

    const makeDate = (ts?: number) => new Date(ts ?? Date.now());

    const makeSession = (overrides: Partial<MockSession> = {}): MockSession => ({
        id: 'session-001',
        tag: 'test-tag',
        accountId: 'user-1',
        seq: 0,
        metadata: 'encrypted-metadata',
        metadataVersion: 0,
        agentState: null,
        agentStateVersion: 0,
        dataEncryptionKey: null,
        active: true,
        lastActiveAt: makeDate(),
        createdAt: makeDate(),
        updatedAt: makeDate(),
        permissionMode: null,
        modelMode: null,
        effortLevel: null,
        permissionModeUpdatedAt: null,
        modelModeUpdatedAt: null,
        effortLevelUpdatedAt: null,
        ...overrides,
    });

    const state = {
        sessions: [] as MockSession[],
    };

    const resetState = () => {
        state.sessions = [makeSession()];
    };

    const dbMock = {
        session: {
            findMany: vi.fn(async (args: any) => {
                const { accountId } = args.where ?? {};
                return state.sessions.filter((s) => s.accountId === accountId);
            }),
            findFirst: vi.fn(async (args: any) => {
                const { id, accountId, tag } = args.where ?? {};
                return (
                    state.sessions.find(
                        (s) =>
                            (id === undefined || s.id === id) &&
                            (accountId === undefined || s.accountId === accountId) &&
                            (tag === undefined || s.tag === tag),
                    ) ?? null
                );
            }),
            create: vi.fn(async (args: any) => {
                const now = makeDate();
                const s = makeSession({
                    id: `session-new-${state.sessions.length}`,
                    accountId: args.data.accountId,
                    tag: args.data.tag,
                    metadata: args.data.metadata,
                    createdAt: now,
                    updatedAt: now,
                    lastActiveAt: now,
                });
                state.sessions.push(s);
                return s;
            }),
            updateMany: vi.fn(async (args: any) => {
                const { id, accountId } = args.where ?? {};
                const session = state.sessions.find(
                    (s) => s.id === id && s.accountId === accountId,
                );
                if (!session) return { count: 0 };
                Object.assign(session, args.data);
                return { count: 1 };
            }),
        },
        $transaction: vi.fn(async (fn: any) => fn(dbMock)),
    };

    // configUpdateMock mirrors sessionConfigUpdate but mutates in-memory state
    const configUpdateMock = vi.fn(async (ctx: any, sessionId: string, body: any) => {
        const session = state.sessions.find(
            (s) => s.id === sessionId && s.accountId === ctx.uid,
        );
        if (!session) return false;
        const now = makeDate();
        if (body.permissionMode !== undefined) {
            session.permissionMode = body.permissionMode ?? null;
            session.permissionModeUpdatedAt = now;
        }
        if (body.modelMode !== undefined) {
            session.modelMode = body.modelMode ?? null;
            session.modelModeUpdatedAt = now;
        }
        if (body.effortLevel !== undefined) {
            session.effortLevel = body.effortLevel ?? null;
            session.effortLevelUpdatedAt = now;
        }
        return true;
    });

    return { state, dbMock, configUpdateMock, resetState };
});

vi.mock('@/storage/db', () => ({ db: dbMock }));
vi.mock('@/storage/inTx', () => ({
    inTx: vi.fn(async (fn: any) => fn(dbMock)),
    afterTx: (_tx: any, cb: () => void) => cb(),
}));
vi.mock('@/app/session/sessionConfigUpdate', async () => {
    const { z } = await import('zod');
    return {
        sessionConfigUpdate: configUpdateMock,
        SessionConfigUpdateBodySchema: z.object({
            permissionMode: z.string().nullish(),
            modelMode: z.string().nullish(),
            effortLevel: z.string().nullish(),
        }).refine(
            (d) =>
                d.permissionMode !== undefined ||
                d.modelMode !== undefined ||
                d.effortLevel !== undefined,
            { message: 'At least one field must be provided' },
        ),
    };
});
vi.mock('@/app/session/sessionDelete', () => ({ sessionDelete: vi.fn(async () => true) }));
vi.mock('@/app/events/eventRouter', () => ({
    eventRouter: { emitUpdate: vi.fn(), emitEphemeral: vi.fn() },
    buildNewSessionUpdate: vi.fn(() => ({ id: 'x', seq: 1, body: { t: 'new-session' }, createdAt: Date.now() })),
    buildSessionActivityEphemeral: vi.fn(() => ({ id: 'x', body: { t: 'activity' } })),
}));
vi.mock('@/storage/seq', () => ({ allocateUserSeq: vi.fn(async () => 1) }));
vi.mock('@/utils/randomKeyNaked', () => ({ randomKeyNaked: vi.fn(() => 'rand-key') }));
vi.mock('@/utils/log', () => ({ log: vi.fn(), warn: vi.fn(), error: vi.fn() }));

import { sessionRoutes } from './sessionRoutes';

// ---------------------------------------------------------------------------
// App factory
// ---------------------------------------------------------------------------
async function createApp(userId = 'user-1'): Promise<FastifyInstance> {
    const app = fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    const typed = app.withTypeProvider<ZodTypeProvider>() as unknown as Fastify;

    typed.decorate('authenticate', async (request: any) => {
        request.userId = userId;
    });

    sessionRoutes(typed);
    await typed.ready();
    return typed as unknown as FastifyInstance;
}

// ---------------------------------------------------------------------------
// Tests: GET /v1/sessions
// ---------------------------------------------------------------------------
describe('GET /v1/sessions — new LWW fields', () => {
    let app: FastifyInstance;

    beforeEach(async () => {
        resetState();
        app = await createApp();
    });

    afterEach(async () => {
        await app.close();
    });

    it('GET-01: returns effortLevel and *UpdatedAt fields (all null for pristine session)', async () => {
        const res = await app.inject({ method: 'GET', url: '/v1/sessions' });
        expect(res.statusCode).toBe(200);

        const { sessions } = JSON.parse(res.body);
        expect(sessions).toHaveLength(1);
        const s = sessions[0];

        expect(s).toHaveProperty('effortLevel', null);
        expect(s).toHaveProperty('permissionModeUpdatedAt', null);
        expect(s).toHaveProperty('modelModeUpdatedAt', null);
        expect(s).toHaveProperty('effortLevelUpdatedAt', null);
    });

    it('GET-02: returns effortLevelUpdatedAt as number (epoch ms) after PATCH', async () => {
        const ts = new Date('2026-07-22T10:00:00.000Z');
        const session = state.sessions[0] as any;
        session.effortLevel = 'high';
        session.effortLevelUpdatedAt = ts;

        const res = await app.inject({ method: 'GET', url: '/v1/sessions' });
        expect(res.statusCode).toBe(200);

        const { sessions } = JSON.parse(res.body);
        const s = sessions[0];

        expect(s.effortLevel).toBe('high');
        expect(s.effortLevelUpdatedAt).toBe(ts.getTime());
        expect(s.permissionModeUpdatedAt).toBeNull();
        expect(s.modelModeUpdatedAt).toBeNull();
    });

    it('GET-03: returns all three *UpdatedAt as numbers when all three fields set', async () => {
        const ts = new Date('2026-07-22T10:00:00.000Z');
        const session = state.sessions[0] as any;
        session.permissionMode = 'bypassPermissions';
        session.permissionModeUpdatedAt = ts;
        session.modelMode = 'claude-opus-4-5';
        session.modelModeUpdatedAt = ts;
        session.effortLevel = 'low';
        session.effortLevelUpdatedAt = ts;

        const res = await app.inject({ method: 'GET', url: '/v1/sessions' });
        const { sessions } = JSON.parse(res.body);
        const s = sessions[0];

        expect(s.permissionModeUpdatedAt).toBe(ts.getTime());
        expect(s.modelModeUpdatedAt).toBe(ts.getTime());
        expect(s.effortLevelUpdatedAt).toBe(ts.getTime());
    });
});

// ---------------------------------------------------------------------------
// Tests: GET /v2/sessions/active
// ---------------------------------------------------------------------------
describe('GET /v2/sessions/active — new LWW fields', () => {
    let app: FastifyInstance;

    beforeEach(async () => {
        resetState();
        // Ensure session is within 15 min window for /active
        (state.sessions[0] as any).lastActiveAt = new Date();
        app = await createApp();
    });

    afterEach(async () => {
        await app.close();
    });

    it('GET-ACTIVE-01: returns effortLevel and *UpdatedAt fields (null for pristine session)', async () => {
        const res = await app.inject({ method: 'GET', url: '/v2/sessions/active' });
        expect(res.statusCode).toBe(200);

        const { sessions } = JSON.parse(res.body);
        expect(sessions).toHaveLength(1);
        const s = sessions[0];

        expect(s).toHaveProperty('effortLevel', null);
        expect(s).toHaveProperty('permissionModeUpdatedAt', null);
        expect(s).toHaveProperty('modelModeUpdatedAt', null);
        expect(s).toHaveProperty('effortLevelUpdatedAt', null);
    });

    it('GET-ACTIVE-02: returns effortLevelUpdatedAt as epoch ms when set', async () => {
        const ts = new Date('2026-07-22T12:00:00.000Z');
        const session = state.sessions[0] as any;
        session.effortLevel = 'medium';
        session.effortLevelUpdatedAt = ts;

        const res = await app.inject({ method: 'GET', url: '/v2/sessions/active' });
        const { sessions } = JSON.parse(res.body);
        expect(sessions[0].effortLevel).toBe('medium');
        expect(sessions[0].effortLevelUpdatedAt).toBe(ts.getTime());
    });
});

// ---------------------------------------------------------------------------
// Tests: GET /v2/sessions (cursor-based pagination)
// ---------------------------------------------------------------------------
describe('GET /v2/sessions — new LWW fields', () => {
    let app: FastifyInstance;

    beforeEach(async () => {
        resetState();
        app = await createApp();
    });

    afterEach(async () => {
        await app.close();
    });

    it('GET-V2-01: returns effortLevel and *UpdatedAt fields (null for pristine session)', async () => {
        const res = await app.inject({ method: 'GET', url: '/v2/sessions' });
        expect(res.statusCode).toBe(200);

        const { sessions } = JSON.parse(res.body);
        expect(sessions).toHaveLength(1);
        const s = sessions[0];

        expect(s).toHaveProperty('effortLevel', null);
        expect(s).toHaveProperty('permissionModeUpdatedAt', null);
        expect(s).toHaveProperty('modelModeUpdatedAt', null);
        expect(s).toHaveProperty('effortLevelUpdatedAt', null);
    });

    it('GET-V2-02: returns effortLevelUpdatedAt as epoch ms when set', async () => {
        const ts = new Date('2026-07-22T08:00:00.000Z');
        const session = state.sessions[0] as any;
        session.effortLevel = 'high';
        session.effortLevelUpdatedAt = ts;

        const res = await app.inject({ method: 'GET', url: '/v2/sessions' });
        const { sessions } = JSON.parse(res.body);
        expect(sessions[0].effortLevel).toBe('high');
        expect(sessions[0].effortLevelUpdatedAt).toBe(ts.getTime());
    });

    it('GET-V2-03: permissionModeUpdatedAt returned when set, others null', async () => {
        const ts = new Date('2026-07-22T09:00:00.000Z');
        const session = state.sessions[0] as any;
        session.permissionMode = 'default';
        session.permissionModeUpdatedAt = ts;

        const res = await app.inject({ method: 'GET', url: '/v2/sessions' });
        const { sessions } = JSON.parse(res.body);
        const s = sessions[0];

        expect(s.permissionModeUpdatedAt).toBe(ts.getTime());
        expect(s.modelModeUpdatedAt).toBeNull();
        expect(s.effortLevelUpdatedAt).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// Tests: PATCH /v1/sessions/:sessionId — effortLevel passthrough
// ---------------------------------------------------------------------------
describe('PATCH /v1/sessions/:sessionId — effortLevel passthrough', () => {
    let app: FastifyInstance;

    beforeEach(async () => {
        resetState();
        configUpdateMock.mockClear();
        app = await createApp();
    });

    afterEach(async () => {
        await app.close();
    });

    it('PATCH-01: effortLevel passed to sessionConfigUpdate and returns 200', async () => {
        const res = await app.inject({
            method: 'PATCH',
            url: '/v1/sessions/session-001',
            payload: { effortLevel: 'high' },
        });
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body)).toEqual({ success: true });
        expect(configUpdateMock).toHaveBeenCalledTimes(1);
        const [, , body] = configUpdateMock.mock.calls[0];
        expect(body.effortLevel).toBe('high');
    });

    it('PATCH-02: empty body returns 400 (refine: at least one field)', async () => {
        const res = await app.inject({
            method: 'PATCH',
            url: '/v1/sessions/session-001',
            payload: {},
        });
        expect(res.statusCode).toBe(400);
    });

    it('PATCH-03: configUpdate returning false → 404', async () => {
        configUpdateMock.mockResolvedValueOnce(false);
        const res = await app.inject({
            method: 'PATCH',
            url: '/v1/sessions/non-existent',
            payload: { effortLevel: 'low' },
        });
        expect(res.statusCode).toBe(404);
    });

    it('PATCH-04: effortLevel null accepted (explicit clear)', async () => {
        const res = await app.inject({
            method: 'PATCH',
            url: '/v1/sessions/session-001',
            payload: { effortLevel: null },
        });
        expect(res.statusCode).toBe(200);
        const [, , body] = configUpdateMock.mock.calls[0];
        expect(body.effortLevel).toBeNull();
    });
});
