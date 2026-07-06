import { describe, it, expect } from 'vitest';
import { resolveResumeErrorMessage } from './resumeErrorMapping';
import { t } from '@/text';

// BUG-RESUME-01 AC-2 (app side, M4): resume `error` result classification.
// Uses the real t() and the real cli-produced result shape (no mocks) so the
// cross-package literal contract 'session-not-tracked' is exercised end-to-end.
describe('resolveResumeErrorMessage', () => {
    it('T1: classifies session-not-tracked to the dedicated message', () => {
        // Real cli daemon not-tracked error shape (cli-resume-errorcode M1/M2 output).
        const result = {
            type: 'error' as const,
            errorCode: 'session-not-tracked' as const,
            errorMessage: 'Session <id> is not tracked by this daemon',
        };
        expect(resolveResumeErrorMessage(result)).toBe(t('sessionInfo.resumeSessionNotTracked'));
    });

    it('T2: passes daemon message through when no errorCode (fallback, not a black box)', () => {
        const result = { type: 'error' as const, errorMessage: 'boom' };
        expect(resolveResumeErrorMessage(result)).toBe('boom');
    });

    it('T3: passes daemon message through for an unknown/future errorCode', () => {
        // Simulates an old app vs newer daemon that emits a code this app does not know.
        const result = {
            type: 'error' as const,
            errorCode: 'some-future-code' as unknown as 'session-not-tracked',
            errorMessage: 'future daemon error',
        };
        expect(resolveResumeErrorMessage(result)).toBe('future daemon error');
    });

    it('does not use substring matching of errorMessage', () => {
        // errorMessage literally contains the phrase, but without the structured
        // code we MUST fall back to passthrough, never classify.
        const result = {
            type: 'error' as const,
            errorMessage: 'session-not-tracked wording appears here',
        };
        expect(resolveResumeErrorMessage(result)).toBe('session-not-tracked wording appears here');
        expect(resolveResumeErrorMessage(result)).not.toBe(t('sessionInfo.resumeSessionNotTracked'));
    });
});
