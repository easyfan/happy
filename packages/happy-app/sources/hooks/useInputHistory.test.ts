// @vitest-environment jsdom

import { describe, it, expect, vi } from 'vitest';

vi.mock('react-native', () => ({
    Platform: { OS: 'ios' },
}));

import { renderHook, act } from '@testing-library/react-native';
import { useInputHistory } from './useInputHistory';

describe('useInputHistory', () => {
    // 正常路径
    it('push 一条后 navigateUp 返回该条文本，再 navigateDown 返回 draftBuffer', () => {
        const { result } = renderHook(() => useInputHistory());

        act(() => { result.current.push('hello'); });

        let up: string | null = null;
        act(() => { up = result.current.navigateUp(''); });
        expect(up).toBe('hello');

        let down: string | null = null;
        act(() => { down = result.current.navigateDown(); });
        expect(down).toBe(''); // draftBuffer
        expect(result.current.isBrowsing).toBe(false);
    });

    it('push 多条后 navigateUp 多次，顺序：最新→最早', () => {
        const { result } = renderHook(() => useInputHistory());

        act(() => {
            result.current.push('first');
            result.current.push('second');
            result.current.push('third');
        });

        let t1: string | null = null, t2: string | null = null, t3: string | null = null;
        act(() => { t1 = result.current.navigateUp(''); });
        act(() => { t2 = result.current.navigateUp(''); });
        act(() => { t3 = result.current.navigateUp(''); });

        expect(t1).toBe('third');
        expect(t2).toBe('second');
        expect(t3).toBe('first');
    });

    it('navigateUp 传入非空 currentDraft，navigateDown 退出浏览后返回该草稿', () => {
        const { result } = renderHook(() => useInputHistory());

        act(() => { result.current.push('cmd1'); });

        act(() => { result.current.navigateUp('my draft'); });

        let restored: string | null = null;
        act(() => { restored = result.current.navigateDown(); });

        expect(restored).toBe('my draft');
    });

    // 边界
    it('发送 0 条消息时 navigateUp 返回 null，isBrowsing 保持 false', () => {
        const { result } = renderHook(() => useInputHistory());

        let up: string | null = null;
        act(() => { up = result.current.navigateUp(''); });

        expect(up).toBeNull();
        expect(result.current.isBrowsing).toBe(false);
    });

    it('navigateUp 到栈底（index=0）再按 ↑，仍返回 history[0]，index 不变', () => {
        const { result } = renderHook(() => useInputHistory());

        act(() => {
            result.current.push('only');
        });

        let r1: string | null = null, r2: string | null = null;
        act(() => { r1 = result.current.navigateUp(''); });
        act(() => { r2 = result.current.navigateUp(''); }); // 已在栈底

        expect(r1).toBe('only');
        expect(r2).toBe('only'); // 停住不变
        expect(result.current.isBrowsing).toBe(true);
    });

    it('navigateDown 在非浏览态返回 null，isBrowsing 保持 false', () => {
        const { result } = renderHook(() => useInputHistory());

        let down: string | null = null;
        act(() => { down = result.current.navigateDown(); });

        expect(down).toBeNull();
        expect(result.current.isBrowsing).toBe(false);
    });

    it('navigateDown 在 index=length-1 退出浏览，返回 draftBuffer，isBrowsing 变 false', () => {
        const { result } = renderHook(() => useInputHistory());

        act(() => { result.current.push('cmd'); });
        act(() => { result.current.navigateUp('draft text'); });
        expect(result.current.isBrowsing).toBe(true);

        let down: string | null = null;
        act(() => { down = result.current.navigateDown(); });

        expect(down).toBe('draft text');
        expect(result.current.isBrowsing).toBe(false);
    });

    // 去重
    it('连续 push 相同文本两次，history.length 仍为 1', () => {
        const { result } = renderHook(() => useInputHistory());

        act(() => {
            result.current.push('dup');
            result.current.push('dup');
        });

        // 验证：navigateUp 返回唯一条目，再 navigateUp 仍返回同一条（栈底）
        let r1: string | null = null, r2: string | null = null;
        act(() => { r1 = result.current.navigateUp(''); });
        act(() => { r2 = result.current.navigateUp(''); }); // 已在栈底，停住

        expect(r1).toBe('dup');
        expect(r2).toBe('dup'); // 停住说明只有1条
        // navigateDown 应直接恢复草稿（只有1条，length-1=0，再 Down 就退出）
        let down: string | null = null;
        act(() => { down = result.current.navigateDown(); });
        expect(down).toBe(''); // 恢复草稿，说明只有1条（索引0=length-1，Down退出浏览）
    });

    it('push "a"、push "b"、push "a"，有 3 条（非相邻不去重）', () => {
        const { result } = renderHook(() => useInputHistory());

        act(() => {
            result.current.push('a');
            result.current.push('b');
            result.current.push('a');
        });

        // 3 条：newest='a', middle='b', oldest='a'
        let r1: string | null = null, r2: string | null = null, r3: string | null = null;
        act(() => { r1 = result.current.navigateUp(''); });
        act(() => { r2 = result.current.navigateUp(''); });
        act(() => { r3 = result.current.navigateUp(''); });

        expect(r1).toBe('a');
        expect(r2).toBe('b');
        expect(r3).toBe('a');

        // 再按一次 ↑ 应停住（栈底）
        let r4: string | null = null;
        act(() => { r4 = result.current.navigateUp(''); });
        expect(r4).toBe('a'); // 停住
    });

    // FIFO 上限
    it('push 201 条不同文本，history.length === 200，第一条被移除', () => {
        const { result } = renderHook(() => useInputHistory());

        act(() => {
            for (let i = 0; i < 201; i++) {
                result.current.push(`item-${i}`);
            }
        });

        // item-0 应被移除，navigateUp 200次后应得到 item-1（最旧条目）
        // 但更简单的验证：navigateUp 直到栈底，应返回 item-1，而非 item-0
        // 先到达最新条目
        let lastSeen: string | null = null;
        act(() => { lastSeen = result.current.navigateUp(''); });
        expect(lastSeen).toBe('item-200'); // 最新

        // 连续 199 次 ↑ 到达栈底
        act(() => {
            for (let i = 0; i < 199; i++) {
                result.current.navigateUp('');
            }
        });

        // 现在在栈底，再按一次应返回 item-1（item-0 已被 FIFO 移除）
        let bottom: string | null = null;
        act(() => { bottom = result.current.navigateUp(''); }); // 停住，返回底部条目
        expect(bottom).toBe('item-1');
    });

    // isBrowsing
    it('初始 false；navigateUp 后 true；navigateDown 退出后 false；reset 后 false', () => {
        const { result } = renderHook(() => useInputHistory());

        expect(result.current.isBrowsing).toBe(false);

        act(() => { result.current.push('test'); });
        act(() => { result.current.navigateUp(''); });
        expect(result.current.isBrowsing).toBe(true);

        act(() => { result.current.navigateDown(); });
        expect(result.current.isBrowsing).toBe(false);

        act(() => { result.current.navigateUp(''); });
        expect(result.current.isBrowsing).toBe(true);

        act(() => { result.current.reset(); });
        expect(result.current.isBrowsing).toBe(false);
    });

    // reset
    it('浏览态中 reset，isBrowsing 变 false，再 navigateDown 返回 null', () => {
        const { result } = renderHook(() => useInputHistory());

        act(() => { result.current.push('a'); });
        act(() => { result.current.navigateUp(''); });
        expect(result.current.isBrowsing).toBe(true);

        act(() => { result.current.reset(); });
        expect(result.current.isBrowsing).toBe(false);

        let down: string | null = null;
        act(() => { down = result.current.navigateDown(); });
        expect(down).toBeNull();
    });

    // 多行历史
    it('push 多行文本，navigateUp 返回完整多行内容（不被 \\n 截断）', () => {
        const { result } = renderHook(() => useInputHistory());

        act(() => { result.current.push('a\nb\nc'); });

        let up: string | null = null;
        act(() => { up = result.current.navigateUp(''); });
        expect(up).toBe('a\nb\nc');
    });

    it('push 多条含多行历史，navigateUp/navigateDown 以「条」为单位切换', () => {
        const { result } = renderHook(() => useInputHistory());

        act(() => {
            result.current.push('first\nline');
            result.current.push('second\nentry');
        });

        let r1: string | null = null, r2: string | null = null;
        act(() => { r1 = result.current.navigateUp(''); });   // 最新 → second\nentry
        act(() => { r2 = result.current.navigateUp(''); });   // 更早 → first\nline

        expect(r1).toBe('second\nentry');
        expect(r2).toBe('first\nline');

        // navigateDown 回到最新条，再 Down 退出浏览恢复草稿
        let d1: string | null = null, d2: string | null = null;
        act(() => { d1 = result.current.navigateDown(); });   // → second\nentry
        act(() => { d2 = result.current.navigateDown(); });   // → '' (draftBuffer)

        expect(d1).toBe('second\nentry');
        expect(d2).toBe('');
        expect(result.current.isBrowsing).toBe(false);
    });

    // 空串
    it('push(\'\') 不追加，history.length 不变', () => {
        const { result } = renderHook(() => useInputHistory());

        act(() => {
            result.current.push('real');
            result.current.push('');
            result.current.push('');
        });

        // 只有 1 条：navigateUp 得到 'real'，再 navigateUp 停住，再 navigateDown 退出浏览
        let r1: string | null = null;
        act(() => { r1 = result.current.navigateUp(''); });
        expect(r1).toBe('real');

        // 再按 ↑ 应停住（只有1条）
        let r2: string | null = null;
        act(() => { r2 = result.current.navigateUp(''); });
        expect(r2).toBe('real');

        // navigateDown 退出浏览
        let down: string | null = null;
        act(() => { down = result.current.navigateDown(); });
        expect(down).toBe('');
    });
});
