/**
 * M3 install-state-migration: LaunchAgent install-state detection + migration
 * decision + install/uninstall orchestration + doctor diagnostics.
 *
 * Boundary with M2 (launchAgent.ts): M2 owns "what the plist looks like + process
 * supervision semantics + the modern launchctl API wrapper" (bootstrap / bootout /
 * kickstart / print). M3 owns "when to install/uninstall/migrate, which install
 * state we are in, and the doctor report". M3 consumes M2's EXPORTED functions —
 * it never re-defines the label/path/env and never writes launchctl commands for
 * the new agent itself.
 *
 * The pure classification (`classifyInstallState`) and decision (`decideMigration`)
 * functions are I/O-free and unit-tested against the full truth table. The
 * side-effecting probe / install / uninstall glue runs real launchctl (no mock,
 * per CLAUDE.md) and is verified on-device in Phase 6.5.
 *
 * Legacy detection (old sudo LaunchDaemon `com.happy-cli.daemon`, system domain) is
 * M3-specific: M2 only manages the new gui-domain agent, so the legacy loaded probe
 * (`launchctl print system/com.happy-cli.daemon`) lives here.
 */

import { existsSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { spawn } from 'cross-spawn';
import { logger } from '@/ui/logger';
import { AppError } from '@/utils/errors';
import {
    getAgentLabel,
    getAgentPlistPath,
    getAgentServiceTarget,
    installAgent,
    isAgentLoaded,
    uninstallAgent,
    readSupervisorHealth,
    getInvokingUid,          // M-D2: resolve invoking user uid (SUDO_UID-priority)
    chownInstallArtifacts,   // M-D2: chown plist+logsDir to invoking user (darwin+sudo)
    kickstartAgent,
    parseSupervisorPid,
} from '@/daemon/mac/launchAgent';
import { LEGACY_DAEMON_LABEL, LEGACY_DAEMON_PLIST_PATH } from '@/daemon/mac/install';
import { configuration } from '@/configuration';
import { stopDaemon, checkIfDaemonRunningAndCleanupStaleState } from '@/daemon/controlClient';
import { readDaemonState } from '@/persistence';

// ── State model ─────────────────────────────────────────────────────────────

/**
 * Three states + one compound half-migrated state. The probe result is a pruned
 * cartesian product of "is the new LaunchAgent installed" × "is the old sudo
 * LaunchDaemon residual".
 */
export type InstallState =
    | 'not-installed'   // no new LaunchAgent, no old LaunchDaemon (default)
    | 'legacy-only'     // old sudo LaunchDaemon present, no new LaunchAgent (needs migration)
    | 'agent-installed' // new user-level LaunchAgent present, no old (target state)
    | 'half-migrated';  // old sudo LaunchDaemon AND new LaunchAgent both present (double-supervision risk / P2-2)

export interface InstallStateProbe {
    state: InstallState;
    agentPlistPath: string;     // new LaunchAgent plist expected path (= M2 getAgentPlistPath())
    agentPlistExists: boolean;  // ~/Library/LaunchAgents/{label}.plist exists (M3 fs probe)
    agentLoaded: boolean;       // = await M2.isAgentLoaded() (launchctl print gui/<uid>/<label> exit 0)
    legacyPlistExists: boolean; // /Library/LaunchDaemons/com.happy-cli.daemon.plist exists (M3 fs probe)
    legacyLoaded: boolean;      // launchctl print system/com.happy-cli.daemon exit 0 (M3 legacy-specific probe)
    hasSudo: boolean;           // process.getuid?.() === 0 (does the current process have root)
}

/**
 * Migration decision (pure-function output, unit-testable). Because M2
 * installAgent() is idempotent (internally overwrites plist + re-bootstraps), M3
 * does NOT distinguish "first install" from "content-drift reinstall" — both map to
 * `install-agent` (calling installAgent() is always safe & idempotent).
 */
export type MigrationAction =
    | { kind: 'install-agent' }
    | { kind: 'migrate-from-legacy' }
    | { kind: 'blocked-need-sudo'; guidance: string }
    | { kind: 'repair-half-migrated'; hasSudo: boolean; guidance?: string };

// ── Pure functions (no I/O, unit-tested) ─────────────────────────────────────

/**
 * Pure: given raw probe inputs (plist file existence), classify InstallState.
 * No side effects, no I/O. `agentLoaded`/`legacyLoaded` deliberately do NOT
 * participate in classification (a plist on disk means "installed"); they only
 * influence warnings/remediation wording downstream.
 */
export function classifyInstallState(input: {
    agentPlistExists: boolean;
    legacyPlistExists: boolean;
}): InstallState {
    if (input.agentPlistExists && input.legacyPlistExists) return 'half-migrated';
    if (input.agentPlistExists) return 'agent-installed';
    if (input.legacyPlistExists) return 'legacy-only';
    return 'not-installed';
}

/** Human-readable sudo remediation to remove the legacy LaunchDaemon. */
function legacySudoGuidance(): string {
    return [
        `sudo launchctl bootout system/${LEGACY_DAEMON_LABEL}`,
        `sudo rm ${LEGACY_DAEMON_PLIST_PATH}`,
        'then run: happy daemon install',
    ].join('\n');
}

/**
 * Pure: given an InstallStateProbe, decide the migration action.
 * No I/O, no plist content comparison (drift is handled by M2 installAgent()
 * idempotency). Every branch returns an action (never throws).
 */
export function decideMigration(probe: InstallStateProbe): MigrationAction {
    switch (probe.state) {
        case 'not-installed':
        case 'agent-installed':
            // installAgent() is idempotent — covers overwrite + re-supervise.
            return { kind: 'install-agent' };
        case 'legacy-only':
            if (probe.hasSudo) return { kind: 'migrate-from-legacy' };
            // P2-2: do NOT install the new agent without sudo (double-supervision guard).
            return { kind: 'blocked-need-sudo', guidance: legacySudoGuidance() };
        case 'half-migrated':
            return {
                kind: 'repair-half-migrated',
                hasSudo: probe.hasSudo,
                guidance: probe.hasSudo ? undefined : legacySudoGuidance(),
            };
    }
}

// ── M-F1: PID supervision check pure functions + thin shells ─────────────────

/**
 * Pure: compare daemon.state.json pid with the pid reported by launchctl print.
 * Returns true only when both are valid numbers and are equal.
 * Either being null/undefined means "cannot confirm" → returns false (conservative).
 *
 * @param statePid   daemon.state.json.pid (may be null/undefined when state file absent)
 * @param launchdPid parseSupervisorPid() result (may be null when service not running)
 */
export function compareDaemonPid(
    statePid: number | null | undefined,
    launchdPid: number | null
): boolean {
    if (statePid == null || launchdPid == null) return false;
    return statePid === launchdPid;
}

/**
 * Pure: given probe + PID supervision result + whether daemon is running, decide
 * whether a takeover is needed.
 *
 * Takeover condition: daemon process is running AND (plist not loaded OR PID does
 * not belong to launchd) — i.e. the daemon is "rogue" (unmanaged).
 *
 * @param probe          probeInstallState() result
 * @param pidSupervised  isDaemonPidSupervised() result
 * @param daemonRunning  true when daemon.state.json exists with a live PID
 */
export function decideTakeover(
    probe: InstallStateProbe,
    pidSupervised: { supervised: boolean; launchdPid: number | null; statePid: number | null },
    daemonRunning: boolean
): { needed: boolean; statePid: number | null; reason: string } {
    if (!daemonRunning) {
        return { needed: false, statePid: null, reason: 'no-daemon-running' };
    }
    // Rogue = running but not supervised by launchd (plist not loaded OR PID mismatch)
    const isRogue = !probe.agentLoaded || !pidSupervised.supervised;
    if (!isRogue) {
        return { needed: false, statePid: pidSupervised.statePid, reason: 'already-supervised' };
    }
    return { needed: true, statePid: pidSupervised.statePid, reason: 'rogue-daemon-detected' };
}

/**
 * Read daemon.state.json pid + execute launchctl print → parse pid, then compare.
 * Supervised=✓ iff agentLoaded=true AND pid attribution matches (INV-3).
 *
 * Never throws: any I/O failure degrades to supervised=false (conservative safe default).
 *
 * @returns { supervised, launchdPid, statePid } for diagnosis and display
 */
export async function isDaemonPidSupervised(): Promise<{
    supervised: boolean;
    launchdPid: number | null;
    statePid: number | null;
}> {
    const [printResult, daemonStateResult] = await Promise.allSettled([
        runLaunchctl(['print', getAgentServiceTarget()]),
        readDaemonState(),
    ]);

    const printOutput = printResult.status === 'fulfilled' && printResult.value.code === 0
        ? printResult.value.stdout
        : null;

    const launchdPid = printOutput !== null ? parseSupervisorPid(printOutput) : null;
    const statePid = daemonStateResult.status === 'fulfilled' && daemonStateResult.value !== null
        ? daemonStateResult.value.pid ?? null
        : null;

    const supervised = compareDaemonPid(statePid, launchdPid);
    return { supervised, launchdPid, statePid };
}

/**
 * Thin shell: call checkIfDaemonRunningAndCleanupStaleState + isDaemonPidSupervised,
 * then call the pure decideTakeover function.
 * Never throws (all errors absorbed; degrades to needed=false — skip takeover, do normal install).
 */
async function shouldTakeoverRunningDaemon(probe: InstallStateProbe): Promise<{
    needed: boolean;
    statePid: number | null;
}> {
    const [daemonRunningResult, pidSupervisedResult] = await Promise.allSettled([
        checkIfDaemonRunningAndCleanupStaleState(),
        isDaemonPidSupervised(),
    ]);

    const running = daemonRunningResult.status === 'fulfilled' ? daemonRunningResult.value : false;
    const pidSup = pidSupervisedResult.status === 'fulfilled'
        ? pidSupervisedResult.value
        : { supervised: false, launchdPid: null, statePid: null };

    const decision = decideTakeover(probe, pidSup, running);
    return { needed: decision.needed, statePid: decision.statePid };
}

/**
 * Takeover orchestration: installAgent → stopDaemon (stop rogue) → kickstartAgent.
 *
 * A-06: if installAgent succeeds but stopDaemon fails, do NOT swallow the error.
 * Print explicit warning with pid + idempotent remediation guidance, then throw
 * AppError('DAEMON_TAKEOVER_STOP_FAILED').
 *
 * @throws AppError('DAEMON_TAKEOVER_STOP_FAILED') — stopDaemon failed after installAgent succeeded
 * @throws (passthrough) installAgent errors: LAUNCHAGENT_WRITE_FAILED / LAUNCHCTL_BOOTSTRAP_FAILED / DAEMON_ENV_INCOMPLETE
 * @throws (passthrough) kickstartAgent error: LAUNCHCTL_KICKSTART_FAILED
 */
async function executeTakeover(statePid: number | null): Promise<void> {
    const pidDisplay = statePid !== null ? String(statePid) : 'unknown';

    // ① installAgent: write plist + bootstrap. RunAtLoad triggers launchd to start a
    //   new supervised instance; same-version instance exits(0) via run.ts:315 (R1).
    await installAgent();

    // ①' IMPL-NOTE-01: darwin+sudo chown (second installAgent success exit in this module)
    await chownIfDarwinSudo();

    // ② stopDaemon: terminate the rogue (unmanaged) old instance.
    try {
        await stopDaemon();
    } catch (err) {
        // A-06 intermediate state: LaunchAgent installed but rogue instance still alive.
        // Not silent — print actionable guidance.
        console.warn(`⚠ LaunchAgent installed but failed to stop rogue daemon (pid=${pidDisplay}).`);
        console.warn('  The old unmanaged daemon and the new supervised daemon are currently coexisting.');
        console.warn('  To resolve: run `happy daemon stop` or `kill ' + pidDisplay + '` then `happy daemon status` to confirm.');
        console.warn('  Or re-run `happy daemon install` to retry the takeover (idempotent).');
        throw new AppError(
            'DAEMON_TAKEOVER_STOP_FAILED',
            `Installed LaunchAgent but failed to stop rogue daemon (pid=${pidDisplay}). See above for remediation.`,
            err
        );
    }

    // ③ kickstartAgent: launchd launches the new supervised instance from latest bundle.
    await kickstartAgent();

    console.log(`✓ Took over unmanaged daemon (pid=${pidDisplay}): LaunchAgent installed, old instance stopped, new supervised instance started.`);
}

// ── launchctl glue (side-effecting, real-OS, unit tests skip; Phase 6.5 E2E) ──

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
            // launchctl missing / spawn failure — never crash; treat as failed probe.
            resolve({ code: -1, stdout, stderr: stderr || String(err) });
        });
        child.on('close', (code) => resolve({ code, stdout, stderr }));
    });
}

