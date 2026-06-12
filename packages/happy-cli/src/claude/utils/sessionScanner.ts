import { InvalidateSync } from "@/utils/sync";
import { RawJSONLines, RawJSONLinesSchema } from "../types";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { logger } from "@/ui/logger";
import { startFileWatcher } from "@/claude/startFileWatcher";
import { getProjectPath } from "./path";

/**
 * Known internal Claude Code event types that should be silently skipped.
 * These are written to session JSONL files by Claude Code but are not 
 * actual conversation messages - they're internal state/tracking events.
 */
const INTERNAL_CLAUDE_EVENT_TYPES = new Set([
    'file-history-snapshot',
    'change',
    'queue-operation',
]);

export async function createSessionScanner(opts: {
    sessionId: string | null,
    workingDirectory: string
    onMessage: (message: RawJSONLines) => void
    /** How long (ms) to keep retrying a missing session file before marking it dead. Default 60000. */
    missingFileTimeoutMs?: number
}) {

    // Resolve project directory
    const projectDir = getProjectPath(opts.workingDirectory);

    // Finished, pending finishing and current session
    let finishedSessions = new Set<string>();
    let pendingSessions = new Set<string>();
    let currentSessionId: string | null = null;
    let watchers = new Map<string, (() => void)>();
    let processedMessageKeys = new Set<string>();

    /**
     * Sessions whose JSONL files never appeared within missingFileTimeoutMs.
     * They are excluded from sync loops to prevent CPU-wasting ENOENT cycles.
     * A dead session can be revived by a subsequent onNewSession() call.
     */
    let deadSessions = new Set<string>();

    // Mark existing messages as processed and start watching the initial session
    if (opts.sessionId) {
        let messages = await readSessionLog(projectDir, opts.sessionId);
        logger.debug(`[SESSION_SCANNER] Marking ${messages.length} existing messages as processed from session ${opts.sessionId}`);
        for (let m of messages) {
            processedMessageKeys.add(messageKey(m));
        }
        // IMPORTANT: Also start watching the initial session file because Claude Code
        // may continue writing to it even after creating a new session with --resume
        // (agent tasks and other updates can still write to the original session file)
        currentSessionId = opts.sessionId;
    }

    // Main sync function
    const sync = new InvalidateSync(async () => {

        // Collect session ids - include ALL sessions that have watchers.
        // Dead sessions are excluded: their watchers have already been stopped
        // and they won't receive new data until explicitly revived via onNewSession().
        let sessions: string[] = [];
        for (let p of pendingSessions) {
            if (!deadSessions.has(p)) {
                sessions.push(p);
            }
        }
        if (currentSessionId && !pendingSessions.has(currentSessionId) && !deadSessions.has(currentSessionId)) {
            sessions.push(currentSessionId);
        }
        // Also process sessions that have active watchers (they may still receive updates)
        for (let [sessionId] of watchers) {
            if (!sessions.includes(sessionId)) {
                sessions.push(sessionId);
            }
        }

        // Process sessions
        for (let session of sessions) {
            const sessionMessages = await readSessionLog(projectDir, session);
            let skipped = 0;
            let sent = 0;
            for (let file of sessionMessages) {
                let key = messageKey(file);
                if (processedMessageKeys.has(key)) {
                    skipped++;
                    continue;
                }
                processedMessageKeys.add(key);
                logger.debug(`[SESSION_SCANNER] Sending new message: type=${file.type}, uuid=${file.type === 'summary' ? file.leafUuid : file.uuid}`);
                opts.onMessage(file);
                sent++;
            }
            if (sessionMessages.length > 0) {
                logger.debug(`[SESSION_SCANNER] Session ${session}: found=${sessionMessages.length}, skipped=${skipped}, sent=${sent}`);
            }
        }

        // Move pending sessions to finished sessions (but keep processing them via watchers)
        for (let p of sessions) {
            if (pendingSessions.has(p)) {
                pendingSessions.delete(p);
                finishedSessions.add(p);
            }
        }

        // Update watchers for all sessions
        for (let p of sessions) {
            if (!watchers.has(p)) {
                logger.debug(`[SESSION_SCANNER] Starting watcher for session: ${p}`);
                const sessionPath = p; // capture for closure
                watchers.set(p, startFileWatcher(
                    join(projectDir, `${sessionPath}.jsonl`),
                    () => { sync.invalidate(); },
                    {
                        missingFileTimeoutMs: opts.missingFileTimeoutMs,
                        onGaveUp: () => {
                            logger.debug(`[SESSION_SCANNER] Session file never appeared, marking dead: ${sessionPath}`);
                            deadSessions.add(sessionPath);
                            // Stop and remove the watcher
                            const stop = watchers.get(sessionPath);
                            if (stop) {
                                stop();
                                watchers.delete(sessionPath);
                            }
                            pendingSessions.delete(sessionPath);
                        },
                    }
                ));
            }
        }
    });
    await sync.invalidateAndAwait();

    // Periodic sync
    const intervalId = setInterval(() => { sync.invalidate(); }, 3000);

    // Public interface
    return {
        cleanup: async () => {
            clearInterval(intervalId);
            for (let w of watchers.values()) {
                w();
            }
            watchers.clear();
            await sync.invalidateAndAwait();
            sync.stop();
        },
        onNewSession: async (sessionId: string, options?: { treatExistingAsProcessed?: boolean }) => {
            // Revive a previously dead session so it can be tracked again.
            // This check MUST come before the currentSessionId/finishedSessions/pendingSessions
            // guards because a dead session may still be the currentSessionId — if we hit the
            // early-return in that guard we would never re-enqueue the revived session.
            if (deadSessions.has(sessionId)) {
                logger.debug(`[SESSION_SCANNER] New session: ${sessionId} was dead, reviving`);
                deadSessions.delete(sessionId);
                // Fall through to re-register the session below
            } else if (currentSessionId === sessionId) {
                logger.debug(`[SESSION_SCANNER] New session: ${sessionId} is the same as the current session, skipping`);
                return;
            } else if (finishedSessions.has(sessionId)) {
                logger.debug(`[SESSION_SCANNER] New session: ${sessionId} is already finished, skipping`);
                return;
            } else if (pendingSessions.has(sessionId)) {
                logger.debug(`[SESSION_SCANNER] New session: ${sessionId} is already pending, skipping`);
                return;
            }
            // In remote mode, the JSONL file already contains the full history that was
            // delivered via SDK/app channel. Pre-mark those messages as processed so that
            // the first invalidate() after session switch does not replay them to the chat.
            if (options?.treatExistingAsProcessed) {
                const existing = await readSessionLog(projectDir, sessionId);
                logger.debug(`[SESSION_SCANNER] Pre-marking ${existing.length} existing messages as processed for new session ${sessionId}`);
                for (const m of existing) {
                    processedMessageKeys.add(messageKey(m));
                }
            }
            if (currentSessionId) {
                pendingSessions.add(currentSessionId);
            }
            logger.debug(`[SESSION_SCANNER] New session: ${sessionId}`)
            currentSessionId = sessionId;
            sync.invalidate();
        },
    }
}

