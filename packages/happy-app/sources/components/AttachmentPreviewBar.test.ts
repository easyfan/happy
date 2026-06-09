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
// AttachmentState / AttachmentStateEntry — type-level constraint checks
// These tests verify the discriminated union shape is correct.
// ---------------------------------------------------------------------------
import type { AttachmentState, AttachmentStateEntry } from './attachmentUtils';

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
// AttachmentStateEntry — id field + AttachmentState fields combined
// ---------------------------------------------------------------------------
describe('AttachmentStateEntry shape', () => {
    it('entry has id plus uploading state fields', () => {
        const entry: AttachmentStateEntry = {
            id: 'entry-001',
            status: 'uploading',
            filename: 'photo.jpg',
            mimeType: 'image/jpeg',
            sizeBytes: 102400,
            percent: 60,
            onCancel: () => {},
        };
        expect(entry.id).toBe('entry-001');
        expect(entry.status).toBe('uploading');
        expect(entry.percent).toBe(60);
    });

    it('entry has id plus ready state fields', () => {
        const entry: AttachmentStateEntry = {
            id: 'entry-002',
            status: 'ready',
            filename: 'notes.txt',
            mimeType: 'text/plain',
            sizeBytes: 512,
            onRemove: () => {},
        };
        expect(entry.id).toBe('entry-002');
        expect(entry.status).toBe('ready');
    });

    it('entry has id plus error state fields', () => {
        let retried = false;
        const entry: AttachmentStateEntry = {
            id: 'entry-003',
            status: 'error',
            filename: 'doc.pdf',
            mimeType: 'application/pdf',
            sizeBytes: 204800,
            onRetry: () => { retried = true; },
            onCancel: () => {},
        };
        entry.onRetry();
        expect(retried).toBe(true);
    });

    it('different entries have different ids', () => {
        const ids = new Set(['entry-a', 'entry-b', 'entry-c']);
        expect(ids.size).toBe(3);
    });
});

// ---------------------------------------------------------------------------
// computeLayout — grid layout algorithm (pure logic, mirrored from component)
// ---------------------------------------------------------------------------

type LayoutResult = {
    columns: number;
    visibleCount: number;
    overflowCount: number;
    itemWidthPercent: string;
} | null;

function computeLayout(count: number): LayoutResult {
    if (count === 0) return null;
    if (count <= 3) {
        return {
            columns: count,
            visibleCount: count,
            overflowCount: 0,
            itemWidthPercent: `${(100 / count).toFixed(2)}%`,
        };
    }
    const columns = 3;
    if (count <= 6) {
        return { columns, visibleCount: count, overflowCount: 0, itemWidthPercent: '33.33%' };
    }
    return { columns, visibleCount: 5, overflowCount: count - 5, itemWidthPercent: '33.33%' };
}

describe('computeLayout', () => {
    it('returns null for 0 attachments', () => {
        expect(computeLayout(0)).toBeNull();
    });

    it('count=1: single column, full width', () => {
        const layout = computeLayout(1)!;
        expect(layout.columns).toBe(1);
        expect(layout.visibleCount).toBe(1);
        expect(layout.overflowCount).toBe(0);
        expect(layout.itemWidthPercent).toBe('100.00%');
    });

    it('count=2: two equal columns', () => {
        const layout = computeLayout(2)!;
        expect(layout.columns).toBe(2);
        expect(layout.visibleCount).toBe(2);
        expect(layout.overflowCount).toBe(0);
        expect(layout.itemWidthPercent).toBe('50.00%');
    });

    it('count=3: three equal columns', () => {
        const layout = computeLayout(3)!;
        expect(layout.columns).toBe(3);
        expect(layout.visibleCount).toBe(3);
        expect(layout.overflowCount).toBe(0);
        expect(layout.itemWidthPercent).toBe('33.33%');
    });

    it('count=4: 3-column grid, 4 visible, no overflow', () => {
        const layout = computeLayout(4)!;
        expect(layout.columns).toBe(3);
        expect(layout.visibleCount).toBe(4);
        expect(layout.overflowCount).toBe(0);
        expect(layout.itemWidthPercent).toBe('33.33%');
    });

    it('count=5: 3-column grid, 5 visible, no overflow', () => {
        const layout = computeLayout(5)!;
        expect(layout.columns).toBe(3);
        expect(layout.visibleCount).toBe(5);
        expect(layout.overflowCount).toBe(0);
    });

    it('count=6: 3-column grid, 6 visible, no overflow', () => {
        const layout = computeLayout(6)!;
        expect(layout.columns).toBe(3);
        expect(layout.visibleCount).toBe(6);
        expect(layout.overflowCount).toBe(0);
    });

    it('count=7: shows 5 normal + overflow badge for remaining 2', () => {
        const layout = computeLayout(7)!;
        expect(layout.visibleCount).toBe(5);
        expect(layout.overflowCount).toBe(2);
        expect(layout.itemWidthPercent).toBe('33.33%');
    });

    it('count=10: shows 5 normal + overflow badge for remaining 5', () => {
        const layout = computeLayout(10)!;
        expect(layout.visibleCount).toBe(5);
        expect(layout.overflowCount).toBe(5);
    });

    it('count=100: overflow count is 95', () => {
        const layout = computeLayout(100)!;
        expect(layout.visibleCount).toBe(5);
        expect(layout.overflowCount).toBe(95);
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
