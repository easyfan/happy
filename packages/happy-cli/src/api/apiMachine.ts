/**
 * WebSocket client for machine/daemon communication with Happy server
 * Similar to ApiSessionClient but for machine-scoped connections
 */

import { io, Socket } from 'socket.io-client';
import { logger } from '@/ui/logger';
import { configuration } from '@/configuration';
import { MachineMetadata, DaemonState, Machine, Update, UpdateMachineBody } from './types';
import { registerCommonHandlers, SpawnSessionOptions, SpawnSessionResult } from '../modules/common/registerCommonHandlers';
import { encodeBase64, decodeBase64, encrypt, decrypt } from './encryption';
import { backoff } from '@/utils/time';
import { RpcHandlerManager } from './rpc/RpcHandlerManager';
import { detectCLIAvailability, CLIAvailability } from '@/utils/detectCLI';
import { detectResumeSupport, type ResumeSupport } from '@/resume/localHappyAgentAuth';
import { shouldReconnect } from '@/utils/lidState';
import { getProjectPath } from '@/claude/utils/path';
import {
    forkSession as claudeForkSession,
    forkAndTruncateSession as claudeForkAndTruncateSession,
    listClaudeRewindPoints,
    ForkTruncateUuidNotFoundError,
    ForkSourceMissingError,
} from '@/claude/utils/claudeSessionFork';
import { readServerIpCache, writeServerIpCache, resolveFreshIp } from '@/utils/serverIpCache';
import { CachedDnsAgent } from '@/utils/cachedDnsAgent';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface ServerToDaemonEvents {
    update: (data: Update) => void;
    'rpc-request': (data: { method: string, params: string }, callback: (response: string) => void) => void;
    'rpc-registered': (data: { method: string }) => void;
    'rpc-unregistered': (data: { method: string }) => void;
    'rpc-error': (data: { type: string, error: string }) => void;
    auth: (data: { success: boolean, user: string }) => void;
    error: (data: { message: string }) => void;
}

interface DaemonToServerEvents {
    'machine-alive': (data: {
        machineId: string;
        time: number;
    }) => void;

    'machine-update-metadata': (data: {
        machineId: string;
        metadata: string; // Encrypted MachineMetadata
        expectedVersion: number
    }, cb: (answer: {
        result: 'error'
    } | {
        result: 'version-mismatch'
        version: number,
        metadata: string
    } | {
        result: 'success',
        version: number,
        metadata: string
    }) => void) => void;

    'machine-update-state': (data: {
        machineId: string;
        daemonState: string; // Encrypted DaemonState
        expectedVersion: number
    }, cb: (answer: {
        result: 'error'
    } | {
        result: 'version-mismatch'
        version: number,
        daemonState: string
    } | {
        result: 'success',
        version: number,
        daemonState: string
    }) => void) => void;

    'rpc-register': (data: { method: string }) => void;
    'rpc-unregister': (data: { method: string }) => void;
    'rpc-call': (data: { method: string, params: any }, callback: (response: {
        ok: boolean
        result?: any
        error?: string
    }) => void) => void;
    'update-state': (data: { sid: string, expectedVersion: number, agentState: string | null }, cb: (answer: {
        result: 'error'
    } | {
        result: 'version-mismatch'
        version: number,
        agentState: string | null
    } | {
        result: 'success',
        version: number,
        agentState: string | null
    }) => void) => void;
}

type MachineRpcHandlers = {
    spawnSession: (options: SpawnSessionOptions) => Promise<SpawnSessionResult>;
    resumeSession?: (sessionId: string, options?: { model?: string; permissionMode?: string }) => Promise<SpawnSessionResult>;
    stopSession: (sessionId: string) => boolean;
    requestShutdown: () => void;
}

