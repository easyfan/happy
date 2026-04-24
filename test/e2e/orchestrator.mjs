#!/usr/bin/env node
/**
 * Happy E2E Test Orchestrator
 *
 * Full cycle: happy-server → CLI container → iOS simulator app (mobilemcp)
 *
 * Usage:
 *   node test/e2e/orchestrator.mjs
 *
 * Prerequisites:
 *   - Docker image happy-cli-test built
 *   - iPhone 13 Pro Max simulator booted (UDID: 0BBFBABE-85B7-48B8-BE0D-3B2F5D5AABA1)
 *   - happy-app installed on simulator
 */

import { spawn, execSync } from 'child_process';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { randomBytes } from 'crypto';

const require = createRequire(import.meta.url);
const tweetnacl = require('tweetnacl');

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');

// ── Config ────────────────────────────────────────────────────────────────────

const SERVER_PORT = 3005;
const SERVER_URL = `http://localhost:${SERVER_PORT}`;
const SIMULATOR_UDID = '0BBFBABE-85B7-48B8-BE0D-3B2F5D5AABA1';
const APP_BUNDLE_ID = 'com.slopus.happy.dev';
const CLI_IMAGE = 'happy-cli-test';
const CLI_CONTAINER = 'happy-e2e-cli';
const CLI_HOME = '/tmp/happy-e2e-cli-home';  // host path for CLI credentials
const CLI_CONTAINER_HOME = '/root/.handy-test';
const METRO_PORT = 8081;

// ── Helpers ───────────────────────────────────────────────────────────────────

function log(msg) { console.log(`[orchestrator] ${msg}`); }
function err(msg) { console.error(`[orchestrator] ERROR: ${msg}`); }

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function waitForUrl(url, timeoutMs = 30000, interval = 1000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        try {
            const res = await fetch(url);
            if (res.ok) return true;
        } catch { }
        await sleep(interval);
    }
    throw new Error(`Timeout waiting for ${url}`);
}

function exec(cmd, opts = {}) {
    return execSync(cmd, { encoding: 'utf8', ...opts }).trim();
}

function spawnBackground(cmd, args, env = {}) {
    return spawn(cmd, args, {
        env: { ...process.env, ...env },
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false,
    });
}

// ── Step 1: Start happy-server ────────────────────────────────────────────────

