import * as React from 'react';

/**
 * Session 内存命令历史（不持久化，不跨 session）。
 * SessionView 因 key=sessionId 重挂载天然清空，无需手动清理。
 *
 * 状态机说明（zsh edit-buffer 语义，OQ-3）：
 * - historyIndex === null：实时编辑态（未进入历史浏览）
 * - historyIndex = 0..history.length-1：历史浏览态；0 = 最早条目，length-1 = 最新条目
 * - draftBuffer：进入浏览前保存的实时草稿，↓ 越过最新条目时恢复
 */
export interface InputHistoryControls {
    /**
     * onSend 时调用，把已发送文本追加到历史栈尾。
     * 去重规则：若新条目与栈尾完全相同（===），则跳过不追加（相邻重复去重，非全局去重）。
     * 空串不追加。
     */
    push: (text: string) => void;

    /**
     * 按 ↑ 时调用。
     * - 若 historyIndex === null（初次进入浏览）：
     *     - 存 currentDraft 到 draftBuffer
     *     - 将 historyIndex 设为 history.length - 1（最新条目）
     *     - 返回 history[history.length - 1]
     * - 若 historyIndex > 0：historyIndex -= 1，返回 history[historyIndex-1]（更早条目）
     * - 若 historyIndex === 0（已在栈底，最早条目）：停住不 wrap，返回 history[0]
     * - 若历史栈为空（history.length === 0）：返回 null，调用方不改变输入框
     * currentDraft：用于首次进入浏览时存草稿，后续 ↑ 不使用此参数
     */
    navigateUp: (currentDraft: string) => string | null;

    /**
     * 按 ↓ 时调用。
     * - 若 historyIndex === null（非浏览态）：返回 null，调用方不处理
     * - 若 historyIndex < history.length - 1：historyIndex += 1，返回 history[historyIndex+1]
     * - 若 historyIndex === history.length - 1（已在最新条目）：
     *     - historyIndex 置 null（退出浏览态）
     *     - 返回 draftBuffer（恢复草稿，通常为空串）
     */
    navigateDown: () => string | null;

    /**
     * onSend 后或外部需要时调用。重置 historyIndex=null，draftBuffer=''。
     * 历史栈本身不清空（session 内累积）。
     */
    reset: () => void;

    /** 当前是否处于历史浏览态（historyIndex !== null）。用于 OQ-2 触发条件判定 */
    isBrowsing: boolean;
}

const HISTORY_MAX = 200;

export function useInputHistory(): InputHistoryControls {
    // ref（不触发重渲染）：历史栈内容变化不需要重渲染
    const historyRef = React.useRef<string[]>([]);
    const draftBufferRef = React.useRef<string>('');
    const historyIndexRef = React.useRef<number | null>(null);

    // state（触发重渲染）：isBrowsing 需要让 AgentInput 感知，必须用 state
    const [browsing, setBrowsing] = React.useState(false);

    const push = React.useCallback((text: string) => {
        if (text === '') return;
        const history = historyRef.current;
        if (history.length > 0 && history[history.length - 1] === text) return; // 相邻去重
        history.push(text);
        if (history.length > HISTORY_MAX) history.shift(); // FIFO 软上限
        historyIndexRef.current = null;
        setBrowsing(false);
        draftBufferRef.current = '';
    }, []);

    const navigateUp = React.useCallback((currentDraft: string): string | null => {
        const history = historyRef.current;
        if (history.length === 0) return null;
        const idx = historyIndexRef.current;
        if (idx === null) {
            draftBufferRef.current = currentDraft;
            historyIndexRef.current = history.length - 1;
            setBrowsing(true);
            return history[history.length - 1];
        }
        if (idx > 0) {
            historyIndexRef.current = idx - 1;
            return history[idx - 1];
        }
        // idx === 0，栈底停住
        return history[0];
    }, []);

    const navigateDown = React.useCallback((): string | null => {
        const idx = historyIndexRef.current;
        if (idx === null) return null;
        const history = historyRef.current;
        if (idx < history.length - 1) {
            historyIndexRef.current = idx + 1;
            return history[idx + 1];
        }
        // idx === length-1，越过最新，退出浏览
        historyIndexRef.current = null;
        setBrowsing(false);
        return draftBufferRef.current;
    }, []);

    const reset = React.useCallback(() => {
        historyIndexRef.current = null;
        setBrowsing(false);
        draftBufferRef.current = '';
    }, []);

    return {
        push,
        navigateUp,
        navigateDown,
        reset,
        isBrowsing: browsing,
    };
}
