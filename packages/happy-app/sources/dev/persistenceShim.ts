// Shim for @/sync/persistence when running tests under vitest/Node.js.
// Uses the MMKV class (which vitest mocks to an in-memory Map) so that
// tests exercising syncReset() share the same storage backend as sync.ts.
import { MMKV } from 'react-native-mmkv';
import type { Settings } from '@/sync/settings';
import { settingsDefaults, settingsParse } from '@/sync/settings';
import type { LocalSettings } from '@/sync/localSettings';
import { localSettingsDefaults } from '@/sync/localSettings';
import type { Purchases } from '@/sync/purchases';
import { purchasesDefaults } from '@/sync/purchases';
import type { Profile } from '@/sync/profile';
import { profileDefaults } from '@/sync/profile';

export type NewSessionAgentType = 'claude' | 'codex' | 'gemini' | 'openclaw';
export type NewSessionSessionType = 'simple' | 'worktree';

export interface NewSessionDraft {
    input: string;
    selectedMachineId: string | null;
    selectedPath: string | null;
    agentType: NewSessionAgentType;
    permissionMode: string;
    modelMode: string;
    sessionType: NewSessionSessionType;
    worktreeKey: string | null;
    updatedAt: number;
}

const mmkv = new MMKV();

export function clearPersistence() {
    mmkv.clearAll();
}

export function loadSettings(): { settings: Settings; version: number | null } {
    const raw = mmkv.getString('settings');
    if (raw) {
        try {
            const parsed = JSON.parse(raw);
            return { settings: settingsParse(parsed.settings), version: parsed.version };
        } catch {
            return { settings: { ...settingsDefaults }, version: null };
        }
    }
    return { settings: { ...settingsDefaults }, version: null };
}

export function saveSettings(settings: Settings, version: number): void {
    mmkv.set('settings', JSON.stringify({ settings, version }));
}

export function loadPendingSettings(): Partial<Settings> {
    const raw = mmkv.getString('pending-settings');
    if (raw) {
        try {
            return JSON.parse(raw);
        } catch {
            return {};
        }
    }
    return {};
}

export function savePendingSettings(settings: Partial<Settings>): void {
    mmkv.set('pending-settings', JSON.stringify(settings));
}

export function loadLocalSettings(): LocalSettings {
    const raw = mmkv.getString('local-settings');
    if (raw) {
        try {
            return JSON.parse(raw);
        } catch {
            return { ...localSettingsDefaults };
        }
    }
    return { ...localSettingsDefaults };
}

export function saveLocalSettings(settings: LocalSettings): void {
    mmkv.set('local-settings', JSON.stringify(settings));
}

export function loadThemePreference(): 'light' | 'dark' | 'adaptive' {
    return loadLocalSettings().themePreference;
}

export function loadPurchases(): Purchases {
    return { ...purchasesDefaults };
}

export function savePurchases(_purchases: Purchases): void {
    // no-op in test environment
}

export function loadSessionDrafts(): Record<string, string> {
    const raw = mmkv.getString('session-drafts');
    if (raw) {
        try {
            return JSON.parse(raw);
        } catch {
            return {};
        }
    }
    return {};
}

export function saveSessionDrafts(drafts: Record<string, string>): void {
    mmkv.set('session-drafts', JSON.stringify(drafts));
}

export function loadNewSessionDraft(): NewSessionDraft | null {
    return null;
}

export function saveNewSessionDraft(_draft: NewSessionDraft): void {
    // no-op
}

export function clearNewSessionDraft(): void {
    mmkv.delete('new-session-draft-v1');
}

export function loadRegisteredPushToken(): string | null {
    return mmkv.getString('registered-push-token-v1') ?? null;
}

export function saveRegisteredPushToken(token: string): void {
    mmkv.set('registered-push-token-v1', token);
}

export function clearRegisteredPushToken(): void {
    mmkv.delete('registered-push-token-v1');
}

export function loadSessionPermissionModes(): Record<string, string> {
    return {};
}

export function saveSessionPermissionModes(_modes: Record<string, string>): void {
    // no-op
}

export function loadSessionModelModes(): Record<string, string> {
    return {};
}

export function saveSessionModelModes(_modes: Record<string, string>): void {
    // no-op
}

export function loadSessionEffortLevels(): Record<string, string> {
    return {};
}

export function saveSessionEffortLevels(_levels: Record<string, string>): void {
    // no-op
}

export function loadProfile(): Profile {
    return { ...profileDefaults };
}

export function saveProfile(_profile: Profile): void {
    // no-op
}

export function storeTempText(_content: string): string {
    return '';
}

export function retrieveTempText(_id: string): string | null {
    return null;
}

export function getVoiceSoftPaywallShownCount(): number {
    return 0;
}

export function incrementVoiceSoftPaywallShown(): void {
    // no-op
}

export function getVoiceOnboardingPromptLoadCount(): number {
    return 0;
}

export function incrementVoiceOnboardingPromptLoadCount(): void {
    // no-op
}

export function getVoiceMessageCount(): number {
    return 0;
}

export function incrementVoiceMessageCount(): void {
    // no-op
}

export function getVoiceLocalCounters() {
    return {
        voiceSoftPaywallShownCount: 0,
        voiceOnboardingPromptLoadCount: 0,
        voiceMessageCount: 0,
    };
}

export function resetVoiceLocalCounters(): void {
    // no-op
}