export class ApiMachineClient {
    private socket!: Socket<ServerToDaemonEvents, DaemonToServerEvents>;
    private keepAliveInterval: NodeJS.Timeout | null = null;
    private lastKnownCLIAvailability: CLIAvailability | null = null;
    private lastKnownResumeSupport: ResumeSupport | null = null;
    private rpcHandlerManager: RpcHandlerManager;
    private resumeSessionHandler: ((sessionId: string, options?: { model?: string; permissionMode?: string }) => Promise<SpawnSessionResult>) | null = null;
    private reconnectInterval: NodeJS.Timeout | null = null;
    /**
     * Optional hook invoked after each successful socket connect (including reconnects).
     * Callers may use this for best-effort cleanup that requires a live server connection
     * (e.g. cancelling orphaned permission requests left over from a previous daemon run).
     * The callback is fire-and-forget; errors are logged but do not affect connection flow.
     */
    private onConnectCallback: (() => Promise<void>) | null = null;

    constructor(
        private token: string,
        private machine: Machine
    ) {
        // Initialize RPC handler manager
        this.rpcHandlerManager = new RpcHandlerManager({
            scopePrefix: this.machine.id,
            encryptionKey: this.machine.encryptionKey,
            encryptionVariant: this.machine.encryptionVariant,
            logger: (msg, data) => logger.debug(msg, data)
        });

        registerCommonHandlers(this.rpcHandlerManager, process.cwd());
    }

    /**
     * Register a callback that runs once per successful socket connect (including reconnects).
     * Intended for best-effort cleanup such as cancelling orphaned permission requests left
     * behind by a previous daemon process.  The callback runs after updateDaemonState() and
     * before rpcHandlerManager.onSocketConnect(), errors are caught and only logged.
     */
    setOnConnectCallback(callback: () => Promise<void>): void {
        this.onConnectCallback = callback;
    }

