'use strict';

/**
 * Unit tests for Step 5 of withAndroidSigning.js:
 *   - package com.helloworld → correct namespace replacement
 *   - BuildConfig import insertion / idempotency
 *   - file-not-found skip
 *   - namespace-missing early return
 *
 * Uses Node.js built-in test runner (node:test) + assert — no extra deps needed.
 * Run with:  node packages/happy-app/plugins/withAndroidSigning.test.js
 */

const { test, describe, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const Module = require('module');

// ── Stub @expo/config-plugins so the CJS require() succeeds in plain Node ──
// withAppBuildGradle  → identity (not under test here)
// withDangerousMod    → captures [platform, callback] and returns the config unchanged;
//                       we'll extract the callback ourselves below.

let _capturedStep5Callback = null;

const originalLoad = Module._load.bind(Module);
Module._load = function (request, parent, isMain) {
    if (request === '@expo/config-plugins') {
        return {
            withAppBuildGradle: (_config, _fn) => _config,   // no-op for Steps 1-4
            withDangerousMod: (config, [platform, callback]) => {
                if (platform === 'android') {
                    _capturedStep5Callback = callback;        // capture Step 5
                }
                return config;
            },
        };
    }
    return originalLoad(request, parent, isMain);
};

// Require the plugin AFTER the stub is installed so it uses our fake module.
// The stub makes `withAndroidSigning` capture the inner callback without
// actually running any Expo machinery.
const withAndroidSigning = require('./withAndroidSigning');

// Restore Module._load so other tests in the process are unaffected.
Module._load = originalLoad;

// Trigger the plugin once with a dummy config to capture the callback.
withAndroidSigning({ android: { package: 'com.easyfan.happy' }, modRequest: {} });

// Confirm we successfully captured the Step 5 callback.
assert.ok(
    typeof _capturedStep5Callback === 'function',
    'Expected withDangerousMod callback to be captured'
);

const step5 = _capturedStep5Callback;

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Create a temp directory for this test run and return its path. */
function makeTmpDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'android-signing-test-'));
}

/**
 * Build the fake android project structure under tmpDir and write
 * MainActivity.kt and/or MainApplication.kt with the given content.
 *
 * Returns a config object whose shape matches what Step 5 reads:
 *   config.modRequest.platformProjectRoot  → tmpDir
 *   config.android.package                 → namespace
 */
function buildFakeConfig(tmpDir, namespace, files) {
    // e.g. com.easyfan.happy  →  com/easyfan/happy
    const namespaceDir = namespace.replace(/\./g, '/');
    const srcBase = path.join(
        tmpDir, 'app', 'src', 'main', 'java', namespaceDir
    );
    fs.mkdirSync(srcBase, { recursive: true });

    for (const [filename, content] of Object.entries(files)) {
        fs.writeFileSync(path.join(srcBase, filename), content, 'utf8');
    }

    return {
        modRequest: { platformProjectRoot: tmpDir },
        android: { package: namespace },
    };
}

/** Read a file from the fake project and return its content. */
function readFakeFile(tmpDir, namespace, filename) {
    const namespaceDir = namespace.replace(/\./g, '/');
    const srcBase = path.join(
        tmpDir, 'app', 'src', 'main', 'java', namespaceDir
    );
    return fs.readFileSync(path.join(srcBase, filename), 'utf8');
}

// ── Tests ─────────────────────────────────────────────────────────────────────

const NS = 'com.easyfan.happy';
const IMPORT_LINE = `import ${NS}.BuildConfig`;

