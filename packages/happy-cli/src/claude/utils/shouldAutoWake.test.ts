import { mkdtemp, writeFile, utimes, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { shouldAutoWake, AUTO_PROCEED_FRESHNESS_MS } from './shouldAutoWake';

describe('shouldAutoWake', () => {
    let tempDir: string;

    beforeEach(async () => {
        tempDir = await mkdtemp(join(tmpdir(), 'happy-test-'));
    });

    afterEach(async () => {
        await rm(tempDir, { recursive: true, force: true });
    });

    it('场景①：三联全满足（文件存在、mtime 新鲜、首行 auto_proceed: true）→ true', async () => {
        const handoffPath = join(tempDir, 'context-handoff.md');
        await writeFile(handoffPath, 'auto_proceed: true\n\nSome other content here\n');
        // mtime 默认为当前时间（写完即新鲜），无需回拨

        const result = await shouldAutoWake(handoffPath);
        expect(result).toBe(true);
    });

    it('场景②：文件不存在 → false（不抛异常）', async () => {
        const nonExistentPath = join(tempDir, 'does-not-exist.md');

        const result = await shouldAutoWake(nonExistentPath);
        expect(result).toBe(false);
    });

    it('场景③a：首行为 auto_proceed: false → false', async () => {
        const handoffPath = join(tempDir, 'context-handoff.md');
        await writeFile(handoffPath, 'auto_proceed: false\n\nSome content\n');

        const result = await shouldAutoWake(handoffPath);
        expect(result).toBe(false);
    });

    it('场景③b：首行为其他内容（非 auto_proceed: true）→ false', async () => {
        const handoffPath = join(tempDir, 'context-handoff.md');
        await writeFile(handoffPath, '# Context Handoff\nauto_proceed: true\n');

        const result = await shouldAutoWake(handoffPath);
        expect(result).toBe(false);
    });

    it('场景④：mtime 过期（> 900s 前）→ false', async () => {
        const handoffPath = join(tempDir, 'context-handoff.md');
        await writeFile(handoffPath, 'auto_proceed: true\n');

        // 回拨 mtime 至 901 秒前
        const pastDate = new Date(Date.now() - (AUTO_PROCEED_FRESHNESS_MS + 1000));
        await utimes(handoffPath, pastDate, pastDate);

        const result = await shouldAutoWake(handoffPath);
        expect(result).toBe(false);
    });

    it('场景⑤：handoffPath 指向目录（readFile 报 EISDIR）→ false（catch 兜底）', async () => {
        const dirPath = join(tempDir, 'subdir');
        await mkdir(dirPath);

        // stat 对目录成功，但 readFile 对目录抛 EISDIR → catch → false
        const result = await shouldAutoWake(dirPath);
        expect(result).toBe(false);
    });
});
