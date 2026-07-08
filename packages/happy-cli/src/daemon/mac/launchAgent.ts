/**
 * macOS user-level LaunchAgent supervisor for the Happy daemon (M2, FR-3).
 *
 * Provides OS-level crash self-healing: the daemon runs under a user LaunchAgent
 * (`~/Library/LaunchAgents/{label}.plist`, no sudo — NFR-003) with
 * `KeepAlive.SuccessfulExit=false` + `ThrottleInterval`, so launchd restarts it
 * on abnormal exit (crash / OOM / SIGKILL / non-zero exit) but leaves it stopped
 * on the 4 intentional `exit(0)` handoff points in run.ts.
 *
 * Uses the MODERN launchctl API exclusively (bootstrap / bootout / kickstart -k /
 * print, all in the `gui/<uid>` domain). Legacy `load`/`unload` are deliberately
 * NOT used: their semantics against an already-exited label are undefined, and the
 * self-upgrade handoff (C1 A-fix) requires `kickstart -k` to bring up a *supervised*
 * instance from the latest on-disk bundle (a `load` would be a no-op and would not
 * re-parent the orphaned grandchild the old detached-spawn approach produced).
 *
 * launchd semantics used here were empirically confirmed on macOS 25.5 (Phase 5
 * plist spike, C7): SuccessfulExit=false → exit 0 not restarted / exit≠0 restarted;
 * ThrottleInterval honored as min restart interval; RunAtLoad fires on bootstrap;
 * kickstart -k kills + relaunches from latest bundle; print reports
 * `runs = N` / `last exit code = M`; bootout of an unloaded label exits non-zero.
 */

