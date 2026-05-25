const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

const monorepoRoot = path.resolve(__dirname, "../..");

const config = getDefaultConfig(__dirname, {
  // Enable CSS support for web
  isCSSEnabled: true,
});

// Expose monorepo root node_modules to Metro bundler.
// Required because pnpm hoists shared deps (e.g. expo-system-ui) to root
// node_modules, but Metro's watchFolders defaults to projectRoot only.
config.watchFolders = [monorepoRoot];

// Add support for .wasm files (required by Skia for all platforms)
// Source: https://shopify.github.io/react-native-skia/docs/getting-started/installation/
config.resolver.assetExts.push('wasm');

// Enable inlineRequires for proper Skia and Reanimated loading
// Source: https://shopify.github.io/react-native-skia/docs/getting-started/web/
// Without this, Skia throws "react-native-reanimated is not installed" error
// This is cross-platform compatible (iOS, Android, web)
config.transformer.getTransformOptions = async () => ({
  transform: {
    experimentalImportSupport: false,
    inlineRequires: true, // Critical for @shopify/react-native-skia
  },
});

module.exports = config;