    setRPCHandlers({
        spawnSession,
        resumeSession,
        stopSession,
        requestShutdown
    }: MachineRpcHandlers) {
        this.resumeSessionHandler = resumeSession ?? null;

        // Register spawn session handler
        this.rpcHandlerManager.registerHandler('spawn-happy-session', async (params: any) => {
            const { directory, sessionId, machineId, approvedNewDirectoryCreation, agent, environmentVariables, token, resumeClaudeSessionId, parentSessionId, forkedFromMessageId } = params || {};
            logger.debug(`[API MACHINE] Spawning session with params: ${JSON.stringify(params)}`);

            if (!directory) {
                throw new Error('Directory is required');
            }

            const result = await spawnSession({ directory, sessionId, machineId, approvedNewDirectoryCreation, agent, environmentVariables, token, resumeClaudeSessionId, parentSessionId, forkedFromMessageId });

            switch (result.type) {
                case 'success':
                    logger.debug(`[API MACHINE] Spawned session ${result.sessionId}`);
                    return { type: 'success', sessionId: result.sessionId };

                case 'requestToApproveDirectoryCreation':
                    logger.debug(`[API MACHINE] Requesting directory creation approval for: ${result.directory}`);
                    return { type: 'requestToApproveDirectoryCreation', directory: result.directory };

                case 'error':
                    throw new Error(result.errorMessage);
            }
        });

        this.syncResumeSessionRpcRegistration();

        // Register stop session handler
        this.rpcHandlerManager.registerHandler('stop-session', (params: any) => {
            const { sessionId } = params || {};

            if (!sessionId) {
                throw new Error('Session ID is required');
            }

            const success = stopSession(sessionId);
            if (!success) {
                throw new Error('Session not found or failed to stop');
            }

            logger.debug(`[API MACHINE] Stopped session ${sessionId}`);
            return { message: 'Session stopped' };
        });

        // Register Claude session fork handlers (used by app-side fork /
        // duplicate flows). These take the source session's working
        // directory and underlying Claude UUID, copy the on-disk JSONL
        // — optionally truncated at a chosen message — and return the new
        // Claude UUID. The caller then spawns a fresh Happy session with
        // `resumeClaudeSessionId` set so `claude --resume <newUuid>`
        // continues the conversation.
        this.rpcHandlerManager.registerHandler('claude-fork-session', async (params: any) => {
            const { directory, claudeSessionId } = params || {};
            if (typeof directory !== 'string' || directory.length === 0) {
                throw new Error('directory is required');
            }
            if (typeof claudeSessionId !== 'string' || !UUID_RE.test(claudeSessionId)) {
                throw new Error('claudeSessionId must be a valid UUID');
            }
            try {
                const newClaudeSessionId = await claudeForkSession(getProjectPath(directory), claudeSessionId);
                return { type: 'success', newClaudeSessionId };
            } catch (error) {
                if (error instanceof ForkSourceMissingError) {
                    throw new Error('Claude session file not found on this machine');
                }
                throw error;
            }
        });

        // List user-text rewind points directly from the on-disk JSONL.
        // The server-side session log misses claudeUuid for messages typed
        // live in the app (legacy `sentFrom: 'web'` path); disk is the
        // source of truth and carries the right uuids for every message.
        this.rpcHandlerManager.registerHandler('claude-list-rewind-points', async (params: any) => {
            const { directory, claudeSessionId } = params || {};
            if (typeof directory !== 'string' || directory.length === 0) {
                throw new Error('directory is required');
            }
            if (typeof claudeSessionId !== 'string' || !UUID_RE.test(claudeSessionId)) {
                throw new Error('claudeSessionId must be a valid UUID');
            }
            try {
                const points = await listClaudeRewindPoints(getProjectPath(directory), claudeSessionId);
                return { type: 'success', points };
            } catch (error) {
                if (error instanceof ForkSourceMissingError) {
                    throw new Error('Claude session file not found on this machine');
                }
                throw error;
            }
        });

        this.rpcHandlerManager.registerHandler('claude-duplicate-session', async (params: any) => {
            const { directory, claudeSessionId, truncateBeforeUuid } = params || {};
            if (typeof directory !== 'string' || directory.length === 0) {
                throw new Error('directory is required');
            }
            if (typeof claudeSessionId !== 'string' || !UUID_RE.test(claudeSessionId)) {
                throw new Error('claudeSessionId must be a valid UUID');
            }
            if (typeof truncateBeforeUuid !== 'string' || !UUID_RE.test(truncateBeforeUuid)) {
                throw new Error('truncateBeforeUuid must be a valid UUID');
            }
            try {
                const newClaudeSessionId = await claudeForkAndTruncateSession(
                    getProjectPath(directory),
                    claudeSessionId,
                    truncateBeforeUuid,
                );
                return { type: 'success', newClaudeSessionId };
            } catch (error) {
                if (error instanceof ForkSourceMissingError) {
                    throw new Error('Claude session file not found on this machine');
                }
                if (error instanceof ForkTruncateUuidNotFoundError) {
                    throw new Error(
                        'The chosen rewind point is no longer present in the source session — try forking without truncation',
                    );
                }
                throw error;
            }
        });

        // Register stop daemon handler
        this.rpcHandlerManager.registerHandler('stop-daemon', () => {
            logger.debug('[API MACHINE] Received stop-daemon RPC request');

            // Trigger shutdown callback after a delay
            setTimeout(() => {
                logger.debug('[API MACHINE] Initiating daemon shutdown from RPC');
                requestShutdown();
            }, 100);

            return { message: 'Daemon stop request acknowledged, starting shutdown sequence...' };
        });
    }

    private syncResumeSessionRpcRegistration(): void {
        const method = 'resume-happy-session';

        if (this.resumeSessionHandler) {
            if (!this.rpcHandlerManager.hasHandler(method)) {
                this.rpcHandlerManager.registerHandler(method, async (params: any) => {
                    const { sessionId, model, permissionMode } = params || {};

                    if (!sessionId || typeof sessionId !== 'string') {
                        throw new Error('Session ID is required');
                    }

                    const handler = this.resumeSessionHandler;
                    if (!handler) {
                        throw new Error('Resume session handler not available');
                    }

                    const result = await handler(sessionId, { model, permissionMode });
                    switch (result.type) {
                        case 'success':
                            return { type: 'success', sessionId: result.sessionId };
                        case 'requestToApproveDirectoryCreation':
                            return result;
                        case 'error':
                            throw new Error(result.errorMessage);
                    }
                });
            }
            return;
        }

        if (this.rpcHandlerManager.hasHandler(method)) {
            this.rpcHandlerManager.unregisterHandler(method);
        }
    }

