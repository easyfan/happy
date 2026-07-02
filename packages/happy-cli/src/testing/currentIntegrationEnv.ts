import { inject } from 'vitest';
import { getWorkerLocalIntegrationEnv } from './integrationEnvState';
import type { IntegrationEnvironment } from './integrationEnvironment';

// ST-1 / OQ-3: cross-process provide/inject payload. Only JSON-serializable
// fields (credentials stay on disk in access.key, never over IPC).
declare module 'vitest' {
    export interface ProvidedContext {
        happyIntegrationEnv: IntegrationEnvironment;
    }
}

export function getIntegrationEnv(): IntegrationEnvironment {
    // ST-1: authenticated suites receive the shared env via provide/inject
    // (crosses the globalSetup main process → worker boundary). inject throws
    // if the key was never provided, so guard and fall back to the in-process
    // holder used by integration-empty.
    let injected: IntegrationEnvironment | undefined;
    try {
        injected = inject('happyIntegrationEnv');
    } catch {
        injected = undefined;
    }

    const env = injected ?? getWorkerLocalIntegrationEnv();
    if (!env) {
        throw new Error('No active integration environment (provide/inject missing)');
    }
    return env;
}
