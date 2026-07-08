import { describe, it, expect, afterEach } from 'vitest';
import { writeFile, unlink, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
    getAgentLabel,
    getAgentServiceTarget,
    buildAgentPlist,
    parseSupervisorPrint,
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
        const uid = process.getuid?.() ?? 0;
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
