// @vitest-environment node

import { describe, it, expect } from 'vitest';
import { deleteWordBefore } from './MultiTextInput.web';

describe('deleteWordBefore', () => {
    it('光标末尾删最后一词：hello world → hello ', () => {
        expect(deleteWordBefore('hello world', 11)).toBe('hello ');
    });

    it('光标在字符串中间删词（保留光标后内容）：hello world, pos=5 → ""+"world"', () => {
        // pos=5 在 "hello" 之后（紧贴空格前）
        // step1: 无空白 → step2: 跳 'hello'(5个) → 删 [0,5) → "" + " world"
        expect(deleteWordBefore('hello world', 5)).toBe(' world');
    });

    it('光标前有多个连续空格：先跳空格再删词', () => {
        // "hello  world", pos=12（末尾）
        // step1: 跳 'd','l','r','o','w' 无空白 → step2 跳 'world'(5) → 删 → "hello  "
        // 修正：pos=12, text="hello  world" (len=12)
        // step1: text[11]='d' 非空白 → 无跳 → step2: 跳'world'(5) i=7 → "hello  "
        expect(deleteWordBefore('hello  world', 12)).toBe('hello  ');
    });

    it('光标在串首（pos=0）：无效果，文本不变', () => {
        expect(deleteWordBefore('hello', 0)).toBe('hello');
    });

    it('光标前只有空白：删掉全部前导空白', () => {
        // "  " pos=2：step1 跳2个空格 i=0 → step2 i已为0 → 删 [0,2) → ""
        expect(deleteWordBefore('  ', 2)).toBe('');
    });

    it('光标前只有空白前缀 + 单词："  hello", pos=7 → "  "', () => {
        // step1: 无空白（text[6]='o'）→ step2: 跳'hello'(5) i=2 → "  "
        expect(deleteWordBefore('  hello', 7)).toBe('  ');
    });

    it('"a b", pos=3（b后） → "a "，新光标=2', () => {
        // step1: 无空白（text[2]='b'）→ step2: 跳'b'(1) i=2 → "a " + ""
        expect(deleteWordBefore('a b', 3)).toBe('a ');
    });

    it('空字符串 pos=0：返回原文本', () => {
        expect(deleteWordBefore('', 0)).toBe('');
    });

    it('纯空白 "  " pos=2 → ""', () => {
        expect(deleteWordBefore('  ', 2)).toBe('');
    });

    it('光标在字符串中间、光标后有内容时保留后部', () => {
        // "abc def", pos=3（abc 后）
        // step1: 无空白(text[2]='c') → step2: 跳'abc' i=0 → "" + " def"
        expect(deleteWordBefore('abc def', 3)).toBe(' def');
    });

    // \n 跨行删词（bash 标准行为：\n 视为空白，跨行合并）
    it('行首 \\n 后按 CTRL+W：跳 \\n 再删上一行末词，两行合并', () => {
        // "foo\nbar", pos=4（\n 后，行首）
        // step1: text[3]='\n' 是空白 → i=3 → step2: 跳 'foo'(3) i=0 → 删 [0,4) → "bar"
        expect(deleteWordBefore('foo\nbar', 4)).toBe('bar');
    });

    it('多行中间行内删词：不碰前行', () => {
        // "line1\nline2 word", pos=16（末尾）
        // step1: 无空白（text[15]='d'）→ step2: 跳 'word'(4) i=12 → 删 [12,16) → "line1\nline2 "
        expect(deleteWordBefore('line1\nline2 word', 16)).toBe('line1\nline2 ');
    });

    it('连续两 \\n 后按 CTRL+W：跳两 \\n 再删 foo', () => {
        // "foo\n\nbar", pos=5（第二 \n 后）
        // step1: text[4]='\n', text[3]='\n' → i=3 → step2: 跳 'foo'(3) i=0 → 删 [0,5) → "bar"
        expect(deleteWordBefore('foo\n\nbar', 5)).toBe('bar');
    });

    it('行末 \\n 后按 CTRL+W：删整行内容', () => {
        // "foo\n", pos=4（\n 后，即末尾）
        // step1: text[3]='\n' → i=3 → step2: 跳 'foo'(3) i=0 → 删 [0,4) → ""
        expect(deleteWordBefore('foo\n', 4)).toBe('');
    });
});
