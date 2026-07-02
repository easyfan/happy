/**
 * Vitest global setup — runs ONCE per active project before all tests.
 *
 * ST-1: for the `integration-authenticated` project we provision a SINGLE
 * shared server + seeded account here (collect phase, zero concurrency) and
 * hand it to workers via project.provide(). Other projects (unit,
 * integration-empty, integration-plan-mode) only build the CLI — the
 * `--project unit` coverage path never spins up a server (AC-4).
 */

import { spawnSync } from 'node:child_process'
import type { TestProject } from 'vitest/node'
import {
    destroyIntegrationEnvironment,
    provisionIntegrationEnvironment,
    type IntegrationEnvironment,
} from '@/testing/integrationEnvironment'

let provisionedEnv: IntegrationEnvironment | undefined

function buildCli(): void {
    const buildResult = spawnSync('pnpm', ['build'], { stdio: 'pipe' })
    if (buildResult.stderr && buildResult.stderr.length > 0) {
        const errorOutput = buildResult.stderr.toString()
        console.error(`Build stderr (could be debugger output): ${errorOutput}`)
        console.log(`Build stdout: ${buildResult.stdout.toString()}`)
        if (errorOutput.includes('Command failed with exit code')) {
            throw new Error(`Build failed STDERR: ${errorOutput}`)
        }
    }
}

export async function setup(project: TestProject): Promise<void> {
    process.env.VITEST_POOL_TIMEOUT = '60000'
    process.env.HAPPY_RUN_SANDBOX_NETWORK_TESTS = '1'

    buildCli()

    // OQ-2: only the authenticated suite needs a live shared server. unit /
    // integration-empty / integration-plan-mode return here (build-only), so
    // `--project unit` never starts a server and the coverage gate is safe.
    if (project.name !== 'integration-authenticated') {
        return
    }

    provisionedEnv = await provisionIntegrationEnvironment({
        template: 'authenticated-empty',
        up: true,
        skipWeb: true,
    })
    project.provide('happyIntegrationEnv', provisionedEnv)
}

export async function teardown(): Promise<void> {
    if (!provisionedEnv) {
        return
    }
    try {
        await destroyIntegrationEnvironment(provisionedEnv)
    } finally {
        provisionedEnv = undefined
    }
}
