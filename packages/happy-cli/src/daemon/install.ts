import { installLaunchAgent } from '@/daemon/mac/installState';

/**
 * `happy daemon install` — installs the user-level LaunchAgent (no sudo).
 * Routes to M3 installLaunchAgent (state probe → migration decision → M2
 * installAgent). Idempotent; migrates from / repairs the legacy sudo LaunchDaemon
 * when detected. Platform check + error handling live inside installLaunchAgent.
 */
export async function install(): Promise<void> {
    await installLaunchAgent();
}
