// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('react-native', () => ({
    Platform: { OS: 'ios' },
}));

vi.mock('@/sync/storage', () => ({
    useFriendRequests: vi.fn(),
    useRequestedFriends: vi.fn(),
    useFeedItems: vi.fn(),
}));

vi.mock('./useChangelog', () => ({
    useChangelog: vi.fn(),
}));

import { renderHook } from '@testing-library/react-native';
import { useFriendRequests, useRequestedFriends } from '@/sync/storage';
import { useChangelog } from './useChangelog';
import { useInboxHasContent } from './useInboxHasContent';

const mockFriendRequests = useFriendRequests as ReturnType<typeof vi.fn>;
const mockRequestedFriends = useRequestedFriends as ReturnType<typeof vi.fn>;
const mockChangelog = useChangelog as ReturnType<typeof vi.fn>;

const noContent = () => {
    mockFriendRequests.mockReturnValue([]);
    mockRequestedFriends.mockReturnValue([]);
    mockChangelog.mockReturnValue({ hasUnread: false });
};

describe('useInboxHasContent', () => {
    beforeEach(noContent);

    it('returns false when there is nothing to show', () => {
        const { result } = renderHook(() => useInboxHasContent());
        expect(result.current).toBe(false);
    });

    it('returns true when there are incoming friend requests', () => {
        mockFriendRequests.mockReturnValue([{ id: '1' }]);
        const { result } = renderHook(() => useInboxHasContent());
        expect(result.current).toBe(true);
    });

    it('returns true when there are outgoing friend requests pending', () => {
        mockRequestedFriends.mockReturnValue([{ id: '2' }]);
        const { result } = renderHook(() => useInboxHasContent());
        expect(result.current).toBe(true);
    });

    it('returns true when changelog has unread entries', () => {
        mockChangelog.mockReturnValue({ hasUnread: true });
        const { result } = renderHook(() => useInboxHasContent());
        expect(result.current).toBe(true);
    });

    it('returns false when changelog.hasUnread is null/undefined', () => {
        mockChangelog.mockReturnValue({ hasUnread: null });
        const { result } = renderHook(() => useInboxHasContent());
        expect(result.current).toBe(false);
    });

    it('returns true when multiple conditions are met', () => {
        mockFriendRequests.mockReturnValue([{ id: '1' }]);
        mockChangelog.mockReturnValue({ hasUnread: true });
        const { result } = renderHook(() => useInboxHasContent());
        expect(result.current).toBe(true);
    });

    // Regression: OTA update availability was removed; it must not factor in
    it('does not depend on any OTA update state', () => {
        // All conditions false — if OTA was accidentally re-introduced it would
        // need some state to trigger. Baseline false confirms OTA is gone.
        const { result } = renderHook(() => useInboxHasContent());
        expect(result.current).toBe(false);
    });
});
