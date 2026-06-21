const { withDangerousMod, IOSConfig } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

/**
 * Config plugin that renames the Xcode target from the default template name
 * "HelloWorld" to the variant-specific sanitized app name produced by prebuild.
 *
 * Background: Expo prebuild names the ios/ directory, .xcodeproj, scheme files
 * and PRODUCT_NAME after the sanitized app.config.js `name`
 * (IOSConfig.XcodeUtils.sanitizedName) — e.g. "Happy (dev)" → "Happydev",
 * "Happy" → "Happy". BUT the generated project's internal Xcode target name and
 * its path references stay as the template name "HelloWorld". The Podfile target
 * is likewise "HelloWorld". This mismatch makes react_native_post_install fail
 * because it builds paths like ios/HelloWorld/PrivacyInfo.xcprivacy that don't
 * exist. This plugin patches the Podfile and Xcode project after prebuild so the
 * target name matches the sanitized directory name for the current variant.
 *
 * oldName is fixed to "HelloWorld" (the template name embedded in the generated
 * project). Only newName is dynamic: it equals the actual prebuild directory name
 * = IOSConfig.XcodeUtils.sanitizedName(config.name).
 */
const withTargetName = (config) => {
    const oldName = 'HelloWorld';
    const newName = IOSConfig.XcodeUtils.sanitizedName(config.name);

    return withDangerousMod(config, [
        'ios',
        async (c) => {
            const iosDir = path.join(c.modRequest.projectRoot, 'ios');

            // 1. Patch Podfile: target 'HelloWorld' → target 'Happy'
            const podfilePath = path.join(iosDir, 'Podfile');
            if (fs.existsSync(podfilePath)) {
                let podfile = fs.readFileSync(podfilePath, 'utf8');
                if (podfile.includes(`target '${oldName}'`)) {
                    podfile = podfile.replace(
                        `target '${oldName}'`,
                        `target '${newName}'`
                    );
                    fs.writeFileSync(podfilePath, podfile, 'utf8');
                    console.log(`[withTargetName] Patched Podfile: target '${oldName}' → '${newName}'`);
                }
            }

            // 2. Patch Xcode project: rename HelloWorld file references to Happy
            const pbxprojPath = path.join(
                iosDir,
                `${newName}.xcodeproj`,
                'project.pbxproj'
            );
            if (fs.existsSync(pbxprojPath)) {
                let pbxproj = fs.readFileSync(pbxprojPath, 'utf8');
                const count = (pbxproj.match(new RegExp(oldName, 'g')) || []).length;
                if (count > 0) {
                    pbxproj = pbxproj.replaceAll(oldName, newName);
                    fs.writeFileSync(pbxprojPath, pbxproj, 'utf8');
                    console.log(`[withTargetName] Patched project.pbxproj: ${count} occurrences of '${oldName}' → '${newName}'`);
                }
            }

            // 3. Patch xcscheme files
            const schemesDir = path.join(iosDir, `${newName}.xcodeproj`, 'xcshareddata', 'xcschemes');
            if (fs.existsSync(schemesDir)) {
                for (const file of fs.readdirSync(schemesDir)) {
                    if (file.endsWith('.xcscheme')) {
                        const schemePath = path.join(schemesDir, file);
                        let scheme = fs.readFileSync(schemePath, 'utf8');
                        if (scheme.includes(oldName)) {
                            scheme = scheme.replaceAll(oldName, newName);
                            fs.writeFileSync(schemePath, scheme, 'utf8');
                            console.log(`[withTargetName] Patched xcscheme: ${file}`);
                        }
                    }
                }
            }

            // 4. Fix Info.plist: replace hardcoded CFBundleVersion "1" with $(CURRENT_PROJECT_VERSION)
            const infoPlistPath = path.join(iosDir, newName, 'Info.plist');
            if (fs.existsSync(infoPlistPath)) {
                let plist = fs.readFileSync(infoPlistPath, 'utf8');
                // Replace hardcoded build number with Xcode variable reference
                plist = plist.replace(
                    /<key>CFBundleVersion<\/key>\s*\n\s*<string>[^<]+<\/string>/,
                    '<key>CFBundleVersion</key>\n\t<string>$(CURRENT_PROJECT_VERSION)</string>'
                );
                fs.writeFileSync(infoPlistPath, plist, 'utf8');
                console.log(`[withTargetName] Patched Info.plist: CFBundleVersion → $(CURRENT_PROJECT_VERSION)`);
            }

            // 5. Rename ios/HelloWorld/ directory to ios/Happy/ if needed
            const oldDir = path.join(iosDir, oldName);
            const newDir = path.join(iosDir, newName);
            if (fs.existsSync(oldDir) && !fs.existsSync(newDir)) {
                fs.renameSync(oldDir, newDir);
                console.log(`[withTargetName] Renamed ios/${oldName}/ → ios/${newName}/`);
            }

            return c;
        },
    ]);
};

module.exports = withTargetName;
