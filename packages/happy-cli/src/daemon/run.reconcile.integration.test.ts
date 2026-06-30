/**
 * Integration tests for daemon zombie active-session reconcile (BUG-06).
 *
 * Exercises `cancelOrphanedPermissions` against a REAL standalone server +
 * REAL socket — no mocking. Each test creates a real session (server defaults
 * `active = true`), wires up the local-ownership inputs (`persisted` +
 * `pidToTrackedSession`), invokes the reconcile, then polls GET /v1/sessions
 * and hard-asserts the resulting `active` flag (and, for AC-3, the agentState).
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, rmSync } from 'fs';
import { join } from 'path';
import type { AgentState, Metadata, Session } from '@/api/types';
import type { PersistedSession } from '@/persistence';
import type { TrackedSession } from '@/daemon/types';
import { ApiClient } from '@/api/api';
import { readCredentials } from '@/persistence';
import { cancelOrphanedPermissions } from '@/daemon/run';
import { configuration } from '@/configuration';
import { getHappyAxios } from '@/utils/happyAxios';
import { decodeBase64, encodeBase64, decrypt } from '@/api/encryption';

type ServerSession = {
    id: string;
    seq: number;
    agentState: string | null;
    agentStateVersion: number;
    metadata: string;
    metadataVersion: number;
    active: boolean;
};

function buildMetadata(): Metadata {
    return {
        path: '/test/reconcile',
        host: 'reconcile-host',
        homeDir: '/test/home',
        happyHomeDir: '/test/happy-home',
        happyLibDir: '/test/happy-lib',
        happyToolsDir: '/test/happy-tools',
    };
}

function persistedFromSession(session: Session): PersistedSession {
    return {
        encryptionKey: encodeBase64(session.encryptionKey),
        encryptionVariant: session.encryptionVariant,
        seq: session.seq,
        metadataVersion: session.metadataVersion,
        agentStateVersion: session.agentStateVersion,
        metadata: session.metadata,
        savedAt: Date.now(),
    };
}

async function fetchServerSession(token: string, id: string): Promise<ServerSession | undefined> {
    const http = getHappyAxios();
    const resp = await http.get<{ sessions: ServerSession[] }>(
        `${configuration.serverUrl}/v1/sessions`,
        {
            headers: {
                'Authorization': `Bearer ${token}`,
                'X-Happy-Client': `cli-daemon/${configuration.currentCliVersion}`,
            },
            timeout: 10000,
        },
    );
    return (resp.data?.sessions ?? []).find(s => s.id === id);
}

async function pollServerSession(
    token: string,
    id: string,
    predicate: (s: ServerSession) => boolean,
    timeout = 8000,
    interval = 200,
): Promise<ServerSession> {
    const start = Date.now();
    let last: ServerSession | undefined;
    while (Date.now() - start < timeout) {
        last = await fetchServerSession(token, id);
        if (last && predicate(last)) return last;
        await new Promise(resolve => setTimeout(resolve, interval));
    }
    throw new Error(`Timeout waiting for session ${id} predicate; last=${JSON.stringify(last)}`);
}

describe('Daemon zombie active reconcile (BUG-06)', { timeout: 120_000 }, () => {
    let api: ApiClient;
    let token: string;
    let tag = 0;

    beforeEach(async () => {
        // The standalone server runs over plain http://localhost. A stale
        // server-ip.cache (hostname=localhost) would make ApiSessionClient inject
        // an https-based CachedDnsAgent and fail the WebSocket handshake. Clear it
        // so the temporary reconcile clients connect natively (test-env isolation
        // only — no production code path is mocked).
        const cacheFile = join(configuration.happyHomeDir, 'server-ip.cache');
        if (existsSync(cacheFile)) {
            rmSync(cacheFile, { force: true });
        }

        const credentials = await readCredentials();
        if (!credentials) {
            throw new Error('No credentials in integration env');
        }
        token = credentials.token;
        api = await ApiClient.create(credentials);
    });

    afterEach(async () => {
        // Sessions are created fresh per-test with unique tags; nothing global to tear down.
    });

    async function createActiveSession(): Promise<Session> {
        const session = await api.getOrCreateSession({
            tag: `reconcile-${Date.now()}-${tag++}`,
            metadata: buildMetadata(),
            state: null,
        });
        if (!session) {
            throw new Error('Failed to create session against server');
        }
        // Server schema defaults active=true on creation; confirm before reconcile.
        const server = await fetchServerSession(token, session.id);
        expect(server, 'session should exist on server after create').toBeDefined();
        expect(server!.active, 'freshly created session should be active=true').toBe(true);
        return session;
    }

    // Write an agentState to the session via a real client (the server ignores the
    // agentState passed at create time, so a zombie session's leftover state can only
    // be reproduced through update-state). Returns the latest Session with the bumped
    // agentStateVersion. `withPending` controls whether a pending request is included.
    async function seedAgentState(session: Session, withPending: boolean, requestId: string, createdAt: number): Promise<Session> {
        const client = api.sessionSyncClient(session);
        try {
            await client.awaitConnected();
            client.updateAgentState(() => withPending
                ? { requests: { [requestId]: { tool: 'Bash', arguments: { command: 'ls' }, createdAt } } }
                : { requests: {}, controlledByUser: false });
            await client.flush();
        } finally {
            await client.close();
        }
        const seeded = await pollServerSession(token, session.id, s => {
            const st = s.agentState
                ? (decrypt(session.encryptionKey, session.encryptionVariant, decodeBase64(s.agentState)) as AgentState | null)
                : null;
            if (st == null) return false;
            return withPending ? st.requests?.[requestId] != null : true;
        });
        return { ...session, agentState: null, agentStateVersion: seeded.agentStateVersion };
    }

    it('AC-1a: reconciles a zombie active session with agentState=null', async () => {
        const session = await createActiveSession();
        const persisted: Record<string, PersistedSession> = {
            [session.id]: persistedFromSession(session),
        };
        const pidToTrackedSession = new Map<number, TrackedSession>();

        await cancelOrphanedPermissions(api, token, persisted, pidToTrackedSession);

        const after = await pollServerSession(token, session.id, s => s.active === false);
        expect(after.active).toBe(false);
    });

    it('AC-1b: reconciles a zombie active session that has agentState (no pending)', async () => {
        // agentState present but no pending requests — proves the reconcile block
        // runs regardless of the `if (!ss.agentState) continue` guard placement
        // (with agentState present, the guard would NOT skip, but the pending-count
        // guard would; reconcile must still flip active independently).
        const created = await createActiveSession();
        const session = await seedAgentState(created, false, 'unused', Date.now());
        const persisted: Record<string, PersistedSession> = {
            [session.id]: persistedFromSession(session),
        };
        const pidToTrackedSession = new Map<number, TrackedSession>();

        await cancelOrphanedPermissions(api, token, persisted, pidToTrackedSession);

        const after = await pollServerSession(token, session.id, s => s.active === false);
        expect(after.active).toBe(false);
    });

    it('AC-2a: does NOT reconcile a session with a live local process', async () => {
        const session = await createActiveSession();
        const persisted: Record<string, PersistedSession> = {
            [session.id]: persistedFromSession(session),
        };
        const pidToTrackedSession = new Map<number, TrackedSession>([
            [12345, { startedBy: 'daemon', happySessionId: session.id, pid: 12345 }],
        ]);

        await cancelOrphanedPermissions(api, token, persisted, pidToTrackedSession);

        // Give any (erroneous) session-end time to land, then assert still active.
        await new Promise(resolve => setTimeout(resolve, 1500));
        const after = await fetchServerSession(token, session.id);
        expect(after?.active, 'live-local session must stay active (liveLocally guard)').toBe(true);
    });

    it('AC-2b: does NOT reconcile a session not owned by this machine (no persisted)', async () => {
        const session = await createActiveSession();
        // persisted intentionally omits this session — another machine owns it.
        const persisted: Record<string, PersistedSession> = {};
        const pidToTrackedSession = new Map<number, TrackedSession>();

        await cancelOrphanedPermissions(api, token, persisted, pidToTrackedSession);

        await new Promise(resolve => setTimeout(resolve, 1500));
        const after = await fetchServerSession(token, session.id);
        expect(after?.active, 'non-owned session must stay active (owned guard)').toBe(true);
    });

    it('AC-3: reconcile and orphaned-permission cleanup coexist on the same session', async () => {
        const createdAt = Date.now();
        const created = await createActiveSession();
        // Seed a real pending permission request (server ignores create-time state).
        const session = await seedAgentState(created, true, 'req-1', createdAt);
        const persisted: Record<string, PersistedSession> = {
            [session.id]: persistedFromSession(session),
        };
        const pidToTrackedSession = new Map<number, TrackedSession>();

        await cancelOrphanedPermissions(api, token, persisted, pidToTrackedSession);

        // Poll until BOTH effects have landed: active flips false (reconcile path)
        // AND the pending permission request has been canceled (cleanup path).
        const decode = (s: ServerSession): AgentState | null => s.agentState
            ? (decrypt(session.encryptionKey, session.encryptionVariant, decodeBase64(s.agentState)) as AgentState | null)
            : null;
        const after = await pollServerSession(token, session.id, s => {
            const st = decode(s);
            const stillPending = Object.keys(st?.requests ?? {}).length;
            return s.active === false && stillPending === 0 && st?.completedRequests?.['req-1'] != null;
        });
        expect(after.active).toBe(false);

        // And pending permission requests must be cleared / moved to canceled.
        const decrypted = decode(after);
        const pending = decrypted?.requests ?? {};
        expect(Object.keys(pending).length, 'pending requests should be cleared').toBe(0);
        const completed = decrypted?.completedRequests ?? {};
        expect(completed['req-1']?.status, 'orphaned request should be canceled').toBe('canceled');
    });

    it('edge: GET failure path is swallowed (no throw, daemon startup unaffected)', async () => {
        // Pass a bogus token so the GET /v1/sessions returns 401 — the function must
        // catch internally and resolve without throwing.
        await expect(
            cancelOrphanedPermissions(api, 'invalid-token-xyz', {}, new Map()),
        ).resolves.toBeUndefined();
    });

    it('edge: a per-session reconcile failure does not block other sessions', async () => {
        // First session has a CORRUPT persisted encryptionKey → decodeBase64/encrypt
        // path throws inside the reconcile block. The per-session try/catch must
        // isolate it so the second (valid) session is still reconciled.
        // Create `good` first, then `bad`, so `bad` sorts first (updatedAt desc) and
        // is processed before `good` — the un-isolated bug would abort the loop on
        // `bad` and leave `good` active.
        const good = await createActiveSession();
        const bad = await createActiveSession();
        const persisted: Record<string, PersistedSession> = {
            [bad.id]: { ...persistedFromSession(bad), encryptionKey: '!!!not-base64!!!' },
            [good.id]: persistedFromSession(good),
        };
        const pidToTrackedSession = new Map<number, TrackedSession>();

        await expect(
            cancelOrphanedPermissions(api, token, persisted, pidToTrackedSession),
        ).resolves.toBeUndefined();

        // The valid session must still be reconciled despite the bad one throwing.
        const afterGood = await pollServerSession(token, good.id, s => s.active === false);
        expect(afterGood.active).toBe(false);
    });
});