describe('withAndroidSigning — Step 5', () => {

    // ── Case 1: package com.helloworld is replaced ────────────────────────────
    test('replaces package com.helloworld with the correct namespace', () => {
        const tmpDir = makeTmpDir();
        try {
            const originalContent =
                'package com.helloworld\n\nclass MainActivity : ReactActivity() {\n}\n';
            const config = buildFakeConfig(tmpDir, NS, {
                'MainActivity.kt': originalContent,
            });

            step5(config);

            const result = readFakeFile(tmpDir, NS, 'MainActivity.kt');
            assert.ok(
                result.includes(`package ${NS}`),
                'Package declaration should be updated to namespace'
            );
            assert.ok(
                !result.includes('package com.helloworld'),
                'Old package declaration must not remain'
            );
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    // ── Case 2: package already correct — no change ───────────────────────────
    test('does not alter the file when package is already the correct namespace', () => {
        const tmpDir = makeTmpDir();
        try {
            // Package is already correct AND import is already present.
            const originalContent =
                `package ${NS}\n${IMPORT_LINE}\n\nclass MainActivity : ReactActivity() {\n}\n`;
            const config = buildFakeConfig(tmpDir, NS, {
                'MainActivity.kt': originalContent,
            });

            // Record mtime before
            const namespaceDir = NS.replace(/\./g, '/');
            const filePath = path.join(
                tmpDir, 'app', 'src', 'main', 'java', namespaceDir, 'MainActivity.kt'
            );
            const mtimeBefore = fs.statSync(filePath).mtimeMs;

            step5(config);

            // File must not have been rewritten (no `changed` flag triggered)
            const result = readFakeFile(tmpDir, NS, 'MainActivity.kt');
            assert.strictEqual(result, originalContent, 'File content must be identical');

            // Mtime should not have changed (no writeFileSync called)
            const mtimeAfter = fs.statSync(filePath).mtimeMs;
            assert.strictEqual(mtimeAfter, mtimeBefore, 'File mtime must not change when no update needed');
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    // ── Case 3: import missing — inserts import after package line ────────────
    test('inserts BuildConfig import when it is missing', () => {
        const tmpDir = makeTmpDir();
        try {
            // Package already correct but no import yet.
            const originalContent =
                `package ${NS}\n\nclass MainActivity : ReactActivity() {\n}\n`;
            const config = buildFakeConfig(tmpDir, NS, {
                'MainActivity.kt': originalContent,
            });

            step5(config);

            const result = readFakeFile(tmpDir, NS, 'MainActivity.kt');
            assert.ok(
                result.includes(IMPORT_LINE),
                'BuildConfig import must be inserted'
            );
            // Import must appear right after the package declaration
            const lines = result.split('\n');
            const packageIdx = lines.findIndex(l => l.startsWith(`package ${NS}`));
            assert.strictEqual(
                lines[packageIdx + 1],
                IMPORT_LINE,
                'Import must be placed on the line immediately after the package declaration'
            );
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    // ── Case 4: import already exists — not duplicated ────────────────────────
    test('does not duplicate BuildConfig import when it already exists', () => {
        const tmpDir = makeTmpDir();
        try {
            const originalContent =
                `package ${NS}\n${IMPORT_LINE}\n\nclass MainActivity : ReactActivity() {\n}\n`;
            const config = buildFakeConfig(tmpDir, NS, {
                'MainActivity.kt': originalContent,
            });

            step5(config);

            const result = readFakeFile(tmpDir, NS, 'MainActivity.kt');
            const occurrences = result.split(IMPORT_LINE).length - 1;
            assert.strictEqual(occurrences, 1, 'Import must appear exactly once');
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    // ── Case 5: both package and import need fixing ───────────────────────────
    test('fixes both package com.helloworld and missing import in the same pass', () => {
        const tmpDir = makeTmpDir();
        try {
            const originalContent =
                'package com.helloworld\n\nclass MainApplication : Application() {\n}\n';
            const config = buildFakeConfig(tmpDir, NS, {
                'MainApplication.kt': originalContent,
            });

            step5(config);

            const result = readFakeFile(tmpDir, NS, 'MainApplication.kt');
            assert.ok(
                result.includes(`package ${NS}`),
                'Package name must be updated to namespace'
            );
            assert.ok(
                !result.includes('package com.helloworld'),
                'Old helloworld package must be gone'
            );
            assert.ok(
                result.includes(IMPORT_LINE),
                'BuildConfig import must be inserted'
            );
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    // ── Case 6: file does not exist — silently skipped ────────────────────────
    test('skips gracefully when the Kotlin source file does not exist', () => {
        const tmpDir = makeTmpDir();
        try {
            // Create the directory but NOT the files.
            const namespaceDir = NS.replace(/\./g, '/');
            fs.mkdirSync(
                path.join(tmpDir, 'app', 'src', 'main', 'java', namespaceDir),
                { recursive: true }
            );
            const config = {
                modRequest: { platformProjectRoot: tmpDir },
                android: { package: NS },
            };

            // Must not throw.
            assert.doesNotThrow(() => step5(config));
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    // ── Case 7: namespace not set — early return, nothing written ─────────────
    test('returns early without touching any file when android.package is falsy', () => {
        const tmpDir = makeTmpDir();
        try {
            // Write a file that would be modified if logic ran.
            const NS2 = 'com.easyfan.happy';
            const originalContent =
                'package com.helloworld\n\nclass MainActivity : ReactActivity() {\n}\n';
            // We put the file under NS2 layout so it WOULD be reachable if namespace were set.
            const namespaceDir = NS2.replace(/\./g, '/');
            const srcBase = path.join(
                tmpDir, 'app', 'src', 'main', 'java', namespaceDir
            );
            fs.mkdirSync(srcBase, { recursive: true });
            fs.writeFileSync(path.join(srcBase, 'MainActivity.kt'), originalContent, 'utf8');

            // Config with NO android.package
            const config = {
                modRequest: { platformProjectRoot: tmpDir },
                android: {},   // package is undefined → falsy
            };

            step5(config);

            // File must be unchanged since we returned early.
            const result = fs.readFileSync(path.join(srcBase, 'MainActivity.kt'), 'utf8');
            assert.strictEqual(result, originalContent, 'File must remain untouched when namespace is absent');
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    // ── Bonus: both MainActivity.kt and MainApplication.kt processed ──────────
    test('processes both MainActivity.kt and MainApplication.kt in one call', () => {
        const tmpDir = makeTmpDir();
        try {
            const makeContent = (cls) =>
                `package com.helloworld\n\nclass ${cls} {\n}\n`;

            const config = buildFakeConfig(tmpDir, NS, {
                'MainActivity.kt': makeContent('MainActivity'),
                'MainApplication.kt': makeContent('MainApplication'),
            });

            step5(config);

            for (const filename of ['MainActivity.kt', 'MainApplication.kt']) {
                const result = readFakeFile(tmpDir, NS, filename);
                assert.ok(
                    result.includes(`package ${NS}`),
                    `${filename}: package must be updated`
                );
                assert.ok(
                    result.includes(IMPORT_LINE),
                    `${filename}: BuildConfig import must be inserted`
                );
            }
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });
});