/**
 * Legacy (system domain) loaded probe — M3-specific, since M2 only manages the new
 * gui-domain agent. `launchctl print system/com.happy-cli.daemon` exit 0 = loaded.
 * Failure degrades to false (best-effort; never blocks doctor).
 */
async function probeLegacyLoaded(): Promise<boolean> {
    if (process.platform !== 'darwin') return false;
    const result = await runLaunchctl(['print', `system/${LEGACY_DAEMON_LABEL}`]);
    return result.code === 0;
}

/**
 * Side-effecting: assemble an InstallStateProbe. Never throws — launchctl/file
 * read failure degrades to the corresponding loaded=false (best-effort probe so a
 * diagnostic failure never aborts doctor / install).
 */
export async function probeInstallState(): Promise<InstallStateProbe> {
    const agentPlistPath = getAgentPlistPath();
    const agentPlistExists = existsSync(agentPlistPath);
    const legacyPlistExists = existsSync(LEGACY_DAEMON_PLIST_PATH);
    const agentLoaded = await isAgentLoaded();         // M2, never throws
    const legacyLoaded = await probeLegacyLoaded();    // M3, degrades to false
    const hasSudo = typeof process.getuid === 'function' && process.getuid() === 0;

    return {
        state: classifyInstallState({ agentPlistExists, legacyPlistExists }),
        agentPlistPath,
        agentPlistExists,
        agentLoaded,
        legacyPlistExists,
        legacyLoaded,
        hasSudo,
    };
}

