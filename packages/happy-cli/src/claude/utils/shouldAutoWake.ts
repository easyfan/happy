import { stat, readFile } from 'node:fs/promises';

/**
 * 900 秒新鲜度阈值（与 context-pilot hook 侧语义一致，独立实现，非跨包复用）。
 * 导出供单测引用，避免魔术数字。
 */
export const AUTO_PROCEED_FRESHNESS_MS = 900 * 1000;

/**
 * 判断 remote /clear 后是否应立即 auto-wake 重生。
 *
 * 三联检测：
 *  1. handoff 文件存在（stat 成功）
 *  2. 文件 mtime 新鲜（< 900s）
 *  3. 首行精确为 `auto_proceed: true`
 *
 * 仅依赖 Node.js 内置 fs/promises（stat + readFile）。
 * 任何读取/解析异常一律视为 false（优雅降级）。
 * 对调用方保证：永不抛异常。
 *
 * @param handoffPath  完整 handoff 文件路径（由调用方构造，便于单测传临时目录路径）
 * @returns Promise<boolean>  true = 三联全满足，应立即重生；false = 任一不满足或异常
 */
export async function shouldAutoWake(handoffPath: string): Promise<boolean> {
    try {
        const s = await stat(handoffPath);

        const freshness = Date.now() - s.mtimeMs;
        if (freshness >= AUTO_PROCEED_FRESHNESS_MS) {
            return false;
        }

        const content = await readFile(handoffPath, 'utf-8');
        // [ESCALATE] BOM: if context-pilot hook ever runs on Windows/editors that emit BOM,
        // ﻿ prefix survives trim() and breaks the match. Current hook is macOS shell,
        // BOM is not generated. Tech-lead to confirm cross-platform requirement.
        const firstLine = content.split('\n')[0].trim();
        if (firstLine !== 'auto_proceed: true') {
            return false;
        }

        return true;
    } catch {
        return false;
    }
}
