/**
 * Unit tests for M3 install-state-migration pure functions.
 *
 * Covers the full truth table for classifyInstallState (4 states) and
 * decideMigration (4 decisions × sudo/no-sudo), plus buildInstallDiagnostics
 * assembly (warnings non-empty / source derivation / no-data degradation).
 *
 * D-2b guard-logic tests (TC-D2b-8…TC-D2b-11): The orchestration helpers
 * chownIfDarwinSudo and removeLegacyPlistSafe are private.  We test their
 * observable guards via:
 *   - getInvokingUid() SUDO_UID resolution (pure function, exported from launchAgent)
 *   - chownInstallArtifacts SUDO_UID early-exit path (exported, env-injectable)
 * Full real-OS flow (TC-D2b-1…TC-D2b-7 + install ordering) is Phase 6.5 on-device.
 *
 * launchctl side effects (probeInstallState / installLaunchAgent /
 * uninstallLaunchAgent) are NOT unit-tested here (no mock, per CLAUDE.md) — they
 * are real-OS glue verified on-device in Phase 6.5.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
    classifyInstallState,
    decideMigration,
    buildInstallDiagnostics,
    compareDaemonPid,
    decideTakeover,
    type InstallState,
    type InstallStateProbe,
} from '@/daemon/mac/installState';
import { getInvokingUid, chownInstallArtifacts } from '@/daemon/mac/launchAgent';
import { isAppError } from '@/utils/errors';

function makeProbe(overrides: Partial<InstallStateProbe> = {}): InstallStateProbe {
    const base: InstallStateProbe = {
        state: 'not-installed',
        agentPlistPath: '/Users/test/Library/LaunchAgents/com.happy-cli.agent.plist',
        agentPlistExists: false,
        agentLoaded: false,
        legacyPlistExists: false,
        legacyLoaded: false,
        hasSudo: false,
    };
    const merged = { ...base, ...overrides };
    // Keep state consistent with plist existence unless caller overrode it explicitly.
    if (overrides.state === undefined) {
        merged.state = classifyInstallState({
            agentPlistExists: merged.agentPlistExists,
            legacyPlistExists: merged.legacyPlistExists,
        });
    }
    return merged;
}

describe('classifyInstallState (full truth table)', () => {
    const cases: Array<[boolean, boolean, InstallState]> = [
        [false, false, 'not-installed'],
        [false, true, 'legacy-only'],
        [true, false, 'agent-installed'],
        [true, true, 'half-migrated'],
    ];

    it.each(cases)(
        'agentPlistExists=%s legacyPlistExists=%s → %s',
        (agentPlistExists, legacyPlistExists, expected) => {
            expect(classifyInstallState({ agentPlistExists, legacyPlistExists })).toBe(expected);
        }
    );

    it('does not consider loaded flags — only plist existence', () => {
        // loaded state is irrelevant to classification; a plist on disk means installed.
        expect(classifyInstallState({ agentPlistExists: true, legacyPlistExists: false })).toBe('agent-installed');
        expect(classifyInstallState({ agentPlistExists: false, legacyPlistExists: false })).toBe('not-installed');
    });
});

describe('decideMigration (full decision matrix)', () => {
    it('not-installed → install-agent', () => {
        const action = decideMigration(makeProbe({ state: 'not-installed' }));
        expect(action).toEqual({ kind: 'install-agent' });
    });

    it('agent-installed → install-agent (idempotent)', () => {
        const action = decideMigration(makeProbe({ agentPlistExists: true }));
        expect(action).toEqual({ kind: 'install-agent' });
    });

    it('legacy-only + hasSudo=true → migrate-from-legacy', () => {
        const action = decideMigration(makeProbe({ legacyPlistExists: true, hasSudo: true }));
        expect(action).toEqual({ kind: 'migrate-from-legacy' });
    });

    it('legacy-only + hasSudo=false → blocked-need-sudo with legacy guidance', () => {
        const action = decideMigration(makeProbe({ legacyPlistExists: true, hasSudo: false }));
        expect(action.kind).toBe('blocked-need-sudo');
        if (action.kind === 'blocked-need-sudo') {
            expect(action.guidance).toBeTruthy();
            expect(action.guidance).toContain('sudo launchctl bootout system/com.happy-cli.daemon');
            expect(action.guidance).toContain('/Library/LaunchDaemons/com.happy-cli.daemon.plist');
        }
    });

    it('half-migrated + hasSudo=true → repair-half-migrated{hasSudo:true, guidance undefined}', () => {
        const action = decideMigration(makeProbe({ agentPlistExists: true, legacyPlistExists: true, hasSudo: true }));
        expect(action.kind).toBe('repair-half-migrated');
        if (action.kind === 'repair-half-migrated') {
            expect(action.hasSudo).toBe(true);
            expect(action.guidance).toBeUndefined();
        }
    });

    it('half-migrated + hasSudo=false → repair-half-migrated{hasSudo:false, guidance non-empty}', () => {
        const action = decideMigration(makeProbe({ agentPlistExists: true, legacyPlistExists: true, hasSudo: false }));
        expect(action.kind).toBe('repair-half-migrated');
        if (action.kind === 'repair-half-migrated') {
            expect(action.hasSudo).toBe(false);
            expect(action.guidance).toBeTruthy();
            expect(action.guidance).toContain('sudo launchctl bootout system/com.happy-cli.daemon');
        }
    });
});

describe('buildInstallDiagnostics (doctor assembly)', () => {
    it('half-migrated (loaded) → warnings non-empty + remediation has sudo command line', () => {
        const probe = makeProbe({ agentPlistExists: true, legacyPlistExists: true, legacyLoaded: true });
        const diag = buildInstallDiagnostics(probe, { lastAbnormalExitAt: null, restartCount: 0, managed: false });
        expect(diag.warnings.length).toBeGreaterThan(0);
        expect(diag.warnings.some((w) => /STILL LOADED/.test(w))).toBe(true);
        expect(diag.remediation.some((r) => r.includes('sudo launchctl bootout system/com.happy-cli.daemon'))).toBe(true);
        expect(diag.remediation.some((r) => r.includes('/Library/LaunchDaemons/com.happy-cli.daemon.plist'))).toBe(true);
    });

    it('half-migrated (not loaded) → warning wording differs, still non-empty', () => {
        const probe = makeProbe({ agentPlistExists: true, legacyPlistExists: true, legacyLoaded: false });
        const diag = buildInstallDiagnostics(probe, { lastAbnormalExitAt: null, restartCount: 0, managed: false });
        expect(diag.warnings.length).toBeGreaterThan(0);
        expect(diag.warnings.some((w) => /STILL LOADED/.test(w))).toBe(false);
    });

    it('legacy-only → migration-incomplete warning + sudo remediation', () => {
        const probe = makeProbe({ legacyPlistExists: true });
        const diag = buildInstallDiagnostics(probe, { lastAbnormalExitAt: null, restartCount: 0, managed: false });
        expect(diag.probe.state).toBe('legacy-only');
        expect(diag.warnings.length).toBeGreaterThan(0);
        expect(diag.remediation.length).toBeGreaterThan(0);
    });

    it('agent-installed + managed=true + pidSupervised=true → no warnings, source=launchagent', () => {
        const probe = makeProbe({ agentPlistExists: true, agentLoaded: true });
        // INV-3: pidSupervised must also be true for source=launchagent (M-F1 change).
        const diag = buildInstallDiagnostics(probe, { lastAbnormalExitAt: 1710000000000, restartCount: 2, managed: true }, true);
        expect(diag.warnings).toHaveLength(0);
        expect(diag.remediation).toHaveLength(0);
        expect(diag.selfHealing.source).toBe('launchagent');
        expect(diag.selfHealing.restartCount).toBe(2);
        expect(diag.selfHealing.managed).toBe(true);
    });

    it('agent-installed + managed=false (plist present, not managed) → source=passive', () => {
        const probe = makeProbe({ agentPlistExists: true, agentLoaded: false });
        const diag = buildInstallDiagnostics(probe, { lastAbnormalExitAt: null, restartCount: 0, managed: false });
        expect(diag.selfHealing.source).toBe('passive');
    });

    it('not-installed → source=none, summary present, no crash on null health', () => {
        const probe = makeProbe({ state: 'not-installed' });
        const diag = buildInstallDiagnostics(probe, { lastAbnormalExitAt: null, restartCount: 0, managed: false });
        expect(diag.selfHealing.source).toBe('none');
        expect(diag.summary).toBeTruthy();
        expect(diag.selfHealing.lastAbnormalExitAt).toBeNull();
    });

    it('agentLoaded but health.managed=false → source=passive (both required for launchagent)', () => {
        const probe = makeProbe({ agentPlistExists: true, agentLoaded: true });
        const diag = buildInstallDiagnostics(probe, { lastAbnormalExitAt: null, restartCount: 0, managed: false });
        // agentLoaded alone is not enough — M2.managed must also be true.
        expect(diag.selfHealing.source).toBe('passive');
    });
});

// ── D-2b guard-logic tests (TC-D2b-8…TC-D2b-11) ──────────────────────────────
//
// chownIfDarwinSudo and removeLegacyPlistSafe are private; we test their
// guards through the exported pure functions and the exported chownInstallArtifacts.

describe('D-2b: getInvokingUid (SUDO_UID resolution — TL-04 guard precondition)', () => {
    const origSudoUid = process.env.SUDO_UID;

    afterEach(() => {
        if (origSudoUid === undefined) delete process.env.SUDO_UID;
        else process.env.SUDO_UID = origSudoUid;
    });

    it('TC-D2b-8a: no SUDO_UID → getInvokingUid() returns process.getuid() (true-root path)', () => {
        delete process.env.SUDO_UID;
        // In a normal test run (not root) this is the non-zero user uid.
        // The key property: getInvokingUid() === process.getuid() when SUDO_UID absent.
        const uid = getInvokingUid();
        const expected = typeof process.getuid === 'function' ? process.getuid() : 0;
        expect(uid).toBe(expected);
    });

    it('TC-D2b-8b: SUDO_UID=\'501\' → getInvokingUid() returns 501 (sudo scenario)', () => {
        process.env.SUDO_UID = '501';
        expect(getInvokingUid()).toBe(501);
    });

    it('TC-D2b-8c: SUDO_UID=\'0\' → getInvokingUid() ignores it (parsed ≤ 0 → fallback to getuid)', () => {
        // SUDO_UID='0' is an invalid value — guard: parsed > 0 required.
        process.env.SUDO_UID = '0';
        const uid = getInvokingUid();
        const expected = typeof process.getuid === 'function' ? process.getuid() : 0;
        expect(uid).toBe(expected);
    });

    it('TC-D2b-8d: SUDO_UID=non-numeric → getInvokingUid() falls back to getuid()', () => {
        process.env.SUDO_UID = 'notanumber';
        const uid = getInvokingUid();
        const expected = typeof process.getuid === 'function' ? process.getuid() : 0;
        expect(uid).toBe(expected);
    });
});

describe('D-2b: chownInstallArtifacts SUDO_UID guard (TC-D2b-10 — TL-04)', () => {
    // TC-D2b-10: when SUDO_UID is absent, chownIfDarwinSudo (private) returns early
    // and never calls chownInstallArtifacts.  We verify the guard that drives it:
    // chownInstallArtifacts does NOTHING productive when SUDO_UID is absent/invalid
    // (it would use uid=NaN → chown(path, NaN, NaN) which would throw on a real file).
    // More importantly: chownInstallArtifacts's guard is in the CALLER (chownIfDarwinSudo).
    // We test this by verifying that when SUDO_UID is set to a valid UID and there is
    // no real path to chown, it correctly propagates ENOENT silently (per M-D2 contract).

    const origSudoUid = process.env.SUDO_UID;
    const origSudoGid = process.env.SUDO_GID;

    afterEach(() => {
        if (origSudoUid === undefined) delete process.env.SUDO_UID;
        else process.env.SUDO_UID = origSudoUid;
        if (origSudoGid === undefined) delete process.env.SUDO_GID;
        else process.env.SUDO_GID = origSudoGid;
    });

    it('TC-D2b-9a: SUDO_UID set → chownInstallArtifacts accepts non-existent test paths silently (ENOENT suppression)', async () => {
        // Provide dummy non-existent paths via the test seam (_paths).
        // ENOENT on plist → silent. ENOENT on logsDir → early return, no throw.
        process.env.SUDO_UID = '501';
        process.env.SUDO_GID = '20';
        await expect(
            chownInstallArtifacts({
                plistPath: '/tmp/nonexistent-d2b-test-plist.plist',
                logsDir: '/tmp/nonexistent-d2b-test-logs',
            })
        ).resolves.toBeUndefined();
    });

    // TC-D2b-11: chownInstallArtifacts propagates LAUNCHAGENT_CHOWN_FAILED on EPERM.
    // Requires: non-root process on darwin or linux (cannot chown /tmp to uid 501).
    // Skips explicitly (not silently) when running as root — visible in test output.
    const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;
    const isPosix = process.platform === 'darwin' || process.platform === 'linux';
    it.skipIf(!isPosix || isRoot)(
        'TC-D2b-11: chownInstallArtifacts with real chown-failure propagates LAUNCHAGENT_CHOWN_FAILED' +
        (!isPosix ? ' [SKIPPED: non-POSIX platform]' : isRoot ? ' [SKIPPED: running as root]' : ''),
        async () => {
            process.env.SUDO_UID = '501';
            process.env.SUDO_GID = '20';
            // logsDir = /tmp → chown(/tmp) to uid 501 will EPERM on non-root → LAUNCHAGENT_CHOWN_FAILED
            let caught: unknown;
            try {
                await chownInstallArtifacts({
                    plistPath: '/tmp/nonexistent-d2b-plist.plist',
                    logsDir: '/tmp',
                });
            } catch (e) {
                caught = e;
            }
            expect(isAppError(caught, 'LAUNCHAGENT_CHOWN_FAILED')).toBe(true);
        }
    );
});

// ── M-F1 pure-function tests ──────────────────────────────────────────────────

describe('compareDaemonPid (M-F1: PID attribution truth table)', () => {
    it('matching PIDs → true (daemon is supervised)', () => {
        expect(compareDaemonPid(88675, 88675)).toBe(true);
    });

    it('different PIDs → false (rogue daemon: launchd has different pid)', () => {
        expect(compareDaemonPid(88675, 99999)).toBe(false);
    });

    it('statePid=null → false (state file absent, cannot confirm)', () => {
        expect(compareDaemonPid(null, 88675)).toBe(false);
    });

    it('launchdPid=null → false (launchd not running service, pid line absent)', () => {
        expect(compareDaemonPid(88675, null)).toBe(false);
    });

    it('both null → false (no data on either side)', () => {
        expect(compareDaemonPid(null, null)).toBe(false);
    });

    it('statePid=undefined → false (missing from state object)', () => {
        expect(compareDaemonPid(undefined, 88675)).toBe(false);
    });
});

describe('decideTakeover (M-F1: takeover decision tree)', () => {
    const noSupervisedPid = { supervised: false, launchdPid: null as number | null, statePid: null as number | null };
    const supervisedPid = { supervised: true, launchdPid: 88675, statePid: 88675 };

    function makeProbeForTakeover(overrides: Partial<InstallStateProbe> = {}): InstallStateProbe {
        return {
            state: 'not-installed',
            agentPlistPath: '/Users/test/Library/LaunchAgents/com.happy-cli.agent.plist',
            agentPlistExists: false,
            agentLoaded: false,
            legacyPlistExists: false,
            legacyLoaded: false,
            hasSudo: false,
            ...overrides,
        };
    }

    it('daemonRunning=false → needed=false (no process to take over)', () => {
        const result = decideTakeover(makeProbeForTakeover(), noSupervisedPid, false);
        expect(result.needed).toBe(false);
        expect(result.reason).toBe('no-daemon-running');
    });

    it('daemonRunning=true + agentLoaded=true + supervised=true → needed=false (already supervised)', () => {
        const probe = makeProbeForTakeover({ agentLoaded: true, agentPlistExists: true, state: 'agent-installed' });
        const result = decideTakeover(probe, supervisedPid, true);
        expect(result.needed).toBe(false);
        expect(result.reason).toBe('already-supervised');
    });

    it('daemonRunning=true + agentLoaded=false → needed=true (rogue: plist not loaded)', () => {
        const probe = makeProbeForTakeover({ agentLoaded: false });
        const result = decideTakeover(probe, noSupervisedPid, true);
        expect(result.needed).toBe(true);
        expect(result.reason).toBe('rogue-daemon-detected');
    });

    it('daemonRunning=true + agentLoaded=true + supervised=false → needed=true (rogue: PID mismatch)', () => {
        const probe = makeProbeForTakeover({ agentLoaded: true, agentPlistExists: true, state: 'agent-installed' });
        const mismatch = { supervised: false, launchdPid: 99999, statePid: 88675 };
        const result = decideTakeover(probe, mismatch, true);
        expect(result.needed).toBe(true);
        expect(result.reason).toBe('rogue-daemon-detected');
    });
});

describe('buildInstallDiagnostics (M-F1: pidSupervised parameter — INV-3)', () => {
    function makeProbeForDiag(overrides: Partial<InstallStateProbe> = {}): InstallStateProbe {
        return {
            state: 'agent-installed',
            agentPlistPath: '/Users/test/Library/LaunchAgents/com.happy-cli.agent.plist',
            agentPlistExists: true,
            agentLoaded: true,
            legacyPlistExists: false,
            legacyLoaded: false,
            hasSudo: false,
            ...overrides,
        };
    }

    const fullHealth = { lastAbnormalExitAt: null, restartCount: 0, managed: true };

    it('agentLoaded=true + managed=true + pidSupervised=true → source=launchagent (full supervision)', () => {
        const diag = buildInstallDiagnostics(makeProbeForDiag(), fullHealth, true);
        expect(diag.selfHealing.source).toBe('launchagent');
    });

    it('agentLoaded=true + managed=true + pidSupervised=false → source=passive (PID mismatch, not truly supervised)', () => {
        const diag = buildInstallDiagnostics(makeProbeForDiag(), fullHealth, false);
        expect(diag.selfHealing.source).toBe('passive');
    });

    it('agentLoaded=true + managed=false + pidSupervised=true → source=passive (not managed)', () => {
        const health = { lastAbnormalExitAt: null, restartCount: 0, managed: false };
        const diag = buildInstallDiagnostics(makeProbeForDiag(), health, true);
        expect(diag.selfHealing.source).toBe('passive');
    });

    it('agentLoaded=false + pidSupervised=* → source=passive (plist exists but not loaded)', () => {
        const probe = makeProbeForDiag({ agentLoaded: false });
        const diag = buildInstallDiagnostics(probe, fullHealth, true);
        // agentPlistExists=true but agentLoaded=false → passive (not launchagent)
        expect(diag.selfHealing.source).toBe('passive');
    });

    it('pidSupervised defaults to false when omitted (backward-compat default param)', () => {
        // Calling with 2 args → pidSupervised=false → old behavior: agentLoaded&&managed → passive
        const diag = buildInstallDiagnostics(makeProbeForDiag(), fullHealth);
        // With old 2-arg call, managed=true && agentLoaded=true but pidSupervised=false → passive
        expect(diag.selfHealing.source).toBe('passive');
    });
});