/** Remove the legacy sudo LaunchDaemon plist (migrate/repair path, requires sudo). */
async function removeLegacyPlist(): Promise<void> {
    if (!existsSync(LEGACY_DAEMON_PLIST_PATH)) return;
    try {
        await unlink(LEGACY_DAEMON_PLIST_PATH);
    } catch (error) {
        throw new AppError(
            'DAEMON_MIGRATE_LEGACY_UNLOAD_FAILED',
            `Failed to remove legacy LaunchDaemon plist at ${LEGACY_DAEMON_PLIST_PATH}`,
            error
        );
    }
}

/**
 * Bootout the legacy sudo LaunchDaemon (system domain). Requires sudo; caller has
 * already confirmed hasSudo before reaching this.
 * @throws AppError('DAEMON_MIGRATE_LEGACY_UNLOAD_FAILED') on a real bootout failure.
 */
async function bootoutLegacy(): Promise<void> {
    const result = await runLaunchctl(['bootout', `system/${LEGACY_DAEMON_LABEL}`]);
    if (result.code !== 0) {
        const notLoaded = /no such process/i.test(result.stderr) || result.code === 3;
        if (!notLoaded) {
            throw new AppError(
                'DAEMON_MIGRATE_LEGACY_UNLOAD_FAILED',
                `Failed to bootout legacy LaunchDaemon (exit ${result.code}): ${result.stderr.trim()}`,
                { code: result.code, stderr: result.stderr }
            );
        }
    }
}

