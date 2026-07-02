/**
 * Harness unit tests for repo-root environments/environments.ts (ST-2/ST-3/ST-4).
 *
 * No mocking (project rule): killProcess is exercised against real short-lived
 * child processes (a SIGTERM-ignoring `sh` trap for the SIGKILL fallback, and a
 * well-behaved sleeper for the graceful path); raceReadyOrEarlyExit is driven
 * with real `node -e` children for the spawn-failure and early-exit branches.
 *
 * These are plain `.test.ts` (unit project) — they must NOT require the shared
 * integration server (AC-4: `--project unit` starts no server).
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..')
const ENVIRONMENTS_MODULE_URL = pathToFileURL(join(REPO_ROOT, 'environments', 'environments.ts')).href

type HarnessModule = {
    killProcess: (pid: number) => Promise<void>
    isProcessAlive: (pid: number) => boolean
    spawnService: (
        command: string,
        args: string[],
        opts: { cwd: string; env: Record<string, string | undefined>; logFile: string },
    ) => { pid: number; child: ChildProcess }
    raceReadyOrEarlyExit: (
        child: ChildProcess,
        service: string,
        logFile: string,
        readyProbe: () => Promise<void>,
    ) => Promise<void>
    ServiceError: new (code: string, message: string) => Error & { code: string }
}

async function loadHarness(): Promise<HarnessModule> {
    return (await import(ENVIRONMENTS_MODULE_URL)) as unknown as HarnessModule
}

// Track detached children so a failing test never leaks a process.
const spawnedPids: number[] = []
function track(pid: number | undefined): number {
    if (pid !== undefined) spawnedPids.push(pid)
    return pid!
}

afterEach(() => {
    for (const pid of spawnedPids.splice(0)) {
        try { process.kill(-pid, 'SIGKILL') } catch {}
        try { process.kill(pid, 'SIGKILL') } catch {}
    }
})

describe('killProcess (ST-3)', () => {
    it('SIGKILLs a SIGTERM-ignoring child within the 1000ms window', async () => {
        const harness = await loadHarness()
        // IT40 idiom: trap "" TERM makes the process ignore SIGTERM entirely,
        // so only the SIGKILL fallback can reap it. Observe the real exit
        // signal via the 'exit' event (killed=true) — polling process.kill(pid,0)
        // would see a zombie because this test process is the direct parent
        // (in production the killed pid is an unrelated detached service).
        const child = spawn('sh', ['-c', 'trap "" TERM; sleep 30 & wait $!'], {
            detached: true,
            stdio: 'ignore',
        })
        const pid = track(child.pid)
        const exited = new Promise<NodeJS.Signals | null>((resolvePromise) => {
            child.on('exit', (_code, signal) => resolvePromise(signal))
        })
        // Give the shell a moment to install its TERM trap.
        await new Promise(r => setTimeout(r, 200))
        expect(harness.isProcessAlive(pid)).toBe(true)

        const start = Date.now()
        await harness.killProcess(pid)
        const signal = await exited
        const elapsed = Date.now() - start

        // SIGTERM was trapped/ignored, so the fallback SIGKILL must be what
        // reaped it.
        expect(signal).toBe('SIGKILL')
        // Window is 1000ms + one 250ms poll step + SIGKILL propagation.
        expect(elapsed).toBeLessThan(2500)
    })

    it('reaps a well-behaved child via SIGTERM before the SIGKILL fallback fires', async () => {
        const harness = await loadHarness()
        const child = spawn('sh', ['-c', 'sleep 30'], { detached: true, stdio: 'ignore' })
        const pid = track(child.pid)
        const exited = new Promise<NodeJS.Signals | null>((resolvePromise) => {
            child.on('exit', (_code, signal) => resolvePromise(signal))
        })
        await new Promise(r => setTimeout(r, 100))
        expect(harness.isProcessAlive(pid)).toBe(true)

        const start = Date.now()
        await harness.killProcess(pid)
        const signal = await exited
        const elapsed = Date.now() - start

        // A well-behaved sleeper dies on SIGTERM; SIGKILL fallback never fires.
        expect(signal).toBe('SIGTERM')
        // Graceful SIGTERM exit should be well under the 1000ms fallback window.
        expect(elapsed).toBeLessThan(1000)
    })

    it('does not throw when the pid is already dead', async () => {
        const harness = await loadHarness()
        const child = spawn('sh', ['-c', 'exit 0'], { detached: true, stdio: 'ignore' })
        const pid = child.pid!
        await new Promise(r => setTimeout(r, 200))
        expect(harness.isProcessAlive(pid)).toBe(false)
        await expect(harness.killProcess(pid)).resolves.toBeUndefined()
    })
})

describe('spawnService (ST-2)', () => {
    it('returns both pid and the child reference', async () => {
        const harness = await loadHarness()
        const logDir = mkdtempSync(join(tmpdir(), 'happy-harness-'))
        const logFile = join(logDir, 'svc.log')
        const { pid, child } = harness.spawnService('sh', ['-c', 'sleep 30'], {
            cwd: logDir,
            env: process.env,
            logFile,
        })
        track(pid)
        expect(pid).toBeGreaterThan(0)
        expect(child).toBeDefined()
        expect(child.pid).toBe(pid)
        await harness.killProcess(pid)
    })
})

describe('raceReadyOrEarlyExit (ST-2)', () => {
    it('rejects fast with SERVICE_SPAWN_FAILED for a nonexistent command', async () => {
        const harness = await loadHarness()
        const logDir = mkdtempSync(join(tmpdir(), 'happy-harness-'))
        const logFile = join(logDir, 'svc.log')
        const { pid, child } = harness.spawnService('nonexistent-cmd-xyz-happy', [], {
            cwd: logDir,
            env: process.env,
            logFile,
        })
        if (pid) track(pid)

        const start = Date.now()
        // A never-resolving readyProbe: only the error branch can settle this.
        await expect(
            harness.raceReadyOrEarlyExit(child, 'server', logFile, () => new Promise<void>(() => {})),
        ).rejects.toThrow(/SERVICE_SPAWN_FAILED|failed to spawn/)
        expect(Date.now() - start).toBeLessThan(2000)
    })

    it('rejects with SERVICE_EXITED_EARLY (incl. exit code + log tail) when child dies before ready', async () => {
        const harness = await loadHarness()
        const logDir = mkdtempSync(join(tmpdir(), 'happy-harness-'))
        const logFile = join(logDir, 'svc.log')
        // node prints a marker then exits 3 before the probe ever succeeds.
        const { pid, child } = harness.spawnService(
            'node',
            ['-e', 'console.log("boot-marker-line"); process.exit(3)'],
            { cwd: logDir, env: process.env, logFile },
        )
        if (pid) track(pid)

        const start = Date.now()
        let caught: unknown
        try {
            await harness.raceReadyOrEarlyExit(child, 'server', logFile, () => new Promise<void>(() => {}))
        } catch (e) {
            caught = e
        }
        expect(Date.now() - start).toBeLessThan(3000)
        const message = caught instanceof Error ? caught.message : String(caught)
        expect(message).toMatch(/SERVICE_EXITED_EARLY|exited before ready/)
        expect(message).toContain('code=3')
        // Log tail should surface the child's stdout for diagnosis.
        expect(message).toContain('boot-marker-line')
    })

    it('resolves and removes listeners when readyProbe wins (no false early-exit on later exit)', async () => {
        const harness = await loadHarness()
        const logDir = mkdtempSync(join(tmpdir(), 'happy-harness-'))
        const logFile = join(logDir, 'svc.log')
        writeFileSync(logFile, '')
        // Long-lived child; probe resolves immediately.
        const { pid, child } = harness.spawnService('sh', ['-c', 'sleep 5'], {
            cwd: logDir,
            env: process.env,
            logFile,
        })
        track(pid)

        await expect(
            harness.raceReadyOrEarlyExit(child, 'server', logFile, async () => { /* ready now */ }),
        ).resolves.toBeUndefined()

        // After ready won, listeners must be detached: killing the child now
        // must NOT reject anything (no dangling SERVICE_EXITED_EARLY).
        let unhandled: unknown
        const onUnhandled = (e: unknown) => { unhandled = e }
        process.on('unhandledRejection', onUnhandled)
        await harness.killProcess(pid)
        await new Promise(r => setTimeout(r, 300))
        process.removeListener('unhandledRejection', onUnhandled)
        expect(unhandled).toBeUndefined()
    })
})
