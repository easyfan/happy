// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('react-native', () => ({
    Platform: { OS: 'ios' },
}));

import { renderHook, act } from '@testing-library/react-native';
import { useInputHistory, __resetInputHistoryStoreForTest } from './useInputHistory';

// TL-W001：每个用例前清空模块级 Map，保证用例互不污染（模块级 Map 跨用例存活）。
beforeEach(() => {
    __resetInputHistoryStoreForTest();
});

// AC-4 既有用例统一传固定 sid（与原 IT39 行为逐字保持）。
const SID = 'test-session';

describe('useInputHistory', () => {
    // ===== AC-4：IT39 readline 既有用例（全量保留，仅加 sessionId 参数）=====

    // 正常路径
    it('push 一条后 navigateUp 返回该条文本，再 navigateDown 返回 draftBuffer', () => {
        const { result } = renderHook(() => useInputHistory(SID));

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
        const { result } = renderHook(() => useInputHistory(SID));

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
        const { result } = renderHook(() => useInputHistory(SID));

        act(() => { result.current.push('cmd1'); });

        act(() => { result.current.navigateUp('my draft'); });

        let restored: string | null = null;
        act(() => { restored = result.current.navigateDown(); });

        expect(restored).toBe('my draft');
    });

    // 边界
    it('发送 0 条消息时 navigateUp 返回 null，isBrowsing 保持 false', () => {
        const { result } = renderHook(() => useInputHistory(SID));

        let up: string | null = null;
        act(() => { up = result.current.navigateUp(''); });

        expect(up).toBeNull();
        expect(result.current.isBrowsing).toBe(false);
    });

    it('navigateUp 到栈底（index=0）再按 ↑，仍返回 history[0]，index 不变', () => {
        const { result } = renderHook(() => useInputHistory(SID));

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
        const { result } = renderHook(() => useInputHistory(SID));

        let down: string | null = null;
        act(() => { down = result.current.navigateDown(); });

        expect(down).toBeNull();
        expect(result.current.isBrowsing).toBe(false);
    });

    it('navigateDown 在 index=length-1 退出浏览，返回 draftBuffer，isBrowsing 变 false', () => {
        const { result } = renderHook(() => useInputHistory(SID));

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
        const { result } = renderHook(() => useInputHistory(SID));

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
        const { result } = renderHook(() => useInputHistory(SID));

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
        const { result } = renderHook(() => useInputHistory(SID));

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
        const { result } = renderHook(() => useInputHistory(SID));

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
        const { result } = renderHook(() => useInputHistory(SID));

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
        const { result } = renderHook(() => useInputHistory(SID));

        act(() => { result.current.push('a\nb\nc'); });

        let up: string | null = null;
        act(() => { up = result.current.navigateUp(''); });
        expect(up).toBe('a\nb\nc');
    });

    it('push 多条含多行历史，navigateUp/navigateDown 以「条」为单位切换', () => {
        const { result } = renderHook(() => useInputHistory(SID));

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
        const { result } = renderHook(() => useInputHistory(SID));

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

    // ===== AC-1：同 session 切走切回历史存活 =====

    it('AC-1: push 后 unmount → 同 sessionId 重新 renderHook，navigateUp 仍能召回历史', () => {
        // 唯一 sid 双保险：即便重置钩子失效也不污染其他用例
        const sid = `s-${(globalThis.crypto?.randomUUID?.() ?? Math.random())}`;

        const first = renderHook(() => useInputHistory(sid));
        act(() => { first.result.current.push('cmd-a'); });

        // 模拟切走：组件卸载（不调用 __resetInputHistoryStoreForTest，模拟仅 re-mount 而非进程结束）
        first.unmount();

        // 模拟切回：同 sessionId 重新挂载
        const second = renderHook(() => useInputHistory(sid));
        let up: string | null = null;
        act(() => { up = second.result.current.navigateUp(''); });
        expect(up).toBe('cmd-a'); // 历史跨 re-mount 存活
    });

    it('AC-1: 重挂载后浏览态瞬时状态重置（isBrowsing 初始为 false，未跨挂载存活）', () => {
        const sid = `s-${(globalThis.crypto?.randomUUID?.() ?? Math.random())}`;

        const first = renderHook(() => useInputHistory(sid));
        act(() => { first.result.current.push('cmd-a'); });
        act(() => { first.result.current.navigateUp(''); });
        expect(first.result.current.isBrowsing).toBe(true); // 切走前处于浏览态
        first.unmount();

        // 切回：浏览游标应重置为非浏览态（瞬时态不进 Map）
        const second = renderHook(() => useInputHistory(sid));
        expect(second.result.current.isBrowsing).toBe(false);
    });

    // ===== AC-2：双 session 交叉隔离（REQ-C001 正负双重断言）=====

    it('AC-2: 双 session 交叉写入，正向各自只召回自己历史', () => {
        const sidA = `A-${(globalThis.crypto?.randomUUID?.() ?? Math.random())}`;
        const sidB = `B-${(globalThis.crypto?.randomUUID?.() ?? Math.random())}`;

        const a = renderHook(() => useInputHistory(sidA));
        const b = renderHook(() => useInputHistory(sidB));

        act(() => { a.result.current.push('a1'); a.result.current.push('a2'); });
        act(() => { b.result.current.push('b1'); b.result.current.push('b2'); });

        // 正向：A 只召回 a2 → a1
        let a_up1: string | null = null, a_up2: string | null = null;
        act(() => { a_up1 = a.result.current.navigateUp(''); });
        act(() => { a_up2 = a.result.current.navigateUp(''); });
        expect(a_up1).toBe('a2');
        expect(a_up2).toBe('a1');

        // 正向：B 只召回 b2 → b1
        let b_up1: string | null = null, b_up2: string | null = null;
        act(() => { b_up1 = b.result.current.navigateUp(''); });
        act(() => { b_up2 = b.result.current.navigateUp(''); });
        expect(b_up1).toBe('b2');
        expect(b_up2).toBe('b1');
    });

    it('AC-2: 负向 — A 反复按 ↑ 永远取不到 b*，栈底停在 a1', () => {
        const sidA = `A-${(globalThis.crypto?.randomUUID?.() ?? Math.random())}`;
        const sidB = `B-${(globalThis.crypto?.randomUUID?.() ?? Math.random())}`;

        const a = renderHook(() => useInputHistory(sidA));
        const b = renderHook(() => useInputHistory(sidB));

        act(() => { a.result.current.push('a1'); a.result.current.push('a2'); });
        act(() => { b.result.current.push('b1'); b.result.current.push('b2'); });

        // 在 A 上连按 6 次 ↑（远超 A 历史深度），每次返回值都必须 ∈ {a1, a2}
        const seen: (string | null)[] = [];
        for (let i = 0; i < 6; i++) {
            let r: string | null = null;
            act(() => { r = a.result.current.navigateUp(''); });
            seen.push(r);
        }
        for (const v of seen) {
            expect(['a1', 'a2']).toContain(v); // 永远取不到 b1/b2
        }
        // 栈底停在 a1（最早条目）
        expect(seen[seen.length - 1]).toBe('a1');
    });

    it('AC-2: 反向再验 — B 反复按 ↑ 永远取不到 a*，栈底停在 b1', () => {
        const sidA = `A-${(globalThis.crypto?.randomUUID?.() ?? Math.random())}`;
        const sidB = `B-${(globalThis.crypto?.randomUUID?.() ?? Math.random())}`;

        const a = renderHook(() => useInputHistory(sidA));
        const b = renderHook(() => useInputHistory(sidB));

        act(() => { a.result.current.push('a1'); a.result.current.push('a2'); });
        act(() => { b.result.current.push('b1'); b.result.current.push('b2'); });

        const seen: (string | null)[] = [];
        for (let i = 0; i < 6; i++) {
            let r: string | null = null;
            act(() => { r = b.result.current.navigateUp(''); });
            seen.push(r);
        }
        for (const v of seen) {
            expect(['b1', 'b2']).toContain(v); // 永远取不到 a1/a2
        }
        expect(seen[seen.length - 1]).toBe('b1');
    });

    // ===== AC-3：重启清空 / 非持久化（REQ-C002，单测代理；真实进程重启归 E2E）=====

    it('AC-3 代理: __resetInputHistoryStoreForTest() 后同 sessionId navigateUp 返回 null（模拟进程释放）', () => {
        const sid = `s-${(globalThis.crypto?.randomUUID?.() ?? Math.random())}`;

        const first = renderHook(() => useInputHistory(sid));
        act(() => { first.result.current.push('survives-only-in-memory'); });
        // 写入后确认存在
        let beforeReset: string | null = null;
        act(() => { beforeReset = first.result.current.navigateUp(''); });
        expect(beforeReset).toBe('survives-only-in-memory');

        // 模拟进程释放：清空模块级 Map（真实 kill app→重开 由 E2E 验证）
        act(() => { __resetInputHistoryStoreForTest(); });

        // 同 sessionId 重新挂载，历史应为空
        const second = renderHook(() => useInputHistory(sid));
        let afterReset: string | null = null;
        act(() => { afterReset = second.result.current.navigateUp(''); });
        expect(afterReset).toBeNull();
    });
});