// ── install / uninstall command orchestration ────────────────────────────────

/**
 * Idempotent removal of the legacy LaunchDaemon plist. Failure is demoted to a
 * console.warn — the new agent is already supervised at this call site, so a
 * leftover legacy plist is merely cosmetic (leaves half-migrated state for the
 * next `happy daemon install` to repair idempotently).
 *
 * D-2b: call ONLY after installAgent() has succeeded (AC-3 guarantee).
 */
async function removeLegacyPlistSafe(): Promise<void> {
    try {
        await removeLegacyPlist();
    } catch (err) {
        console.warn(
            `⚠ Could not remove legacy plist at ${LEGACY_DAEMON_PLIST_PATH} — ` +
            'safe to retry with: happy daemon install'
        );
    }
}

/**
 * darwin+sudo guard wrapper: chown install artifacts to the invoking user ONLY
 * when SUDO_UID is set (i.e. real sudo scenario, not a direct root login).
 *
 * TL-04 rule: non-sudo / non-darwin paths MUST NOT call chown.  The darwin-guard
 * is already applied at the `installLaunchAgent` boundary (throws on non-darwin),
 * so this helper only needs to check for SUDO_UID presence.
 *
 * Failure is demoted to console.warn: supervision is already established; root
 * ownership of the plist/logsDir is inconvenient but not fatal (AC-4, best-effort).
 */
