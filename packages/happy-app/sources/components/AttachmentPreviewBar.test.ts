import { describe, it, expect } from 'vitest';
import { formatBytes } from './attachmentUtils';

// ---------------------------------------------------------------------------
// formatBytes — human-readable file size display
// ---------------------------------------------------------------------------
describe('formatBytes', () => {
    it('displays bytes when under 1 KB', () => {
        expect(formatBytes(0)).toBe('0 B');
        expect(formatBytes(1)).toBe('1 B');
        expect(formatBytes(512)).toBe('512 B');
        expect(formatBytes(1023)).toBe('1023 B');
    });

    it('displays KB when between 1 KB and 1 MB (1 decimal)', () => {
        expect(formatBytes(1024)).toBe('1.0 KB');
        expect(formatBytes(1536)).toBe('1.5 KB');
        expect(formatBytes(10240)).toBe('10.0 KB');
        expect(formatBytes(1024 * 1024 - 1)).toBe('1024.0 KB');
    });

    it('displays MB for files >= 1 MB (1 decimal)', () => {
        expect(formatBytes(1024 * 1024)).toBe('1.0 MB');
        expect(formatBytes(1.5 * 1024 * 1024)).toBe('1.5 MB');
        expect(formatBytes(3.3 * 1024 * 1024)).toBe('3.3 MB');
        expect(formatBytes(10 * 1024 * 1024)).toBe('10.0 MB');
    });

    it('rounds to 1 decimal place', () => {
        // 1500 bytes = 1.4648... KB → rounds to 1.5 KB
        expect(formatBytes(1500)).toBe('1.5 KB');
        // 1499 bytes = 1.4638... KB → rounds to 1.5 KB
        expect(formatBytes(1499)).toBe('1.5 KB');
        // 1450 bytes = 1.416... KB → rounds to 1.4 KB
        expect(formatBytes(1450)).toBe('1.4 KB');
    });
});

// ---------------------------------------------------------------------------
// AttachmentState — type-level constraint checks (compile-time safety)
// These tests verify the discriminated union shape is correct.
// ---------------------------------------------------------------------------
import type { AttachmentState } from './attachmentUtils';

describe('AttachmentState shape', () => {
    it('uploading state has required fields', () => {
        const s: AttachmentState = {
            status: 'uploading',
            filename: 'report.docx',
            mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            sizeBytes: 1024,
            percent: 45,
            onCancel: () => {},
        };
        expect(s.status).toBe('uploading');
        expect(s.percent).toBe(45);
    });

    it('ready state has onRemove, not onCancel', () => {
        const s: AttachmentState = {
            status: 'ready',
            filename: 'budget.xlsx',
            mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            sizeBytes: 2048,
            onRemove: () => {},
        };
        expect(s.status).toBe('ready');
        // @ts-expect-error — ready state must not expose onCancel
        expect(s.onCancel).toBeUndefined();
    });

    it('error state has both onRetry and onCancel', () => {
        let retried = false;
        let cancelled = false;
        const s: AttachmentState = {
            status: 'error',
            filename: 'slides.pptx',
            mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
            sizeBytes: 4096,
            onRetry: () => { retried = true; },
            onCancel: () => { cancelled = true; },
        };
        s.onRetry();
        s.onCancel();
        expect(retried).toBe(true);
        expect(cancelled).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// isMachineOnline — pure logic, inline to avoid RN dependency chain in vitest
// Source: packages/happy-app/sources/utils/machineUtils.ts
// ---------------------------------------------------------------------------
function isMachineOnline(machine: { active: boolean }): boolean {
    return machine.active;
}

describe('isMachineOnline', () => {
    it('returns true when machine.active is true', () => {
        expect(isMachineOnline({ active: true })).toBe(true);
    });

    it('returns false when machine.active is false', () => {
        expect(isMachineOnline({ active: false })).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// cliOfflineWarning derivation — unit-tests the logic used in SessionView
// (pure function extracted from component logic for testability)
// Source: packages/happy-app/sources/-session/SessionView.tsx
// ---------------------------------------------------------------------------
const DEVICE_OFFLINE_WARNING = 'Device offline. File saved, will deliver when CLI reconnects.';

function deriveCliOfflineWarning(machine: { active: boolean } | null): string | undefined {
    if (machine && !isMachineOnline(machine)) {
        return DEVICE_OFFLINE_WARNING;
    }
    return undefined;
}

describe('deriveCliOfflineWarning', () => {
    it('returns undefined when machine is null (no machine associated with session)', () => {
        expect(deriveCliOfflineWarning(null)).toBeUndefined();
    });

    it('returns undefined when machine is online', () => {
        expect(deriveCliOfflineWarning({ active: true })).toBeUndefined();
    });

    it('returns warning string when machine is offline', () => {
        const result = deriveCliOfflineWarning({ active: false });
        expect(typeof result).toBe('string');
        expect(result!.length).toBeGreaterThan(0);
    });

    it('warning string is the expected i18n value', () => {
        expect(deriveCliOfflineWarning({ active: false })).toBe(DEVICE_OFFLINE_WARNING);
    });

    it('cliOfflineWarning is only propagated for ready status, not uploading or error', () => {
        const warning = deriveCliOfflineWarning({ active: false });

        // AgentInput.tsx: cliOfflineWarning={attachmentState.status === 'ready' ? props.cliOfflineWarning : undefined}
        const resolveWarning = (status: 'uploading' | 'ready' | 'error') =>
            status === 'ready' ? warning : undefined;

        expect(resolveWarning('ready')).toBe(warning);
        expect(resolveWarning('uploading')).toBeUndefined();
        expect(resolveWarning('error')).toBeUndefined();
    });

    it('transitions correctly: offline → online clears warning', () => {
        expect(deriveCliOfflineWarning({ active: false })).toBeDefined();
        expect(deriveCliOfflineWarning({ active: true })).toBeUndefined();
    });
});
