import { afterAll } from 'vitest';
import { setWorkerLocalIntegrationEnv } from './integrationEnvState';
import {
    applyEnvironmentToProcess,
    createIntegrationEnvironment,
    destroyIntegrationEnvironment,
    type EnvironmentTemplate,
} from './integrationEnvironment';

type IntegrationEnvironmentProfile = {
    template: EnvironmentTemplate;
    up: boolean;
    skipWeb?: boolean;
};

/**
 * Legacy in-process installer, retained for integration-empty (up:false, no
 * server, single worker → no concurrency problem). The authenticated suites
 * use the provision/apply split in integrationEnvironment.ts instead (which
 * avoids importing `vitest` so it is safe from the globalSetup context).
 *
 * This module DOES import `vitest` (afterAll) and must therefore only ever be
 * loaded from worker setupFiles, never from globalSetup.
 */
export async function installIntegrationEnvironment(profile: IntegrationEnvironmentProfile) {
    const previousEnv = {
        HAPPY_SERVER_URL: process.env.HAPPY_SERVER_URL,
        HAPPY_WEBAPP_URL: process.env.HAPPY_WEBAPP_URL,
        HAPPY_HOME_DIR: process.env.HAPPY_HOME_DIR,
        HAPPY_PROJECT_DIR: process.env.HAPPY_PROJECT_DIR,
        HAPPY_VARIANT: process.env.HAPPY_VARIANT,
        DEBUG: process.env.DEBUG,
    };

    const env = await createIntegrationEnvironment({
        template: profile.template,
        up: profile.up,
        skipWeb: profile.skipWeb,
    });
    applyEnvironmentToProcess(env);
    setWorkerLocalIntegrationEnv(env);

    afterAll(async () => {
        try {
            await destroyIntegrationEnvironment(env);
        } finally {
            for (const [key, value] of Object.entries(previousEnv)) {
                if (value === undefined) {
                    delete process.env[key];
                } else {
                    process.env[key] = value;
                }
            }
        }
    });
}