    /**
     * Update machine metadata
     * Currently unused, changes from the mobile client are more likely
     * for example to set a custom name.
     */
    async updateMachineMetadata(handler: (metadata: MachineMetadata | null) => MachineMetadata): Promise<void> {
        await backoff(async () => {
            const updated = handler(this.machine.metadata);

            const answer = await this.socket.emitWithAck('machine-update-metadata', {
                machineId: this.machine.id,
                metadata: encodeBase64(encrypt(this.machine.encryptionKey, this.machine.encryptionVariant, updated)),
                expectedVersion: this.machine.metadataVersion
            });

            if (answer.result === 'success') {
                this.machine.metadata = decrypt(this.machine.encryptionKey, this.machine.encryptionVariant, decodeBase64(answer.metadata));
                this.machine.metadataVersion = answer.version;
                logger.debug('[API MACHINE] Metadata updated successfully');
            } else if (answer.result === 'version-mismatch') {
                if (answer.version > this.machine.metadataVersion) {
                    this.machine.metadataVersion = answer.version;
                    this.machine.metadata = decrypt(this.machine.encryptionKey, this.machine.encryptionVariant, decodeBase64(answer.metadata));
                }
                throw new Error('Metadata version mismatch'); // Triggers retry
            }
        });
    }

    /**
     * Update daemon state (runtime info) - similar to session updateAgentState
     * Simplified without lock - relies on backoff for retry
     */
    async updateDaemonState(handler: (state: DaemonState | null) => DaemonState): Promise<void> {
        await backoff(async () => {
            const updated = handler(this.machine.daemonState);

            const answer = await this.socket.emitWithAck('machine-update-state', {
                machineId: this.machine.id,
                daemonState: encodeBase64(encrypt(this.machine.encryptionKey, this.machine.encryptionVariant, updated)),
                expectedVersion: this.machine.daemonStateVersion
            });

            if (answer.result === 'success') {
                this.machine.daemonState = decrypt(this.machine.encryptionKey, this.machine.encryptionVariant, decodeBase64(answer.daemonState));
                this.machine.daemonStateVersion = answer.version;
                logger.debug('[API MACHINE] Daemon state updated successfully');
            } else if (answer.result === 'version-mismatch') {
                if (answer.version > this.machine.daemonStateVersion) {
                    this.machine.daemonStateVersion = answer.version;
                    this.machine.daemonState = decrypt(this.machine.encryptionKey, this.machine.encryptionVariant, decodeBase64(answer.daemonState));
                }
                throw new Error('Daemon state version mismatch'); // Triggers retry
            }
        });
    }

