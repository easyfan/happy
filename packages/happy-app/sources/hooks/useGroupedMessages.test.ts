// @vitest-environment jsdom

import { describe, it, expect, vi } from 'vitest';

// Mock react-native before importing anything that uses it
vi.mock('react-native', () => ({
    Platform: { OS: 'ios' },
}));

// Mock knownTools — specify which tools are hidden
vi.mock('@/components/tools/knownTools', () => ({
    knownTools: {
        ToolSearch: { hidden: true },
        CodexReasoning: { hidden: true },
        Edit: { hidden: false },
        Read: { hidden: false },
        Bash: { hidden: false },
    },
}));

// Mock the t() function to return predictable strings for testing
vi.mock('@/text', () => ({
    t: (key: string, params?: { count?: number }) => {
        if (params?.count !== undefined) return `${key}:${params.count}`;
        return key;
    },
}));

import { renderHook } from '@testing-library/react-native';
import { useGroupedMessages, generateGroupSummary } from './useGroupedMessages';
import type { Message } from '@/sync/typesMessage';

// Helper factories
function makeUserText(id: string): Message {
    return {
        kind: 'user-text',
        id,
        localId: null,
        createdAt: 1000,
        text: 'Hello',
    };
}

function makeAgentText(id: string, text = 'Response'): Message {
    return {
        kind: 'agent-text',
        id,
        localId: null,
        createdAt: 1000,
        text,
    };
}

function makeToolCall(id: string, name = 'Edit', state: 'running' | 'completed' | 'error' = 'completed'): Message {
    return {
        kind: 'tool-call',
        id,
        localId: null,
        createdAt: 1000,
        tool: {
            name,
            state,
            input: {},
            createdAt: 1000,
            startedAt: 1000,
            completedAt: state !== 'running' ? 2000 : null,
            description: null,
        },
        children: [],
    };
}

function makeAgentEvent(id: string): Message {
    return {
        kind: 'agent-event',
        id,
        createdAt: 1000,
        event: { type: 'mode-change', mode: 'auto' } as any,
    };
}

function makeThinking(id: string): Message {
    return {
        kind: 'agent-text',
        id,
        localId: null,
        createdAt: 1000,
        text: 'thinking...',
        isThinking: true,
    };
}

