import { t } from '@/text';
import type { ResumeErrorCode } from '@/sync/ops';

/**
 * Maps a resume `error` result to the user-facing message (BUG-RESUME-01 AC-2, M4).
 *
 * Classification is by structured `errorCode` only — never by matching English
 * substrings of `errorMessage` (daemon wording drift / i18n would silently break
 * substring matching). Unknown / absent codes fall back to passing the daemon
 * message through verbatim so nothing is a black box (AC-2-3).
 *
 * Lives in its own module (no React/RN imports) so the classification is
 * unit-testable without pulling the whole hook dependency graph.
 */
export function resolveResumeErrorMessage(result: { errorMessage: string; errorCode?: ResumeErrorCode }): string {
    if (result.errorCode === 'session-not-tracked') {
        return t('sessionInfo.resumeSessionNotTracked');
    }
    return result.errorMessage;
}