    async connect() {
        const serverUrl = configuration.serverUrl.replace(/^http/, 'ws');
        logger.debug(`[API MACHINE] Connecting to ${serverUrl}`);

        // Plan C: inject CachedDnsAgent when a valid cached IP is available
        const hostname = new URL(configuration.serverUrl).hostname;
        const cachedEntry = await readServerIpCache();
        // socket.io's TS type declares agent as `string | boolean` but the runtime
        // accepts any http.Agent / https.Agent. Using cast here avoids the TS conflict.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const agentOpt: Record<string, any> = (cachedEntry?.hostname === hostname)
            ? { agent: new CachedDnsAgent(cachedEntry.ip, hostname) }
            : {};

        this.socket = io(serverUrl, {
            transports: ['websocket'],
            auth: {
                token: this.token,
                clientType: 'machine-scoped' as const,
                machineId: this.machine.id,
                happyClient: `cli-daemon/${configuration.currentCliVersion}`
            },
            path: '/v1/updates',
            reconnection: false,
            ...agentOpt,
        } as Parameters<typeof io>[1]);

        this.socket.on('connect', () => {
            logger.debug('[API MACHINE] Connected to server');

            if (this.reconnectInterval) {
                clearInterval(this.reconnectInterval);
                this.reconnectInterval = null;
            }

            this.updateDaemonState((state) => ({
                ...state,
                status: 'running',
                pid: process.pid,
                httpPort: this.machine.daemonState?.httpPort,
                startedAt: Date.now()
            }));

            // Fire-and-forget: run caller-provided cleanup after re-establishing the
            // server connection.  Errors are caught here so they never break the
            // connection setup path.
            if (this.onConnectCallback) {
                this.onConnectCallback().catch((err) => {
                    logger.debug('[API MACHINE] onConnectCallback error (non-fatal):', err);
                });
            }

            this.rpcHandlerManager.onSocketConnect(this.socket);
            this.syncResumeSessionRpcRegistration();
            this.startKeepAlive();

            // Fire-and-forget: refresh IP cache after successful connection
            void resolveFreshIp(hostname).then((ip) => {
                if (ip) void writeServerIpCache(ip, hostname);
            });
        });

        this.socket.on('disconnect', (reason) => {
            logger.debug(`[API MACHINE] Disconnected from server — reason: ${reason}`);
            this.rpcHandlerManager.onSocketDisconnect();
            this.stopKeepAlive();
            this.startSmartReconnect();
        });

        // Single consolidated RPC handler
        this.socket.on('rpc-request', async (data: { method: string, params: string }, callback: (response: string) => void) => {
            logger.debugLargeJson(`[API MACHINE] Received RPC request:`, data);
            callback(await this.rpcHandlerManager.handleRequest(data));
        });

        // Handle update events from server
        this.socket.on('update', (data: Update) => {
            // Machine clients should only care about machine updates
            if (data.body.t === 'update-machine' && (data.body as UpdateMachineBody).machineId === this.machine.id) {
                // Handle machine metadata or daemon state updates from other clients (e.g., mobile app)
                const update = data.body as UpdateMachineBody;

                if (update.metadata) {
                    logger.debug('[API MACHINE] Received external metadata update');
                    this.machine.metadata = decrypt(this.machine.encryptionKey, this.machine.encryptionVariant, decodeBase64(update.metadata.value));
                    this.machine.metadataVersion = update.metadata.version;
                }

                if (update.daemonState) {
                    logger.debug('[API MACHINE] Received external daemon state update');
                    this.machine.daemonState = decrypt(this.machine.encryptionKey, this.machine.encryptionVariant, decodeBase64(update.daemonState.value));
                    this.machine.daemonStateVersion = update.daemonState.version;
                }
            } else {
                logger.debug(`[API MACHINE] Received unknown update type: ${(data.body as any).t}`);
            }
        });

        this.socket.on('connect_error', (error) => {
            logger.debug(`[API MACHINE] Connection error: ${error.message}`);
            this.startSmartReconnect();
        });

        this.socket.io.on('error', (error: any) => {
            logger.debug('[API MACHINE] Socket error:', error);
        });
    }

    private startKeepAlive() {
        this.stopKeepAlive();
        this.keepAliveInterval = setInterval(() => {
            const payload = {
                machineId: this.machine.id,
                time: Date.now()
            };
            if (process.env.DEBUG) {
                logger.debugLargeJson(`[API MACHINE] Emitting machine-alive`, payload);
            }
            this.socket.emit('machine-alive', payload);

            // Re-detect CLI availability and push metadata update if changed
            const newAvailability = detectCLIAvailability();
            const prev = this.lastKnownCLIAvailability;
            const newResumeSupport = detectResumeSupport();
            const prevResume = this.lastKnownResumeSupport;
            const cliAvailabilityChanged = !prev || prev.claude !== newAvailability.claude || prev.codex !== newAvailability.codex || prev.gemini !== newAvailability.gemini || prev.openclaw !== newAvailability.openclaw;
            const resumeSupportChanged = !prevResume
                || prevResume.rpcAvailable !== newResumeSupport.rpcAvailable
                || prevResume.happyAgentAuthenticated !== newResumeSupport.happyAgentAuthenticated;

            if (cliAvailabilityChanged || resumeSupportChanged) {
                this.lastKnownCLIAvailability = newAvailability;
                this.lastKnownResumeSupport = newResumeSupport;
                this.updateMachineMetadata((metadata) => ({
                    ...(metadata || {} as any),
                    cliAvailability: newAvailability,
                    resumeSupport: { ...newResumeSupport, rpcAvailable: !!this.resumeSessionHandler },
                })).catch((err) => {
                    logger.debug('[API MACHINE] Failed to update machine capabilities:', err);
                });
            }
        }, 20000);
        logger.debug('[API MACHINE] Keep-alive started (20s interval)');
    }

