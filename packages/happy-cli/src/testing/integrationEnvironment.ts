import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..');
const ENVIRONMENTS_MODULE_URL = pathToFileURL(join(REPO_ROOT, 'environments', 'environments.ts')).href;

export type EnvironmentTemplate = 'authenticated-empty' | 'empty';

export type IntegrationEnvironment = {
    name: string;
    envDir: string;
    projectPath: string;
    serverPort: number;
    expoPort: number;
};

type EnvironmentConfig = {
    projectPath: string;
    serverPort: number;
    expoPort: number;
};

type EnvironmentsModule = {
    createEnvironment: (opts?: { noSwitch?: boolean }) => Promise<string>;
    getEnvironmentConfig: (name: string) => EnvironmentConfig;
    getEnvironmentDir: (name: string) => string;
    removeEnvironment: (name: string) => void;
    seedEnvironment: (name: string) => Promise<void>;
    setEnvironmentTemplate: (name: string, template: EnvironmentTemplate) => void;
    startEnvironmentServices: (name: string, opts?: { skipWeb?: boolean }) => Promise<void>;
    stopEnvironment: (name: string) => Promise<void>;
};

async function loadEnvironmentManager(): Promise<EnvironmentsModule> {
    return await import(ENVIRONMENTS_MODULE_URL) as EnvironmentsModule;
}

export async function createIntegrationEnvironment(options?: { template?: EnvironmentTemplate; up?: boolean; skipWeb?: boolean }): Promise<IntegrationEnvironment> {
    const template = options?.template ?? 'authenticated-empty';
    const shouldStart = options?.up ?? true;
    const skipWeb = options?.skipWeb ?? false;
    const environments = await loadEnvironmentManager();
    const name = await environments.createEnvironment({ noSwitch: true });

    try {
        environments.setEnvironmentTemplate(name, template);

        if (shouldStart) {
            await environments.startEnvironmentServices(name, { skipWeb });
            if (template === 'authenticated-empty') {
                await environments.seedEnvironment(name);
            }
        }

        const config = environments.getEnvironmentConfig(name);
        return {
            name,
            envDir: environments.getEnvironmentDir(name),
            projectPath: config.projectPath,
            serverPort: config.serverPort,
            expoPort: config.expoPort,
        };
    } catch (error) {
        // OQ-5: on provision failure keep the env directory + server logs for
        // diagnosis. Print the log path + tail, then only stop processes — do
        // NOT removeEnvironment (that would delete the logs we need).
        try {
            const envDir = environments.getEnvironmentDir(name);
            const serverLogFile = join(envDir, 'server', 'stdout.log');
            console.error(`[integration] provision failed for "${name}". Server log: ${serverLogFile}`);
            if (existsSync(serverLogFile)) {
                const tail = readFileSync(serverLogFile, 'utf-8').split('\n').slice(-40).join('\n');
                console.error(`[integration] --- server log tail (last 40 lines) ---\n${tail}`);
            }
        } catch {}

        try {
            await environments.stopEnvironment(name);
        } catch {}

        throw error;
    }
}

export function applyEnvironmentToProcess(env: IntegrationEnvironment) {
    process.env.HAPPY_SERVER_URL = `http://localhost:${env.serverPort}`;
    process.env.HAPPY_WEBAPP_URL = `http://localhost:${env.expoPort}`;
    process.env.HAPPY_HOME_DIR = join(env.envDir, 'cli', 'home');
    process.env.HAPPY_PROJECT_DIR = env.projectPath;
    process.env.HAPPY_VARIANT = 'dev';
    process.env.DEBUG = '1';
}

/**
 * ST-1: provision-only entry point for the vitest globalSetup main process
 * (collect phase). Provisions a single shared server + seeded account and
 * returns a JSON-serializable descriptor for cross-process provide/inject.
 * Imports nothing from `vitest`, so it is safe in the globalSetup context.
 */
export async function provisionIntegrationEnvironment(profile: {
    template: EnvironmentTemplate;
    up: boolean;
    skipWeb?: boolean;
}): Promise<IntegrationEnvironment> {
    return await createIntegrationEnvironment({
        template: profile.template,
        up: profile.up,
        skipWeb: profile.skipWeb,
    });
}

/**
 * ST-1: worker-side apply. Rebuilds process.env from an injected descriptor.
 * Starts no server — the shared server is already running from globalSetup.
 */
export function applyInjectedEnvironment(env: IntegrationEnvironment): void {
    applyEnvironmentToProcess(env);
}

export async function destroyIntegrationEnvironment(env: IntegrationEnvironment) {
    const environments = await loadEnvironmentManager();
    await environments.stopEnvironment(env.name);
    environments.removeEnvironment(env.name);
}
