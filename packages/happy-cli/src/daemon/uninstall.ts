import { uninstallLaunchAgent } from '@/daemon/mac/installState';

/**
 * `happy daemon uninstall` — removes the user-level LaunchAgent (no sudo) and falls
 * back to the passive auto-start model (C12). Routes to M3 uninstallLaunchAgent
 * (M2 uninstallAgent + stop running instance + fallback-model explanation).
 * Platform check + error handling live inside uninstallLaunchAgent.
 */
export async function uninstall(): Promise<void> {
    await uninstallLaunchAgent();
}
