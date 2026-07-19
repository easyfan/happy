import fs from 'fs/promises';
import os from 'os';
import * as tmp from 'tmp';
import { getHappyAxios } from '@/utils/happyAxios';

import { ApiClient } from '@/api/api';
import { TrackedSession, SessionEncryptionData } from './types';
import { MachineMetadata, DaemonState, Metadata, AgentState, Session } from '@/api/types';
import { SpawnSessionOptions, SpawnSessionResult } from '@/modules/common/registerCommonHandlers';
import { logger } from '@/ui/logger';
import { authAndSetupMachineIfNeeded } from '@/ui/auth';
import { configuration } from '@/configuration';
import { startCaffeinate, stopCaffeinate } from '@/utils/caffeinate';
import packageJson from '../../package.json';
import { getEnvironmentInfo } from '@/ui/doctor';
import { spawnHappyCLI } from '@/utils/spawnHappyCLI';
import { writeDaemonState, DaemonLocallyPersistedState, readDaemonState, acquireDaemonLock, releaseDaemonLock, readPersistedSessions, persistSession } from '@/persistence';
import type { PersistedSession } from '@/persistence';

import { cleanupDaemonState, isDaemonRunningCurrentlyInstalledHappyVersion, stopDaemon } from './controlClient';
import { startDaemonControlServer } from './controlServer';
import { statSync, existsSync } from 'fs';
import { join } from 'path';
import { projectPath } from '@/projectPath';
import { getTmuxUtilities, isTmuxAvailable, parseTmuxSessionIdentifier, formatTmuxSessionIdentifier } from '@/utils/tmux';
import { expandEnvironmentVariables } from '@/utils/expandEnvVars';
import { detectCLIAvailability } from '@/utils/detectCLI';
import { buildResumeLaunch } from '@/resume/handleResumeCommand';
import { detectResumeSupport } from '@/resume/localHappyAgentAuth';
import { encodeBase64, decodeBase64, decrypt } from '@/api/encryption';
import { routeStartupError, connectionState } from '@/utils/serverConnectionErrors';
import { isAgentLoaded, kickstartAgent, getAgentPlistPath, readSupervisorHealth } from '@/daemon/mac/launchAgent';

/** Shell-escape a string for safe interpolation into tmux commands. */
function shellescape(s: string): string {
    return "'" + s.replace(/'/g, "'\\''") + "'";
}

// Prepare initial metadata
// Suffix host with `-dev` for the HAPPY_VARIANT=dev variant so the dev daemon
// is visually distinct from the stable one in the machine list (they otherwise
// share the same hostname and look identical).
const hostSuffix = process.env.HAPPY_VARIANT === 'dev' ? '-dev' : '';
export const initialMachineMetadata: MachineMetadata = {
  host: os.hostname() + hostSuffix,
  platform: os.platform(),
  happyCliVersion: packageJson.version,
  homeDir: os.homedir(),
  happyHomeDir: configuration.happyHomeDir,
  happyLibDir: projectPath(),
  cliAvailability: detectCLIAvailability(),
  resumeSupport: { ...detectResumeSupport(), rpcAvailable: true },
};

/**
 * Scan persisted sessions and reconcile daemon-restart fallout left behind by the
 * previous daemon process. Two best-effort cleanups share a single GET /v1/sessions:
 *
 * 1. Zombie active reconcile (BUG-06): for sessions the server still reports as
 *    `active === true` that are locally owned (present in persisted sessions.json)
 *    but have no live local process (no entry in pidToTrackedSession), send a
 *    `session-end` so the web/mobile app stops showing a stale active session after
 *    the container/host was hard-killed and restarted.
 * 2. Orphaned permission cancel: clear pending permission requests so the app no
 *    longer shows spinners for requests that died with the previous daemon.
 *
 * Called as a best-effort operation in the apiMachine onConnect callback so it
 * runs once per daemon startup (and again on reconnect, which is idempotent since
 * by the second connect the requests will already have been cleared).
 *
 * Failure is non-fatal: errors are caught inside the function and only logged.
 */
export async function cancelOrphanedPermissions(
    api: ApiClient,
    token: string,
    persisted: Record<string, PersistedSession>,
    pidToTrackedSession: Map<number, TrackedSession>
): Promise<void> {
    try {
        const http = getHappyAxios();
        const resp = await http.get<{
            sessions: Array<{
                id: string;
                seq: number;
                agentState: string | null;
                agentStateVersion: number;
                metadata: string;
                metadataVersion: number;
                active: boolean;
            }>;
        }>(
            `${configuration.serverUrl}/v1/sessions`,
            {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'X-Happy-Client': `cli-daemon/${configuration.currentCliVersion}`
                },
                timeout: 10000
            }
        );

        const serverSessions = resp.data?.sessions ?? [];

        for (const ss of serverSessions) {
            // ───── Zombie active reconcile (BUG-06): MUST run before the
            // `if (!ss.agentState) continue` guard below, because a zombie active
            // session hard-killed by SIGKILL usually has no pending permission
            // request and therefore agentState === null — the guard would skip it
            // and the zombie active session would never be reconciled. This block
            // does not need agentState (session-end is a plaintext {sid, time}
            // socket emit), so it is fully decoupled from the permission cleanup.
            const reconcileP = persisted[ss.id];
            const owned = reconcileP != null;
            let liveLocally = false;
            for (const tracked of pidToTrackedSession.values()) {
                if (tracked.happySessionId === ss.id) {
                    liveLocally = true;
                    break;
                }
            }
            // owner guard: only reconcile sessions that are locally owned (persisted)
            // and have no live local process (pidToTrackedSession). Known self-healing
            // races: a session taken over by another machine, or one this machine just
            // spawned but has not yet registered, may be briefly mis-judged — the
            // subsequent session-alive will flip `active` back to true (the server is
            // the only writer of session.active).
            if (ss.active === true && owned && !liveLocally) {
                // Per-session try/catch: the outer catch sits OUTSIDE this for-loop,
                // so an unhandled throw here (bad key decode, flush/close failure)
                // would abort the whole loop and skip every remaining session's
                // reconcile AND permission cleanup. Isolate it so one bad session
                // cannot block the rest (best-effort, errors swallowed).
                try {
                    const reconcileSession: Session = {
                        id: ss.id,
                        seq: ss.seq,
                        encryptionKey: decodeBase64(reconcileP.encryptionKey),
                        encryptionVariant: reconcileP.encryptionVariant,
                        metadata: reconcileP.metadata,
                        metadataVersion: ss.metadataVersion,
                        agentState: null,
                        agentStateVersion: ss.agentStateVersion,
                    };
                    const reconcileClient = api.sessionSyncClient(reconcileSession);
                    try {
                        // session-end is a raw socket emit; the temporary client connects
                        // asynchronously, so gate the emit on an actual connection to avoid
                        // dropping it (best-effort: a failed/slow connect just no-ops here).
                        await reconcileClient.awaitConnected();
                        reconcileClient.sendSessionDeath();
                        await reconcileClient.flush();
                    } finally {
                        await reconcileClient.close();
                    }
                } catch {
                    // Best-effort: swallow so one bad session does not abort the loop
                    // (the outer catch already logs aggregate failures; per project
                    // rule "no logging unless asked" we do not add a new log here).
                }
                // Do not continue/return: the same session may still flow into the
                // permission cleanup below (the two operations do not conflict).
            }

            // ───── Orphaned permission cleanup (unchanged) ─────
            if (!ss.agentState) continue;

            const p = persisted[ss.id];
            if (!p) continue; // No encryption key available — cannot decrypt or update

            const key = decodeBase64(p.encryptionKey);
            const variant = p.encryptionVariant;

            let agentState: AgentState;
            try {
                const decrypted = decrypt(key, variant, decodeBase64(ss.agentState));
                if (!decrypted) continue; // Decryption returned null — skip session
                agentState = decrypted as AgentState;
            } catch {
                continue; // Decryption failure — skip session
            }

            const pendingCount = Object.keys(agentState.requests ?? {}).length;
            if (pendingCount === 0) continue;

            logger.debug(`[DAEMON RUN] cancelOrphanedPermissions: canceling ${pendingCount} orphaned request(s) on session ${ss.id}`);

            const sessionObj: Session = {
                id: ss.id,
                seq: ss.seq,
                encryptionKey: key,
                encryptionVariant: variant,
                metadata: p.metadata,
                metadataVersion: ss.metadataVersion,
                agentState,
                agentStateVersion: ss.agentStateVersion,
            };

            const client = api.sessionSyncClient(sessionObj);
            try {
                // The temporary client connects asynchronously; update-state is sent
                // via emitWithAck which is buffered until the socket connects, while
                // flush() does not await the agentState lock (see [ESCALATE-001]).
                // Gate on an actual connection so a fast close() cannot drop the emit.
                await client.awaitConnected();
                client.updateAgentState((current) => {
                    if (!current) return { requests: {}, completedRequests: {} };
                    const pending = current.requests ?? {};
                    const completed: AgentState['completedRequests'] = { ...current.completedRequests };
                    for (const [id, req] of Object.entries(pending)) {
                        completed![id] = {
                            ...req,
                            completedAt: Date.now(),
                            status: 'canceled',
                            reason: 'daemon-restarted',
                        };
                    }
                    return { ...current, requests: {}, completedRequests: completed };
                });
                // [ESCALATE-001] flush() waits for the message outbox and one ping round-trip,
                // but does NOT explicitly wait for the agentState update-state emitWithAck to
                // complete.  In practice the update-state fires before the ping (Socket.IO order
                // guarantee), so the server receives the state update before close().  However
                // on a very slow or congested connection the ack may not have arrived before
                // flush() resolves.  A more reliable solution would be to expose a dedicated
                // "waitForAgentStateFlush()" on ApiSessionClient.
                await client.flush();
            } finally {
                await client.close();
            }
        }
    } catch (err) {
        logger.debug('[DAEMON RUN] cancelOrphanedPermissions failed (non-fatal):', err);
    }
}