async function startServer() {
    log('Starting happy-server standalone:dev...');
    const server = spawnBackground('pnpm', ['standalone:dev'], {
        HANDY_MASTER_SECRET: 'e2e-test-secret',
        PORT: String(SERVER_PORT),
    });
    server.stdout.on('data', d => process.stdout.write(`[server] ${d}`));
    server.stderr.on('data', d => process.stderr.write(`[server] ${d}`));
    server.cwd = join(ROOT, 'packages/happy-server');

    // pnpm standalone:dev doesn't respect cwd from spawn options directly
    const serverProc = spawn('pnpm', ['standalone:dev'], {
        cwd: join(ROOT, 'packages/happy-server'),
        env: { ...process.env, HANDY_MASTER_SECRET: 'e2e-test-secret', PORT: String(SERVER_PORT) },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    serverProc.stdout.on('data', d => process.stdout.write(`[server] ${d}`));
    serverProc.stderr.on('data', d => process.stderr.write(`[server] ${d}`));

    await waitForUrl(`${SERVER_URL}/health`, 30000);
    log('Server ready.');
    return serverProc;
}

// ── Step 2: Create test account ───────────────────────────────────────────────

async function createAccount() {
    log('Creating test account...');
    const seed = randomBytes(32);
    const keypair = tweetnacl.sign.keyPair.fromSeed(seed);
    const challenge = randomBytes(32);
    const sig = tweetnacl.sign.detached(challenge, keypair.secretKey);

    const res = await fetch(`${SERVER_URL}/v1/auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            publicKey: Buffer.from(keypair.publicKey).toString('base64'),
            challenge: Buffer.from(challenge).toString('base64'),
            signature: Buffer.from(sig).toString('base64'),
        }),
    });
    const data = await res.json();
    if (!data.token) throw new Error(`Auth failed: ${JSON.stringify(data)}`);

    const token = data.token;
    const secret = Buffer.from(seed).toString('base64url');
    log(`Account created. Token: ${token.slice(0, 30)}...`);
    return { token, secret, seed };
}

// ── Step 3: Seed CLI credentials ──────────────────────────────────────────────

function seedCliCredentials(token, seed) {
    log('Seeding CLI credentials...');
    if (existsSync(CLI_HOME)) rmSync(CLI_HOME, { recursive: true });
    mkdirSync(CLI_HOME, { recursive: true });

    // Legacy format: {token, secret (base64)}
    const creds = {
        token,
        secret: Buffer.from(seed).toString('base64'),
    };
    writeFileSync(join(CLI_HOME, 'access.key'), JSON.stringify(creds, null, 2));
    log(`CLI creds written to ${CLI_HOME}/access.key`);
}

// ── Step 4: Start CLI container ───────────────────────────────────────────────

async function startCli() {
    log('Starting CLI container...');
    try { exec(`docker rm -f ${CLI_CONTAINER}`); } catch { }

    const proc = spawn('docker', [
        'run', '--rm',
        '--name', CLI_CONTAINER,
        '--add-host=host.docker.internal:host-gateway',
        '-e', `HAPPY_SERVER_URL=http://host.docker.internal:${SERVER_PORT}`,
        '-e', `HAPPY_HOME_DIR=${CLI_CONTAINER_HOME}`,
        '-e', 'ANTHROPIC_API_KEY=e2e-dummy',
        '-v', `${CLI_HOME}:${CLI_CONTAINER_HOME}`,
        CLI_IMAGE,
        // Start a session: just run echo for now as smoke test
        '--', 'echo', 'hello from happy e2e',
    ], { stdio: ['ignore', 'pipe', 'pipe'] });

    let output = '';
    proc.stdout.on('data', d => { output += d; process.stdout.write(`[cli] ${d}`); });
    proc.stderr.on('data', d => { output += d; process.stderr.write(`[cli] ${d}`); });

    // Wait for QR URL in output or pairing URL
    const qrUrl = await Promise.race([
        new Promise((resolve) => {
            const check = setInterval(() => {
                const match = output.match(/happy:\/\/terminal\?([A-Za-z0-9_\-]+)/);
                if (match) { clearInterval(check); resolve(match[0]); }
            }, 500);
        }),
        sleep(20000).then(() => null),
    ]);

    return { proc, qrUrl };
}

// ── Step 5: Pair CLI with app via deep link ───────────────────────────────────

async function pairWithApp(qrUrl) {
    if (!qrUrl) {
        log('No QR URL found — skipping deep link pairing');
        return;
    }
    log(`Pairing app via deep link: ${qrUrl}`);
    exec(`xcrun simctl openurl ${SIMULATOR_UDID} "${qrUrl}"`);
    await sleep(3000); // Let app handle the deep link
    log('Deep link sent.');
}

// ── Step 6: Restart Metro with credentials ────────────────────────────────────

async function restartMetro(token, secret) {
    log('Restarting Metro with test credentials...');
    try { exec('pkill -f "expo start"'); } catch { }
    try { exec(`lsof -ti:${METRO_PORT} | xargs kill -9`); } catch { }
    await sleep(2000);

    const metro = spawn('npx', ['expo', 'start', '--port', String(METRO_PORT)], {
        cwd: join(ROOT, 'packages/happy-app'),
        env: {
            ...process.env,
            EXPO_PUBLIC_DEV_TOKEN: token,
            EXPO_PUBLIC_DEV_SECRET: secret,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    metro.stdout.on('data', d => process.stdout.write(`[metro] ${d}`));
    metro.stderr.on('data', d => process.stderr.write(`[metro] ${d}`));

    await waitForUrl(`http://localhost:${METRO_PORT}/status`, 30000);
    log('Metro ready.');
    return metro;
}

// ── Step 7: Relaunch app ──────────────────────────────────────────────────────

async function relaunchApp() {
    log('Relaunching app on simulator...');
    try { exec(`xcrun simctl terminate ${SIMULATOR_UDID} ${APP_BUNDLE_ID}`); } catch { }
    await sleep(1000);
    exec(`xcrun simctl launch ${SIMULATOR_UDID} ${APP_BUNDLE_ID}`);
    await sleep(8000); // Wait for bundle load
    log('App launched.');
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
    log('=== Happy E2E Orchestrator ===');

    // Kill any leftover server/metro
    try { exec(`lsof -ti:${SERVER_PORT} | xargs kill -9`); } catch { }
    try { exec('pkill -f "expo start"'); } catch { }
    try { exec(`lsof -ti:${METRO_PORT} | xargs kill -9`); } catch { }
    await sleep(1000);

    const serverProc = await startServer();
    const { token, secret, seed } = await createAccount();
    seedCliCredentials(token, seed);
    const metroProc = await restartMetro(token, secret);
    await relaunchApp();

    log('');
    log('=== Setup complete ===');
    log(`Server:  ${SERVER_URL}`);
    log(`Account: token=${token.slice(0, 30)}...`);
    log(`App:     ${APP_BUNDLE_ID} on ${SIMULATOR_UDID}`);
    log('');
    log('App should now be logged in. Run CLI pairing next with:');
    log(`  node test/e2e/pair-cli.mjs`);

    // Keep server + metro alive
    process.on('SIGINT', () => {
        log('Shutting down...');
        serverProc.kill();
        metroProc.kill();
        process.exit(0);
    });
}

main().catch(e => { err(e.message); process.exit(1); });
