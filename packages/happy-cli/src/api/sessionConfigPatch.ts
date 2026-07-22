/**
 * Fire-and-forget helper for reporting CLI-resolved initial session config
 * to the server immediately after session creation (spawn-time config sync).
 *
 * Design: CFGSYNC-cli (FEAT-16, P5-A)
 * Route: PATCH /v1/sessions/:sessionId (server: sessionConfigUpdate.ts)
 *
 * Called once per new session spawn, right after getOrCreateSession() returns
 * a non-null response. This call is strictly fire-and-forget — failures are
 * silently swallowed so session startup is never blocked by config sync.
 *
 * Encryption boundary: permissionMode and modelMode are control metadata
 * (not user content), transmitted as plaintext per architecture §7 exemption.
 * No TweetNaCl involvement.
 */

import { getHappyAxios } from '@/utils/happyAxios';
import { configuration } from '@/configuration';
import { logger } from '@/ui/logger';

export interface SessionConfigPatchBody {
    permissionMode?: string | null;
    modelMode?: string | null;
    effortLevel?: string | null;
}

/**
 * Fire-and-forget PATCH /v1/sessions/:sessionId to report CLI-resolved
 * initial config to the server immediately after session creation.
 *
 * - Does nothing if body contains no non-undefined field (guard enforced internally).
 * - Does not return a Promise; callers must not await it.
 * - Failures are logged at DEBUG level only and never propagate.
 *
 * @param token     Bearer token from Credentials.token
 * @param sessionId The newly-created session ID (response.id from getOrCreateSession)
 * @param body      Partial config to report; effortLevel reserved for CFGSYNC-CLI-2
 */
export function patchSessionConfigFireAndForget(
    token: string,
    sessionId: string,
    body: SessionConfigPatchBody,
): void {
    if (
        body.permissionMode === undefined &&
        body.modelMode === undefined &&
        body.effortLevel === undefined
    ) {
        return;
    }

    const url = `${configuration.serverUrl}/v1/sessions/${encodeURIComponent(sessionId)}`;
    const http = getHappyAxios();

    http.patch(
        url,
        body,
        {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
                'X-Happy-Client': `cli-coding-session/${configuration.currentCliVersion}`,
            },
            timeout: 10000,
        },
    ).catch((err: unknown) => {
        logger.debug('[CFGSYNC-cli] PATCH session config failed (best-effort, ignored)', {
            sessionId,
            error: err instanceof Error ? err.message : String(err),
        });
    });
}