import { spawn } from 'cross-spawn';
import { writeFile, mkdir, unlink, readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { configuration } from '@/configuration';
import { projectPath } from '@/projectPath';
import { collectDaemonEnv } from '@/daemon/daemonEnv';
import { AppError } from '@/utils/errors';

// New user-level LaunchAgent label (distinct from the legacy sudo LaunchDaemon
// 'com.happy-cli.daemon' which lives in the `system` domain, owned by M3).
// variant-aware: stable and dev use different labels so a dev daemon under debug
// never kills the stable production daemon (and vice versa) — P2-1.
const AGENT_LABEL_STABLE = 'com.happy-cli.agent';
const AGENT_LABEL_DEV = 'com.happy-cli.agent.dev';

/** Result of running a launchctl subcommand. */
interface LaunchctlResult {
    code: number | null;
    stdout: string;
    stderr: string;
}

function runLaunchctl(args: string[]): Promise<LaunchctlResult> {
    return new Promise((resolve) => {
        const child = spawn('launchctl', args, { windowsHide: true });
        let stdout = '';
        let stderr = '';
        child.stdout?.on('data', (d) => { stdout += d.toString(); });
        child.stderr?.on('data', (d) => { stderr += d.toString(); });
        child.on('error', (err) => {
            // launchctl not found / spawn failure — treat as a failed invocation,
            // never let it crash the daemon (this is a supervisor, not a crash source).
            resolve({ code: -1, stdout, stderr: stderr || String(err) });
        });
        child.on('close', (code) => resolve({ code, stdout, stderr }));
    });
}

/**
 * LaunchAgent label, variant-aware (HAPPY_VARIANT env, see configuration.ts:77).
 *   stable → com.happy-cli.agent   dev → com.happy-cli.agent.dev
 */
export function getAgentLabel(): string {
    const variant = process.env.HAPPY_VARIANT || 'stable';
    return variant === 'dev' ? AGENT_LABEL_DEV : AGENT_LABEL_STABLE;
}

/** plist absolute path: ~/Library/LaunchAgents/{label}.plist (user-level, no sudo). */
export function getAgentPlistPath(): string {
    return join(homedir(), 'Library', 'LaunchAgents', `${getAgentLabel()}.plist`);
}

/**
 * GUI-domain service target for launchctl kickstart/print/bootout: 'gui/<uid>/<label>'.
 * uid from process.getuid() (Node built-in, always present on macOS).
 */
export function getAgentServiceTarget(): string {
    const uid = typeof process.getuid === 'function' ? process.getuid() : 0;
    return `gui/${uid}/${getAgentLabel()}`;
}

/** GUI-domain bootstrap target: 'gui/<uid>'. */
function getAgentDomainTarget(): string {
    const uid = typeof process.getuid === 'function' ? process.getuid() : 0;
    return `gui/${uid}`;
}

function xmlEscape(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/**
 * Generate the LaunchAgent plist XML (pure function — no disk I/O, unit-testable).
 * envOverrides is passed to collectDaemonEnv for test injection.
 *
 * @throws AppError('DAEMON_ENV_INCOMPLETE') via collectDaemonEnv when a required
 *         env var (PATH/HOME) is missing.
 */
export function buildAgentPlist(params: {
    label: string;
    nodeExecPath: string; // process.execPath (absolute node path, C2 — never bare 'node')
    entrypoint: string; // projectPath()/dist/index.mjs (never hard-coded argv)
    env: Record<string, string>; // collectDaemonEnv() product
    stdoutPath: string;
    stderrPath: string;
    throttleIntervalSec: number;
}): string {
    // Guard the throttle floor (launchd convention ≥ 10s; NFR-002 restart storm).
    const throttle = Math.max(10, Math.floor(params.throttleIntervalSec));

    // ProgramArguments: absolute node + --no-warnings/--no-deprecation (same as
    // spawnHappyCLI) + real bundle entrypoint + real subcommand `daemon start-sync`
    // (index.ts:527). NEVER bare 'node', NEVER the invalid legacy 'happy-daemon'.
    const programArgs = [
        params.nodeExecPath,
        '--no-warnings',
        '--no-deprecation',
        params.entrypoint,
        'daemon',
        'start-sync',
    ];

    const programArgsXml = programArgs
        .map((arg) => `        <string>${xmlEscape(arg)}</string>`)
        .join('\n');

    const envXml = Object.entries(params.env)
        .map(([key, value]) => `        <key>${xmlEscape(key)}</key>\n        <string>${xmlEscape(value)}</string>`)
        .join('\n');

    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${xmlEscape(params.label)}</string>
    <key>ProgramArguments</key>
    <array>
${programArgsXml}
    </array>
    <key>KeepAlive</key>
    <dict>
        <key>SuccessfulExit</key>
        <false/>
    </dict>
    <key>ThrottleInterval</key>
    <integer>${throttle}</integer>
    <key>RunAtLoad</key>
    <true/>
    <key>EnvironmentVariables</key>
    <dict>
${envXml}
    </dict>
    <key>StandardOutPath</key>
    <string>${xmlEscape(params.stdoutPath)}</string>
    <key>StandardErrorPath</key>
    <string>${xmlEscape(params.stderrPath)}</string>
</dict>
</plist>
`;
}

/** Assemble buildAgentPlist params from live configuration + process env. */
function assemblePlist(): string {
    const env = collectDaemonEnv();
    const label = getAgentLabel();
    const entrypoint = join(projectPath(), 'dist', 'index.mjs');
    return buildAgentPlist({
        label,
        nodeExecPath: process.execPath,
        entrypoint,
        env,
        stdoutPath: join(configuration.logsDir, 'launchagent.out.log'),
        stderrPath: join(configuration.logsDir, 'launchagent.err.log'),
        throttleIntervalSec: 30,
    });
}

/**
 * Write the plist + `launchctl bootstrap` (modern API, replaces legacy load).
 * Idempotent: bootout any pre-existing instance first, then bootstrap fresh.
 *
 * @throws AppError('DAEMON_ENV_INCOMPLETE') — required env missing (from collectDaemonEnv)
 * @throws AppError('LAUNCHAGENT_WRITE_FAILED') — plist write / dir create failed
 * @throws AppError('LAUNCHCTL_BOOTSTRAP_FAILED') — launchctl bootstrap failed
 */
export async function installAgent(): Promise<void> {
    // May throw DAEMON_ENV_INCOMPLETE — deliberately before any disk write so we
    // never emit a plist that would boot a broken daemon.
    const plist = assemblePlist();
    const plistPath = getAgentPlistPath();

    try {
        await mkdir(dirname(plistPath), { recursive: true });
        await mkdir(configuration.logsDir, { recursive: true });
        await writeFile(plistPath, plist, 'utf8');
    } catch (error) {
        throw new AppError(
            'LAUNCHAGENT_WRITE_FAILED',
            `Failed to write LaunchAgent plist at ${plistPath}`,
            error
        );
    }

    // Idempotent: remove any stale registration before bootstrapping the new plist.
    // A failed bootout (not currently loaded) is fine — bootstrap is the real assert.
    await runLaunchctl(['bootout', getAgentServiceTarget()]);

    const result = await runLaunchctl(['bootstrap', getAgentDomainTarget(), plistPath]);
    if (result.code !== 0) {
        throw new AppError(
            'LAUNCHCTL_BOOTSTRAP_FAILED',
            `launchctl bootstrap failed (exit ${result.code}): ${result.stderr.trim()}`,
            { code: result.code, stderr: result.stderr }
        );
    }
}

/**
 * Query whether the agent is loaded (launchctl print gui/<uid>/<label> exit 0).
 * Never throws: query failure / not-registered both return false.
 */
export async function isAgentLoaded(): Promise<boolean> {
    if (process.platform !== 'darwin') return false;
    const result = await runLaunchctl(['print', getAgentServiceTarget()]);
    return result.code === 0;
}

/**
 * C1 A-fix handoff②: `launchctl kickstart -k gui/<uid>/<label>`.
 * -k = kill the current instance then relaunch a SUPERVISED instance from the
 * latest on-disk bundle (eliminates the orphaned grandchild the old detached
 * spawn produced).
 *
 * @throws AppError('LAUNCHCTL_KICKSTART_FAILED') — caller (run.ts handoff②) MUST
 *         catch this and fall back to detached spawn so self-upgrade never drops
 *         the connection (see error handling in design).
 */
export async function kickstartAgent(): Promise<void> {
    const result = await runLaunchctl(['kickstart', '-k', getAgentServiceTarget()]);
    if (result.code !== 0) {
        throw new AppError(
            'LAUNCHCTL_KICKSTART_FAILED',
            `launchctl kickstart failed (exit ${result.code}): ${result.stderr.trim()}`,
            { code: result.code, stderr: result.stderr }
        );
    }
}

/**
 * C12 full uninstall: `launchctl bootout` + remove plist (does NOT kill the
 * currently-running instance — that is the caller's responsibility).
 * Idempotent: not-loaded / plist-not-present both count as success.
 *
 * @throws AppError('LAUNCHCTL_BOOTOUT_FAILED') — only on a REAL bootout failure
 *         (a "no such process" / not-loaded result is treated as success).
 */
export async function uninstallAgent(): Promise<void> {
    const target = getAgentServiceTarget();
    const result = await runLaunchctl(['bootout', target]);
    // Spike-confirmed: bootout of an unloaded label exits non-zero with
    // "Boot-out failed: 3: No such process". Treat "not loaded" as idempotent success.
    if (result.code !== 0) {
        const notLoaded = /no such process/i.test(result.stderr) || result.code === 3;
        if (!notLoaded) {
            throw new AppError(
                'LAUNCHCTL_BOOTOUT_FAILED',
                `launchctl bootout failed (exit ${result.code}): ${result.stderr.trim()}`,
                { code: result.code, stderr: result.stderr }
            );
        }
    }

    const plistPath = getAgentPlistPath();
    if (existsSync(plistPath)) {
        try {
            await unlink(plistPath);
        } catch (error) {
            throw new AppError(
                'LAUNCHAGENT_WRITE_FAILED',
                `Failed to remove LaunchAgent plist at ${plistPath}`,
                error
            );
        }
    }
}

/**
 * Parse `launchctl print` output for supervisor health. Exported for unit testing
 * the pure parse step (the launchctl invocation itself is real-OS glue).
 * Spike-confirmed field format: `runs = N`, `last exit code = M`, `state = ...`.
 */
export function parseSupervisorPrint(printOutput: string): {
    runs: number | null;
    lastExitCode: number | null;
    running: boolean;
} {
    const runsMatch = printOutput.match(/^\s*runs\s*=\s*(\d+)/m);
    const exitMatch = printOutput.match(/^\s*last exit code\s*=\s*(-?\d+)/m);
    const stateMatch = printOutput.match(/^\s*state\s*=\s*(.+)$/m);
    return {
        runs: runsMatch ? parseInt(runsMatch[1], 10) : null,
        lastExitCode: exitMatch ? parseInt(exitMatch[1], 10) : null,
        running: stateMatch ? /running/i.test(stateMatch[1]) && !/not running/i.test(stateMatch[1]) : false,
    };
}

/**
 * C11 self-healing visibility: derive last-abnormal-exit / restart info for doctor.
 * Zero new persistence — restartCount from launchd's own `runs` counter,
 * lastAbnormalExitAt scanned from the crash-restart log markers.
 * Never throws: query failure returns null/false so doctor shows "unknown" not crash.
 */
export async function readSupervisorHealth(): Promise<{
    lastAbnormalExitAt: number | null;
    restartCount: number;
    managed: boolean;
}> {
    if (process.platform !== 'darwin') {
        return { lastAbnormalExitAt: null, restartCount: 0, managed: false };
    }

    const result = await runLaunchctl(['print', getAgentServiceTarget()]);
    if (result.code !== 0) {
        // Not loaded / query failed → unmanaged, no data.
        return { lastAbnormalExitAt: null, restartCount: 0, managed: false };
    }

    const parsed = parseSupervisorPrint(result.stdout);
    // restartCount = launchd relaunches within this plist lifecycle = runs - 1
    // (the first `run` is the initial RunAtLoad start, not a restart).
    const restartCount = parsed.runs !== null && parsed.runs > 0 ? parsed.runs - 1 : 0;

    return {
        lastAbnormalExitAt: await deriveLastAbnormalExitAt(),
        restartCount,
        managed: true,
    };
}

/**
 * Scan the launchagent OUT log for the most recent crash-restart marker timestamp.
 * Read-only; failure → null (doctor shows "none"). No new storage introduced.
 *
 * TL-01 fix: the crash-restart marker is emitted via `logger.info(...)` in run.ts
 * (`[SUPERVISOR] daemon start | ... | trigger=crash-restart`), and logger.info →
 * console.log → the process's stdout, which launchd redirects to `StandardOutPath`
 * (launchagent.out.log, set in assemblePlist). It is NEVER written to stderr /
 * launchagent.err.log, so scanning err.log made lastAbnormalExitAt structurally
 * always null. Scan the out log instead — where the marker actually lands.
 *
 * Exported for unit testing the pure scan step (the log path is real-OS glue).
 */
export async function deriveLastAbnormalExitAt(): Promise<number | null> {
    const outLogPath = join(configuration.logsDir, 'launchagent.out.log');
    if (!existsSync(outLogPath)) return null;
    try {
        const content = await readFile(outLogPath, 'utf8');
        // The daemon logs `[SUPERVISOR] daemon start | ... | trigger=crash-restart`
        // via logger.info → console.log → stdout → launchagent.out.log on a
        // supervised restart. Find the latest such marker's mtime.
        if (!/trigger=crash-restart/.test(content)) return null;
        const st = await stat(outLogPath);
        return st.mtimeMs;
    } catch {
        return null;
    }
}
