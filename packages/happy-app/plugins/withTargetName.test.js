'use strict';

/**
 * Unit tests for withTargetName.js — variant-aware Xcode target renaming.
 *
 * Verifies that newName is derived from IOSConfig.XcodeUtils.sanitizedName(config.name)
 * so the plugin patches the correct files for each build variant:
 *   - "Happy (dev)"     → Happydev
 *   - "Happy (preview)" → Happypreview
 *   - "Happy"           → Happy   (production regression anchor)
 * plus idempotency and the ios/HelloWorld → ios/<newName> directory rename fallback.
 *
 * Uses Node.js built-in test runner (node:test) + assert — no extra deps, no mocks.
 * The @expo/config-plugins module is stubbed at the boundary only; the real IOSConfig
 * (and thus the real sanitizedName) is passed through so the test exercises the same
 * sanitize function production uses.
 * Run with:  node packages/happy-app/plugins/withTargetName.test.js
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const Module = require('module');

// ── Stub @expo/config-plugins boundary ──────────────────────────────────────
// IOSConfig         → pass through the REAL one (sanitizedName is under test).
// withDangerousMod  → captures [platform, callback] and returns config unchanged.
const realConfigPlugins = require('@expo/config-plugins');

let _capturedIosCallback = null;

const originalLoad = Module._load.bind(Module);
Module._load = function (request, parent, isMain) {
    if (request === '@expo/config-plugins') {
        return {
            IOSConfig: realConfigPlugins.IOSConfig,        // real sanitizedName
            withDangerousMod: (config, [platform, callback]) => {
                if (platform === 'ios') {
                    _capturedIosCallback = callback;
                }
                return config;
            },
        };
    }
    return originalLoad(request, parent, isMain);
};

// Require the plugin AFTER the stub is installed so it uses our fake module.
const withTargetName = require('./withTargetName');

// Restore Module._load so other tests in the process are unaffected.
Module._load = originalLoad;

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Create a temp directory for this test run and return its path. */
function makeTmpDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'withtargetname-test-'));
}

/**
 * Build a mini prebuild artifact mirroring real prebuild output, where the
 * directory / project are named after the sanitized app name but the internal
 * Xcode target + path references still use the template name "HelloWorld".
 *   sanitized = expected newName (e.g. 'Happydev' / 'Happy')
 */
function buildFakeIosProject(tmpDir, sanitized) {
    const iosDir = path.join(tmpDir, 'ios');
    const xcodeproj = path.join(iosDir, `${sanitized}.xcodeproj`);
    const schemesDir = path.join(xcodeproj, 'xcshareddata', 'xcschemes');
    const appDir = path.join(iosDir, sanitized);
    fs.mkdirSync(schemesDir, { recursive: true });
    fs.mkdirSync(appDir, { recursive: true });

    // Podfile: target still uses the template name HelloWorld (empirical).
    const podfilePath = path.join(iosDir, 'Podfile');
    fs.writeFileSync(podfilePath,
        "require_relative '../node_modules/...'\n\ntarget 'HelloWorld' do\n  use_expo_modules!\nend\n",
        'utf8');

    // pbxproj: internal target/path use HelloWorld; PRODUCT_NAME already sanitized.
    const pbxprojPath = path.join(xcodeproj, 'project.pbxproj');
    fs.writeFileSync(pbxprojPath,
        '/* HelloWorld target */\n' +
        'PRODUCT_NAME = ' + sanitized + ';\n' +
        'name = HelloWorld;\n' +
        'path = HelloWorld/Info.plist;\n' +
        'productName = HelloWorld;\n' +
        'HelloWorld.app;\n',
        'utf8');

    // xcscheme: contains HelloWorld references.
    const schemePath = path.join(schemesDir, `${sanitized}.xcscheme`);
    fs.writeFileSync(schemePath,
        '<Scheme><BuildableReference BlueprintName="HelloWorld" ' +
        'BuildableName="HelloWorld.app"></BuildableReference></Scheme>\n',
        'utf8');

    // Info.plist: hardcoded CFBundleVersion 1.
    const infoPlistPath = path.join(appDir, 'Info.plist');
    fs.writeFileSync(infoPlistPath,
        '<plist><dict>\n\t<key>CFBundleVersion</key>\n\t<string>1</string>\n</dict></plist>\n',
        'utf8');

    return { iosDir, podfilePath, pbxprojPath, schemePath, infoPlistPath };
}

/**
 * Call the plugin for a given app name: newName = sanitizedName(name) is computed
 * at the plugin entry, the ios dangerous mod is registered & captured, then its
 * callback is executed against the fake project rooted at tmpDir.
 */
