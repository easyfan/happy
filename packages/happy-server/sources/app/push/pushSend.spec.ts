import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.mock is hoisted to the top of the file by vitest, before any const declarations.
// Therefore mocks that need to reference external vars must use vi.hoisted() or
// create the mock fns inside the factory itself.
const mockFns = vi.hoisted(() => ({
    sendPushNotificationsAsync: vi.fn(),
    chunkPushNotifications: vi.fn((messages: any[]) => [messages]),
    isExpoPushToken: vi.fn((token: string) =>
        token.startsWith('ExponentPushToken[') && token.endsWith(']')
    )
}));

vi.mock('expo-server-sdk', () => {
    // Use function constructor syntax so new Expo() works correctly
    function ExpoMock(this: any) {
        this.sendPushNotificationsAsync = mockFns.sendPushNotificationsAsync;
        this.chunkPushNotifications = mockFns.chunkPushNotifications;
    }
    // isExpoPushToken is a static method on the class
    (ExpoMock as any).isExpoPushToken = mockFns.isExpoPushToken;
    return {
        Expo: ExpoMock
    };
});

import { pushSend } from './pushSend';

describe('pushSend', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockFns.chunkPushNotifications.mockImplementation((messages: any[]) => [messages]);
    });

    it('pushSend-invalid-tokens: invalid tokens filtered out via Expo.isExpoPushToken', async () => {
        const tokens = [
            'ExponentPushToken[validtoken12345678901]',
            'not-a-valid-expo-token',
            'also-invalid'
        ];

        mockFns.sendPushNotificationsAsync.mockResolvedValue([]);

        await pushSend(tokens);

        // Only the valid token is sent
        expect(mockFns.sendPushNotificationsAsync).toHaveBeenCalledTimes(1);
        const sentMessages = mockFns.sendPushNotificationsAsync.mock.calls[0][0];
        expect(sentMessages).toHaveLength(1);
        expect(sentMessages[0].to).toBe('ExponentPushToken[validtoken12345678901]');
    });

    it('pushSend-error-swallowed: network error does not propagate', async () => {
        const tokens = ['ExponentPushToken[validtoken12345678901]'];
        mockFns.sendPushNotificationsAsync.mockRejectedValue(new Error('Network failure'));

        // Must not throw
        await expect(pushSend(tokens)).resolves.toBeUndefined();
    });
});
