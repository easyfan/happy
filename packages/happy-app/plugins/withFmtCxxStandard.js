const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

/**
 * Config plugin: force the `fmt` Pod to compile with C++17 (instead of the
 * project-wide C++20) to work around a Xcode 26.5 / Apple clang 21 build failure.
 *
 * Background (TECH-XCODE265-02): fmt 11.0.2 (pinned transitively by RN 0.83.1 via
 * RCT-Folly) fails to compile under Apple clang 21 because its consteval-based
 * compile-time format-string checks hit a clang regression. Under C++17 there is
 * no consteval, so fmt falls back to RUNTIME format validation — no functional
 * regression, since RN/Expo never rely on fmt compile-time checks.
 *
 * Injection: appends a `installer.pods_project.targets.each` loop that sets
 * CLANG_CXX_LANGUAGE_STANDARD='c++17' ONLY for target.name == 'fmt', inserted
 * immediately AFTER the existing multi-line react_native_post_install(...) call,
 * staying inside the `post_install do |installer|` block (reuses `installer`).
 *
 * Why parenthesis-balancing (matchClosingParen) and not indexOf(')'): the real
 * Podfile's react_native_post_install call HAS a nested parenthesis in its
 * arguments — `:ccache_enabled => ccache_enabled?(podfile_properties)`. A plain
 * indexOf(')') would wrongly hit `podfile_properties)` and splice the snippet
 * INTO the argument list, breaking Ruby syntax. Balancing depth-counts ( ) and
 * lands on the OUTERMOST close paren, correctly skipping the nested one. This is
 * the same technique withAndroidSigning.js uses for {}-counting signingConfigs.
 *
 * TEMPORARY BRIDGE: remove this plugin file AND its app.config.js registration
 * line once RN is upgraded to 0.83.5 (ships fmt 12.1.0, TECH-XCODE265-03).
 */

// GUARD_MARKER must appear verbatim inside SNIPPET — the idempotency guard
// (podfile.includes(GUARD_MARKER)) keys off it.
const GUARD_MARKER = '[withFmtCxxStandard] fmt -> C++17';
const ANCHOR = 'react_native_post_install(';

const SNIPPET = `

    # ── ${GUARD_MARKER} ──  (GUARD_MARKER literal — drives idempotency check)
    # TEMPORARY WORKAROUND (TECH-XCODE265-02): fmt 11.0.2 (pinned by RN 0.83.1)
    # fails to compile under Apple clang 21 (Xcode 26.5) due to consteval
    # format-string checks. C++17 has no consteval -> fmt falls back to runtime
    # format validation (no functional regression). REMOVE this plugin + its
    # app.config.js registration once RN is upgraded to 0.83.5 (TECH-XCODE265-03).
    installer.pods_project.targets.each do |target|
      if target.name == 'fmt'
        target.build_configurations.each do |config|
          config.build_settings['CLANG_CXX_LANGUAGE_STANDARD'] = 'c++17'
        end
      end
    end`;

// From the open paren of react_native_post_install(, depth-count ( ) and return
// the index of the matching OUTERMOST close paren. Returns -1 if unbalanced.
function matchClosingParen(text, openParenIdx) {
    let depth = 0;
    for (let i = openParenIdx; i < text.length; i++) {
        if (text[i] === '(') depth++;
        else if (text[i] === ')') {
            depth--;
            if (depth === 0) return i;
        }
    }
    return -1;
}

const withFmtCxxStandard = (config) => {
    return withDangerousMod(config, [
        'ios',
        async (c) => {
            const podfilePath = path.join(c.modRequest.projectRoot, 'ios', 'Podfile');
            if (!fs.existsSync(podfilePath)) {
                console.warn('[withFmtCxxStandard] ios/Podfile not found — skipped');
                return c;
            }

            let podfile = fs.readFileSync(podfilePath, 'utf8');

            // 1) Idempotency guard (normal "already injected" path).
            if (podfile.includes(GUARD_MARKER)) {
                console.log('[withFmtCxxStandard] already injected — skip (idempotent)');
                return c;
            }

            // 2) Locate the OPEN paren of react_native_post_install(.
            const anchorIdx = podfile.indexOf(ANCHOR);
            if (anchorIdx === -1) {
                throw new Error(
                    "[withFmtCxxStandard] anchor 'react_native_post_install(' not found in " +
                    "ios/Podfile. The Expo/RN Podfile template may have changed. fmt C++17 " +
                    "patch was NOT applied — the Xcode 26.5 build will fail with the fmt " +
                    "consteval error. Update the ANCHOR constant in withFmtCxxStandard.js."
                );
            }
            const openParenIdx = anchorIdx + ANCHOR.length - 1; // index of '('

            // 3) Balance ( ) to find the OUTERMOST close paren (skips nested
            //    ccache_enabled?(...) — see file header rationale).
            const closeIdx = matchClosingParen(podfile, openParenIdx);
            if (closeIdx === -1) {
                throw new Error(
                    "[withFmtCxxStandard] no matching ')' for react_native_post_install( in " +
                    "ios/Podfile (file may be truncated or hand-edited). fmt C++17 patch was " +
                    "NOT applied."
                );
            }

            // 4) Insert the fmt-loop snippet right after that close paren — inside
            //    the post_install block, after the untouched react_native_post_install call.
            const insertAt = closeIdx + 1;
            podfile = podfile.slice(0, insertAt) + SNIPPET + podfile.slice(insertAt);

            fs.writeFileSync(podfilePath, podfile, 'utf8');
            console.log(
                '[withFmtCxxStandard] injected fmt -> C++17 into post_install ' +
                '(Xcode 26.5 consteval workaround)'
            );
            return c;
        },
    ]);
};

module.exports = withFmtCxxStandard;
