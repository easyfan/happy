// vitest setupFiles entry.
//
// This module runs in the vitest worker BEFORE any test file is loaded.
// It patches Node.js module cache so that require('react-native') returns our
// shim instead of the real package — preventing the "Unexpected token 'typeof'"
// Flow-syntax error that occurs when Node.js tries to parse react-native's
// index.js (which contains Flow-only `import typeof` syntax).
//
// This is necessary because @testing-library/react-native is a pre-built CJS
// package that uses the native Node.js require() loader which bypasses Vite's
// module graph (and therefore bypasses resolve.alias and vi.mock hoisting).
//
// Resolution order: setupFiles runs before the test worker creates its module
// cache. We populate require.cache with our shim keyed to react-native's
// actual resolved path, so that when TNRL does require('react-native') it hits
// the cached version (our shim) instead of loading the real file.

import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import * as ReactAll from 'react';
const React = ReactAll;
import { vi } from 'vitest';

const _require = createRequire(import.meta.url);
// Also create a resolver relative to the monorepo root to find root-level react-native.
// @testing-library/react-native lives at <root>/node_modules/@testing-library/...,
// so its require('react-native') resolves from the root, not packages/happy-app.
const _requireFromRoot = createRequire(resolve('../../node_modules/@testing-library/react-native/package.json'));
console.log('[patchModuleCache] setupFile starting, require.cache type:', typeof (require as any)?.cache);

// Resolve the real react-native entry path so we can register the shim under
// that exact key in require.cache.
// We need both paths because pnpm hoisting may result in two react-native installs:
// one at packages/happy-app/node_modules (used by vite-node's ESM imports from source
// files), and one at the monorepo root node_modules (used by @testing-library/react-native
// which resolves react-native from its own location in <root>/node_modules).
const reactNativePaths: string[] = [];
try {
    const p = _require.resolve('react-native');
    reactNativePaths.push(p);
} catch {
    // skip
}
try {
    const p = _requireFromRoot.resolve('react-native');
    if (!reactNativePaths.includes(p)) reactNativePaths.push(p);
} catch {
    // skip
}
// Keep old single variable for compatibility below
const reactNativePath = reactNativePaths[0] ?? '';

const Module = _require('node:module') as any;
const cache = (require as any).cache as Record<string, any>;

function patchCache(id: string, exports: any) {
    const mockModule = new Module(id);
    mockModule.exports = exports;
    mockModule.loaded = true;
    mockModule.filename = id;
    mockModule.paths = [];
    cache[id] = mockModule;
    (_require as any).cache[id] = mockModule;
}

// ── Patch react-native ──────────────────────────────────────────────────────
if (reactNativePaths.length > 0) {
    const shimExports = buildShim(React);
    for (const rnPath of reactNativePaths) {
        patchCache(rnPath, shimExports);
        console.log('[patchModuleCache] patched react-native at', rnPath);
    }
} else {
    console.log('[patchModuleCache] could not resolve react-native, skipping patch');
}

// ── Patch react (deduplicate instances) ─────────────────────────────────────
// react-test-renderer (a CJS package at <root>/node_modules/) may resolve 'react'
// to a DIFFERENT path than the source files processed by vite-node
// (packages/happy-app/node_modules/react). When they differ, hooks like useState
// fail with "Cannot read properties of null (reading 'useState')".
// Patching require.cache for ALL react paths ensures every CJS package that
// does require('react') gets the exact same singleton instance.
const reactPaths: string[] = [];
try { reactPaths.push(_require.resolve('react')); } catch { /* skip */ }
try {
    const p = _requireFromRoot.resolve('react');
    if (!reactPaths.includes(p)) reactPaths.push(p);
} catch { /* skip */ }
try {
    // react-test-renderer's require('react') resolves from its own directory
    const _requireFromRtr = createRequire(
        _require.resolve('react-test-renderer') || '',
    );
    const p = _requireFromRtr.resolve('react');
    if (!reactPaths.includes(p)) reactPaths.push(p);
} catch { /* skip */ }

// Load the canonical React object via _require (which goes through vite-node's
// module resolution) so that we get the same instance used by source files.
const reactExports = (ReactAll as any).default ?? ReactAll;

for (const rPath of reactPaths) {
    patchCache(rPath, reactExports);
    console.log('[patchModuleCache] patched react at', rPath);
}

console.log('[patchModuleCache] total require.cache keys:', Object.keys(cache).length);

function buildShim(React: any) {
    const View = ({ children, style, testID, ...rest }: any) =>
        React.createElement('View', { style, testID, ...rest }, children);

    const Text = ({ children, style, testID, numberOfLines, ellipsizeMode, ...rest }: any) =>
        React.createElement('Text', { style, testID, numberOfLines, ellipsizeMode, ...rest }, children);

    const TouchableOpacity = ({ children, style, onPress, disabled, activeOpacity, testID, ...rest }: any) =>
        React.createElement('TouchableOpacity', { style, onPress, disabled, activeOpacity, testID, ...rest }, children);

    const ActivityIndicator = ({ size, color, style, testID, ...rest }: any) =>
        React.createElement('ActivityIndicator', { size, color, style, testID, ...rest });

    const Pressable = ({ children, style, onPress, disabled, testID, ...rest }: any) =>
        React.createElement('Pressable', { style, onPress, disabled, testID, ...rest },
            typeof children === 'function' ? children({ pressed: false }) : children);

    const ScrollView = ({ children, style, testID, ...rest }: any) =>
        React.createElement('ScrollView', { style, testID, ...rest }, children);

    const Image = ({ style, source, testID, ...rest }: any) =>
        React.createElement('Image', { style, source, testID, ...rest });

    const TextInput = ({ style, value, onChangeText, testID, ...rest }: any) =>
        React.createElement('TextInput', { style, value, onChangeText, testID, ...rest });

    const StyleSheet = {
        create: (s: any) => s,
        hairlineWidth: 1,
        absoluteFill: { position: 'absolute' as const, top: 0, right: 0, bottom: 0, left: 0 },
        absoluteFillObject: { position: 'absolute' as const, top: 0, right: 0, bottom: 0, left: 0 },
        flatten: (s: any) => (Array.isArray(s) ? Object.assign({}, ...s.filter(Boolean)) : s ?? {}),
    };

    const Platform = {
        OS: 'ios',
        Version: '17.0',
        select: (obj: any) => obj.ios ?? obj.default,
        isPad: false,
        isTVOS: false,
    };

    const Alert = { alert: vi.fn() };
    const Keyboard = { dismiss: vi.fn(), addListener: vi.fn(() => ({ remove: vi.fn() })) };

    return {
        __esModule: true,
        default: { View, Text, TouchableOpacity, ActivityIndicator, Pressable, ScrollView, Image, TextInput, StyleSheet, Platform, Alert, Keyboard },
        View, Text, TouchableOpacity, ActivityIndicator, Pressable, ScrollView, Image, TextInput, StyleSheet, Platform, Alert, Keyboard,
        NativeModules: {},
        NativeEventEmitter: class { addListener() { return { remove: vi.fn() }; } },
        AppState: { addEventListener: vi.fn(() => ({ remove: vi.fn() })), currentState: 'active' },
        Linking: { openURL: vi.fn(), addEventListener: vi.fn(() => ({ remove: vi.fn() })) },
        Dimensions: { get: () => ({ width: 375, height: 812 }), addEventListener: vi.fn(() => ({ remove: vi.fn() })) },
    };
}
