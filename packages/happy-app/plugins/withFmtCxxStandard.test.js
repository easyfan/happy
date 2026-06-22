'use strict';

/**
 * Unit tests for withFmtCxxStandard.js — fmt -> C++17 Podfile config plugin
 * (TECH-XCODE265-02 方案B).
 *
 * Uses Node.js built-in test runner (node:test) + assert — no mocking of internal
 * modules; only @expo/config-plugins is stubbed via Module._load so the CJS
 * require() succeeds in plain Node. All fs operations run against a real tmpDir.
 *
 * Run with:  node packages/happy-app/plugins/withFmtCxxStandard.test.js
 *
 * Case 5 (parenthesis balancing over the nested ccache_enabled?(...) ) is the
 * spec_check sentinel: if the plugin ever regresses to indexOf(')'), Case 5 (and
 * Case 3) will fail because the snippet would be spliced INTO the argument list.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const Module = require('module');

// ── Stub @expo/config-plugins: capture the ios withDangerousMod callback ──
let _capturedIosCallback = null;
const originalLoad = Module._load.bind(Module);
Module._load = function (request, parent, isMain) {
    if (request === '@expo/config-plugins') {
        return {
            withDangerousMod: (config, [platform, callback]) => {
                if (platform === 'ios') _capturedIosCallback = callback;
                return config;
            },
        };
    }
    return originalLoad(request, parent, isMain);
};
// Require the plugin AFTER the stub is installed so it uses our fake module.
const withFmtCxxStandard = require('./withFmtCxxStandard');
Module._load = originalLoad;

// GUARD_MARKER literal — must match the one embedded in the plugin's SNIPPET.
const GUARD_MARKER = '[withFmtCxxStandard] fmt -> C++17';

// ── FIXTURE_PODFILE: verbatim copy of the real packages/happy-app/ios/Podfile
//    (65 lines), INCLUDING the L62 nested paren `ccache_enabled?(podfile_properties)`
//    and the single post_install block. This is the matchClosingParen命门夹具. ──
const FIXTURE_PODFILE = `# Set by expo-router. This enables Fabric-only features from react-native-screens
ENV['RNS_GAMMA_ENABLED'] ||= '1'
require File.join(File.dirname(\`node --print "require.resolve('expo/package.json')"\`), "scripts/autolinking")
require File.join(File.dirname(\`node --print "require.resolve('react-native/package.json')"\`), "scripts/react_native_pods")

require 'json'
podfile_properties = JSON.parse(File.read(File.join(__dir__, 'Podfile.properties.json'))) rescue {}

def ccache_enabled?(podfile_properties)
  # Environment variable takes precedence
  return ENV['USE_CCACHE'] == '1' if ENV['USE_CCACHE']

  # Fall back to Podfile properties
  podfile_properties['apple.ccacheEnabled'] == 'true'
end

ENV['EX_DEV_CLIENT_NETWORK_INSPECTOR'] ||= podfile_properties['EX_DEV_CLIENT_NETWORK_INSPECTOR']
ENV['RCT_USE_RN_DEP'] ||= '1' if podfile_properties['ios.buildReactNativeFromSource'] != 'true'
ENV['RCT_USE_PREBUILT_RNCORE'] ||= '1' if podfile_properties['ios.buildReactNativeFromSource'] != 'true'
ENV['RCT_HERMES_V1_ENABLED'] ||= '1' if podfile_properties['expo.useHermesV1'] == 'true'
platform :ios, podfile_properties['ios.deploymentTarget'] || '15.1'

prepare_react_native_project!

target 'Happydev' do
  use_expo_modules!

  if ENV['EXPO_USE_COMMUNITY_AUTOLINKING'] == '1'
    config_command = ['node', '-e', "process.argv=['', '', 'config'];require('@react-native-community/cli').run()"];
  else
    config_command = [
      'node',
      '--no-warnings',
      '--eval',
      'require(\\'expo/bin/autolinking\\')',
      'expo-modules-autolinking',
      'react-native-config',
      '--json',
      '--platform',
      'ios'
    ]
  end

  config = use_native_modules!(config_command)

  use_frameworks! :linkage => podfile_properties['ios.useFrameworks'].to_sym if podfile_properties['ios.useFrameworks']
  use_frameworks! :linkage => ENV['USE_FRAMEWORKS'].to_sym if ENV['USE_FRAMEWORKS']

  use_react_native!(
    :path => config[:reactNativePath],
    :hermes_enabled => podfile_properties['expo.jsEngine'] == nil || podfile_properties['expo.jsEngine'] == 'hermes',
    # An absolute path to your application root.
    :app_path => "#{Pod::Config.instance.installation_root}/..",
    :privacy_file_aggregation_enabled => podfile_properties['apple.privacyManifestAggregationEnabled'] != 'false',
  )

  post_install do |installer|
    react_native_post_install(
      installer,
      config[:reactNativePath],
      :mac_catalyst_enabled => false,
      :ccache_enabled => ccache_enabled?(podfile_properties),
    )
  end
end
`;

// ── Helpers ──────────────────────────────────────────────────────────────────
function makeTmpDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'withfmtcxx-test-'));
}

/** Write `contents` to tmpDir/ios/Podfile, return its path. */
function writePodfile(tmpDir, contents) {
    const iosDir = path.join(tmpDir, 'ios');
    fs.mkdirSync(iosDir, { recursive: true });
    const podfilePath = path.join(iosDir, 'Podfile');
    fs.writeFileSync(podfilePath, contents, 'utf8');
    return podfilePath;
}