async function chownIfDarwinSudo(): Promise<void> {
    if (typeof process.env.SUDO_UID !== 'string') return;
    try {
        await chownInstallArtifacts();
    } catch (err) {
        console.warn(
            '⚠ Could not chown install artifacts to invoking user — ' +
            'plist/logs may be root-owned. Run:\n' +
            `  sudo chown $SUDO_UID ${getAgentPlistPath()}\n` +
            `  sudo chown -R $SUDO_UID ${configuration.logsDir}`
        );
    }
}

/**
 * `happy daemon install`: route to the user-level LaunchAgent (no sudo precheck).
 * Idempotent — repeated calls are safe (M2 installAgent() is idempotent).
 *
 * D-2b fixes:
 *   1. migrate-from-legacy / repair-half-migrated entry: true-root guard
 *      (hasSudo && getInvokingUid()===0 → console.error guidance + early return).
 *   2. Both branches reordered: bootoutLegacy → installAgent (success required) →
 *      chownIfDarwinSudo → removeLegacyPlistSafe.  installAgent failure keeps the
 *      legacy plist intact → system falls back to legacy-only (re-entrant, AC-3).
 *
 * @throws AppError('DAEMON_INSTALL_UNSUPPORTED_OS') on non-darwin
 * @throws AppError('DAEMON_MIGRATE_LEGACY_UNLOAD_FAILED') if legacy unload fails
 * @throws (passthrough) M2 installAgent()'s 'LAUNCHAGENT_WRITE_FAILED' /
 *         'LAUNCHCTL_BOOTSTRAP_FAILED' / 'DAEMON_ENV_INCOMPLETE'
 */
export async function installLaunchAgent(): Promise<void> {
    if (process.platform !== 'darwin') {
        throw new AppError(
            'DAEMON_INSTALL_UNSUPPORTED_OS',
            'Daemon install (LaunchAgent) is currently only supported on macOS'
        );
    }

    const probe = await probeInstallState();
    const action = decideMigration(probe);

    switch (action.kind) {
        case 'install-agent': {
            const alreadyManaged = probe.agentPlistExists && probe.agentLoaded;

            // F-1: detect a "rogue" daemon — running but not supervised by launchd
            // (plist absent OR PID not owned by launchd). If found, execute takeover.
            const takeover = await shouldTakeoverRunningDaemon(probe);

            if (takeover.needed) {
                await executeTakeover(takeover.statePid);
                return;
            }

            // Normal install path (idempotent: writes plist + bootstrap; overwrites & re-supervises)
            await installAgent();
            // IMPL-NOTE-01: darwin+sudo chown (first/only installAgent success exit on normal path)
            await chownIfDarwinSudo();
            console.log(alreadyManaged
                ? '✓ LaunchAgent already installed; reconciled & up to date'
                : '✓ Installed LaunchAgent (OS now supervises daemon, self-heals on crash)');
            return;
        }
        case 'migrate-from-legacy': {
            // D-2b true-root guard: hasSudo=true but no SUDO_UID → cannot resolve
            // invoking user; gui/<uid> bootstrap will fail; do NOT modify any plist.
            if (probe.hasSudo && getInvokingUid() === 0) {
                console.error('⚠ Cannot resolve invoking user (no SUDO_UID).');
                console.error('  Run with sudo instead of as root directly:');
                console.error('  sudo happy daemon install');
                return;
            }
            // D-2b order: bootout → installAgent (must succeed) → chown → remove-legacy.
            // installAgent failure keeps legacy plist intact → falls back to legacy-only.
            if (probe.legacyLoaded) {
                await bootoutLegacy(); // sudo confirmed via hasSudo
            }
            await installAgent();
            await chownIfDarwinSudo();         // darwin+sudo: fix root-owned artifacts
            await removeLegacyPlistSafe();     // post-success cleanup; failure is warn-only
            console.log('✓ Migrated from legacy sudo LaunchDaemon to user-level LaunchAgent');
            return;
        }
        case 'blocked-need-sudo': {
            // P2-2 safe handling: never install the new agent (else new+old both KeepAlive
            // → double-supervision). Warn + guidance, return without error (a legitimate
            // user path, but must NOT be silent).
            console.warn('⚠ Legacy sudo LaunchDaemon detected but no sudo to remove it.');
            console.warn('  Skipping LaunchAgent install to avoid double-supervision.');
            console.log(action.guidance);
            return;
        }
        case 'repair-half-migrated': {
            console.warn('⚠ Both legacy LaunchDaemon and new LaunchAgent present (double-supervision risk).');
            if (action.hasSudo) {
                // D-2b true-root guard: same logic as migrate-from-legacy.
                if (probe.hasSudo && getInvokingUid() === 0) {
                    console.error('⚠ Cannot resolve invoking user (no SUDO_UID).');
                    console.error('  Run with sudo instead of as root directly:');
                    console.error('  sudo happy daemon install');
                    return;
                }
                // D-2b order: bootout → installAgent (must succeed) → chown → remove-legacy.
                if (probe.legacyLoaded) await bootoutLegacy();
                await installAgent(); // idempotent — re-write plist + re-bootstrap
                await chownIfDarwinSudo();         // darwin+sudo: fix root-owned artifacts
                await removeLegacyPlistSafe();     // post-success cleanup; failure is warn-only
                console.log('✓ Repaired: removed legacy LaunchDaemon, LaunchAgent supervising');
            } else {
                console.warn('  Cannot remove legacy without sudo.');
                console.log(action.guidance ?? legacySudoGuidance());
            }
            return;
        }
    }
}

