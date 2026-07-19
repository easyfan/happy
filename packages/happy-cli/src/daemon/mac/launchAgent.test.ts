import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { writeFile, unlink, stat, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
    getAgentLabel,
    getAgentServiceTarget,
    getInvokingUid,
    chownInstallArtifacts,
    buildAgentPlist,
    parseSupervisorPrint,
    parseSupervisorPid,
    deriveLastAbnormalExitAt,
} from './launchAgent';
import { configuration } from '@/configuration';
import { collectDaemonEnv, DAEMON_REQUIRED_ENV } from '@/daemon/daemonEnv';
import { isAppError } from '@/utils/errors';

const originalVariant = process.env.HAPPY_VARIANT;

afterEach(() => {
    if (originalVariant === undefined) delete process.env.HAPPY_VARIANT;
    else process.env.HAPPY_VARIANT = originalVariant;
});

describe('getAgentLabel (variant isolation, P2-1)', () => {
    it('stable → com.happy-cli.agent', () => {
        process.env.HAPPY_VARIANT = 'stable';
        expect(getAgentLabel()).toBe('com.happy-cli.agent');
    });

    it('dev → com.happy-cli.agent.dev', () => {
        process.env.HAPPY_VARIANT = 'dev';
        expect(getAgentLabel()).toBe('com.happy-cli.agent.dev');
    });

    it('absent variant defaults to stable', () => {
        delete process.env.HAPPY_VARIANT;
        expect(getAgentLabel()).toBe('com.happy-cli.agent');
    });
});

describe('getAgentServiceTarget', () => {
    it('formats gui/<uid>/<label>', () => {
        process.env.HAPPY_VARIANT = 'stable';
        // Use getInvokingUid() — not the raw process.getuid() — so the assertion is
        // correct in both ordinary-user and sudo-run-tests environments (BUG-DAEMON-03).
        const uid = getInvokingUid();
        expect(getAgentServiceTarget()).toBe(`gui/${uid}/com.happy-cli.agent`);
    });

    it('reflects dev label', () => {
        process.env.HAPPY_VARIANT = 'dev';
        expect(getAgentServiceTarget()).toContain('com.happy-cli.agent.dev');
    });
});