function readPodfile(tmpDir) {
    return fs.readFileSync(path.join(tmpDir, 'ios', 'Podfile'), 'utf8');
}

/** Capture the ios callback and run it against tmpDir. */
async function runPlugin(tmpDir) {
    _capturedIosCallback = null;
    withFmtCxxStandard({});
    assert.ok(
        typeof _capturedIosCallback === 'function',
        'ios dangerous mod callback must be captured'
    );
    await _capturedIosCallback({ modRequest: { projectRoot: tmpDir } });
}

// Sanity: callback was captured at module load too.
assert.ok(typeof withFmtCxxStandard === 'function', 'plugin must export a function');

// ── Tests ─────────────────────────────────────────────────────────────────────
describe('withFmtCxxStandard', () => {

    // ── Case 1: injection correctness ─────────────────────────────────────────
    test('injects fmt -> C++17 snippet inside the post_install block', async () => {
        const tmpDir = makeTmpDir();
        try {
            writePodfile(tmpDir, FIXTURE_PODFILE);
            await runPlugin(tmpDir);

            const podfile = readPodfile(tmpDir);
            // ① target filter present
            assert.ok(
                podfile.includes("if target.name == 'fmt'"),
                "snippet must filter on target.name == 'fmt'"
            );
            // ② c++17 setting present
            assert.ok(
                podfile.includes("config.build_settings['CLANG_CXX_LANGUAGE_STANDARD'] = 'c++17'"),
                "snippet must set CLANG_CXX_LANGUAGE_STANDARD = c++17"
            );
            // ③ GUARD_MARKER present
            assert.ok(podfile.includes(GUARD_MARKER), 'GUARD_MARKER must be present');

            // ④ insertion ORDER: react_native_post_install call < GUARD_MARKER < block `end`.
            const rnpiIdx = podfile.indexOf('react_native_post_install(');
            const guardIdx = podfile.indexOf(GUARD_MARKER);
            // close paren of the react_native_post_install call (outermost) precedes guard
            const lastEndIdx = podfile.lastIndexOf('\n  end'); // post_install block end
            assert.ok(rnpiIdx !== -1 && guardIdx > rnpiIdx,
                'GUARD_MARKER must appear after the react_native_post_install call');
            assert.ok(guardIdx < lastEndIdx,
                'GUARD_MARKER must appear before the post_install block end (inside the block)');
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    // ── Case 2: idempotency — running twice does not duplicate ────────────────
    test('is idempotent — second run does not duplicate the snippet', async () => {
        const tmpDir = makeTmpDir();
        try {
            writePodfile(tmpDir, FIXTURE_PODFILE);
            await runPlugin(tmpDir);
            const after1 = readPodfile(tmpDir);

            await assert.doesNotReject(runPlugin(tmpDir));
            const after2 = readPodfile(tmpDir);

            // GUARD_MARKER appears exactly once.
            const occurrences = (after1.match(
                new RegExp(GUARD_MARKER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')
            ) || []).length;
            assert.strictEqual(occurrences, 1, 'GUARD_MARKER must appear exactly once');
            // Byte-identical: second run is a no-op.
            assert.strictEqual(after2, after1, 'second run must not change the file');
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    // ── Case 3: does not break the existing react_native_post_install call ────
    test('leaves the existing react_native_post_install call intact', async () => {
        const tmpDir = makeTmpDir();
        try {
            writePodfile(tmpDir, FIXTURE_PODFILE);
            await runPlugin(tmpDir);

            const podfile = readPodfile(tmpDir);
            // Original multi-line call (4 args + nested paren) must remain verbatim.
            const originalCall =
                "react_native_post_install(\n" +
                "      installer,\n" +
                "      config[:reactNativePath],\n" +
                "      :mac_catalyst_enabled => false,\n" +
                "      :ccache_enabled => ccache_enabled?(podfile_properties),\n" +
                "    )";
            assert.ok(
                podfile.includes(originalCall),
                'original react_native_post_install call must remain unbroken'
            );
            assert.ok(
                podfile.includes('post_install do |installer|'),
                'post_install block opener must remain'
            );
            // Nested paren expression must not be torn apart.
            assert.ok(
                podfile.includes('ccache_enabled?(podfile_properties)'),
                'nested ccache_enabled?(...) must remain intact'
            );
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    // ── Case 4: anchor missing → throws, file untouched ───────────────────────
    test('throws when the react_native_post_install anchor is missing', async () => {
        const tmpDir = makeTmpDir();
        try {
            const noAnchor = "platform :ios\ntarget 'Happy' do\nend\n";
            writePodfile(tmpDir, noAnchor);

            await assert.rejects(
                runPlugin(tmpDir),
                /anchor.*not found|NOT applied/
            );
            // File must be unchanged (no silent rewrite).
            assert.strictEqual(readPodfile(tmpDir), noAnchor,
                'Podfile must be unchanged when anchor is missing');
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    // ── Case 5: [REQUIRED] parenthesis balancing over nested ccache_enabled?(...) ─
    test('[required] balances parens, skipping the nested ccache_enabled?(...)', async () => {
        const tmpDir = makeTmpDir();
        try {
            writePodfile(tmpDir, FIXTURE_PODFILE);
            await runPlugin(tmpDir);

            const podfile = readPodfile(tmpDir);

            // The snippet (GUARD_MARKER) must be inserted AFTER the complete nested
            // ccache_enabled?(podfile_properties) expression — proving the matcher
            // skipped the inner ')' and landed on the OUTERMOST one.
            const nestedIdx = podfile.indexOf('ccache_enabled?(podfile_properties)');
            const guardIdx = podfile.indexOf(GUARD_MARKER);
            assert.ok(nestedIdx !== -1, 'nested ccache_enabled?(...) must exist in fixture');
            assert.ok(
                guardIdx > nestedIdx,
                'GUARD_MARKER must appear AFTER the nested ccache_enabled?(...) — ' +
                'a regression to indexOf(\')\') would insert it earlier, inside the args'
            );

            // The call tail structure (nested close + outer close) must be intact,
            // i.e. the outermost ')' was correctly chosen as the insertion point.
            assert.ok(
                podfile.includes('ccache_enabled?(podfile_properties),\n    )'),
                'call tail (nested paren + outer close paren) must be structurally intact'
            );

            // Independent re-derivation of the insertion math: the snippet must NOT
            // sit between the inner '(' and inner ')' of ccache_enabled?(...).
            const innerOpen = podfile.indexOf('ccache_enabled?(') + 'ccache_enabled?('.length - 1;
            const innerClose = podfile.indexOf(')', innerOpen);
            assert.ok(
                guardIdx > innerClose,
                'GUARD_MARKER must be beyond the inner close paren of ccache_enabled?(...)'
            );
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });
});