/**
 * `happy daemon uninstall`: turn off launchd self-healing, fall back to the passive
 * auto-start model (does NOT disable the daemon entirely; C12).
 *
 * Four-step semantics:
 *   ①② bootout + remove plist  → delegated to M2 uninstallAgent() (idempotent)
 *   ③  stop the running instance → M3 stopDaemon() (M2 does NOT kill the running one)
 *   ④  print the fallback-model explanation
 *
 * @throws AppError('DAEMON_UNINSTALL_UNSUPPORTED_OS') on non-darwin
 * @throws (passthrough) M2 uninstallAgent()'s 'LAUNCHCTL_BOOTOUT_FAILED' (real failure only)
 */
export async function uninstallLaunchAgent(): Promise<void> {
    if (process.platform !== 'darwin') {
        throw new AppError(
            'DAEMON_UNINSTALL_UNSUPPORTED_OS',
            'Daemon uninstall (LaunchAgent) is currently only supported on macOS'
        );
    }

    const probe = await probeInstallState();

    if (!probe.agentPlistExists) {
        console.log('LaunchAgent not installed — nothing to uninstall');
        if (probe.legacyPlistExists) {
            console.warn('⚠ Legacy sudo LaunchDaemon still present. Remove it with:');
            console.log(legacySudoGuidance());
        }
        return;
    }

    // ①② bootout + remove plist (M2 uninstallAgent is idempotent; not-loaded still succeeds).
    await uninstallAgent();

    // ③ stop the currently-running instance. M2 uninstallAgent explicitly does NOT
    // kill the running one; the launchd-managed instance usually stops on bootout,
    // but a passively-spawned instance must be stopped here. stopDaemon() is fault-
    // tolerant (no running instance is fine).
    await stopDaemon();

    // ④ fallback-model explanation (C12).
    console.log('✓ Removed launchd auto-supervision.');
    console.log('  daemon will still auto-start passively next time you run happy,');
    console.log('  but will NOT self-heal after a crash. Run `happy daemon install` to re-enable.');

    if (probe.legacyPlistExists) {
        console.warn('⚠ Legacy sudo LaunchDaemon still present. Remove it with:');
        console.log(legacySudoGuidance());
    }
}

// ── doctor diagnostics (C11) ──────────────────────────────────────────────────

/**
 * C11 self-healing visibility — carries M2 readSupervisorHealth() + M3-derived source.
 */
export interface SelfHealingVisibility {
    managed: boolean;
    lastAbnormalExitAt: number | null;
    restartCount: number;
    source: 'launchagent' | 'passive' | 'none';
}

