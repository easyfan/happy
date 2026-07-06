/**
 * BUG-RESUME-01 AC-2 (cli side): resume RPC wrapper must RETURN structured
 * error results (not throw), so `{type:'error', errorCode?, errorMessage}`
 * survives the RpcHandlerManager encryption round-trip and reaches the app
 * with its `type` (and optional `errorCode`) intact.
 *
 * Strategy (no mocks): drive a real RpcHandlerManager with real encrypt/decrypt.
 * The wrapper switch lives inline in a private apiMachine method, so we
 * replicate that exact switch here as the registered handler (real function
 * injection, not a mock lib) and assert the effect on handleRequest's output.
 * This path really traverses RpcHandlerManager.ts:86 (return → normal encrypt,
 * preserves shape) vs L89 (throw → catch → bare {error}, drops shape),
 * precisely reproducing the bug chain.
 */

import { describe, expect, it, expectTypeOf } from 'vitest';
import tweetnacl from 'tweetnacl';
import { RpcHandlerManager } from '@/api/rpc/RpcHandlerManager';
import { encrypt, decrypt, encodeBase64, decodeBase64 } from '@/api/encryption';
import type { SpawnSessionResult, ResumeErrorCode } from '@/modules/common/registerCommonHandlers';

// Exact replica of the resume RPC wrapper switch (apiMachine.ts
// syncResumeSessionRpcRegistration). `handler` is the injected resumeSession
// impl (a real function, not a mock). Keep in lockstep with the production
// wrapper — the test's whole point is that `case 'error'` RETURNS.
async function resumeWrapper(
    params: any,
    handler: (sessionId: string, options?: { model?: string; permissionMode?: string }) => Promise<SpawnSessionResult>,
): Promise<any> {
    const { sessionId, model, permissionMode } = params || {};
    if (!sessionId || typeof sessionId !== 'string') {
        throw new Error('Session ID is required');
    }
    const result = await handler(sessionId, { model, permissionMode });
    switch (result.type) {
        case 'success':
            return { type: 'success', sessionId: result.sessionId };
        case 'requestToApproveDirectoryCreation':
            return result;
        case 'error':
            return result;
        default:
            throw new Error('Unknown resume result type');
    }
}

// Build a real RpcHandlerManager, register the wrapper bound to `resumeImpl`,
// then encrypt params → handleRequest → decrypt response, exactly like the
// server-mediated app→daemon RPC round-trip.
async function roundTrip(
    resumeImpl: (sessionId: string, options?: { model?: string; permissionMode?: string }) => Promise<SpawnSessionResult>,
    params: any = { sessionId: 'sess-1' },
): Promise<any> {
    const encryptionKey = tweetnacl.randomBytes(32);
    const variant = 'dataKey' as const;
    const scopePrefix = 'machine-1';
    const mgr = new RpcHandlerManager({
        scopePrefix,
        encryptionKey,
        encryptionVariant: variant,
        logger: () => { /* silence */ },
    });
    mgr.registerHandler('resume-happy-session', (p: any) => resumeWrapper(p, resumeImpl));

    const encryptedParams = encodeBase64(encrypt(encryptionKey, variant, params));
    const encryptedResponse = await mgr.handleRequest({
        method: `${scopePrefix}:resume-happy-session`,
        params: encryptedParams,
    });
    return decrypt(encryptionKey, variant, decodeBase64(encryptedResponse));
}

describe('resume RPC wrapper — error result flows through RPC round-trip (BUG-RESUME-01 AC-2)', () => {
    it('S1: success result round-trips with type=success', async () => {
        const decoded = await roundTrip(async () => ({ type: 'success', sessionId: 'new-sess' }));
        expect(decoded.type).toBe('success');
        expect(decoded.sessionId).toBe('new-sess');
    });

    it('S2 (core): not-tracked error RETURNS — type and errorCode survive round-trip', async () => {
        const errorMessage = 'Session sess-1 is not tracked by this daemon.';
        const decoded = await roundTrip(async () => ({
            type: 'error',
            errorCode: 'session-not-tracked',
            errorMessage,
        }));
        // Pre-fix this path decrypted to a bare {error} (no .type / .errorCode).
        expect(decoded.type).toBe('error');
        expect(decoded.errorCode).toBe('session-not-tracked');
        expect(decoded.errorMessage).toBe(errorMessage);
        expect(decoded.error).toBeUndefined();
    });

    it('S3: error without errorCode transparently passes through (847/850/897 paths)', async () => {
        const errorMessage = 'Session sess-1 has no metadata. Cannot resume.';
        const decoded = await roundTrip(async () => ({ type: 'error', errorMessage }));
        expect(decoded.type).toBe('error');
        expect(decoded.errorCode).toBeUndefined();
        expect(decoded.errorMessage).toBe(errorMessage);
    });

    it('S4: unknown result type hits default throw → catch → bare {error} (FR-004 fallback)', async () => {
        const decoded = await roundTrip(async () => ({ type: 'weird' } as any));
        // default: throw → RpcHandlerManager catch (L89) → {error: message}, no .type.
        expect(decoded.type).toBeUndefined();
        expect(decoded.error).toBe('Unknown resume result type');
    });

    it('S5: requestToApproveDirectoryCreation passes through unchanged (regression guard)', async () => {
        const decoded = await roundTrip(async () => ({
            type: 'requestToApproveDirectoryCreation',
            directory: '/tmp/foo',
        }));
        expect(decoded.type).toBe('requestToApproveDirectoryCreation');
        expect(decoded.directory).toBe('/tmp/foo');
    });

    it('S2b: invalid params (missing sessionId) still throws → bare {error}, unaffected by change', async () => {
        const decoded = await roundTrip(async () => ({ type: 'success', sessionId: 'x' }), {});
        expect(decoded.type).toBeUndefined();
        expect(decoded.error).toBe('Session ID is required');
    });
});

describe('SpawnSessionResult type — errorCode optionality (compile-time, S6)', () => {
    it('error result without errorCode is a valid SpawnSessionResult (847/850/897 unchanged)', () => {
        const noCode: SpawnSessionResult = { type: 'error', errorMessage: 'x' };
        expect(noCode.type).toBe('error');
        // errorCode is optional on the error branch — omitting it type-checks.
        type ErrorBranch = Extract<SpawnSessionResult, { type: 'error' }>;
        expectTypeOf<ErrorBranch['errorCode']>().toEqualTypeOf<ResumeErrorCode | undefined>();
    });

    it('error result with errorCode is valid and errorCode is the ResumeErrorCode union', () => {
        const withCode: SpawnSessionResult = {
            type: 'error',
            errorMessage: 'x',
            errorCode: 'session-not-tracked',
        };
        expect(withCode.errorCode).toBe('session-not-tracked');
        expectTypeOf<ResumeErrorCode>().toEqualTypeOf<'session-not-tracked'>();
    });
});
