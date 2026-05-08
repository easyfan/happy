// Shim for @/sync/persistence when running tests under vitest/Node.js.
// MMKV requires native modules; this shim returns empty defaults so that
// the t() module initializer can run without crashing in a jsdom environment.
import type { Settings } from '@/sync/settings';
import { settingsDefaults } from '@/sync/settings';

export function loadSettings(): { settings: Settings; version: number | null } {
    return { settings: { ...settingsDefaults }, version: null };
}

export function saveSettings(_settings: Settings, _version: number | null): void {
    // no-op in test environment
}
