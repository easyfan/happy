import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
    test: {
        globals: false,
        environment: 'node',
        include: ['sources/**/*.{spec,test}.ts'],
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
            // General path alias
            { find: '@', replacement: resolve('./sources') },
        ],
    },
})