    private startSmartReconnect() {
        if (this.reconnectInterval) return;

        // hostname is stable for daemon lifetime (serverUrl never changes at runtime)
        const hostname = new URL(configuration.serverUrl).hostname;

        /**
         * Read cached IP and update socket.io.opts.agent before each connect attempt.
         * Re-reading on every attempt ensures we pick up any cache refresh that may
         * have occurred since the last attempt (e.g. DNS briefly recovered).
         */
        const connectWithCachedAgent = async () => {
            const cached = await readServerIpCache();
            const opts = this.socket.io.opts as Record<string, unknown> | undefined;
            if (opts) {
                if (cached?.hostname === hostname) {
                    opts.agent = new CachedDnsAgent(cached.ip, hostname);
                } else {
                    delete opts.agent;
                }
            }
            this.socket.connect();
        };

        this.reconnectInterval = setInterval(() => {
            if (this.socket.connected) {
                clearInterval(this.reconnectInterval!);
                this.reconnectInterval = null;
                return;
            }
            if (!shouldReconnect()) {
                logger.debug('[API MACHINE] Still not ready to reconnect');
                return;
            }
            logger.debug('[API MACHINE] Attempting reconnect');
            void connectWithCachedAgent();
        }, 3000);

        if (shouldReconnect()) {
            logger.debug('[API MACHINE] Network up + lid open — reconnecting in 1s');
            setTimeout(() => {
                if (!this.socket.connected) void connectWithCachedAgent();
            }, 1000);
        }
    }

    private stopKeepAlive() {
        if (this.keepAliveInterval) {
            clearInterval(this.keepAliveInterval);
            this.keepAliveInterval = null;
            logger.debug('[API MACHINE] Keep-alive stopped');
        }
    }

    /**
     * Best-effort: send agentState=null for a session via the machine-scoped socket.
     * Used when a session's child process exits or when the daemon is shutting down.
     *
     * On version-mismatch: if server agentState is already null, goal is achieved.
     * Otherwise retries once with the new version. Second failure is silently ignored.
     * All errors are non-fatal (fire-and-forget scenario).
     */
    async clearSessionAgentState(sid: string, expectedVersion: number): Promise<void> {
        if (!this.socket.connected) {
            logger.debug(`[API MACHINE] clearSessionAgentState: socket not connected, skipping sid=${sid}`);
            return;
        }

        const attempt = async (version: number): Promise<void> => {
            const answer = await this.socket.emitWithAck('update-state', {
                sid,
                expectedVersion: version,
                agentState: null,
            });

            if (answer.result === 'success') {
                logger.debug(`[API MACHINE] clearSessionAgentState: success sid=${sid} version=${answer.version}`);
                return;
            }

            if (answer.result === 'version-mismatch') {
                // If server-side agentState is already null, our goal is achieved
                if (answer.agentState === null) {
                    logger.debug(`[API MACHINE] clearSessionAgentState: already null sid=${sid}`);
                    return;
                }
                // Non-null mismatch: retry once with the new version
                logger.debug(`[API MACHINE] clearSessionAgentState: version-mismatch, retrying sid=${sid} newVersion=${answer.version}`);
                const retry = await this.socket.emitWithAck('update-state', {
                    sid,
                    expectedVersion: answer.version,
                    agentState: null,
                });
                if (retry.result === 'success' || (retry.result === 'version-mismatch' && retry.agentState === null)) {
                    logger.debug(`[API MACHINE] clearSessionAgentState: retry ok sid=${sid}`);
                    return;
                }
                logger.debug(`[API MACHINE] clearSessionAgentState: retry failed sid=${sid} result=${retry.result}`);
                return;
            }

            logger.debug(`[API MACHINE] clearSessionAgentState: error result sid=${sid}`);
        };

        await attempt(expectedVersion);
    }

    shutdown() {
        logger.debug('[API MACHINE] Shutting down');
        this.stopKeepAlive();
        if (this.reconnectInterval) {
            clearInterval(this.reconnectInterval);
            this.reconnectInterval = null;
        }
        if (this.socket) {
            this.socket.close();
            logger.debug('[API MACHINE] Socket closed');
        }
    }
}
