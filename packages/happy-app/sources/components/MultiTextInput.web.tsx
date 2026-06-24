import * as React from 'react';
import { View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import TextareaAutosize from 'react-textarea-autosize';
import { Typography } from '@/constants/Typography';

export type SupportedKey = 'Enter' | 'Escape' | 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight' | 'Tab';

export interface KeyPressEvent {
    key: SupportedKey;
    shiftKey: boolean;
}

export type OnKeyPressCallback = (event: KeyPressEvent) => boolean;

export const MULTI_TEXT_INPUT_FONT_SIZE = 16;
export const MULTI_TEXT_INPUT_LINE_HEIGHT = 22;

export interface TextInputState {
    text: string;
    selection: {
        start: number;
        end: number;
    };
}

export interface MultiTextInputHandle {
    setTextAndSelection: (text: string, selection: { start: number; end: number }) => void;
    focus: () => void;
    blur: () => void;
}

interface MultiTextInputProps {
    value: string;
    onChangeText: (text: string) => void;
    placeholder?: string;
    maxHeight?: number;
    lineHeight?: number;
    paddingTop?: number;
    paddingBottom?: number;
    paddingLeft?: number;
    paddingRight?: number;
    onKeyPress?: OnKeyPressCallback;
    onSelectionChange?: (selection: { start: number; end: number }) => void;
    onStateChange?: (state: TextInputState) => void;
}

/**
 * bash readline word-erase（backward-kill-word）语义。
 * 从 pos 向左：先跳过连续空白（\s），再跳过连续非空白，删除该区间。
 * pos=0 时返回原文本不变。
 */
export function deleteWordBefore(text: string, pos: number): string {
    if (pos === 0) return text;

    let i = pos;
    // Step 1: 跳过光标前连续空白
    while (i > 0 && /\s/.test(text[i - 1])) {
        i--;
    }
    // Step 2: 跳过光标前连续非空白（单词本体）
    while (i > 0 && !/\s/.test(text[i - 1])) {
        i--;
    }
    // Step 3: 删除 [i, pos) 区间
    return text.slice(0, i) + text.slice(pos);
}

export const MultiTextInput = React.forwardRef<MultiTextInputHandle, MultiTextInputProps>((props, ref) => {
    const {
        value,
        onChangeText,
        placeholder,
        maxHeight = 120,
        lineHeight = MULTI_TEXT_INPUT_LINE_HEIGHT,
        onKeyPress,
        onSelectionChange,
        onStateChange
    } = props;
    
    const { theme } = useUnistyles();
    const textareaRef = React.useRef<HTMLTextAreaElement>(null);

    const maxRows = Math.floor(maxHeight / lineHeight);

    const handleKeyDown = React.useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        // ===== 新增：CTRL+W 删词（最优先，在 onKeyPress 检查之前）=====
        if ((e.ctrlKey || e.metaKey) && e.key === 'w') {
            e.preventDefault(); // 阻止浏览器关标签页（Ctrl+W）和 Cmd+W（macOS）
            const textarea = textareaRef.current;
            if (textarea) {
                const pos = textarea.selectionStart;
                const text = textarea.value;
                const newText = deleteWordBefore(text, pos);
                const deletedCount = text.length - newText.length;
                const newCursorPos = Math.max(0, pos - deletedCount);
                // 回写 DOM 并通知 React（同 setTextAndSelection 实现模式）
                textarea.value = newText;
                textarea.setSelectionRange(newCursorPos, newCursorPos);
                const inputEvent = new Event('input', { bubbles: true });
                textarea.dispatchEvent(inputEvent);
                onChangeText(newText);
                if (onStateChange) {
                    onStateChange({ text: newText, selection: { start: newCursorPos, end: newCursorPos } });
                }
            }
            return; // 不进入后续归一化逻辑
        }
        // ===== 新增结束 =====

        if (!onKeyPress) return;

        const isComposing = e.nativeEvent.isComposing || (e.nativeEvent as any).isComposing || e.keyCode === 229;
        if (isComposing) {
            return;
        }

        const key = e.key;
        
        // Map browser key names to our normalized format
        let normalizedKey: SupportedKey | null = null;
        
        switch (key) {
            case 'Enter':
                normalizedKey = 'Enter';
                break;
            case 'Escape':
                normalizedKey = 'Escape';
                break;
            case 'ArrowUp':
                normalizedKey = 'ArrowUp';
                break;
            case 'ArrowDown':
                normalizedKey = 'ArrowDown';
                break;
            case 'ArrowLeft':
                normalizedKey = 'ArrowLeft';
                break;
            case 'ArrowRight':
                normalizedKey = 'ArrowRight';
                break;
            case 'Tab':
                normalizedKey = 'Tab';
                break;
        }

        if (normalizedKey) {
            const keyEvent: KeyPressEvent = {
                key: normalizedKey,
                shiftKey: e.shiftKey
            };
            
            const handled = onKeyPress(keyEvent);
            if (handled) {
                e.preventDefault();
            }
        }
    }, [onKeyPress, onChangeText, onStateChange]);

    const handleChange = React.useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const text = e.target.value;
        const selection = { 
            start: e.target.selectionStart, 
            end: e.target.selectionEnd 
        };
        
        onChangeText(text);
        
        if (onStateChange) {
            onStateChange({ text, selection });
        }
        if (onSelectionChange) {
            onSelectionChange(selection);
        }
    }, [onChangeText, onStateChange, onSelectionChange]);

    const handleSelect = React.useCallback((e: React.SyntheticEvent<HTMLTextAreaElement>) => {
        const target = e.target as HTMLTextAreaElement;
        const selection = { 
            start: target.selectionStart, 
            end: target.selectionEnd 
        };
        
        if (onSelectionChange) {
            onSelectionChange(selection);
        }
        if (onStateChange) {
            onStateChange({ text: value, selection });
        }
    }, [value, onSelectionChange, onStateChange]);

    // Imperative handle for direct control
    React.useImperativeHandle(ref, () => ({
        setTextAndSelection: (text: string, selection: { start: number; end: number }) => {
            if (textareaRef.current) {
                // Directly set value and selection on DOM element
                textareaRef.current.value = text;
                textareaRef.current.setSelectionRange(selection.start, selection.end);
                
                // Trigger React's onChange by dispatching an input event
                const event = new Event('input', { bubbles: true });
                textareaRef.current.dispatchEvent(event);
                
                // Also call callbacks directly for immediate update
                onChangeText(text);
                if (onStateChange) {
                    onStateChange({ text, selection });
                }
                if (onSelectionChange) {
                    onSelectionChange(selection);
                }
            }
        },
        focus: () => {
            textareaRef.current?.focus();
        },
        blur: () => {
            textareaRef.current?.blur();
        }
    }), [onChangeText, onStateChange, onSelectionChange]);

    return (
        <View style={{ width: '100%' }}>
            <TextareaAutosize
                ref={textareaRef}
                style={{
                    width: '100%',
                    padding: '0',
                    fontSize: `${MULTI_TEXT_INPUT_FONT_SIZE}px`,
                    color: theme.colors.input.text,
                    border: 'none',
                    outline: 'none',
                    resize: 'none' as const,
                    backgroundColor: 'transparent',
                    fontFamily: Typography.default().fontFamily,
                    lineHeight: `${lineHeight}px`,
                    scrollbarWidth: 'none',
                    paddingTop: props.paddingTop,
                    paddingBottom: props.paddingBottom,
                    paddingLeft: props.paddingLeft,
                    paddingRight: props.paddingRight,
                }}
                placeholder={placeholder}
                value={value}
                onChange={handleChange}
                onSelect={handleSelect}
                onKeyDown={handleKeyDown}
                maxRows={maxRows}
                autoCapitalize="sentences"
                autoCorrect="on"
                autoComplete="off"
            />
        </View>
    );
});

MultiTextInput.displayName = 'MultiTextInput';
