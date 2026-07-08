/**
 * Lightweight structured error for happy-cli.
 *
 * happy-cli historically used bare `throw new Error(msg)` with no machine-readable
 * error code. The DAEMON-RESILIENCE-P1 work (M2 launchagent-supervisor / M3
 * install-state-migration) needs structured error codes so callers can branch on
 * the failure kind (e.g. downgrade a `LAUNCHCTL_KICKSTART_FAILED` handoff to a
 * fallback spawn, or print a user remediation for `DAEMON_ENV_INCOMPLETE`).
 *
 * Deliberately minimal — no third-party error framework (architecture constraint:
 * no new dependencies). Just `code` + `message` + optional `detail`.
 */

export class AppError extends Error {
    public readonly code: string;
    public readonly detail?: unknown;

    constructor(code: string, message: string, detail?: unknown) {
        super(message);
        this.name = 'AppError';
        this.code = code;
        this.detail = detail;
        // Preserve prototype chain when transpiled to ES5-ish targets.
        Object.setPrototypeOf(this, AppError.prototype);
    }
}

/** Narrow an unknown caught value to AppError, optionally matching a code. */
export function isAppError(error: unknown, code?: string): error is AppError {
    return error instanceof AppError && (code === undefined || error.code === code);
}
