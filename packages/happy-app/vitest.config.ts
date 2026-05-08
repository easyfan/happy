import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
    test: {
        globals: true,
        // Default environment for most tests is 'node'.
        // Tests that render React components (e.g. PermissionFooter.test.tsx)
        // use @vitest-environment jsdom in a per-file docblock comment to opt in.
        environment: 'node',
        include: ['sources/**/*.{spec,test}.{ts,tsx}'],
        setupFiles: [
            // Patches require.cache with a react-native shim before any test module
            // loads. This prevents the "Unexpected token 'typeof'" Flow-syntax error
            // from @testing-library/react-native's CJS require('react-native') calls
            // which bypass Vite's alias/mock system and go through Node's native CJS.
            './sources/dev/patchModuleCache.ts',
        ],
        coverage: {
            provider: 'v8',
            reporter: ['text', 'json', 'html'],
            exclude: [
                'node_modules/**',
                'dist/**',
                '**/*.d.ts',
                '**/*.config.*',
                '**/mockData/**',
            ],
        },
    },
    resolve: {
        // dedupe ensures only one copy of react and react-dom is used in tests,
        // preventing "Cannot read properties of null (reading 'useState')" errors
        // that occur when react-test-renderer uses a different React instance
        // than the component under test.
        dedupe: ['react', 'react-dom'],
        alias: [
            // More specific aliases must precede general ones.
            // Use libsodium-wrappers (pure JS/WASM) instead of the React Native
            // native module when running under Node.js (vitest). The crypto
            // algorithms are identical — only the delivery mechanism differs.
            { find: '@/encryption/libsodium.lib', replacement: resolve('./sources/encryption/libsodium.lib.web.ts') },
            // expo-crypto uses native modules in RN; shim it with Node.js crypto
            // so that encryptBox/decryptBox can generate random nonces in tests.
            { find: 'expo-crypto', replacement: resolve('./sources/dev/expoCryptoShim.ts') },
            // rn-encryption requires react-native (a native module) at import time.
            // Shim it so that the encryptor.ts module graph can be loaded in Node.js.
            // AES256Encryption tests are not part of this spec so stubs are fine.
            { find: 'rn-encryption', replacement: resolve('./sources/dev/rnEncryptionShim.ts') },
            // react-native uses Flow types that cannot be parsed by Node.js/esbuild.
            // This alias intercepts ESM imports from source files under test.
            // CJS require() calls from @testing-library/react-native are handled
            // by vi.mock('react-native', ...) in individual test files.
            { find: /^react-native$/, replacement: resolve('./sources/dev/reactNativeShim.ts') },
            // expo-localization uses native modules; shim returns English locale for tests.
            { find: 'expo-localization', replacement: resolve('./sources/dev/expoLocalizationShim.ts') },
            // @/sync/persistence uses MMKV native module; shim returns empty settings.
            { find: '@/sync/persistence', replacement: resolve('./sources/dev/persistenceShim.ts') },
            // General path alias
            { find: '@', replacement: resolve('./sources') },
        ],
    },
})