export type SessionScanner = ReturnType<typeof createSessionScanner>;


//
// Helpers
//

function messageKey(message: RawJSONLines): string {
    if (message.type === 'user') {
        return message.uuid;
    } else if (message.type === 'assistant') {
        return message.uuid;
    } else if (message.type === 'summary') {
        return 'summary: ' + message.leafUuid + ': ' + message.summary;
    } else if (message.type === 'system') {
        return message.uuid;
    } else {
        throw Error() // Impossible
    }
}

/**
 * Read and parse session log file
 * Returns only valid conversation messages, silently skipping internal events
 */
async function readSessionLog(projectDir: string, sessionId: string): Promise<RawJSONLines[]> {
    const expectedSessionFile = join(projectDir, `${sessionId}.jsonl`);
    logger.debug(`[SESSION_SCANNER] Reading session file: ${expectedSessionFile}`);
    let file: string;
    try {
        file = await readFile(expectedSessionFile, 'utf-8');
    } catch (error) {
        logger.debug(`[SESSION_SCANNER] Session file not found: ${expectedSessionFile}`);
        return [];
    }
    let lines = file.split('\n');
    let messages: RawJSONLines[] = [];
    for (let l of lines) {
        try {
            if (l.trim() === '') {
                continue;
            }
            let message = JSON.parse(l);
            
            // Silently skip known internal Claude Code events
            // These are state/tracking events, not conversation messages
            if (message.type && INTERNAL_CLAUDE_EVENT_TYPES.has(message.type)) {
                continue;
            }
            
            let parsed = RawJSONLinesSchema.safeParse(message);
            if (!parsed.success) {
                // Unknown message types are silently skipped
                // They will be tracked by processedMessageKeys to avoid reprocessing
                continue;
            }
            messages.push(parsed.data);
        } catch (e) {
            logger.debug(`[SESSION_SCANNER] Error processing message: ${e}`);
            continue;
        }
    }
    return messages;
}