/**
 * Pure function — determines the exit code when the shutdown fuse fires.
 *
 * Decoupled from `source` entirely (design A-02): we only look at whether the
 * graceful chain has already resolved.
 *
 *   gracefulResolved = true  → 0  (chain completed; fuse fired redundantly — launchd should NOT revive)
 *   gracefulResolved = false → 1  (chain truly stalled; launchd SHOULD revive the daemon)
 *
 * Zero side-effects, zero I/O.  Exported for direct unit-test import.
 */
export function shouldFuseExitCode(gracefulResolved: boolean): 0 | 1 {
    return gracefulResolved ? 0 : 1;
}

export async function startDaemon(): Promise<void> {
  // We don't have cleanup function at the time of server construction
  // Control flow is:
  // 1. Create promise that will resolve when shutdown is requested
  // 2. Setup signal handlers to resolve this promise with the source of the shutdown
  // 3. Once our setup is complete - if all goes well - we await this promise
  // 4. When it resolves we can cleanup and exit
  //
  // In case the setup malfunctions - our signal handlers will not properly
  // shut down. We will force exit the process with code 1.

  // BUG-DAEMON-02/D-1: fuse state variables hoisted to startDaemon top-level lexical scope
  // so both requestShutdown (closure) and cleanupAndShutdown share the same binding.
  let fuseTimer: ReturnType<typeof setTimeout> | null = null;
  let gracefulResolved: boolean = false;

  let requestShutdown: (source: 'happy-app' | 'happy-cli' | 'os-signal' | 'exception', errorMessage?: string) => void;
  let resolvesWhenShutdownRequested = new Promise<({ source: 'happy-app' | 'happy-cli' | 'os-signal' | 'exception', errorMessage?: string })>((resolve) => {
    requestShutdown = (source, errorMessage) => {
      // BUG-DAEMON-02/D-1: early-return guard prevents a second concurrent signal
      // (e.g. SIGTERM arriving while SIGINT handler is already running) from arming
      // a second fuse and resetting the 1s window.  Promise.resolve is idempotent
      // (only the first call takes effect), but setTimeout is not — without this
      // guard the later call would start a fresh 1s countdown and could race
      // clearTimeout in cleanupAndShutdown.
      if (fuseTimer !== null) {
        logger.debug(`[DAEMON RUN] Duplicate shutdown request ignored (source: ${source})`);
        return;
      }

      logger.debug(`[DAEMON RUN] Requesting shutdown (source: ${source}, errorMessage: ${errorMessage})`);

      // BUG-DAEMON-02/D-1: capture the timer handle so cleanupAndShutdown can
      // cancel it once the graceful chain completes successfully.
      // If the graceful chain stalls for >1 s the fuse fires:
      //   - gracefulResolved=true  → exit(0)  (chain completed, fuse is redundant)
      //   - gracefulResolved=false → exit(1)  (true stall, launchd should revive)
      fuseTimer = setTimeout(async () => {
        logger.debug(`[DAEMON RUN] Graceful chain stalled, fuse triggered (gracefulResolved=${gracefulResolved})`);

        // Give time for logs to be flushed
        await new Promise<void>(r => setTimeout(r, 100));

        process.exit(shouldFuseExitCode(gracefulResolved));
      }, 1_000);

      // Start graceful shutdown
      resolve({ source, errorMessage });
    };
  });

  // Setup signal handlers
  process.on('SIGINT', () => {
    logger.debug('[DAEMON RUN] Received SIGINT');
    requestShutdown('os-signal');
  });

  process.on('SIGTERM', () => {
    logger.debug('[DAEMON RUN] Received SIGTERM');
    requestShutdown('os-signal');
  });

  process.on('uncaughtException', (error) => {
    logger.debug('[DAEMON RUN] FATAL: Uncaught exception', error);
    logger.debug(`[DAEMON RUN] Stack trace: ${error.stack}`);
    requestShutdown('exception', error.message);
  });

  process.on('unhandledRejection', (reason, promise) => {
    logger.debug('[DAEMON RUN] FATAL: Unhandled promise rejection', reason);
    logger.debug(`[DAEMON RUN] Rejected promise:`, promise);
    const error = reason instanceof Error ? reason : new Error(`Unhandled promise rejection: ${reason}`);
    logger.debug(`[DAEMON RUN] Stack trace: ${error.stack}`);
    requestShutdown('exception', error.message);
  });

  process.on('exit', (code) => {
    logger.debug(`[DAEMON RUN] Process exiting with code: ${code}`);
  });

  process.on('beforeExit', (code) => {
    logger.debug(`[DAEMON RUN] Process about to exit with code: ${code}`);
  });

  logger.debug('[DAEMON RUN] Starting daemon process...');
  logger.debugLargeJson('[DAEMON RUN] Environment', getEnvironmentInfo());

  // Check if already running
  // Check if running daemon version matches current CLI version
  const runningDaemonVersionMatches = await isDaemonRunningCurrentlyInstalledHappyVersion();
  if (!runningDaemonVersionMatches) {
    // TODO: This hand-rolled self-restart path is awkward to reason about and awkward to test.
    // We should probably migrate this daemon to native system service management
    // (launchd/systemd, similar to OpenClaw's model), so startup/start-at-login and upgrades
    // are owned by the OS instead of by the daemon trying to replace itself in-process.
    logger.debug('[DAEMON RUN] Daemon version mismatch detected, restarting daemon with current CLI version');
    await stopDaemon();
  } else {
    logger.debug('[DAEMON RUN] Daemon version matches, keeping existing daemon');
    console.log('Daemon already running with matching version');
    process.exit(0);
  }

  // Acquire exclusive lock (proves daemon is running)
  const daemonLockHandle = await acquireDaemonLock(5, 200);
  if (!daemonLockHandle) {
    logger.debug('[DAEMON RUN] Daemon lock file already held, another daemon is running');
    process.exit(0);
  }

  // At this point we should be safe to startup the daemon:
  // 1. Not have a stale daemon state
  // 2. Should not have another daemon process running

  try {
    // Start caffeinate
    const caffeinateStarted = startCaffeinate();
    if (caffeinateStarted) {
      logger.debug('[DAEMON RUN] Sleep prevention enabled');
    }

    // Ensure auth and machine registration BEFORE anything else
    const { credentials, machineId } = await authAndSetupMachineIfNeeded();
    logger.debug('[DAEMON RUN] Auth and machine setup complete');

    // Structural-typed ref to apiMachine, initialized after REST setup.
    // onChildExited is defined before apiMachine; using a ref avoids TS TDZ errors.
    let apiMachineRef: { clearSessionAgentState(sid: string, version: number): Promise<void> } | null = null;

    // Setup state - key by PID
    const pidToTrackedSession = new Map<number, TrackedSession>();

    // Retain session data after process exits so resume can still find it.
    // Pre-populate from disk so sessions survive daemon restarts.
    const sessionIdToFinishedSession = new Map<string, TrackedSession>();
    const persisted = readPersistedSessions();
    for (const [id, s] of Object.entries(persisted)) {
      sessionIdToFinishedSession.set(id, {
        startedBy: 'persisted',
        happySessionId: id,
        happySessionMetadataFromLocalWebhook: s.metadata,
        encryption: {
          encryptionKey: decodeBase64(s.encryptionKey),
          encryptionVariant: s.encryptionVariant,
          seq: s.seq,
          metadataVersion: s.metadataVersion,
          agentStateVersion: s.agentStateVersion,
        },
        pid: 0,
      });
    }
    if (Object.keys(persisted).length > 0) {
      logger.debug(`[DAEMON RUN] Loaded ${Object.keys(persisted).length} persisted sessions from disk`);
    }

    // Session spawning awaiter system
    const pidToAwaiter = new Map<number, (session: TrackedSession) => void>();

    // Helper functions
    const getCurrentChildren = () => Array.from(pidToTrackedSession.values());

    // Handle webhook from happy session reporting itself
    const onHappySessionWebhook = (sessionId: string, sessionMetadata: Metadata, encryption?: SessionEncryptionData) => {
      logger.debugLargeJson(`[DAEMON RUN] Session reported`, sessionMetadata);

      const pid = sessionMetadata.hostPid;
      if (!pid) {
        logger.debug(`[DAEMON RUN] Session webhook missing hostPid for sessionId: ${sessionId}`);
        return;
      }

      logger.debug(`[DAEMON RUN] Session webhook: ${sessionId}, PID: ${pid}, started by: ${sessionMetadata.startedBy || 'unknown'}, hasEncryption: ${!!encryption}`);
      logger.debug(`[DAEMON RUN] Current tracked sessions before webhook: ${Array.from(pidToTrackedSession.keys()).join(', ')}`);

      // Persist encryption data to disk so it survives daemon restarts
      if (encryption) {
        persistSession(sessionId, {
          encryptionKey: encodeBase64(encryption.encryptionKey),
          encryptionVariant: encryption.encryptionVariant,
          seq: encryption.seq,
          metadataVersion: encryption.metadataVersion,
          agentStateVersion: encryption.agentStateVersion,
          metadata: sessionMetadata,
          savedAt: Date.now(),
        });
      }

      // Check if we already have this PID (daemon-spawned)
      const existingSession = pidToTrackedSession.get(pid);

      if (existingSession && existingSession.startedBy === 'daemon') {
        // Update daemon-spawned session with reported data
        existingSession.happySessionId = sessionId;
        existingSession.happySessionMetadataFromLocalWebhook = sessionMetadata;
        existingSession.encryption = encryption;
        logger.debug(`[DAEMON RUN] Updated daemon-spawned session ${sessionId} with metadata`);

        // Resolve any awaiter for this PID
        const awaiter = pidToAwaiter.get(pid);
        if (awaiter) {
          pidToAwaiter.delete(pid);
          awaiter(existingSession);
          logger.debug(`[DAEMON RUN] Resolved session awaiter for PID ${pid}`);
        }
      } else if (!existingSession) {
        // New session started externally
        const trackedSession: TrackedSession = {
          startedBy: 'happy directly - likely by user from terminal',
          happySessionId: sessionId,
          happySessionMetadataFromLocalWebhook: sessionMetadata,
          encryption,
          pid
        };
        pidToTrackedSession.set(pid, trackedSession);
        logger.debug(`[DAEMON RUN] Registered externally-started session ${sessionId}`);
      }
    };

    // Spawn a new session (sessionId reserved for future --resume functionality)
    const spawnSession = async (options: SpawnSessionOptions): Promise<SpawnSessionResult> => {
      logger.debugLargeJson('[DAEMON RUN] Spawning session', options);

      const { directory, sessionId, machineId, approvedNewDirectoryCreation = true } = options;
      let directoryCreated = false;

      try {
        await fs.access(directory);
        logger.debug(`[DAEMON RUN] Directory exists: ${directory}`);
      } catch (error) {
        logger.debug(`[DAEMON RUN] Directory doesn't exist, creating: ${directory}`);

        // Check if directory creation is approved
        if (!approvedNewDirectoryCreation) {
          logger.debug(`[DAEMON RUN] Directory creation not approved for: ${directory}`);
          return {
            type: 'requestToApproveDirectoryCreation',
            directory
          };
        }

        try {
          await fs.mkdir(directory, { recursive: true });
          logger.debug(`[DAEMON RUN] Successfully created directory: ${directory}`);
          directoryCreated = true;
        } catch (mkdirError: any) {
          let errorMessage = `Unable to create directory at '${directory}'. `;

          // Provide more helpful error messages based on the error code
          if (mkdirError.code === 'EACCES') {
            errorMessage += `Permission denied. You don't have write access to create a folder at this location. Try using a different path or check your permissions.`;
          } else if (mkdirError.code === 'ENOTDIR') {
            errorMessage += `A file already exists at this path or in the parent path. Cannot create a directory here. Please choose a different location.`;
          } else if (mkdirError.code === 'ENOSPC') {
            errorMessage += `No space left on device. Your disk is full. Please free up some space and try again.`;
          } else if (mkdirError.code === 'EROFS') {
            errorMessage += `The file system is read-only. Cannot create directories here. Please choose a writable location.`;
          } else {
            errorMessage += `System error: ${mkdirError.message || mkdirError}. Please verify the path is valid and you have the necessary permissions.`;
          }

          logger.debug(`[DAEMON RUN] Directory creation failed: ${errorMessage}`);
          return {
            type: 'error',
            errorMessage
          };
        }
      }

      try {

        // Build environment variables for session spawning
        // Authentication tokens are resolved here

        // Resolve authentication token if provided
        const authEnv: Record<string, string> = {};
        if (options.token) {
          if (options.agent === 'codex') {

            // Create a temporary directory for Codex
            const codexHomeDir = tmp.dirSync();

            // Write the token to the temporary directory
            await fs.writeFile(join(codexHomeDir.name, 'auth.json'), options.token);

            // Set the environment variable for Codex
            authEnv.CODEX_HOME = codexHomeDir.name;
          } else { // Assuming claude
            authEnv.CLAUDE_CODE_OAUTH_TOKEN = options.token;
          }
        }

        let extraEnv: Record<string, string> = {
          ...authEnv,
          ...(options.environmentVariables ?? {}),
        };
        if (options.parentSessionId) {
          extraEnv.HAPPY_FORKED_FROM_SESSION_ID = options.parentSessionId;
        }
        if (options.forkedFromMessageId) {
          extraEnv.HAPPY_FORKED_FROM_MESSAGE_ID = options.forkedFromMessageId;
        }
        logger.debug(`[DAEMON RUN] Environment variable keys (before expansion) (${Object.keys(extraEnv).length}): ${Object.keys(extraEnv).join(', ')}`);

        // Expand ${VAR} references from daemon's process.env
        // This ensures variable substitution works in both tmux and non-tmux modes
        // Example: ANTHROPIC_AUTH_TOKEN="${Z_AI_AUTH_TOKEN}" → ANTHROPIC_AUTH_TOKEN="sk-real-key"
        extraEnv = expandEnvironmentVariables(extraEnv, process.env);
        logger.debug(`[DAEMON RUN] After variable expansion: ${Object.keys(extraEnv).join(', ')}`);

        // Fail fast if any passed-through environment variable still contains an
        // unresolved ${VAR} reference after expansion.
        const unresolvedEnvEntries = Object.entries(extraEnv).flatMap(([key, value]) => {
          if (typeof value !== 'string' || !value.includes('${')) {
            return [];
          }

          const unresolvedMatch = value.match(/\$\{([^}]+)\}/);
          if (!unresolvedMatch) {
            return [];
          }

          const expression = unresolvedMatch[1];
          const defaultSeparatorIndex = expression.indexOf(':-');
          const missingVar = defaultSeparatorIndex === -1
            ? expression
            : expression.slice(0, defaultSeparatorIndex);

          return [`${key} references \${${missingVar}} which is not defined`];
        });

        if (unresolvedEnvEntries.length > 0) {
          const errorMessage = `Session environment is invalid - environment variables not found in daemon: ${unresolvedEnvEntries.join('; ')}. ` +
            `Ensure these variables are set in the daemon's environment before starting sessions.`;
          logger.warn(`[DAEMON RUN] ${errorMessage}`);
          return {
            type: 'error',
            errorMessage
          };
        }

        // Check if tmux is available and should be used
        const tmuxAvailable = await isTmuxAvailable();
        let useTmux = tmuxAvailable;

        // Get tmux session name from environment variables (now set by profile system)
        // Empty string means "use current/most recent session" (tmux default behavior)
        let tmuxSessionName: string | undefined = extraEnv.TMUX_SESSION_NAME;

        // If tmux is not available or session name is explicitly undefined, fall back to regular spawning
        // Note: Empty string is valid (means use current/most recent tmux session)
        if (!tmuxAvailable || tmuxSessionName === undefined) {
          useTmux = false;
          if (tmuxSessionName !== undefined) {
            logger.debug(`[DAEMON RUN] tmux session name specified but tmux not available, falling back to regular spawning`);
          }
        }

        if (useTmux && tmuxSessionName !== undefined) {
          // Try to spawn in tmux session
          const sessionDesc = tmuxSessionName || 'current/most recent session';
          logger.debug(`[DAEMON RUN] Attempting to spawn session in tmux: ${sessionDesc}`);

          const tmux = getTmuxUtilities(tmuxSessionName);

          // Construct command for the CLI
          const cliPath = join(projectPath(), 'dist', 'index.mjs');
          // Determine agent command - support claude, codex, and gemini
          const agent = options.agent === 'gemini' ? 'gemini' : (options.agent === 'codex' ? 'codex' : (options.agent === 'openclaw' ? 'openclaw' : 'claude'));
          // Restrict resume to Claude — Codex/Gemini don't honour the
          // happy-pass-through `--resume <id>` argument the same way.
          const resumeFragment = options.resumeClaudeSessionId && agent === 'claude'
            ? ` --resume ${shellescape(options.resumeClaudeSessionId)}`
            : '';
          const fullCommand = `node --no-warnings --no-deprecation ${cliPath} ${agent} --happy-starting-mode remote --started-by daemon${resumeFragment}`;

          // Spawn in tmux with environment variables
          // IMPORTANT: Pass complete environment (process.env + extraEnv) because:
          // 1. tmux sessions need daemon's expanded auth variables (e.g., ANTHROPIC_AUTH_TOKEN)
          // 2. Regular spawn uses env: { ...process.env, ...extraEnv }
          // 3. tmux needs explicit environment via -e flags to ensure all variables are available
          const windowName = `happy-${Date.now()}-${agent}`;
          const tmuxEnv: Record<string, string> = {};

          // Add all daemon environment variables (filtering out undefined and HAPPY_RECONNECT_* vars).
          // HAPPY_RECONNECT_* must be stripped so the child creates a fresh session instead of
          // reconnecting to whatever session the daemon itself inherited from its parent shell.
          const RECONNECT_KEYS = new Set(['HAPPY_RECONNECT_SESSION_ID', 'HAPPY_RECONNECT_ENCRYPTION_KEY', 'HAPPY_RECONNECT_ENCRYPTION_VARIANT', 'HAPPY_RECONNECT_SEQ', 'HAPPY_RECONNECT_METADATA_VERSION', 'HAPPY_RECONNECT_AGENT_STATE_VERSION']);
          for (const [key, value] of Object.entries(process.env)) {
            if (value !== undefined && !RECONNECT_KEYS.has(key)) {
              tmuxEnv[key] = value;
            }
          }

          // Add extra environment variables (these should already be filtered)
          Object.assign(tmuxEnv, extraEnv);

          const tmuxResult = await tmux.spawnInTmux([fullCommand], {
            sessionName: tmuxSessionName,
            windowName: windowName,
            cwd: directory
          }, tmuxEnv);  // Pass complete environment for tmux session

          if (tmuxResult.success) {
            logger.debug(`[DAEMON RUN] Successfully spawned in tmux session: ${tmuxResult.sessionId}, PID: ${tmuxResult.pid}`);

            // Validate we got a PID from tmux
            if (!tmuxResult.pid) {
              throw new Error('Tmux window created but no PID returned');
            }

            // Create a tracked session for tmux windows - now we have the real PID!
            const trackedSession: TrackedSession = {
              startedBy: 'daemon',
              pid: tmuxResult.pid, // Real PID from tmux -P flag
              tmuxSessionId: tmuxResult.sessionId,
              directoryCreated,
              message: directoryCreated
                ? `The path '${directory}' did not exist. We created a new folder and spawned a new session in tmux session '${tmuxSessionName}'. Use 'tmux attach -t ${tmuxSessionName}' to view the session.`
                : `Spawned new session in tmux session '${tmuxSessionName}'. Use 'tmux attach -t ${tmuxSessionName}' to view the session.`
            };

            // Add to tracking map so webhook can find it later
            pidToTrackedSession.set(tmuxResult.pid, trackedSession);

            // Wait for webhook to populate session with happySessionId (exact same as regular flow)
            logger.debug(`[DAEMON RUN] Waiting for session webhook for PID ${tmuxResult.pid} (tmux)`);

            return new Promise((resolve) => {
              // Set timeout for webhook (same as regular flow)
              const timeout = setTimeout(() => {
                pidToAwaiter.delete(tmuxResult.pid!);
                logger.debug(`[DAEMON RUN] Session webhook timeout for PID ${tmuxResult.pid} (tmux)`);
                resolve({
                  type: 'error',
                  errorMessage: `Session webhook timeout for PID ${tmuxResult.pid} (tmux)`
                });
              }, 15_000); // Same timeout as regular sessions

              // Register awaiter for tmux session (exact same as regular flow)
              pidToAwaiter.set(tmuxResult.pid!, (completedSession) => {
                clearTimeout(timeout);
                logger.debug(`[DAEMON RUN] Session ${completedSession.happySessionId} fully spawned with webhook (tmux)`);
                resolve({
                  type: 'success',
                  sessionId: completedSession.happySessionId!
                });
              });
            });
          } else {
            logger.debug(`[DAEMON RUN] Failed to spawn in tmux: ${tmuxResult.error}, falling back to regular spawning`);
            useTmux = false;
          }
        }

        // Regular process spawning (fallback or if tmux not available)
        if (!useTmux) {
          logger.debug(`[DAEMON RUN] Using regular process spawning`);

          // Construct arguments for the CLI - support claude, codex, and gemini
          let agentCommand: string;
          switch (options.agent) {
            case 'claude':
            case undefined:
              agentCommand = 'claude';
              break;
            case 'codex':
              agentCommand = 'codex';
              break;
            case 'gemini':
              agentCommand = 'gemini';
              break;
            case 'openclaw':
              agentCommand = 'openclaw';
              break;
            default:
              return {
                type: 'error',
                errorMessage: `Unsupported agent type: '${options.agent}'. Please update your CLI to the latest version.`
              };
          }
          const args = [
            agentCommand,
            '--happy-starting-mode', 'remote',
            '--started-by', 'daemon'
          ];

          // resumeClaudeSessionId attaches the new Happy session to a pre-existing
          // Claude conversation file (used by the fork / duplicate flow). We pass
          // it through `--resume <id>` as Happy's existing pass-through to claude.
          if (options.resumeClaudeSessionId && agentCommand === 'claude') {
            args.push('--resume', options.resumeClaudeSessionId);
          }

          // TODO: In future, sessionId could be used with --resume to continue existing sessions
          // For now, we ignore it - each spawn creates a new session
          // Explicitly clear HAPPY_RECONNECT_* vars so daemon's inherited env doesn't
          // cause the child process to reconnect to an old session instead of creating a new one.
          const { HAPPY_RECONNECT_SESSION_ID, HAPPY_RECONNECT_ENCRYPTION_KEY, HAPPY_RECONNECT_ENCRYPTION_VARIANT, HAPPY_RECONNECT_SEQ, HAPPY_RECONNECT_METADATA_VERSION, HAPPY_RECONNECT_AGENT_STATE_VERSION, ...cleanEnv } = process.env;
          return spawnTrackedHappyProcess({
            args,
            cwd: directory,
            env: {
              ...cleanEnv,
              ...extraEnv
            },
            directoryCreated,
            message: directoryCreated ? `The path '${directory}' did not exist. We created a new folder and spawned a new session there.` : undefined,
          });
        }

        // This should never be reached, but TypeScript requires a return statement
        return {
          type: 'error',
          errorMessage: 'Unexpected error in session spawning'
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.debug('[DAEMON RUN] Failed to spawn session:', error);
        return {
          type: 'error',
          errorMessage: `Failed to spawn session: ${errorMessage}`
        };
      }
    };

    const spawnTrackedHappyProcess = ({
      args,
      cwd,
      env,
      directoryCreated = false,
      message,
    }: {
      args: string[];
      cwd: string;
      env: NodeJS.ProcessEnv;
      directoryCreated?: boolean;
      message?: string;
    }): Promise<SpawnSessionResult> => {
      const happyProcess = spawnHappyCLI(args, {
        cwd,
        detached: true,
        stdio: 'ignore',
        env,
      });

      if (!happyProcess.pid) {
        logger.debug('[DAEMON RUN] Failed to spawn process - no PID returned');
        return Promise.resolve({
          type: 'error',
          errorMessage: 'Failed to spawn Happy process - no PID returned'
        });
      }

      logger.debug(`[DAEMON RUN] Spawned process with PID ${happyProcess.pid}`);

      const trackedSession: TrackedSession = {
        startedBy: 'daemon',
        pid: happyProcess.pid,
        childProcess: happyProcess,
        directoryCreated,
        message,
      };

      pidToTrackedSession.set(happyProcess.pid, trackedSession);

      happyProcess.on('exit', (code, signal) => {
        logger.debug(`[DAEMON RUN] Child PID ${happyProcess.pid} exited with code ${code}, signal ${signal}`);
        if (happyProcess.pid) {
          onChildExited(happyProcess.pid);
        }
      });

      happyProcess.on('error', (error) => {
        logger.debug(`[DAEMON RUN] Child process error:`, error);
        if (happyProcess.pid) {
          onChildExited(happyProcess.pid);
        }
      });

      logger.debug(`[DAEMON RUN] Waiting for session webhook for PID ${happyProcess.pid}`);

      return new Promise((resolve) => {
        const timeout = setTimeout(() => {
          pidToAwaiter.delete(happyProcess.pid!);
          logger.debug(`[DAEMON RUN] Session webhook timeout for PID ${happyProcess.pid}`);
          resolve({
            type: 'error',
            errorMessage: `Session webhook timeout for PID ${happyProcess.pid}`
          });
        }, 15_000);

        pidToAwaiter.set(happyProcess.pid!, (completedSession) => {
          clearTimeout(timeout);
          logger.debug(`[DAEMON RUN] Session ${completedSession.happySessionId} fully spawned with webhook`);
          resolve({
            type: 'success',
            sessionId: completedSession.happySessionId!
          });
        });
      });
    };

    const findTrackedSessionById = (happySessionId: string): TrackedSession | undefined => {
      for (const session of pidToTrackedSession.values()) {
        if (session.happySessionId === happySessionId) return session;
      }
      return sessionIdToFinishedSession.get(happySessionId);
    };

    const fetchServerSessionMetadata = async (sessionId: string, encryptionKey: Uint8Array, encryptionVariant: 'legacy' | 'dataKey'): Promise<Metadata | null> => {
      try {
        const http = getHappyAxios();
        const response = await http.get(`${configuration.serverUrl}/v1/sessions`, {
          headers: { Authorization: `Bearer ${credentials.token}` },
          timeout: 10_000,
        });
        const sessions = (response.data as { sessions: { id: string; metadata: string }[] }).sessions;
        const matched = sessions.find(s => s.id === sessionId);
        if (!matched) return null;
        const decrypted = decrypt(encryptionKey, encryptionVariant, decodeBase64(matched.metadata));
        return decrypted as Metadata | null;
      } catch (error) {
        logger.debug(`[DAEMON RUN] Failed to fetch session metadata from server: ${error instanceof Error ? error.message : error}`);
        return null;
      }
    };

    const resumeSession = async (happySessionId: string, options?: { model?: string; permissionMode?: string }): Promise<SpawnSessionResult> => {
      try {
        const tracked = findTrackedSessionById(happySessionId);
        if (!tracked) {
          return { type: 'error', errorCode: 'session-not-tracked', errorMessage: `Session ${happySessionId} is not tracked by this daemon. It may have been started before the daemon or on another machine.` };
        }
        if (!tracked.happySessionMetadataFromLocalWebhook) {
          return { type: 'error', errorMessage: `Session ${happySessionId} has no metadata. Cannot resume.` };
        }
        if (!tracked.encryption) {
          return { type: 'error', errorMessage: `Session ${happySessionId} has no stored encryption data. It was likely started before this feature was available. Restart the daemon and start a new session to enable resume.` };
        }

        // Webhook metadata may be stale (missing claudeSessionId/codexThreadId set after startup).
        // Fetch fresh metadata from server if needed.
        let metadata = tracked.happySessionMetadataFromLocalWebhook;
        const needsFetch = (!metadata.claudeSessionId && (!metadata.flavor || metadata.flavor === 'claude'))
          || (!metadata.codexThreadId && metadata.flavor === 'codex');
        if (needsFetch) {
          logger.debug(`[DAEMON RUN] Session ${happySessionId} missing agent session ID in webhook metadata, fetching from server`);
          const serverMetadata = await fetchServerSessionMetadata(happySessionId, tracked.encryption.encryptionKey, tracked.encryption.encryptionVariant);
          if (serverMetadata) {
            metadata = serverMetadata;
            tracked.happySessionMetadataFromLocalWebhook = serverMetadata;
          }
        }

        const launch = buildResumeLaunch(
          { id: happySessionId, active: true, metadata },
          { startedBy: 'daemon', claudeStartingMode: 'remote' },
        );

        if (options?.model) {
          launch.args.push('--model', options.model);
        }
        if (options?.permissionMode) {
          launch.args.push('--permission-mode', options.permissionMode);
        }

        await fs.access(launch.cwd);

        return spawnTrackedHappyProcess({
          args: launch.args,
          cwd: launch.cwd,
          env: {
            ...process.env,
            HAPPY_RECONNECT_SESSION_ID: happySessionId,
            HAPPY_RECONNECT_ENCRYPTION_KEY: encodeBase64(tracked.encryption.encryptionKey),
            HAPPY_RECONNECT_ENCRYPTION_VARIANT: tracked.encryption.encryptionVariant,
            HAPPY_RECONNECT_SEQ: String(tracked.encryption.seq),
            HAPPY_RECONNECT_METADATA_VERSION: String(tracked.encryption.metadataVersion),
            HAPPY_RECONNECT_AGENT_STATE_VERSION: String(tracked.encryption.agentStateVersion),
          },
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : (error && typeof error === 'object' ? JSON.stringify(error) : String(error));
        logger.debug(`[DAEMON RUN] Failed to resume session: ${errorMessage}`, error instanceof Error ? error.stack : undefined);
        return {
          type: 'error',
          errorMessage: `Failed to resume session: ${errorMessage}`,
        };
      }
    };

    // Stop a session by sessionId or PID fallback
    const stopSession = (sessionId: string): boolean => {
      logger.debug(`[DAEMON RUN] Attempting to stop session ${sessionId}`);

      // Try to find by sessionId first
      for (const [pid, session] of pidToTrackedSession.entries()) {
        if (session.happySessionId === sessionId ||
          (sessionId.startsWith('PID-') && pid === parseInt(sessionId.replace('PID-', '')))) {

          if (session.startedBy === 'daemon' && session.childProcess) {
            try {
              session.childProcess.kill('SIGTERM');
              logger.debug(`[DAEMON RUN] Sent SIGTERM to daemon-spawned session ${sessionId}`);
            } catch (error) {
              logger.debug(`[DAEMON RUN] Failed to kill session ${sessionId}:`, error);
            }
          } else {
            // For externally started sessions, try to kill by PID
            try {
              process.kill(pid, 'SIGTERM');
              logger.debug(`[DAEMON RUN] Sent SIGTERM to external session PID ${pid}`);
            } catch (error) {
              logger.debug(`[DAEMON RUN] Failed to kill external session PID ${pid}:`, error);
            }
          }

          pidToTrackedSession.delete(pid);
          logger.debug(`[DAEMON RUN] Removed session ${sessionId} from tracking`);
          return true;
        }
      }

      logger.debug(`[DAEMON RUN] Session ${sessionId} not found`);
      return false;
    };

    // Best-effort: send agentState=null for a session to the server.
    // apiMachineRef is null until apiMachine is initialized (line ~930);
    // this function is only called at or after that point, so the guard
    // is a safety net, not an expected code path.
    const clearAgentState = async (session: TrackedSession): Promise<void> => {
        const { happySessionId, encryption } = session;
        if (!happySessionId || !encryption || !apiMachineRef) {
            return;
        }
        try {
            await apiMachineRef.clearSessionAgentState(happySessionId, encryption.agentStateVersion);
        } catch (err) {
            logger.debug(`[DAEMON RUN] clearAgentState failed for ${happySessionId} (non-fatal):`, err);
        }
    };

    // Handle child process exit — preserve session data for resume
    const onChildExited = (pid: number) => {
      const session = pidToTrackedSession.get(pid);
      if (session?.happySessionId && session.encryption) {
        // Fire-and-forget: clear agentState on server before archiving session.
        // Failure is non-fatal; server TTL cleanup handles missed clears.
        void clearAgentState(session);
        sessionIdToFinishedSession.set(session.happySessionId, session);
        logger.debug(`[DAEMON RUN] Process PID ${pid} exited, preserved session ${session.happySessionId} for resume`);
      } else {
        logger.debug(`[DAEMON RUN] Removing exited process PID ${pid} from tracking`);
      }
      pidToTrackedSession.delete(pid);
    };

    // Start control server
    const { port: controlPort, stop: stopControlServer } = await startDaemonControlServer({
      getChildren: getCurrentChildren,
      stopSession,
      spawnSession,
      requestShutdown: () => requestShutdown('happy-cli'),
      onHappySessionWebhook
    });

    // Write initial daemon state (no lock needed for state file)
    const fileState: DaemonLocallyPersistedState = {
      pid: process.pid,
      httpPort: controlPort,
      startTime: new Date().toLocaleString(),
      startedWithCliVersion: packageJson.version,
      daemonLogPath: logger.logFilePath
    };
    writeDaemonState(fileState);
    logger.debug('[DAEMON RUN] Daemon state written');

    // Capture the bundled CLI's mtime at startup so the heartbeat can detect
    // when npm replaces `dist/index.mjs` on disk (= the user ran `npm i -g happy`).
    // We previously compared disk `package.json.version` to our bundled version,
    // but that produced infinite restart loops (#1107) when the manifest version
    // diverged from the bundled version (e.g. `happy-coder@0.13.1` deprecation
    // stub bumped package.json without rebuilding dist). File mtime is a more
    // reliable signal: it only changes when the bundle is actually replaced.
    const bundlePath = join(projectPath(), 'dist', 'index.mjs');
    let initialBundleMtimeMs = 0;
    try {
      initialBundleMtimeMs = statSync(bundlePath).mtimeMs;
    } catch {
      // dist/index.mjs not present (e.g. dev mode via tsx) — skip upgrade detection.
      logger.debug(`[DAEMON RUN] Bundle at ${bundlePath} not found; self-restart on upgrade disabled`);
    }

    // Prepare initial daemon state
    const initialDaemonState: DaemonState = {
      status: 'offline',
      pid: process.pid,
      httpPort: controlPort,
      startedAt: Date.now()
    };

    // Create API client
    const api = await ApiClient.create(credentials);

    // Get or create machine
    const machine = await api.getOrCreateMachine({
      machineId,
      metadata: initialMachineMetadata,
      daemonState: initialDaemonState
    });
    logger.debug(`[DAEMON RUN] Machine registered: ${machine.id}`);

    // Create realtime machine session
    const apiMachine = api.machineSyncClient(machine);
    apiMachineRef = apiMachine;

    // Set RPC handlers
    apiMachine.setRPCHandlers({
      spawnSession,
      resumeSession,
      stopSession,
      requestShutdown: () => requestShutdown('happy-app')
    });

    // Best-effort cleanup: cancel any pending permission requests left over from
    // the previous daemon process.  Runs once on initial connect and again on
    // every reconnect (idempotent — second run is a no-op since requests are gone).
    apiMachine.setOnConnectCallback(() =>
      cancelOrphanedPermissions(api, credentials.token, persisted, pidToTrackedSession)
    );

    // Connect to server (async: reads cached IP before creating socket)
    await apiMachine.connect();

    // Every 60 seconds:
    // 1. Prune stale sessions
    // 2. Check if daemon needs update
    // 3. If outdated, restart with latest version
    // 4. Write heartbeat
    const heartbeatIntervalMs = parseInt(process.env.HAPPY_DAEMON_HEARTBEAT_INTERVAL || '60000');
    let heartbeatRunning = false
    const restartOnStaleVersionAndHeartbeat = setInterval(async () => {
      if (heartbeatRunning) {
        return;
      }
      heartbeatRunning = true;

      if (process.env.DEBUG) {
        logger.debug(`[DAEMON RUN] Health check started at ${new Date().toLocaleString()}`);
      }

      // Prune stale sessions
      for (const [pid, _] of pidToTrackedSession.entries()) {
        try {
          // Check if process is still alive (signal 0 doesn't kill, just checks)
          process.kill(pid, 0);
        } catch (error) {
          // Process is dead, remove from tracking
          logger.debug(`[DAEMON RUN] Removing stale session with PID ${pid} (process no longer exists)`);
          pidToTrackedSession.delete(pid);
        }
      }

      // Check if daemon needs update by detecting whether `dist/index.mjs` was
      // replaced on disk since the daemon started (npm install rewrites the file).
      // Skip if we never captured an initial mtime (dev mode).
      let bundleReplaced = false;
      if (initialBundleMtimeMs > 0) {
        try {
          const currentMtimeMs = statSync(bundlePath).mtimeMs;
          bundleReplaced = currentMtimeMs !== initialBundleMtimeMs;
        } catch {
          // File temporarily missing (e.g. mid-install) — retry on next heartbeat.
        }
      }
      if (bundleReplaced) {
        // TODO: We probably do not want to keep this in-process self-restart logic long-term.
        // A native service manager would make startup and upgrades much simpler: the CLI would
        // ask the OS to start the latest daemon instead of hand-rolling respawn/kill behavior here.
        logger.debug('[DAEMON RUN] Daemon bundle replaced on disk, handing off to new daemon');

        clearInterval(restartOnStaleVersionAndHeartbeat);

        // Release ownership BEFORE spawning the new daemon. Otherwise the spawned
        // `happy daemon start` reads our still-present daemon.state.json, sees
        // isDaemonRunningCurrentlyInstalledHappyVersion() === true, and exits —
        // leaving nothing running once we also exit.
        apiMachine.shutdown();
        await stopControlServer();
        await cleanupDaemonState();
        await releaseDaemonLock(daemonLockHandle);
        await stopCaffeinate();

        // C1 A-fix (handoff②): prefer handing off to launchd via `kickstart -k`,
        // which kills+relaunches a *supervised* instance from the latest on-disk
        // bundle. The old detached spawn produced an orphaned grandchild
        // (`daemon start` → `start-sync`) that escaped launchd's label supervision,
        // so a post-upgrade crash had no self-healing. kickstart keeps the new
        // instance under supervision, closing the crash-self-healing loop.
        // If the agent is not supervised (non-macOS / M3 not installed) or kickstart
        // fails, fall back to the original detached spawn so self-upgrade never
        // drops the connection.
        const spawnNewDaemonDetached = () => {
          try {
            spawnHappyCLI(['daemon', 'start'], {
              detached: true,
              stdio: 'ignore'
            });
          } catch (error) {
            logger.debug('[DAEMON RUN] Failed to spawn new daemon, this is quite likely to happen during integration tests as we are cleaning out dist/ directory', error);
          }
        };

        if (process.platform === 'darwin' && await isAgentLoaded()) {
          logger.debug('[SUPERVISOR] self-upgrade handoff via launchctl kickstart -k');
          try {
            await kickstartAgent();
          } catch (error) {
            logger.debug('[SUPERVISOR] kickstart failed, falling back to detached spawn', error);
            spawnNewDaemonDetached();
          }
        } else {
          spawnNewDaemonDetached();
        }

        process.exit(0);
      }

      // Before wrecklessly overriting the daemon state file, we should check if we are the ones who own it
      // Race condition is possible, but thats okay for the time being :D
      const daemonState = await readDaemonState();
      if (daemonState && daemonState.pid !== process.pid) {
        logger.debug('[DAEMON RUN] Somehow a different daemon was started without killing us. We should kill ourselves.')
        requestShutdown('exception', 'A different daemon was started without killing us. We should kill ourselves.')
      }

      // Heartbeat
      try {
        const updatedState: DaemonLocallyPersistedState = {
          pid: process.pid,
          httpPort: controlPort,
          startTime: fileState.startTime,
          startedWithCliVersion: packageJson.version,
          lastHeartbeat: new Date().toLocaleString(),
          daemonLogPath: fileState.daemonLogPath
        };
        writeDaemonState(updatedState);
        if (process.env.DEBUG) {
          logger.debug(`[DAEMON RUN] Health check completed at ${updatedState.lastHeartbeat}`);
        }
      } catch (error) {
        logger.debug('[DAEMON RUN] Failed to write heartbeat', error);
      }

      heartbeatRunning = false;
    }, heartbeatIntervalMs); // Every 60 seconds in production

    // Setup signal handlers
    const cleanupAndShutdown = async (source: 'happy-app' | 'happy-cli' | 'os-signal' | 'exception', errorMessage?: string) => {
      logger.debug(`[DAEMON RUN] Starting proper cleanup (source: ${source}, errorMessage: ${errorMessage})...`);

      // Clear health check interval
      if (restartOnStaleVersionAndHeartbeat) {
        clearInterval(restartOnStaleVersionAndHeartbeat);
        logger.debug('[DAEMON RUN] Health check interval cleared');
      }

      // [BUG-23] Best-effort: clear agentState for all tracked sessions before shutdown.
      // Collect sessions from both active (pid-tracked) and finished (resume-eligible) maps.
      const allTrackedSessions = [
          ...pidToTrackedSession.values(),
          ...sessionIdToFinishedSession.values(),
      ].filter(s => s.happySessionId && s.encryption);

      if (allTrackedSessions.length > 0) {
          logger.debug(`[DAEMON RUN] Clearing agentState for ${allTrackedSessions.length} session(s) before shutdown`);
          const clearPromises = allTrackedSessions.map(s => clearAgentState(s));
          await Promise.race([
              Promise.allSettled(clearPromises),
              new Promise<void>(resolve => setTimeout(resolve, 2000)),
          ]);
          logger.debug('[DAEMON RUN] agentState clear phase complete (or timed out after 2s)');
      }

      // Update daemon state before shutting down
      await apiMachine.updateDaemonState((state: DaemonState | null) => ({
        ...state,
        status: 'shutting-down',
        shutdownRequestedAt: Date.now(),
        shutdownSource: source
      }));

      // Give time for metadata update to send
      await new Promise(resolve => setTimeout(resolve, 100));

      apiMachine.shutdown();
      await stopControlServer();
      await cleanupDaemonState();
      await stopCaffeinate();
      await releaseDaemonLock(daemonLockHandle);

      // BUG-DAEMON-02/D-1: graceful chain completed successfully.
      // Mark resolved and cancel the fuse so it cannot fire exit(1) after we
      // have already called exit(0).  clearTimeout is a no-op when fuseTimer is
      // null (R1/R2/R4 paths that never arm the fuse).
      gracefulResolved = true;
      if (fuseTimer !== null) {
          clearTimeout(fuseTimer);
          fuseTimer = null;
      }

      logger.debug('[DAEMON RUN] Cleanup completed, exiting process');
      process.exit(0);
    };

    logger.debug('[DAEMON RUN] Daemon started successfully, waiting for shutdown request');

    // C11 self-healing visibility: emit a searchable startup marker so `happy doctor`
    // (readSupervisorHealth) and post-mortem log scans can tell a launchd-managed
    // start from a crash-restart. `managed` = this instance is supervised by launchd.
    // crash-restart heuristic: agent is loaded AND the plist exists (this run was
    // brought up by launchd's KeepAlive, not a manual `happy daemon start`).
    if (process.platform === 'darwin') {
      try {
        const plistExists = existsSync(getAgentPlistPath());
        const managed = plistExists && await isAgentLoaded();
        if (managed) {
          // runs>1 in launchd means at least one relaunch happened this lifecycle.
          const health = await readSupervisorHealth();
          const trigger = health.restartCount > 0 ? 'crash-restart' : 'launchd-managed-start';
          logger.info(`[SUPERVISOR] daemon start | managed=true | trigger=${trigger}`);
        } else if (plistExists) {
          // plist present but not loaded → started manually, outside launchd.
          // Do NOT bootstrap here (would race the currently-running instance into a
          // double-launch); only record a hint for doctor (C8).
          logger.debug('[SUPERVISOR] running unmanaged; run `happy daemon install` to enable self-healing');
        }
      } catch (error) {
        // Visibility must never break startup.
        logger.debug('[SUPERVISOR] health/visibility probe failed (non-fatal)', error);
      }
    }

    // Wait for shutdown request
    const shutdownRequest = await resolvesWhenShutdownRequested;
    await cleanupAndShutdown(shutdownRequest.source, shutdownRequest.errorMessage);
  } catch (error) {
    // FR-2 (BUG-DAEMON-01): narrow the top-level catch so a transient startup-phase
    // network blip (whitelisted code) degrades instead of killing the daemon. Only
    // truly fatal, non-network conditions (EADDRINUSE control-port collision,
    // EACCES/EEXIST lock conflicts, programming errors, non-Error throws) keep the
    // original process.exit(1). routeStartupError is pure — the exit / fail glue
    // lives here (C5).
    if (routeStartupError(error) === 'fatal') {
      logger.debug('[DAEMON RUN][FATAL] Failed somewhere unexpectedly - exiting with code 1', error);
      process.exit(1);
    }
    // 'downgrade': whitelisted transient network error. Record for the offline
    // warning coordinator and stay alive — the existing offline degrade chain
    // (WebSocket startSmartReconnect + metadata sync) takes over once the network
    // recovers. NEVER exit(1) here.
    connectionState.fail({
      operation: 'Daemon startup (network)',
      caller: 'startDaemon.topLevelCatch',
      errorCode: (error as { code?: string })?.code,
    });
    logger.debug('[DAEMON RUN] Startup network error downgraded, daemon staying alive', error);
  }
}
