import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readSettingsStringSync } from './configuration';

// Tests for readSettingsStringSync — the UP-05 settings-tier URL helper.
// Indirectly validates that the priority chain (env > settings > default) is
// wired correctly in the Configuration constructor.

describe('readSettingsStringSync', () => {
    let testDir: string;
    let settingsFile: string;

    beforeEach(() => {
        testDir = join(tmpdir(), `happy-cfg-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
        mkdirSync(testDir, { recursive: true });
        settingsFile = join(testDir, 'settings.json');
    });

    afterEach(() => {
        rmSync(testDir, { recursive: true, force: true });
    });

    it('returns undefined when settings file does not exist', () => {
        // settingsFile is not written — file missing
        expect(readSettingsStringSync(settingsFile, 'serverUrl')).toBeUndefined();
        expect(readSettingsStringSync(settingsFile, 'webappUrl')).toBeUndefined();
    });

    it('returns the value from settings.json when key is present', () => {
        writeFileSync(settingsFile, JSON.stringify({
            serverUrl: 'https://my-server.example.com',
            webappUrl: 'https://my-app.example.com',
        }));

        expect(readSettingsStringSync(settingsFile, 'serverUrl')).toBe('https://my-server.example.com');
        expect(readSettingsStringSync(settingsFile, 'webappUrl')).toBe('https://my-app.example.com');
    });

    it('returns undefined when key is absent from settings.json', () => {
        writeFileSync(settingsFile, JSON.stringify({ onboardingCompleted: true }));

        expect(readSettingsStringSync(settingsFile, 'serverUrl')).toBeUndefined();
        expect(readSettingsStringSync(settingsFile, 'webappUrl')).toBeUndefined();
    });

    it('returns undefined when value is an empty string', () => {
        writeFileSync(settingsFile, JSON.stringify({ serverUrl: '', webappUrl: '' }));

        expect(readSettingsStringSync(settingsFile, 'serverUrl')).toBeUndefined();
        expect(readSettingsStringSync(settingsFile, 'webappUrl')).toBeUndefined();
    });

    it('returns undefined when value is not a string (number or null)', () => {
        writeFileSync(settingsFile, JSON.stringify({ serverUrl: 42, webappUrl: null }));

        expect(readSettingsStringSync(settingsFile, 'serverUrl')).toBeUndefined();
        expect(readSettingsStringSync(settingsFile, 'webappUrl')).toBeUndefined();
    });

    it('returns undefined and does not throw when settings.json is malformed JSON', () => {
        writeFileSync(settingsFile, 'this is not valid { json');

        expect(readSettingsStringSync(settingsFile, 'serverUrl')).toBeUndefined();
    });

    it('returns only the matching key value when other keys differ', () => {
        writeFileSync(settingsFile, JSON.stringify({
            serverUrl: 'https://server.local',
        }));

        expect(readSettingsStringSync(settingsFile, 'serverUrl')).toBe('https://server.local');
        // webappUrl not in file
        expect(readSettingsStringSync(settingsFile, 'webappUrl')).toBeUndefined();
    });
});

describe('Configuration env priority', () => {
    const savedEnv: Record<string, string | undefined> = {};

    beforeEach(() => {
        savedEnv['HAPPY_WEBAPP_URL'] = process.env.HAPPY_WEBAPP_URL;
        savedEnv['HAPPY_SERVER_URL'] = process.env.HAPPY_SERVER_URL;
        savedEnv['HAPPY_HOME_DIR'] = process.env.HAPPY_HOME_DIR;
    });

    afterEach(() => {
        for (const [k, v] of Object.entries(savedEnv)) {
            if (v === undefined) {
                delete process.env[k as keyof NodeJS.ProcessEnv];
            } else {
                process.env[k as keyof NodeJS.ProcessEnv] = v;
            }
        }
    });

    it('webappUrl uses HAPPY_WEBAPP_URL env when set', async () => {
        process.env.HAPPY_WEBAPP_URL = 'https://custom-webapp.example.com';
        process.env.HAPPY_HOME_DIR = tmpdir();
        vi.resetModules();
        const mod = await import('./configuration');
        expect(mod.configuration.webappUrl).toBe('https://custom-webapp.example.com');
    });

    it('webappUrl falls back to default when HAPPY_WEBAPP_URL is not set', async () => {
        delete process.env.HAPPY_WEBAPP_URL;
        process.env.HAPPY_HOME_DIR = tmpdir();
        vi.resetModules();
        const mod = await import('./configuration');
        expect(mod.configuration.webappUrl).toBe('https://app.happy.engineering');
    });

    it('webappUrl falls back to default when HAPPY_WEBAPP_URL is empty string', async () => {
        process.env.HAPPY_WEBAPP_URL = '';
        process.env.HAPPY_HOME_DIR = tmpdir();
        vi.resetModules();
        const mod = await import('./configuration');
        expect(mod.configuration.webappUrl).toBe('https://app.happy.engineering');
    });
});