async function runPlugin(name, tmpDir) {
    _capturedIosCallback = null;
    withTargetName({ name });
    assert.ok(typeof _capturedIosCallback === 'function',
        'ios dangerous mod callback must be captured');
    await _capturedIosCallback({ modRequest: { projectRoot: tmpDir } });
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('withTargetName — variant-aware target rename', () => {

    // ── Case 1: dev variant ───────────────────────────────────────────────────
    test('dev variant: sanitizes "Happy (dev)" to Happydev and patches all files', async () => {
        const tmpDir = makeTmpDir();
        try {
            const f = buildFakeIosProject(tmpDir, 'Happydev');
            await runPlugin('Happy (dev)', tmpDir);

            assert.match(fs.readFileSync(f.podfilePath, 'utf8'), /target 'Happydev'/);
            const pbx = fs.readFileSync(f.pbxprojPath, 'utf8');
            assert.ok(!pbx.includes('HelloWorld'), 'pbxproj must have no HelloWorld');
            assert.ok(pbx.includes('Happydev'), 'pbxproj must reference Happydev');
            assert.ok(!fs.readFileSync(f.schemePath, 'utf8').includes('HelloWorld'),
                'scheme must have no HelloWorld');
            assert.match(fs.readFileSync(f.infoPlistPath, 'utf8'),
                /<string>\$\(CURRENT_PROJECT_VERSION\)<\/string>/);
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    // ── Case 2: preview variant ───────────────────────────────────────────────
    test('preview variant: sanitizes "Happy (preview)" to Happypreview and patches all files', async () => {
        const tmpDir = makeTmpDir();
        try {
            const f = buildFakeIosProject(tmpDir, 'Happypreview');
            await runPlugin('Happy (preview)', tmpDir);

            assert.match(fs.readFileSync(f.podfilePath, 'utf8'), /target 'Happypreview'/);
            const pbx = fs.readFileSync(f.pbxprojPath, 'utf8');
            assert.ok(!pbx.includes('HelloWorld'), 'pbxproj must have no HelloWorld');
            assert.ok(pbx.includes('Happypreview'), 'pbxproj must reference Happypreview');
            assert.ok(!fs.readFileSync(f.schemePath, 'utf8').includes('HelloWorld'),
                'scheme must have no HelloWorld');
            assert.match(fs.readFileSync(f.infoPlistPath, 'utf8'),
                /<string>\$\(CURRENT_PROJECT_VERSION\)<\/string>/);
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    // ── Case 3: production variant (regression anchor) ─────────────────────────
    test('production variant: "Happy" stays Happy (regression anchor)', async () => {
        // Lock the source-of-truth: sanitizedName('Happy') must be byte-identical 'Happy'.
        assert.strictEqual(realConfigPlugins.IOSConfig.XcodeUtils.sanitizedName('Happy'), 'Happy');

        const tmpDir = makeTmpDir();
        try {
            const f = buildFakeIosProject(tmpDir, 'Happy');
            await runPlugin('Happy', tmpDir);

            assert.match(fs.readFileSync(f.podfilePath, 'utf8'), /target 'Happy'/);
            const pbx = fs.readFileSync(f.pbxprojPath, 'utf8');
            // Strong anchor: the internal target name MUST have been changed.
            assert.ok(pbx.includes('name = Happy;'), 'pbxproj target name must become Happy');
            assert.ok(!pbx.includes('HelloWorld'), 'pbxproj must have no HelloWorld');
            assert.ok(!fs.readFileSync(f.schemePath, 'utf8').includes('HelloWorld'),
                'scheme must have no HelloWorld');
            assert.match(fs.readFileSync(f.infoPlistPath, 'utf8'),
                /<string>\$\(CURRENT_PROJECT_VERSION\)<\/string>/);
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    // ── Case 4: idempotency ────────────────────────────────────────────────────
    test('idempotent: running twice does not corrupt or throw', async () => {
        const tmpDir = makeTmpDir();
        try {
            const f = buildFakeIosProject(tmpDir, 'Happydev');
            await runPlugin('Happy (dev)', tmpDir);
            const after1 = {
                podfile: fs.readFileSync(f.podfilePath, 'utf8'),
                pbx: fs.readFileSync(f.pbxprojPath, 'utf8'),
                scheme: fs.readFileSync(f.schemePath, 'utf8'),
                info: fs.readFileSync(f.infoPlistPath, 'utf8'),
            };

            await assert.doesNotReject(runPlugin('Happy (dev)', tmpDir));

            // Step 4 Info.plist has no `includes` guard: the second run re-matches
            // $(CURRENT_PROJECT_VERSION) via [^<]+ and replaces it with the same
            // value, so content stays identical (idempotent by self-replacement).
            assert.strictEqual(fs.readFileSync(f.podfilePath, 'utf8'), after1.podfile);
            assert.strictEqual(fs.readFileSync(f.pbxprojPath, 'utf8'), after1.pbx);
            assert.strictEqual(fs.readFileSync(f.schemePath, 'utf8'), after1.scheme);
            assert.strictEqual(fs.readFileSync(f.infoPlistPath, 'utf8'), after1.info);
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    // ── Case 5: directory rename fallback ──────────────────────────────────────
    test('directory rename fallback: ios/HelloWorld -> ios/Happy when target dir absent', async () => {
        const tmpDir = makeTmpDir();
        try {
            buildFakeIosProject(tmpDir, 'Happy');        // creates ios/Happy/
            const iosDir = path.join(tmpDir, 'ios');
            // Remove the sanitized app dir and create ios/HelloWorld/ to trigger Step 5.
            fs.rmSync(path.join(iosDir, 'Happy'), { recursive: true, force: true });
            fs.mkdirSync(path.join(iosDir, 'HelloWorld'), { recursive: true });

            await runPlugin('Happy', tmpDir);

            assert.ok(fs.existsSync(path.join(iosDir, 'Happy')), 'ios/Happy must exist');
            assert.ok(!fs.existsSync(path.join(iosDir, 'HelloWorld')), 'ios/HelloWorld must be gone');
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });
});
