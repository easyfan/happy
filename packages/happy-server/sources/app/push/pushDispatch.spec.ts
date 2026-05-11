import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock focusTracker
vi.mock('./focusTracker', () => ({
    hasActiveConnection: vi.fn()
}));

// Mock pushSend
vi.mock('./pushSend', () => ({
    pushSend: vi.fn()
}));

// Mock db
vi.mock('@/storage/db', () => ({
    db: {
        accountPushToken: {
            findMany: vi.fn()
        }
    }
}));

import { pushDispatch } from './pushDispatch';
import { hasActiveConnection } from './focusTracker';
import { pushSend } from './pushSend';
import { db } from '@/storage/db';

describe('pushDispatch', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('pushDispatch-active-skip: when hasActiveConnection is true, no DB query or pushSend called', async () => {
        vi.mocked(hasActiveConnection).mockReturnValue(true);

        await pushDispatch('user-1', 'session-1');

        expect(db.accountPushToken.findMany).not.toHaveBeenCalled();
        expect(pushSend).not.toHaveBeenCalled();
    });

    it('pushDispatch-no-tokens: when no tokens in DB, pushSend not called', async () => {
        vi.mocked(hasActiveConnection).mockReturnValue(false);
        vi.mocked(db.accountPushToken.findMany).mockResolvedValue([]);

        await pushDispatch('user-1', 'session-1');

        expect(db.accountPushToken.findMany).toHaveBeenCalledWith({
            where: { accountId: 'user-1' },
            select: { token: true }
        });
        expect(pushSend).not.toHaveBeenCalled();
    });

    it('pushDispatch-sends: when no active connection and tokens exist, pushSend called with token list', async () => {
        vi.mocked(hasActiveConnection).mockReturnValue(false);
        vi.mocked(db.accountPushToken.findMany).mockResolvedValue([
            { token: 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]' },
            { token: 'ExponentPushToken[yyyyyyyyyyyyyyyyyyyyyy]' }
        ] as any);
        vi.mocked(pushSend).mockResolvedValue(undefined);

        await pushDispatch('user-1', 'session-1');

        expect(pushSend).toHaveBeenCalledWith([
            'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]',
            'ExponentPushToken[yyyyyyyyyyyyyyyyyyyyyy]'
        ]);
    });
});
