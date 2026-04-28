/**
 * Human-readable file size string.
 * < 1 KB → "N B"
 * < 1 MB → "N.N KB"
 * else   → "N.N MB"
 */
export function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export type AttachmentState =
    | { status: 'uploading'; filename: string; mimeType: string; sizeBytes: number; percent: number; onCancel: () => void }
    | { status: 'ready'; filename: string; mimeType: string; sizeBytes: number; onRemove: () => void }
    | { status: 'error'; filename: string; mimeType: string; sizeBytes: number; onRetry: () => void; onCancel: () => void };
