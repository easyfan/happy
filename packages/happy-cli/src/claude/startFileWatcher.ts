import { logger } from "@/ui/logger";
import { watch } from "fs/promises";

/**
 * Start watching a file for changes with exponential backoff on ENOENT errors.
 *
 * Differences from `modules/watcher/startFileWatcher.ts`:
 *  - Exponential backoff on ENOENT: 1s → 2s → 4s … up to ~15s cap
 *  - missingFileTimeoutMs: give up after this many ms of continuous ENOENT
 *  - onGaveUp: called once when the file is considered permanently absent
 *  - Non-ENOENT errors restart immediately (reset backoff timer)
 *
 * The old watcher (`modules/watcher/startFileWatcher.ts`) is kept intact for
 * other call-sites that don't need the give-up behaviour.
 */
export function startFileWatcher(
    file: string,
    onFileChange: (file: string) => void,
    opts?: {
        /** How long (ms) to keep retrying a missing file before calling onGaveUp. Default 60000. */
        missingFileTimeoutMs?: number;
        /** Called once if the file never appears within missingFileTimeoutMs. */
        onGaveUp?: () => void;
    }
): () => void {
    const missingFileTimeoutMs = opts?.missingFileTimeoutMs ?? 60_000;
    const onGaveUp = opts?.onGaveUp;

    const abortController = new AbortController();

    void (async () => {
        let backoffMs = 1_000;
        const BACKOFF_CAP = 15_000;
        let missingFileSince: number | null = null;

        while (true) {
            if (abortController.signal.aborted) {
                return;
            }
            try {
                logger.debug(`[FILE_WATCHER_V2] Starting watcher for ${file}`);
                // NOTE: watch() from fs/promises returns an async iterable immediately
                // without throwing, even when the file does not exist.  The ENOENT error
                // surfaces only when the first iteration of `for await` is executed.
                // Therefore we must NOT reset missingFileSince here (before iteration),
                // because doing so would mask an unbroken ENOENT streak.  The reset only
                // happens upon a confirmed non-ENOENT error path (see below) or on the
                // first successful event emission inside the loop.
                const watcher = watch(file, { persistent: true, signal: abortController.signal });
                let receivedEvent = false;

                for await (const _event of watcher) {
                    if (abortController.signal.aborted) {
                        return;
                    }
                    if (!receivedEvent) {
                        // File successfully watched and first event received → reset missing-file timer
                        receivedEvent = true;
                        missingFileSince = null;
                        backoffMs = 1_000;
                        logger.debug(`[FILE_WATCHER_V2] File is now present, reset missing-file timer: ${file}`);
                    }
                    logger.debug(`[FILE_WATCHER_V2] File changed: ${file}`);
                    onFileChange(file);
                }
            } catch (e: any) {
                if (abortController.signal.aborted) {
                    return;
                }

                const isEnoent = (e?.code === 'ENOENT' || e?.message?.includes('ENOENT'));

                if (isEnoent) {
                    // Track when we first noticed the file missing
                    if (missingFileSince === null) {
                        missingFileSince = Date.now();
                    }

                    const elapsed = Date.now() - missingFileSince;
                    if (elapsed >= missingFileTimeoutMs) {
                        logger.debug(`[FILE_WATCHER_V2] File missing for ${elapsed}ms, giving up: ${file}`);
                        if (onGaveUp) {
                            onGaveUp();
                        }
                        return;
                    }

                    // Exponential backoff capped at BACKOFF_CAP
                    logger.debug(`[FILE_WATCHER_V2] ENOENT for ${file}, retrying in ${backoffMs}ms (elapsed=${elapsed}ms / timeout=${missingFileTimeoutMs}ms)`);
                    await delay(backoffMs, abortController.signal);
                    if (abortController.signal.aborted) {
                        return;
                    }
                    backoffMs = Math.min(backoffMs * 2, BACKOFF_CAP);
                } else {
                    // Non-ENOENT error: restart immediately, reset backoff
                    missingFileSince = null;
                    backoffMs = 1_000;
                    logger.debug(`[FILE_WATCHER_V2] Watch error (non-ENOENT): ${e?.message}, restarting watcher`);
                    // small sleep to avoid tight error-restart loops
                    await delay(200, abortController.signal);
                    if (abortController.signal.aborted) {
                        return;
                    }
                }
            }
        }
    })();

    return () => {
        abortController.abort();
    };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function delay(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, ms);
        signal?.addEventListener('abort', () => {
            clearTimeout(timer);
            resolve();
        }, { once: true });
    });
}
