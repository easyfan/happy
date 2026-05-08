// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';

// NOTE: vi.mock calls are hoisted by vitest to the top of the file (before all
// imports), so 'react-native' is intercepted before @testing-library/react-native
// requires it. This is why react-native must be mocked here (not in a setup file).

// --- Mock: react-native ---
// react-native v0.83.x uses Flow syntax (import typeof) which cannot load in
// Node.js / esbuild without Babel. Mocking it here prevents the Flow parse error.
vi.mock('react-native', () => ({
    View: ({ children, style, testID, ...rest }: any) =>
        React.createElement('View', { style, testID, ...rest }, children),
    Text: ({ children, style, testID, numberOfLines, ellipsizeMode, ...rest }: any) =>
        React.createElement('Text', { style, testID, numberOfLines, ellipsizeMode, ...rest }, children),
    TouchableOpacity: ({ children, style, onPress, disabled, activeOpacity, testID, ...rest }: any) =>
        React.createElement('TouchableOpacity', { style, onPress, disabled, activeOpacity, testID, ...rest }, children),
    ActivityIndicator: ({ size, color, style, testID, ...rest }: any) =>
        React.createElement('ActivityIndicator', { size, color, style, testID, ...rest }),
    StyleSheet: { create: (s: any) => s },
    Platform: { OS: 'ios', select: (obj: any) => obj.ios ?? obj.default },
}));

// --- Mock: react-native-unistyles ---
vi.mock('react-native-unistyles', () => ({
    useUnistyles: () => ({
        theme: {
            colors: {
                text: '#000000',
                textSecondary: '#666666',
                permissionButton: {
                    allow: { background: '#22c55e' },
                    deny: { background: '#ef4444' },
                    allowAll: { background: '#3b82f6' },
                },
            },
        },
    }),
    StyleSheet: { create: (s: any) => s },
}));

// --- Mock: @expo/vector-icons ---
vi.mock('@expo/vector-icons', () => ({
    Ionicons: () => null,
}));

// --- Mock: @/sync/ops ---
vi.mock('@/sync/ops', () => ({
    sessionAllow: vi.fn(),
    sessionDeny: vi.fn(),
}));

// --- Mock: @/modal ---
vi.mock('@/modal', () => ({
    Modal: {
        alert: vi.fn(),
    },
}));

// --- Mock: @/sync/storage ---
vi.mock('@/sync/storage', () => ({
    storage: {
        getState: () => ({
            updateSessionPermissionMode: vi.fn(),
        }),
    },
}));

// This import will be processed AFTER vi.mock due to hoisting
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { PermissionFooter } from './PermissionFooter';
import * as ops from '@/sync/ops';
import { Modal } from '@/modal';

// Helpers
const basePendingPermission = {
    id: 'p1',
    status: 'pending' as const,
};

describe('PermissionFooter', () => {
    let consoleSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        vi.clearAllMocks();
        // Suppress console.error output; ignore the react-test-renderer deprecation
        // warning so we can assert only on app-level errors.
        consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        consoleSpy.mockRestore();
    });

    // TC-04: handleApprove fails → Modal.alert called, no console.error
    it('TC-04: handleApprove 失败 → Modal.alert 被调用，无 console.error', async () => {
        vi.mocked(ops.sessionAllow).mockRejectedValueOnce(new Error('network error'));

        const { getByText } = render(
            React.createElement(PermissionFooter, {
                permission: basePendingPermission,
                sessionId: 's1',
                toolName: 'Bash',
            })
        );

        fireEvent.press(getByText('Yes'));

        await waitFor(() => {
            expect(Modal.alert).toHaveBeenCalledOnce();
        });

        // t('common.error') = 'Error' (capital E — see en.ts common.error),
        // t('permissions.actionFailed') = 'Action failed. Please try again.'
        expect(Modal.alert).toHaveBeenCalledWith(
            'Error',
            'Action failed. Please try again.'
        );
        // Filter out the react-test-renderer deprecation warning (third-party noise).
        const appErrors = consoleSpy.mock.calls.filter(
            (args) => !String(args[0]).includes('react-test-renderer is deprecated'),
        );
        expect(appErrors).toHaveLength(0);
    });

    // TC-05: handleDeny fails → Modal.alert called, no console.error
    it('TC-05: handleDeny 失败 → Modal.alert 被调用，无 console.error', async () => {
        vi.mocked(ops.sessionDeny).mockRejectedValueOnce(new Error('network error'));

        const { getByText } = render(
            React.createElement(PermissionFooter, {
                permission: basePendingPermission,
                sessionId: 's1',
                toolName: 'Bash',
            })
        );

        fireEvent.press(getByText('No, and provide feedback'));

        await waitFor(() => {
            expect(Modal.alert).toHaveBeenCalledOnce();
        });

        expect(Modal.alert).toHaveBeenCalledWith(
            'Error',
            'Action failed. Please try again.'
        );
        // Filter out the react-test-renderer deprecation warning (third-party noise).
        const appErrors = consoleSpy.mock.calls.filter(
            (args) => !String(args[0]).includes('react-test-renderer is deprecated'),
        );
        expect(appErrors).toHaveLength(0);
    });

    // TC-06: isMissed=true → shows "Handled on another device", no action buttons
    it('TC-06: isMissed=true → 显示"另一设备处理"，不渲染操作按钮', () => {
        const { getByText, queryByText } = render(
            React.createElement(PermissionFooter, {
                permission: { id: 'p1', status: 'approved' },
                sessionId: 's1',
                toolName: 'Bash',
                isMissed: true,
            })
        );

        expect(getByText('Handled on another device')).toBeTruthy();
        expect(queryByText('Yes')).toBeNull();
        expect(queryByText('No, and provide feedback')).toBeNull();
    });
});