describe('useGroupedMessages', () => {
    describe('disabled mode (groupToolCalls = false)', () => {
        it('returns all messages as TextItems when disabled', () => {
            const messages: Message[] = [
                makeUserText('u1'),
                makeToolCall('t1'),
                makeAgentText('a1'),
            ];
            const { result } = renderHook(() => useGroupedMessages(messages, false));
            expect(result.current).toHaveLength(3);
            expect(result.current.every(item => item.type === 'message')).toBe(true);
        });

        it('preserves message references when disabled', () => {
            const messages: Message[] = [makeToolCall('t1'), makeUserText('u1')];
            const { result } = renderHook(() => useGroupedMessages(messages, false));
            expect(result.current[0].type).toBe('message');
            if (result.current[0].type === 'message') {
                expect(result.current[0].message).toBe(messages[0]);
            }
        });
    });

    describe('enabled mode (default)', () => {
        it('returns empty array for empty messages', () => {
            const { result } = renderHook(() => useGroupedMessages([]));
            expect(result.current).toHaveLength(0);
        });

        it('passes through a single user text message as TextItem', () => {
            const messages: Message[] = [makeUserText('u1')];
            const { result } = renderHook(() => useGroupedMessages(messages));
            expect(result.current).toHaveLength(1);
            expect(result.current[0].type).toBe('message');
        });

        it('groups consecutive tool calls into a single ToolGroupItem', () => {
            const messages: Message[] = [
                makeUserText('u1'),
                makeToolCall('t1'),
                makeToolCall('t2'),
                makeToolCall('t3'),
                makeAgentText('a1'),
            ];
            const { result } = renderHook(() => useGroupedMessages(messages));
            // Inverted list: newest first = [u1, t1, t2, t3, a1]
            // Grouped output: [u1 (message), group(t1,t2,t3), a1 (message)]
            expect(result.current).toHaveLength(3);
            expect(result.current[0].type).toBe('message');  // u1
            expect(result.current[1].type).toBe('tool-group');
            expect(result.current[2].type).toBe('message');  // a1
        });

        it('includes all tool calls in the group', () => {
            const messages: Message[] = [
                makeToolCall('t1'),
                makeToolCall('t2'),
                makeToolCall('t3'),
            ];
            const { result } = renderHook(() => useGroupedMessages(messages));
            expect(result.current).toHaveLength(1);
            const group = result.current[0];
            expect(group.type).toBe('tool-group');
            if (group.type === 'tool-group') {
                expect(group.messages).toHaveLength(3);
            }
        });

        it('group id is derived from the last message in the buffer (oldest chronologically)', () => {
            const messages: Message[] = [
                makeToolCall('t1'),
                makeToolCall('t2'),
                makeToolCall('t3'),
            ];
            const { result } = renderHook(() => useGroupedMessages(messages));
            const group = result.current[0];
            expect(group.id).toBe('group-t3');
        });

        it('detects hasRunning = true when a tool is still running', () => {
            const messages: Message[] = [
                makeToolCall('t1', 'Edit', 'running'),
                makeToolCall('t2', 'Read', 'completed'),
            ];
            const { result } = renderHook(() => useGroupedMessages(messages));
            const group = result.current[0];
            if (group.type === 'tool-group') {
                expect(group.hasRunning).toBe(true);
            }
        });

        it('detects hasRunning = false when no tools are running', () => {
            const messages: Message[] = [
                makeToolCall('t1', 'Edit', 'completed'),
                makeToolCall('t2', 'Read', 'completed'),
            ];
            const { result } = renderHook(() => useGroupedMessages(messages));
            const group = result.current[0];
            if (group.type === 'tool-group') {
                expect(group.hasRunning).toBe(false);
            }
        });

        it('agent-event messages break groups and pass through as standalone', () => {
            const messages: Message[] = [
                makeToolCall('t1'),
                makeAgentEvent('e1'),
                makeToolCall('t2'),
            ];
            const { result } = renderHook(() => useGroupedMessages(messages));
            // t1 group, e1 standalone, t2 group → 3 items
            expect(result.current).toHaveLength(3);
            expect(result.current[0].type).toBe('tool-group');
            expect(result.current[1].type).toBe('message');
            expect(result.current[2].type).toBe('tool-group');
        });

        it('excludes hidden tools from groups (isInvisible path)', () => {
            const messages: Message[] = [
                makeToolCall('visible', 'Edit', 'completed'),
                makeToolCall('hidden', 'ToolSearch', 'completed'),  // hidden tool
            ];
            const { result } = renderHook(() => useGroupedMessages(messages));
            // ToolSearch is skipped; only Edit ends up in group
            expect(result.current).toHaveLength(1);
            if (result.current[0].type === 'tool-group') {
                expect(result.current[0].messages).toHaveLength(1);
                expect(result.current[0].messages[0].id).toBe('visible');
            }
        });

        it('thinking messages are excluded (isInvisible)', () => {
            const messages: Message[] = [
                makeToolCall('t1'),
                makeThinking('think1'),
                makeToolCall('t2'),
            ];
            const { result } = renderHook(() => useGroupedMessages(messages));
            // thinking is skipped; t1 and t2 land in same group
            expect(result.current).toHaveLength(1);
            if (result.current[0].type === 'tool-group') {
                expect(result.current[0].messages).toHaveLength(2);
            }
        });

        it('empty agent-text messages are excluded (isInvisible)', () => {
            const emptyText: Message = {
                kind: 'agent-text',
                id: 'empty',
                localId: null,
                createdAt: 1000,
                text: '   ',  // whitespace only
            };
            const messages: Message[] = [
                makeToolCall('t1'),
                emptyText,
                makeToolCall('t2'),
            ];
            const { result } = renderHook(() => useGroupedMessages(messages));
            expect(result.current).toHaveLength(1);
            if (result.current[0].type === 'tool-group') {
                expect(result.current[0].messages).toHaveLength(2);
            }
        });

        it('user-sent file tool is treated as standalone (isUserAttachment)', () => {
            const fileMsg: Message = makeToolCall('file1', 'file');
            const messages: Message[] = [
                makeToolCall('t1'),
                fileMsg,
                makeToolCall('t2'),
            ];
            const { result } = renderHook(() => useGroupedMessages(messages));
            // file tool breaks grouping: [group(t1), file (standalone), group(t2)]
            expect(result.current).toHaveLength(3);
            expect(result.current[1].type).toBe('message');
            if (result.current[1].type === 'message') {
                expect(result.current[1].message.id).toBe('file1');
            }
        });

        it('non-empty agent-text stands alone and breaks groups', () => {
            const messages: Message[] = [
                makeToolCall('t1'),
                makeAgentText('a1', 'Some response'),
                makeToolCall('t2'),
            ];
            const { result } = renderHook(() => useGroupedMessages(messages));
            expect(result.current).toHaveLength(3);
        });

        it('produces stable output with same messages (memoized)', () => {
            const messages: Message[] = [makeToolCall('t1'), makeToolCall('t2')];
            const { result, rerender } = renderHook(
                ({ msgs, enabled }: { msgs: Message[]; enabled: boolean }) =>
                    useGroupedMessages(msgs, enabled),
                { initialProps: { msgs: messages, enabled: true } }
            );
            const first = result.current;
            rerender({ msgs: messages, enabled: true });
            expect(result.current).toBe(first);  // same reference (memoized)
        });
    });
});

describe('generateGroupSummary', () => {
    it('returns usedTools fallback for empty messages array', () => {
        const result = generateGroupSummary([]);
        expect(result).toContain('toolGroup.usedTools');
    });

    it('correctly categorizes Edit calls', () => {
        const messages: Message[] = [makeToolCall('t1', 'Edit'), makeToolCall('t2', 'Write')];
        const result = generateGroupSummary(messages);
        expect(result).toContain('toolGroup.editedFiles:2');
    });

    it('correctly categorizes Read calls', () => {
        const messages: Message[] = [makeToolCall('t1', 'Read')];
        const result = generateGroupSummary(messages);
        expect(result).toContain('toolGroup.readFiles:1');
    });

    it('correctly categorizes terminal calls (Bash)', () => {
        const messages: Message[] = [makeToolCall('t1', 'Bash'), makeToolCall('t2', 'Bash')];
        const result = generateGroupSummary(messages);
        expect(result).toContain('toolGroup.ranCommands:2');
    });

    it('combines multiple categories with comma separator', () => {
        const messages: Message[] = [
            makeToolCall('t1', 'Edit'),
            makeToolCall('t2', 'Read'),
            makeToolCall('t3', 'Bash'),
        ];
        const result = generateGroupSummary(messages);
        expect(result).toContain('toolGroup.editedFiles:1');
        expect(result).toContain('toolGroup.readFiles:1');
        expect(result).toContain('toolGroup.ranCommands:1');
    });

    it('categorizes unknown tools as other', () => {
        const messages: Message[] = [makeToolCall('t1', 'SomeUnknownTool')];
        const result = generateGroupSummary(messages);
        expect(result).toContain('toolGroup.usedTools:1');
    });
});
