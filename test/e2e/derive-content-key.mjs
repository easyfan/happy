#!/usr/bin/env node
/**
 * Derives the App's contentPublicKey from the master secret stored in localStorage.
 *
 * Usage:
 *   node derive-content-key.mjs --secret <base64url-encoded-secret>
 *
 * Outputs the Base64-encoded contentPublicKey to stdout.
 * This key can be passed to `happy auth upgrade --content-public-key <key>`.
 *
 * Key derivation matches the App's Encryption.create() path:
 *   masterSecret → deriveKey(master, 'Happy EnCoder', ['content']) → libsodiumPublicKeyFromSecretKey
 */

import { createHmac, createHash } from 'node:crypto';
import tweetnacl from '../../node_modules/tweetnacl/nacl-fast.js';

function decodeBase64Url(str) {
    const base64 = str.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - str.length % 4) % 4);
    return new Uint8Array(Buffer.from(base64, 'base64'));
}

function decodeBase64(str) {
    return new Uint8Array(Buffer.from(str, 'base64'));
}

function encodeBase64(buf) {
    return Buffer.from(buf).toString('base64');
}

function hmacSha512(key, data) {
    return new Uint8Array(createHmac('sha512', Buffer.from(key)).update(Buffer.from(data)).digest());
}

/** BIP32-style key derivation matching App's deriveKey() */
function deriveKey(master, usage, path) {
    // Root: HMAC-SHA512(key=usage+' Master Seed', data=master)
    let I = hmacSha512(new TextEncoder().encode(usage + ' Master Seed'), master);
    let state = { key: I.slice(0, 32), chainCode: I.slice(32) };

    for (const index of path) {
        // Child: HMAC-SHA512(key=chainCode, data=[0x00, ...index_bytes])
        const data = new Uint8Array([0x00, ...new TextEncoder().encode(index)]);
        I = hmacSha512(state.chainCode, data);
        state = { key: I.slice(0, 32), chainCode: I.slice(32) };
    }

    return state.key;
}

/** Matches CLI's libsodiumPublicKeyFromSecretKey (SHA512 clamping → curve25519) */
function libsodiumPublicKeyFromSecretKey(seed) {
    const hashed = new Uint8Array(createHash('sha512').update(Buffer.from(seed)).digest());
    const secretKey = hashed.slice(0, 32);
    return new Uint8Array(tweetnacl.box.keyPair.fromSecretKey(secretKey).publicKey);
}

const args = process.argv.slice(2);
const secretFlagIndex = args.indexOf('--secret');
if (secretFlagIndex === -1 || !args[secretFlagIndex + 1]) {
    console.error('Usage: node derive-content-key.mjs --secret <base64url-or-base64-secret>');
    process.exit(1);
}

const secretStr = args[secretFlagIndex + 1];
// Accept both base64url (from App localStorage) and plain base64
const masterSecret = secretStr.includes('-') || secretStr.includes('_')
    ? decodeBase64Url(secretStr)
    : decodeBase64(secretStr);

const contentDataKey = deriveKey(masterSecret, 'Happy EnCoder', ['content']);
const contentPublicKey = libsodiumPublicKeyFromSecretKey(contentDataKey);

process.stdout.write(encodeBase64(contentPublicKey));