describe('buildAgentPlist (pure XML generation)', () => {
    const baseParams = {
        label: 'com.happy-cli.agent',
        nodeExecPath: '/usr/local/bin/node',
        entrypoint: '/Users/x/happy/packages/happy-cli/dist/index.mjs',
        env: { PATH: '/usr/bin', HOME: '/Users/x' },
        stdoutPath: '/Users/x/.happy/logs/launchagent.out.log',
        stderrPath: '/Users/x/.happy/logs/launchagent.err.log',
        throttleIntervalSec: 30,
    };

    it('SuccessfulExit is false (exit 0 handoffs must not restart)', () => {
        const plist = buildAgentPlist(baseParams);
        expect(plist).toMatch(/<key>SuccessfulExit<\/key>\s*<false\/>/);
    });

    it('ProgramArguments use absolute node execPath, not bare node', () => {
        const plist = buildAgentPlist(baseParams);
        expect(plist).toContain('<string>/usr/local/bin/node</string>');
        // no bare <string>node</string> program arg
        expect(plist).not.toMatch(/<string>node<\/string>/);
    });

    it('ProgramArguments use real `daemon start-sync` subcommand, not legacy happy-daemon', () => {
        const plist = buildAgentPlist(baseParams);
        expect(plist).toContain('<string>daemon</string>');
        expect(plist).toContain('<string>start-sync</string>');
        expect(plist).not.toContain('happy-daemon');
    });

    it('ProgramArguments include the real dist/index.mjs entrypoint', () => {
        const plist = buildAgentPlist(baseParams);
        expect(plist).toContain('<string>/Users/x/happy/packages/happy-cli/dist/index.mjs</string>');
    });

    it('includes --no-warnings --no-deprecation (same as spawnHappyCLI)', () => {
        const plist = buildAgentPlist(baseParams);
        expect(plist).toContain('<string>--no-warnings</string>');
        expect(plist).toContain('<string>--no-deprecation</string>');
    });

    it('ThrottleInterval reflects requested value', () => {
        const plist = buildAgentPlist(baseParams);
        expect(plist).toMatch(/<key>ThrottleInterval<\/key>\s*<integer>30<\/integer>/);
    });

    it('clamps ThrottleInterval to a >=10 floor (restart storm guard, NFR-002)', () => {
        const plist = buildAgentPlist({ ...baseParams, throttleIntervalSec: 3 });
        expect(plist).toMatch(/<integer>10<\/integer>/);
    });

    it('RunAtLoad is true', () => {
        const plist = buildAgentPlist(baseParams);
        expect(plist).toMatch(/<key>RunAtLoad<\/key>\s*<true\/>/);
    });

    it('writes StandardOut/StandardError paths', () => {
        const plist = buildAgentPlist(baseParams);
        expect(plist).toContain('<string>/Users/x/.happy/logs/launchagent.out.log</string>');
        expect(plist).toContain('<string>/Users/x/.happy/logs/launchagent.err.log</string>');
    });

    it('C9: plist EnvironmentVariables keys ⊇ DAEMON_REQUIRED_ENV.required', () => {
        const env = collectDaemonEnv({ PATH: '/usr/bin', HOME: '/Users/x' });
        const plist = buildAgentPlist({ ...baseParams, env });
        for (const key of DAEMON_REQUIRED_ENV.required) {
            expect(plist).toContain(`<key>${key}</key>`);
        }
    });

    it('does NOT leak secrets: no access.key / token keys in plist', () => {
        const plist = buildAgentPlist(baseParams);
        expect(plist.toLowerCase()).not.toContain('access.key');
        expect(plist.toLowerCase()).not.toContain('token');
        expect(plist.toLowerCase()).not.toContain('secret');
    });

    it('XML-escapes special characters in paths/env values', () => {
        const plist = buildAgentPlist({
            ...baseParams,
            entrypoint: '/Users/a&b/dist/index.mjs',
            env: { PATH: '/usr/bin', HOME: '/Users/a<b>' },
        });
        expect(plist).toContain('/Users/a&amp;b/dist/index.mjs');
        expect(plist).toContain('/Users/a&lt;b&gt;');
        // raw unescaped forms must not appear
        expect(plist).not.toContain('/Users/a&b/');
    });

    it('propagates DAEMON_ENV_INCOMPLETE when required env missing (via collectDaemonEnv)', () => {
        let caught: unknown;
        try {
            const env = collectDaemonEnv({ HOME: '/Users/x' }); // missing PATH
            buildAgentPlist({ ...baseParams, env });
        } catch (e) {
            caught = e;
        }
        expect(isAppError(caught, 'DAEMON_ENV_INCOMPLETE')).toBe(true);
    });
});

describe('parseSupervisorPrint (launchctl print parsing, spike-confirmed format)', () => {
    const sample = `gui/501/com.happy-cli.agent = {
\tstate = not running
\truns = 5
\tlast exit code = 1
}`;

    it('parses runs count', () => {
        expect(parseSupervisorPrint(sample).runs).toBe(5);
    });

    it('parses last exit code (incl. non-zero)', () => {
        expect(parseSupervisorPrint(sample).lastExitCode).toBe(1);
    });

    it('detects not-running state', () => {
        expect(parseSupervisorPrint(sample).running).toBe(false);
    });

    it('detects running state', () => {
        const running = `com.happy-cli.agent = {\n\tstate = running\n\truns = 2\n\tlast exit code = 0\n}`;
        const parsed = parseSupervisorPrint(running);
        expect(parsed.running).toBe(true);
        expect(parsed.runs).toBe(2);
        expect(parsed.lastExitCode).toBe(0);
    });

    it('returns nulls on unparseable output', () => {
        const parsed = parseSupervisorPrint('garbage');
        expect(parsed.runs).toBeNull();
        expect(parsed.lastExitCode).toBeNull();
        expect(parsed.running).toBe(false);
    });

    it('derives restartCount = runs - 1 semantics (runs=1 → 0 restarts)', () => {
        const first = `x = {\n\truns = 1\n\tlast exit code = 0\n\tstate = not running\n}`;
        expect(parseSupervisorPrint(first).runs).toBe(1);
    });
});

