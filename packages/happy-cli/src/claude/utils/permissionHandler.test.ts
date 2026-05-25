/**
 * Tests for PermissionHandler.reset(reason) behavior.
 *
 * Verifies that:
 *  - reset() with no args uses default reason 'Session switched to local mode'
 *  - reset() with custom reason propagates the reason to completedRequests
 *  - reset() clears pending requests and agentState.requests on server
 */

import { describe, it, expect, vi } from 'vitest';
import { PermissionHandler } from './permissionHandler';

vi.mock('@/lib', () => ({
    logger: {
        debug: vi.fn(),
    },
}));

/**
 * Creates a minimal session mock that captures updateAgentState calls
 * and returns accumulated state.
 */
function createSessionMock() {
    let state: Record<string, any> = {};

    const session = {
        client: {
            rpcHandlerManager: {
                registerHandler: vi.fn(),
            },
            updateAgentState: vi.fn((updater: (s: Record<string, any>) => Record<string, any>) => {
                state = updater(state);
                return state;
            }),
        },
    };

    return {
        session: session as any,
        getState: () => state,
        setState: (s: Record<string, any>) => { state = s; },
    };
}

describe('PermissionHandler.reset()', () => {
    it('uses default reason when called without arguments', () => {
        const { session, getState, setState } = createSessionMock();

        // Seed a pending request in the agent state to simulate orphaned state
        setState({
            requests: {
                'req-001': { tool: 'Bash', arguments: { command: 'ls' }, createdAt: 1000 },
            },
            completedRequests: {},
        });

        const handler = new PermissionHandler(session);
        handler.reset();

        const state = getState();
        // Pending requests cleared
        expect(state.requests).toEqual({});
        // Moved to completedRequests with default reason
        expect(state.completedRequests['req-001']).toMatchObject({
            tool: 'Bash',
            status: 'canceled',
            reason: 'Session switched to local mode',
        });
    });

    it('propagates custom reason to completedRequests', () => {
        const { session, getState, setState } = createSessionMock();

        setState({
            requests: {
                'req-002': { tool: 'WriteFile', arguments: { path: '/tmp/x' }, createdAt: 2000 },
            },
            completedRequests: {},
        });

        const handler = new PermissionHandler(session);
        handler.reset('Previous CLI process exited before responding');

        const state = getState();
        expect(state.requests).toEqual({});
        expect(state.completedRequests['req-002']).toMatchObject({
            status: 'canceled',
            reason: 'Previous CLI process exited before responding',
        });
    });

    it('handles multiple orphaned requests in a single reset', () => {
        const { session, getState, setState } = createSessionMock();

        setState({
            requests: {
                'req-a': { tool: 'ToolA', arguments: {}, createdAt: 100 },
                'req-b': { tool: 'ToolB', arguments: {}, createdAt: 200 },
                'req-c': { tool: 'ToolC', arguments: {}, createdAt: 300 },
            },
            completedRequests: {},
        });

        const handler = new PermissionHandler(session);
        handler.reset('Batch cancel reason');

        const state = getState();
        expect(state.requests).toEqual({});
        expect(Object.keys(state.completedRequests)).toHaveLength(3);
        for (const id of ['req-a', 'req-b', 'req-c']) {
            expect(state.completedRequests[id]).toMatchObject({
                status: 'canceled',
                reason: 'Batch cancel reason',
            });
        }
    });

    it('is a no-op when there are no pending requests', () => {
        const { session, getState } = createSessionMock();

        const handler = new PermissionHandler(session);
        // Should not throw
        expect(() => handler.reset('No-op test')).not.toThrow();

        const state = getState();
        // updateAgentState should still have been called; requests remain empty
        expect(state.requests ?? {}).toEqual({});
    });

    it('completedAt timestamp is set on canceled entries', () => {
        const { session, getState, setState } = createSessionMock();

        setState({
            requests: {
                'req-ts': { tool: 'ReadFile', arguments: { path: '/etc/hosts' }, createdAt: 5000 },
            },
            completedRequests: {},
        });

        const before = Date.now();
        const handler = new PermissionHandler(session);
        handler.reset();
        const after = Date.now();

        const entry = getState().completedRequests['req-ts'];
        expect(entry.completedAt).toBeGreaterThanOrEqual(before);
        expect(entry.completedAt).toBeLessThanOrEqual(after);
    });

    it('daemon-restart: all pending requests are batch-canceled with reason daemon-restarted', () => {
        // Simulates the scenario where a daemon restarts and reconnects to the server.
        // The new daemon's claudeRemoteLauncher calls reset('daemon-restarted') on the
        // permission handler to clear orphaned requests left by the previous daemon process.
        const { session, getState, setState } = createSessionMock();

        setState({
            requests: {
                'perm-100': { tool: 'WriteFile', arguments: { path: '/src/app.ts' }, createdAt: 1000 },
                'perm-101': { tool: 'Bash', arguments: { command: 'npm install' }, createdAt: 1001 },
            },
            completedRequests: {},
        });

        const handler = new PermissionHandler(session);
        handler.reset('daemon-restarted');

        const state = getState();
        expect(state.requests).toEqual({});

        expect(state.completedRequests['perm-100']).toMatchObject({
            tool: 'WriteFile',
            status: 'canceled',
            reason: 'daemon-restarted',
        });
        expect(state.completedRequests['perm-101']).toMatchObject({
            tool: 'Bash',
            status: 'canceled',
            reason: 'daemon-restarted',
        });
        // Existing completedRequests must be preserved
        expect(Object.keys(state.completedRequests)).toHaveLength(2);
    });

    it('daemon-restart: preserves already-completed requests while clearing pending ones', () => {
        const { session, getState, setState } = createSessionMock();

        setState({
            requests: {
                'new-pending': { tool: 'Edit', arguments: {}, createdAt: 9000 },
            },
            completedRequests: {
                'old-done': {
                    tool: 'Read',
                    arguments: {},
                    createdAt: 1000,
                    completedAt: 1100,
                    status: 'approved',
                },
            },
        });

        const handler = new PermissionHandler(session);
        handler.reset('daemon-restarted');

        const state = getState();
        expect(state.requests).toEqual({});
        // Old completed entry must survive
        expect(state.completedRequests['old-done']).toMatchObject({ status: 'approved' });
        // New pending entry must now be canceled
        expect(state.completedRequests['new-pending']).toMatchObject({
            status: 'canceled',
            reason: 'daemon-restarted',
        });
    });
});
