/**
 * Single authoritative env dependency list for the daemon (C9).
 *
 * launchd does NOT inherit the interactive shell environment. When the daemon is
 * launched by a LaunchAgent (M2), only the vars we explicitly write into the plist
 * `EnvironmentVariables` dict are present. Missing PATH/HOME would make the daemon
 * connect to the wrong server, resolve the wrong home dir, or fail to spawn child
 * sessions (claude/codex/caffeinate). This module is the single source of truth
 * consumed by both plist generation (buildAgentPlist) and any runtime env checks.
 *
 * Two tiers:
 *  - required: missing → AppError('DAEMON_ENV_INCOMPLETE') (block plist generation
 *    rather than emit a plist that boots into a broken daemon).
 *  - optional: only written into the plist when present in the host env (defaults
 *    live in configuration.ts, so absence is fine).
 *
 * SECURITY (CLAUDE.md encryption boundary): this list intentionally contains NO
 * secrets — no access.key, no auth token. Those are read by the daemon at startup
 * from ~/.happy/access.key, never passed via env / plist.
 */

import { AppError } from '@/utils/errors';

export const DAEMON_REQUIRED_ENV = {
    // Required: launchd won't inherit shell env; these are load-bearing for startup.
    required: [
        'PATH', // child session spawn (claude/codex) + caffeinate need binary resolution
        'HOME', // homedir() dependency; referenced across the os layer
    ] as const,
    // Optional passthrough: written into plist only when present in the host env.
    optional: [
        'HAPPY_HOME_DIR', // configuration.ts:40 — state/lock/logs dir
        'HAPPY_SERVER_URL', // configuration.ts:56/67 — non-default server (dev/self-host)
        'HAPPY_WEBAPP_URL', // configuration.ts:60
        'HAPPY_VARIANT', // configuration.ts:77 — decides label + home dir (dev/stable)
        'HAPPY_EXPERIMENTAL',
        'HAPPY_DISABLE_CAFFEINATE',
        'HAPPY_DAEMON_HEARTBEAT_INTERVAL', // run.ts heartbeat interval
        'HAPPY_AUTH_METHOD', // ui/auth.ts
    ] as const,
} as const;

/**
 * Collect the daemon-relevant env from `source` (defaults to process.env), to be
 * written into the plist EnvironmentVariables dict.
 *
 * @throws AppError('DAEMON_ENV_INCOMPLETE', { missing }) when any required var is
 *         absent or empty. Optional vars are copied only when present & non-empty
 *         (never written as empty strings).
 */
export function collectDaemonEnv(source: NodeJS.ProcessEnv = process.env): Record<string, string> {
    const result: Record<string, string> = {};
    const missing: string[] = [];

    for (const key of DAEMON_REQUIRED_ENV.required) {
        const value = source[key];
        if (typeof value === 'string' && value.length > 0) {
            result[key] = value;
        } else {
            missing.push(key);
        }
    }

    if (missing.length > 0) {
        throw new AppError(
            'DAEMON_ENV_INCOMPLETE',
            `Daemon cannot be supervised: required environment variable(s) missing: ${missing.join(', ')}`,
            { missing }
        );
    }

    for (const key of DAEMON_REQUIRED_ENV.optional) {
        const value = source[key];
        if (typeof value === 'string' && value.length > 0) {
            result[key] = value;
        }
    }

    return result;
}