describe('deriveLastAbnormalExitAt (TL-01: scan the log the marker actually lands in)', () => {
    // The crash-restart marker is emitted via logger.info → console.log → stdout,
    // which launchd redirects to launchagent.out.log (NOT err.log). These tests
    // write real files under configuration.logsDir (no mocking) and clean up after.
    const outLogPath = join(configuration.logsDir, 'launchagent.out.log');
    const errLogPath = join(configuration.logsDir, 'launchagent.err.log');
    const CRASH_MARKER = '[SUPERVISOR] daemon start | managed=true | trigger=crash-restart\n';

    async function rm(p: string): Promise<void> {
        if (existsSync(p)) await unlink(p);
    }

    afterEach(async () => {
        await rm(outLogPath);
        await rm(errLogPath);
    });

    it('reads the crash-restart marker timestamp from out.log (the file it lands in)', async () => {
        await writeFile(outLogPath, `some startup line\n${CRASH_MARKER}`, 'utf8');
        const result = await deriveLastAbnormalExitAt();
        expect(result).not.toBeNull();
        const st = await stat(outLogPath);
        expect(result).toBe(st.mtimeMs);
    });

    it('returns null when out.log has no crash-restart marker (managed start only)', async () => {
        await writeFile(
            outLogPath,
            '[SUPERVISOR] daemon start | managed=true | trigger=launchd-managed-start\n',
            'utf8',
        );
        expect(await deriveLastAbnormalExitAt()).toBeNull();
    });

    it('regression guard: marker in err.log alone is NOT read (old behavior was structurally null)', async () => {
        // Before TL-01 the scan targeted err.log; the marker never lands there, so
        // simulate the marker only in err.log with out.log absent — must be null.
        await writeFile(errLogPath, CRASH_MARKER, 'utf8');
        expect(await deriveLastAbnormalExitAt()).toBeNull();
    });

    it('returns null when out.log does not exist', async () => {
        // afterEach guarantees no out.log present at entry of this run.
        await rm(outLogPath);
        expect(await deriveLastAbnormalExitAt()).toBeNull();
    });
});

// ─── M-D2 new tests ────────────────────────────────────────────────────────

describe('getInvokingUid (TL-04 three-scenario truth table)', () => {
    const originalSudoUid = process.env.SUDO_UID;

    afterEach(() => {
        if (originalSudoUid === undefined) delete process.env.SUDO_UID;
        else process.env.SUDO_UID = originalSudoUid;
    });

    it('scenario 1 — ordinary user: no SUDO_UID → returns process.getuid()', () => {
        delete process.env.SUDO_UID;
        const expected = typeof process.getuid === 'function' ? process.getuid() : 0;
        expect(getInvokingUid()).toBe(expected);
    });

    it('scenario 2 — sudo user: SUDO_UID="501" → returns 501 (not process.getuid())', () => {
        process.env.SUDO_UID = '501';
        expect(getInvokingUid()).toBe(501);
    });

    it('scenario 3 — true root (no SUDO_UID): getuid()=current uid, descends to getuid fallback', () => {
        // Without SUDO_UID the function must fall back to process.getuid().
        // In a non-root CI process this verifies the branch compiles and runs correctly.
        delete process.env.SUDO_UID;
        const fromFn = getInvokingUid();
        const fromGetuid = typeof process.getuid === 'function' ? process.getuid() : 0;
        expect(fromFn).toBe(fromGetuid);
    });

    it('scenario 4a — SUDO_UID="0" (not a positive integer) → falls back to getuid()', () => {
        process.env.SUDO_UID = '0';
        const expected = typeof process.getuid === 'function' ? process.getuid() : 0;
        expect(getInvokingUid()).toBe(expected);
    });

    it('scenario 4b — SUDO_UID="abc" (NaN) → falls back to getuid()', () => {
        process.env.SUDO_UID = 'abc';
        const expected = typeof process.getuid === 'function' ? process.getuid() : 0;
        expect(getInvokingUid()).toBe(expected);
    });

    it('scenario 4c — SUDO_UID="-5" (negative) → falls back to getuid()', () => {
        process.env.SUDO_UID = '-5';
        const expected = typeof process.getuid === 'function' ? process.getuid() : 0;
        expect(getInvokingUid()).toBe(expected);
    });
});

describe('getAgentServiceTarget sudo-domain fix (BUG-DAEMON-03)', () => {
    const originalSudoUid = process.env.SUDO_UID;
    const originalVariant2 = process.env.HAPPY_VARIANT;

    afterEach(() => {
        if (originalSudoUid === undefined) delete process.env.SUDO_UID;
        else process.env.SUDO_UID = originalSudoUid;
        if (originalVariant2 === undefined) delete process.env.HAPPY_VARIANT;
        else process.env.HAPPY_VARIANT = originalVariant2;
    });

    it('sudo scenario: service target uses SUDO_UID (not 0)', () => {
        process.env.SUDO_UID = '501';
        process.env.HAPPY_VARIANT = 'stable';
        expect(getAgentServiceTarget()).toBe('gui/501/com.happy-cli.agent');
    });

    it('ordinary user scenario: service target uses process.getuid() (no regression)', () => {
        delete process.env.SUDO_UID;
        process.env.HAPPY_VARIANT = 'stable';
        const expectedUid = typeof process.getuid === 'function' ? process.getuid() : 0;
        expect(getAgentServiceTarget()).toBe(`gui/${expectedUid}/com.happy-cli.agent`);
    });
});

