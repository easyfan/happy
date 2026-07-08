/**
 * Unit tests for M3 install-state-migration pure functions.
 *
 * Covers the full truth table for classifyInstallState (4 states) and
 * decideMigration (4 decisions × sudo/no-sudo), plus buildInstallDiagnostics
 * assembly (warnings non-empty / source derivation / no-data degradation).
 *
 * launchctl side effects (probeInstallState / installLaunchAgent /
 * uninstallLaunchAgent) are NOT unit-tested here (no mock, per CLAUDE.md) — they
 * are real-OS glue verified on-device in Phase 6.5.
 */

import { describe, it, expect } from 'vitest';
import {
    classifyInstallState,
    decideMigration,
    buildInstallDiagnostics,
    type InstallState,
    type InstallStateProbe,
} from '@/daemon/mac/installState';

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

    it('agent-installed + managed=true → no warnings, source=launchagent', () => {
        const probe = makeProbe({ agentPlistExists: true, agentLoaded: true });
        const diag = buildInstallDiagnostics(probe, { lastAbnormalExitAt: 1710000000000, restartCount: 2, managed: true });
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
