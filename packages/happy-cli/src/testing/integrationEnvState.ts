import type { IntegrationEnvironment } from './integrationEnvironment';

/**
 * Worker-local integration env holder. Deliberately imports nothing from
 * `vitest` so it is safe to pull into the globalSetup module graph (globalSetup
 * runs in a separate context where importing vitest throws). The authenticated
 * suites read the shared env via vitest inject(); this holder only backs the
 * in-process fallback used by integration-empty (up:false, single worker).
 */
let workerLocalEnv: IntegrationEnvironment | undefined;

export function setWorkerLocalIntegrationEnv(env: IntegrationEnvironment): void {
    workerLocalEnv = env;
}

export function getWorkerLocalIntegrationEnv(): IntegrationEnvironment | undefined {
    return workerLocalEnv;
}