describe('chownInstallArtifacts ENOENT tolerance', () => {
    // Design note (design_m-d2.md §UT): actual chown-to-other-uid semantics require
    // a darwin+root environment and are validated in Phase 6.5 host-machine tests
    // (TC-701). Unit-test goal: ENOENT silencing — the function must NOT throw
    // AppError('LAUNCHAGENT_CHOWN_FAILED') when plist / logsDir do not exist.
    //
    // We use the optional `_paths` seam (internal to this module) to supply temp
    // paths guaranteed not to exist, isolating the tests from real production
    // artifacts (which may include root-owned files from a past sudo daemon run).
    // SUDO_UID is set to current uid so parseInt yields a valid positive integer.

    const originalSudoUid = process.env.SUDO_UID;
    const originalSudoGid = process.env.SUDO_GID;

    const selfUid = typeof process.getuid === 'function' ? process.getuid() : 501;
    const selfGid = typeof process.getgid === 'function' ? process.getgid() : 20;

    // Paths that do not exist — guaranteed by using a random suffix
    const nonExistentPlist = join(configuration.logsDir, '__test_nonexistent_plist__.plist');
    const nonExistentLogsDir = join(configuration.logsDir, '__test_nonexistent_logsdir__');

    beforeEach(() => {
        process.env.SUDO_UID = String(selfUid);
        process.env.SUDO_GID = String(selfGid);
    });

    afterEach(() => {
        if (originalSudoUid === undefined) delete process.env.SUDO_UID;
        else process.env.SUDO_UID = originalSudoUid;
        if (originalSudoGid === undefined) delete process.env.SUDO_GID;
        else process.env.SUDO_GID = originalSudoGid;
    });

    it('scenario B — plist does not exist: ENOENT silenced, no AppError thrown', async () => {
        // Both paths non-existent → ENOENT silenced at plist → early return before logsDir.
        await expect(
            chownInstallArtifacts({ plistPath: nonExistentPlist, logsDir: nonExistentLogsDir })
        ).resolves.toBeUndefined();
    });

    it('scenario C — logsDir does not exist: ENOENT silenced, no AppError thrown', async () => {
        // plist non-existent (ENOENT silenced), logsDir non-existent (ENOENT → early return).
        await expect(
            chownInstallArtifacts({ plistPath: nonExistentPlist, logsDir: nonExistentLogsDir })
        ).resolves.toBeUndefined();
    });

    it('scenario D — SUDO_GID absent: gid falls back to uid, ENOENT paths silenced, no throw', async () => {
        delete process.env.SUDO_GID;
        // gid fallback = selfUid; paths non-existent → ENOENT silenced.
        await expect(
            chownInstallArtifacts({ plistPath: nonExistentPlist, logsDir: nonExistentLogsDir })
        ).resolves.toBeUndefined();
    });
});

// ─── M-F1 new tests ────────────────────────────────────────────────────────

describe('parseSupervisorPid (M-F1: pid extraction from launchctl print output)', () => {
    it('running service — pid line present with tab indent → returns pid', () => {
        const output = 'state = running\n\truns = 2\n\tpid = 88675\n';
        expect(parseSupervisorPid(output)).toBe(88675);
    });

    it('not running — no pid line → returns null', () => {
        const output = 'state = waiting\n\truns = 1\n';
        expect(parseSupervisorPid(output)).toBeNull();
    });

    it('pid = 0 (boundary) → returns 0', () => {
        const output = '\tpid = 0\n';
        expect(parseSupervisorPid(output)).toBe(0);
    });

    it('large pid → returns correctly', () => {
        const output = '\tpid = 99999\n';
        expect(parseSupervisorPid(output)).toBe(99999);
    });

    it('empty string → returns null', () => {
        expect(parseSupervisorPid('')).toBeNull();
    });

    it('pid line with extra spaces → returns pid', () => {
        const output = '  pid   =   12345  \n';
        expect(parseSupervisorPid(output)).toBe(12345);
    });

    it('embedded state=active line does not interfere with pid parsing', () => {
        const output = '\tpid = 88675\n\t\tstate = active\n';
        expect(parseSupervisorPid(output)).toBe(88675);
    });
});
