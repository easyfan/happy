import { describe, it, expect } from 'vitest';
import { collectDaemonEnv, DAEMON_REQUIRED_ENV } from './daemonEnv';
import { isAppError } from '@/utils/errors';

describe('DAEMON_REQUIRED_ENV', () => {
    it('required tier contains PATH and HOME', () => {
        expect(DAEMON_REQUIRED_ENV.required).toContain('PATH');
        expect(DAEMON_REQUIRED_ENV.required).toContain('HOME');
    });

    it('optional tier contains HAPPY_VARIANT (label/home selection)', () => {
        expect(DAEMON_REQUIRED_ENV.optional).toContain('HAPPY_VARIANT');
        expect(DAEMON_REQUIRED_ENV.optional).toContain('HAPPY_HOME_DIR');
        expect(DAEMON_REQUIRED_ENV.optional).toContain('HAPPY_SERVER_URL');
    });
});

describe('collectDaemonEnv', () => {
    it('collects required vars when present', () => {
        const env = collectDaemonEnv({ PATH: '/usr/bin', HOME: '/Users/x' });
        expect(env.PATH).toBe('/usr/bin');
        expect(env.HOME).toBe('/Users/x');
    });

    it('throws DAEMON_ENV_INCOMPLETE when PATH missing', () => {
        let caught: unknown;
        try {
            collectDaemonEnv({ HOME: '/Users/x' });
        } catch (e) {
            caught = e;
        }
        expect(isAppError(caught, 'DAEMON_ENV_INCOMPLETE')).toBe(true);
        expect((caught as { detail?: { missing?: string[] } }).detail?.missing).toContain('PATH');
    });

    it('throws DAEMON_ENV_INCOMPLETE when HOME missing', () => {
        let caught: unknown;
        try {
            collectDaemonEnv({ PATH: '/usr/bin' });
        } catch (e) {
            caught = e;
        }
        expect(isAppError(caught, 'DAEMON_ENV_INCOMPLETE')).toBe(true);
        expect((caught as { detail?: { missing?: string[] } }).detail?.missing).toContain('HOME');
    });

    it('treats empty string as missing', () => {
        expect(() => collectDaemonEnv({ PATH: '', HOME: '/Users/x' })).toThrow();
    });

    it('includes optional vars only when present and non-empty', () => {
        const env = collectDaemonEnv({
            PATH: '/usr/bin',
            HOME: '/Users/x',
            HAPPY_VARIANT: 'dev',
            HAPPY_SERVER_URL: 'https://local',
            HAPPY_EXPERIMENTAL: '', // empty → excluded
        });
        expect(env.HAPPY_VARIANT).toBe('dev');
        expect(env.HAPPY_SERVER_URL).toBe('https://local');
        expect('HAPPY_EXPERIMENTAL' in env).toBe(false);
        expect('HAPPY_WEBAPP_URL' in env).toBe(false); // absent → not written
    });

    it('never writes empty strings for absent optionals', () => {
        const env = collectDaemonEnv({ PATH: '/usr/bin', HOME: '/Users/x' });
        for (const v of Object.values(env)) {
            expect(v.length).toBeGreaterThan(0);
        }
    });
});