export interface InstallDiagnostics {
    probe: InstallStateProbe;
    summary: string;
    warnings: string[];
    remediation: string[];
    selfHealing: SelfHealingVisibility;
}

/** Pure: derive the doctor diagnostics from a probe + supervisor-health snapshot.
 * Extracted so the assembly logic is unit-testable with hand-built inputs.
 *
 * @param pidSupervised  isDaemonPidSupervised().supervised — INV-3 PID attribution check.
 *                       Defaults to false (conservative) when caller cannot determine it.
 */
export function buildInstallDiagnostics(
    probe: InstallStateProbe,
    health: { lastAbnormalExitAt: number | null; restartCount: number; managed: boolean },
    pidSupervised = false
): InstallDiagnostics {
    const warnings: string[] = [];
    const remediation: string[] = [];

    if (probe.state === 'half-migrated') {
        warnings.push(probe.legacyLoaded
            ? 'Legacy sudo LaunchDaemon detected and STILL LOADED — risk of double daemon supervision.'
            : 'Legacy sudo LaunchDaemon plist still present alongside the new LaunchAgent.');
        remediation.push(
            `sudo launchctl bootout system/${LEGACY_DAEMON_LABEL}`,
            `sudo rm ${LEGACY_DAEMON_PLIST_PATH}`,
            'then run: happy daemon install'
        );
    } else if (probe.state === 'legacy-only') {
        warnings.push('Legacy sudo LaunchDaemon present but the new LaunchAgent is not installed (migration incomplete).');
        remediation.push(
            `sudo launchctl bootout system/${LEGACY_DAEMON_LABEL}`,
            `sudo rm ${LEGACY_DAEMON_PLIST_PATH}`,
            'then run: happy daemon install'
        );
    }

    // INV-3: Supervised = agentLoaded AND managed AND PID attribution confirmed.
    // agentLoaded && managed alone is insufficient (daemon may be rogue — not actually
    // controlled by launchd despite plist being present).
    const source: SelfHealingVisibility['source'] =
        probe.agentLoaded && health.managed && pidSupervised ? 'launchagent'
            : probe.agentPlistExists ? 'passive'
                : 'none';

    const summary = describeState(probe.state);

    return {
        probe,
        summary,
        warnings,
        remediation,
        selfHealing: {
            managed: health.managed,
            lastAbnormalExitAt: health.lastAbnormalExitAt,
            restartCount: health.restartCount,
            source,
        },
    };
}

function describeState(state: InstallState): string {
    switch (state) {
        case 'agent-installed': return 'LaunchAgent installed (user-level, OS-supervised)';
        case 'legacy-only': return 'Legacy sudo LaunchDaemon only — migration to LaunchAgent pending';
        case 'half-migrated': return 'Half-migrated — legacy LaunchDaemon and LaunchAgent both present';
        case 'not-installed': return 'Not installed — daemon starts passively only (no crash self-heal)';
    }
}

/**
 * Supply structured install-state diagnostics for ui/doctor.ts to render.
 * C11: state + half-migration warnings + self-healing visibility (data source =
 * M2 readSupervisorHealth() + isDaemonPidSupervised(), both never throw →
 * doctor is naturally fault-tolerant).
 */
export async function getInstallStateDiagnostics(): Promise<InstallDiagnostics> {
    const probe = await probeInstallState();
    const [healthResult, pidSupervisedResult] = await Promise.allSettled([
        readSupervisorHealth(),
        isDaemonPidSupervised(),
    ]);
    const health = healthResult.status === 'fulfilled'
        ? healthResult.value
        : (() => {
            // Defensive: M2 guarantees no-throw, but keep doctor robust regardless.
            logger.debug('[install-state] readSupervisorHealth threw unexpectedly');
            return { lastAbnormalExitAt: null, restartCount: 0, managed: false };
        })();
    const pidSupervised = pidSupervisedResult.status === 'fulfilled'
        ? pidSupervisedResult.value.supervised
        : false;
    return buildInstallDiagnostics(probe, health, pidSupervised);
}

/** Exposed for doctor rendering: agent label + service target of current variant. */
export function getAgentIdentity(): { label: string; serviceTarget: string; plistPath: string } {
    return {
        label: getAgentLabel(),
        serviceTarget: getAgentServiceTarget(),
        plistPath: getAgentPlistPath(),
    };
}
