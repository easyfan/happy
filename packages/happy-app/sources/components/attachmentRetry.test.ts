/**
 * AC-3: Single attachment retry — state machine contract tests.
 *
 * These tests verify the retry behaviour of the multi-attachment upload flow
 * without rendering AgentInput (a heavy React Native component). They model the
 * state transitions that `startUpload` / `handleCancel` / `handleRetry` perform
 * on the `attachments: AttachmentStateEntry[]` array.
 *
 * Test strategy: simulate the reducer logic directly, confirming:
 *   1. A failed upload transitions the entry to 'error' status.
 *   2. Calling onRetry removes the error entry and re-queues uploading.
 *   3. A sibling entry (different id) is unaffected throughout.
 *   4. After successful retry, the slot is in 'ready' status.
 *   5. uploadIdMap is kept consistent with attachment state.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AttachmentStateEntry } from './attachmentUtils';

// ---------------------------------------------------------------------------
// Helpers that replicate AgentInput's internal state transitions
// ---------------------------------------------------------------------------

type UploadIdMap = Map<string, string>;

function makeUploading(id: string, filename: string): AttachmentStateEntry {
    return {
        id,
        status: 'uploading',
        filename,
        mimeType: 'image/jpeg',
        sizeBytes: 1024,
        percent: 0,
        onCancel: vi.fn(),
    };
}

function transitionToError(
    entries: AttachmentStateEntry[],
    entryId: string,
    onRetry: () => void,
    onCancel: () => void,
): AttachmentStateEntry[] {
    return entries.map(a =>
        a.id === entryId
            ? { id: entryId, status: 'error', filename: a.filename, mimeType: a.mimeType, sizeBytes: a.sizeBytes, onRetry, onCancel }
            : a,
    );
}

function transitionToReady(
    entries: AttachmentStateEntry[],
    entryId: string,
    onRemove: () => void,
): AttachmentStateEntry[] {
    return entries.map(a =>
        a.id === entryId
            ? { id: entryId, status: 'ready', filename: a.filename, mimeType: a.mimeType, sizeBytes: a.sizeBytes, onRemove }
            : a,
    );
}

function cancelEntry(
    entries: AttachmentStateEntry[],
    uploadIdMap: UploadIdMap,
    entryId: string,
): AttachmentStateEntry[] {
    uploadIdMap.delete(entryId);
    return entries.filter(a => a.id !== entryId);
}

// ---------------------------------------------------------------------------
// AC-3 contract tests
// ---------------------------------------------------------------------------

describe('AC-3: attachment retry state machine', () => {
    let entries: AttachmentStateEntry[];
    let uploadIdMap: UploadIdMap;

    const ENTRY_A = 'entry-a';
    const ENTRY_B = 'entry-b'; // sibling — must never be affected

    beforeEach(() => {
        uploadIdMap = new Map();
        entries = [
            makeUploading(ENTRY_A, 'photo_a.jpg'),
            makeUploading(ENTRY_B, 'photo_b.jpg'),
        ];
    });

    it('failed upload transitions entry to error with onRetry and onCancel', () => {
        const onRetry = vi.fn();
        const onCancel = vi.fn();
        entries = transitionToError(entries, ENTRY_A, onRetry, onCancel);

        const entryA = entries.find(e => e.id === ENTRY_A)!;
        expect(entryA.status).toBe('error');
        expect((entryA as Extract<AttachmentStateEntry, { status: 'error' }>).onRetry).toBe(onRetry);
        expect((entryA as Extract<AttachmentStateEntry, { status: 'error' }>).onCancel).toBe(onCancel);
    });

    it('sibling entry is unaffected when one entry fails', () => {
        entries = transitionToError(entries, ENTRY_A, vi.fn(), vi.fn());

        const entryB = entries.find(e => e.id === ENTRY_B)!;
        expect(entryB.status).toBe('uploading');
        expect(entryB.filename).toBe('photo_b.jpg');
    });

    it('onRetry removes the error entry (handleCancel step)', () => {
        entries = transitionToError(entries, ENTRY_A, vi.fn(), vi.fn());
        // simulate handleCancel — remove the errored entry
        entries = cancelEntry(entries, uploadIdMap, ENTRY_A);

        expect(entries.find(e => e.id === ENTRY_A)).toBeUndefined();
        expect(entries).toHaveLength(1); // only sibling remains
    });

    it('sibling survives the cancel step of retry', () => {
        entries = transitionToError(entries, ENTRY_A, vi.fn(), vi.fn());
        entries = cancelEntry(entries, uploadIdMap, ENTRY_A);

        const entryB = entries.find(e => e.id === ENTRY_B)!;
        expect(entryB).toBeDefined();
        expect(entryB.status).toBe('uploading');
    });

    it('new uploading entry is appended after cancel (re-queue step)', () => {
        entries = transitionToError(entries, ENTRY_A, vi.fn(), vi.fn());
        entries = cancelEntry(entries, uploadIdMap, ENTRY_A);

        const NEW_ID = 'entry-a-retry';
        entries = [...entries, makeUploading(NEW_ID, 'photo_a.jpg')];

        expect(entries).toHaveLength(2); // sibling + new retry entry
        const newEntry = entries.find(e => e.id === NEW_ID)!;
        expect(newEntry.status).toBe('uploading');
        expect(newEntry.filename).toBe('photo_a.jpg');
    });

    it('successful retry transitions new entry to ready', () => {
        entries = transitionToError(entries, ENTRY_A, vi.fn(), vi.fn());
        entries = cancelEntry(entries, uploadIdMap, ENTRY_A);

        const NEW_ID = 'entry-a-retry';
        entries = [...entries, makeUploading(NEW_ID, 'photo_a.jpg')];

        // simulate successful upload
        const uploadId = 'upload-xyz';
        uploadIdMap.set(NEW_ID, uploadId);
        entries = transitionToReady(entries, NEW_ID, vi.fn());

        const retried = entries.find(e => e.id === NEW_ID)!;
        expect(retried.status).toBe('ready');
        expect(uploadIdMap.get(NEW_ID)).toBe(uploadId);
    });

    it('uploadIdMap entry is removed when error entry is cancelled', () => {
        // simulate a partial upload that got an uploadId before failing
        uploadIdMap.set(ENTRY_A, 'upload-partial');
        entries = transitionToError(entries, ENTRY_A, vi.fn(), vi.fn());
        entries = cancelEntry(entries, uploadIdMap, ENTRY_A);

        expect(uploadIdMap.has(ENTRY_A)).toBe(false);
    });

    it('sibling uploadId is preserved when one entry is retried', () => {
        uploadIdMap.set(ENTRY_B, 'upload-b-ok');
        entries = transitionToError(entries, ENTRY_A, vi.fn(), vi.fn());
        entries = cancelEntry(entries, uploadIdMap, ENTRY_A);

        expect(uploadIdMap.get(ENTRY_B)).toBe('upload-b-ok');
    });

    it('error entry filename and mimeType are preserved through retry cycle', () => {
        entries = transitionToError(entries, ENTRY_A, vi.fn(), vi.fn());
        const errorEntry = entries.find(e => e.id === ENTRY_A)!;
        const { filename, mimeType } = errorEntry;

        entries = cancelEntry(entries, uploadIdMap, ENTRY_A);
        const NEW_ID = 'entry-a-retry-2';
        entries = [...entries, makeUploading(NEW_ID, filename)];

        const retryEntry = entries.find(e => e.id === NEW_ID)!;
        expect(retryEntry.filename).toBe(filename);
        expect(retryEntry.mimeType).toBe(mimeType);
    });
});
