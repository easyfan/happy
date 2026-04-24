#!/usr/bin/env node
/**
 * Pair CLI container with simulator app.
 *
 * Run after orchestrator.mjs has set up server + app.
 * Starts CLI container → captures happy://terminal? URL → sends via simctl openurl.
 */

import { spawn, execSync } from 'child_process';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const SERVER_PORT = 3005;
const SIMULATOR_UDID = '0BBFBABE-85B7-48B8-BE0D-3B2F5D5AABA1';
const CLI_IMAGE = 'happy-cli-test';
const CLI_CONTAINER = 'happy-e2e-cli';
const CLI_HOME = '/tmp/happy-e2e-cli-home';
const CLI_CONTAINER_HOME = '/root/.handy-test';

function log(msg) { console.log(`[pair-cli] ${msg}`); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function exec(cmd) { return execSync(cmd, { encoding: 'utf8' }).trim(); }

async function main() {
    if (!existsSync(join(CLI_HOME, 'access.key'))) {
        throw new Error(`CLI credentials not found at ${CLI_HOME}/access.key — run orchestrator.mjs first`);
    }

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
    ], { stdio: ['ignore', 'pipe', 'pipe'] });

    let output = '';
    proc.stdout.on('data', d => { output += d; process.stdout.write(`[cli] ${d}`); });
    proc.stderr.on('data', d => { output += d; process.stderr.write(`[cli] ${d}`); });

    log('Waiting for QR URL...');
    const qrUrl = await Promise.race([
        new Promise((resolve, reject) => {
            const check = setInterval(() => {
                const match = output.match(/happy:\/\/terminal\?([A-Za-z0-9_\-]+)/);
                if (match) { clearInterval(check); resolve(match[0]); }
            }, 300);
            proc.on('exit', code => {
                clearInterval(check);
                if (code !== 0) reject(new Error(`CLI exited with code ${code}`));
            });
        }),
        sleep(30000).then(() => { throw new Error('Timeout waiting for QR URL'); }),
    ]);

    log(`QR URL: ${qrUrl}`);
    log('Sending deep link to simulator...');
    exec(`xcrun simctl openurl ${SIMULATOR_UDID} "${qrUrl}"`);
    log('Deep link sent — app should show pairing confirmation.');

    // Wait for CLI to confirm pairing
    await Promise.race([
        new Promise((resolve) => {
            const check = setInterval(() => {
                if (output.includes('authenticated') || output.includes('paired') || output.includes('connected')) {
                    clearInterval(check); resolve();
                }
            }, 500);
        }),
        sleep(15000),
    ]);

    log('Done. CLI process continues running...');
    proc.on('exit', code => log(`CLI exited: ${code}`));
}

main().catch(e => { console.error(`[pair-cli] ERROR: ${e.message}`); process.exit(1); });
