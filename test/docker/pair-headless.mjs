/**
 * Headless pairing script — simulates the Happy mobile app's auth response
 * without needing a real phone.
 *
 * Usage:
 *   node pair-headless.mjs <SERVER_URL> <CLI_PUBLIC_KEY_BASE64URL>
 *
 * The CLI_PUBLIC_KEY_BASE64URL comes from the QR code content:
 *   happy://terminal?<CLI_PUBLIC_KEY_BASE64URL>
 *
 * Outputs the paired token and secret so the test script can verify login.
 */

import { createRequire } from 'module';
import { randomBytes } from 'crypto';

const require = createRequire(import.meta.url);
const tweetnacl = require('tweetnacl');

const SERVER_URL = process.argv[2] || 'http://localhost:3005';
const CLI_PUBLIC_KEY_B64URL = process.argv[3];

if (!CLI_PUBLIC_KEY_B64URL) {
    console.error('Usage: node pair-headless.mjs <SERVER_URL> <CLI_PUBLIC_KEY_BASE64URL>');
    process.exit(1);
}

// Base64url decode
function decodeBase64Url(str) {
    const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(base64.length + (4 - base64.length % 4) % 4, '=');
    return Buffer.from(padded, 'base64');
}

// Base64 encode
function encodeBase64(buf) {
    return Buffer.from(buf).toString('base64');
}

// Decode CLI's ephemeral public key from QR code
const cliPublicKey = decodeBase64Url(CLI_PUBLIC_KEY_B64URL);
console.log(`[pair] CLI public key (${cliPublicKey.length} bytes): ${encodeBase64(cliPublicKey).slice(0, 20)}...`);

// Step 1: Create a test app account via /v1/auth
// Generate a sign keypair (simulates the mobile app's identity keypair)
const appSignKeypair = tweetnacl.sign.keyPair();
const challenge = randomBytes(32);
const signature = tweetnacl.sign.detached(challenge, appSignKeypair.secretKey);

console.log('[pair] Creating test app account...');
const authResp = await fetch(`${SERVER_URL}/v1/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
        publicKey: encodeBase64(appSignKeypair.publicKey),
        challenge: encodeBase64(challenge),
        signature: encodeBase64(signature)
    })
});
const authData = await authResp.json();
if (!authData.token) {
    console.error('[pair] Failed to create account:', authData);
    process.exit(1);
}
const appToken = authData.token;
console.log(`[pair] App account created, token: ${appToken.slice(0, 20)}...`);

// Step 2: Generate a random session secret (32 bytes)
// This is what the CLI will use as its encryption key
const sessionSecret = randomBytes(32);

// Step 3: Encrypt the secret with CLI's public key using NaCl box
// Format: [ephemeralPublicKey(32)] + [nonce(24)] + [encrypted]
const ephemeralKeypair = tweetnacl.box.keyPair();
const nonce = tweetnacl.randomBytes(tweetnacl.box.nonceLength);
const encrypted = tweetnacl.box(sessionSecret, nonce, cliPublicKey, ephemeralKeypair.secretKey);

// Bundle: ephemeral pubkey + nonce + ciphertext
const bundle = new Uint8Array(32 + 24 + encrypted.length);
bundle.set(ephemeralKeypair.publicKey, 0);
bundle.set(nonce, 32);
bundle.set(encrypted, 56);

console.log('[pair] Sending auth response to server...');
const responseResp = await fetch(`${SERVER_URL}/v1/auth/response`, {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${appToken}`
    },
    body: JSON.stringify({
        publicKey: encodeBase64(cliPublicKey),
        response: encodeBase64(bundle)
    })
});
const responseData = await responseResp.json();
if (!responseData.success) {
    console.error('[pair] Failed to send auth response:', responseData, 'HTTP:', responseResp.status);
    process.exit(1);
}

console.log('[pair] Auth response sent successfully!');
console.log('[pair] The CLI should now detect the authorization.');
console.log('');
console.log('SESSION_SECRET=' + encodeBase64(sessionSecret));
console.log('APP_TOKEN=' + appToken);
