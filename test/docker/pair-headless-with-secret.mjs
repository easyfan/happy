/**
 * Headless pairing script — authenticates as an EXISTING account (identified by
 * its secret key) and approves a CLI pairing request.
 *
 * Use this when the Web App account already exists (e.g. created via "Create Account"
 * in the browser) and you want the CLI to join the SAME account.
 *
 * Usage:
 *   node pair-headless-with-secret.mjs <SERVER_URL> <CLI_PUBLIC_KEY_BASE64URL> <APP_SECRET_BASE64URL>
 *
 * APP_SECRET_BASE64URL: the 32-byte master secret from localStorage['auth_credentials'].secret
 * CLI_PUBLIC_KEY_BASE64URL: from the QR URL  happy://terminal?{KEY}
 */

import { createRequire } from 'module';
import { randomBytes } from 'crypto';

const require = createRequire(import.meta.url);
const tweetnacl = require('tweetnacl');

const SERVER_URL = process.argv[2] || 'http://localhost:3005';
const CLI_PUBLIC_KEY_B64URL = process.argv[3];
const APP_SECRET_B64URL = process.argv[4];

if (!CLI_PUBLIC_KEY_B64URL || !APP_SECRET_B64URL) {
    console.error('Usage: node pair-headless-with-secret.mjs <SERVER_URL> <CLI_PUBLIC_KEY_BASE64URL> <APP_SECRET_BASE64URL>');
    process.exit(1);
}

function decodeBase64Url(str) {
    const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(base64.length + (4 - base64.length % 4) % 4, '=');
    return Buffer.from(padded, 'base64');
}

function encodeBase64(buf) {
    return Buffer.from(buf).toString('base64');
}

// Decode CLI's ephemeral public key from QR URL
const cliPublicKey = decodeBase64Url(CLI_PUBLIC_KEY_B64URL);
console.log(`[pair] CLI public key (${cliPublicKey.length} bytes): ${encodeBase64(cliPublicKey).slice(0, 20)}...`);

// Decode the app master secret (32-byte seed for sign keypair)
const appSecret = decodeBase64Url(APP_SECRET_B64URL);
console.log(`[pair] App secret (${appSecret.length} bytes)`);

// Derive the signing keypair from the secret seed
// This matches Web App: sodium.crypto_sign_seed_keypair(secret)
// tweetnacl equivalent: sign.keyPair.fromSeed(seed)
const appSignKeypair = tweetnacl.sign.keyPair.fromSeed(appSecret);

// Authenticate as this account — POST /v1/auth with challenge/signature
const challenge = randomBytes(32);
const signature = tweetnacl.sign.detached(challenge, appSignKeypair.secretKey);

console.log('[pair] Authenticating as existing account...');
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
    console.error('[pair] Failed to authenticate:', authData);
    process.exit(1);
}
const appToken = authData.token;
console.log(`[pair] Authenticated, token: ${appToken.slice(0, 20)}...`);

// Use app master secret as session secret — this way CLI and Web App share the same
// encryption key, so Web App can decrypt CLI session metadata (legacy encryption mode).
const sessionSecret = appSecret;
const ephemeralKeypair = tweetnacl.box.keyPair();
const nonce = tweetnacl.randomBytes(tweetnacl.box.nonceLength);
const encrypted = tweetnacl.box(sessionSecret, nonce, cliPublicKey, ephemeralKeypair.secretKey);

// Bundle: ephemeralPublicKey(32) + nonce(24) + ciphertext
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
