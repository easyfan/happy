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

interface HistoryStore {
    history: string[]; // 已发送指令栈（FIFO，HISTORY_MAX=200 钳制）
}

/**
 * 模块级 Map：key = sessionId，value = 该 session 的历史栈。
 *
 * 生命周期 = JS bundle 进程：跨组件 re-mount 存活（修复 SessionView.tsx:232
 * key={sessionId} 重挂载导致历史清空的缺陷），进程结束（app kill / 刷新）即释放。
 *
 * 有意不清理（见 IT41 架构裁定 W-2，对标 FileShareBubble.tsx failedUploadIds）：
 *   - 单 session 上界由 HISTORY_MAX=200 单条钳制（≈40KB/session）。
 *   - Map 条目数 = 进程内访问过的 session 数（数十~低百量级，总计数 MB），进程重启全清。
 *   - 不监听 session 删除/归档事件清理条目（会把纯内存结构耦合到 sync，违反「不碰 sync」）。
 *   - 后续维护者请勿擅自加 useEffect / 事件订阅清理逻辑。
 *
 * HMR：dev 环境模块热替换会重置本 Map（与 FileShareBubble failedUploadIds 同构，
 * 无显式 module.hot 钩子）；生产 bundle 无 HMR，无影响。
 */
const historyStores = new Map<string, HistoryStore>();

// 取或建：保证每个 sessionId 都有独立 store（AC-2 隔离的物理基础）。
function getOrCreateStore(sessionId: string): HistoryStore {
    let store = historyStores.get(sessionId);
    if (!store) {
        store = { history: [] };
        historyStores.set(sessionId, store);
    }
    return store;
}

/**
 * 仅用于单测隔离 / 重置模块级 Map；生产代码不得调用。
 * 纯内存操作，不抛错。
 */
export function __resetInputHistoryStoreForTest(): void {
    historyStores.clear();
}

export function useInputHistory(sessionId: string): InputHistoryControls {
    // ref（不触发重渲染）：浏览游标是「本次输入会话」瞬时态，随 key={sessionId} 重挂载重置
    const draftBufferRef = React.useRef<string>('');
    const historyIndexRef = React.useRef<number | null>(null);

    // state（触发重渲染）：isBrowsing 需要让 AgentInput 感知，必须用 state
    const [browsing, setBrowsing] = React.useState(false);

    const push = React.useCallback((text: string) => {
        if (text === '') return;
        const history = getOrCreateStore(sessionId).history;
        if (history.length > 0 && history[history.length - 1] === text) return; // 相邻去重
        history.push(text);
        if (history.length > HISTORY_MAX) history.shift(); // FIFO 软上限
        historyIndexRef.current = null;
        setBrowsing(false);
        draftBufferRef.current = '';
    }, [sessionId]);

    const navigateUp = React.useCallback((currentDraft: string): string | null => {
        const history = getOrCreateStore(sessionId).history;
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
    }, [sessionId]);

    const navigateDown = React.useCallback((): string | null => {
        const idx = historyIndexRef.current;
        if (idx === null) return null;
        const history = getOrCreateStore(sessionId).history;
        if (idx < history.length - 1) {
            historyIndexRef.current = idx + 1;
            return history[idx + 1];
        }
        // idx === length-1，越过最新，退出浏览
        historyIndexRef.current = null;
        setBrowsing(false);
        return draftBufferRef.current;
    }, [sessionId]);

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
