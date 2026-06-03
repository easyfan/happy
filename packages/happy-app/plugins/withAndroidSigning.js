const { withAppBuildGradle, withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

/**
 * Config plugin that configures Android release signing and fixes common build issues.
 *
 * Steps:
 *   1. Injects Groovy loader code before the android{} block
 *   2. Adds a 'release' signingConfig as a sibling of 'debug' (brace-counting)
 *   3. Switches the release buildType from signingConfigs.debug → .release
 *   4. Enables BuildConfig generation (disabled by default in AGP 8+)
 *   5. Patches MainActivity.kt + MainApplication.kt to add explicit
 *      BuildConfig import (Expo template uses 'package com.helloworld' but
 *      the namespace/BuildConfig is com.easyfan.happy — without the import,
 *      compileReleaseKotlin fails with "Unresolved reference 'BuildConfig'")
 */
module.exports = function withAndroidSigning(config) {
    // ── Steps 1-4: patch build.gradle ──
    config = withAppBuildGradle(config, (config) => {
        let contents = config.modResults.contents;

        // 1. Inject keystore properties loader before the android{} block
        const LOADER_BLOCK = `
// Load production keystore credentials from ~/.handy/happy-android.keystore.properties
// This file is NOT committed to version control.
def keystorePropertiesFile = new File(System.getProperty('user.home') + '/.handy/happy-android.keystore.properties')
def keystoreProperties = new Properties()
if (keystorePropertiesFile.exists()) {
    keystoreProperties.load(new FileInputStream(keystorePropertiesFile))
}

`;

        if (!contents.includes('happy-android.keystore.properties')) {
            contents = contents.replace('android {', LOADER_BLOCK + 'android {');
        }

        // 2. Add 'release' signingConfig using brace-counting
        if (!contents.includes("signingConfig signingConfigs.release")) {
            const marker = 'signingConfigs {';
            const markerIdx = contents.indexOf(marker);
            if (markerIdx !== -1) {
                let depth = 0;
                let closingIdx = -1;
                for (let i = markerIdx; i < contents.length; i++) {
                    if (contents[i] === '{') depth++;
                    else if (contents[i] === '}') {
                        depth--;
                        if (depth === 0) { closingIdx = i; break; }
                    }
                }
                if (closingIdx !== -1) {
                    const RELEASE_SIGNING = `
        release {
            if (keystorePropertiesFile.exists()) {
                storeFile file(keystoreProperties['storeFile'])
                storePassword keystoreProperties['storePassword']
                keyAlias keystoreProperties['keyAlias']
                keyPassword keystoreProperties['keyPassword']
            }
        }`;
                    contents = contents.slice(0, closingIdx) + RELEASE_SIGNING + '\n    ' + contents.slice(closingIdx);
                }
            }
        }

        // 3. Switch release buildType to signingConfigs.release
        contents = contents.replace(
            /(\s*\/\/\s*Caution![\s\S]*?see[\s\S]*?\n\s*)signingConfig signingConfigs\.debug/,
            '$1signingConfig signingConfigs.release'
        );

        // 4. Enable BuildConfig generation (disabled by default in AGP 8+)
        if (!contents.includes('buildConfig = true')) {
            contents = contents.replace(
                'buildTypes {',
                'buildFeatures {\n        buildConfig = true\n    }\n    buildTypes {'
            );
        }

        config.modResults.contents = contents;
        return config;
    });

    // ── Step 5: patch Kotlin source files to add explicit BuildConfig import ──
    // Expo template generates MainActivity.kt/MainApplication.kt with
    // 'package com.helloworld', but the namespace (and BuildConfig) is the
    // app's actual package (e.g. com.easyfan.happy). Without an explicit import,
    // compileReleaseKotlin fails with "Unresolved reference 'BuildConfig'".
    config = withDangerousMod(config, [
        'android',
        (config) => {
            const androidDir = config.modRequest.platformProjectRoot;
            const namespace = config.android?.package;
            if (!namespace) return config;

            const namespaceDir = namespace.replace(/\./g, '/');
            const srcBase = path.join(androidDir, 'app', 'src', 'main', 'java', namespaceDir);
            const importLine = `import ${namespace}.BuildConfig`;

            for (const filename of ['MainActivity.kt', 'MainApplication.kt']) {
                const filePath = path.join(srcBase, filename);
                if (!fs.existsSync(filePath)) continue;

                let content = fs.readFileSync(filePath, 'utf8');

                // Fix package name: expo template generates 'package com.helloworld'
                // but the correct namespace is the app's actual package
                let changed = false;
                if (content.includes('package com.helloworld')) {
                    content = content.replace('package com.helloworld', `package ${namespace}`);
                    // Also remove the stale BuildConfig import if it was added in a previous run
                    // (it will be re-added below without the now-redundant explicit import,
                    //  since package and namespace match — but keep it for safety)
                    changed = true;
                    console.log(`[withAndroidSigning] Fixed package name in ${filename}: com.helloworld → ${namespace}`);
                }

                if (!content.includes(importLine)) {
                    // Insert import right after the package declaration line
                    content = content.replace(
                        /^(package [^\n]+\n)/,
                        `$1${importLine}\n`
                    );
                    changed = true;
                }

                if (!changed) continue;
                fs.writeFileSync(filePath, content, 'utf8');
                console.log(`[withAndroidSigning] Patched ${filename}`);
            }

            return config;
        },
    ]);

    return config;
};
