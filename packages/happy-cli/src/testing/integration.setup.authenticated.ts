import { getIntegrationEnv } from '@/testing/currentIntegrationEnv';
import { applyInjectedEnvironment } from '@/testing/integrationEnvironment';

// ST-1: the shared server + seeded account are provisioned ONCE in the vitest
// globalSetup main process (collect phase) and passed to workers via
// provide/inject. Each worker only rebuilds its process.env here — no server
// startup, so N workers no longer race N concurrent server spawns.
applyInjectedEnvironment(getIntegrationEnv());
