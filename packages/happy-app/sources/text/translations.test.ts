import { describe, it, expect } from 'vitest';
import { en } from './_default';
import { en as enLang } from './translations/en';
import { ru } from './translations/ru';
import { pl } from './translations/pl';
import { es } from './translations/es';
import { ca } from './translations/ca';
import { it as itLang } from './translations/it';
import { pt } from './translations/pt';
import { ja } from './translations/ja';
import { zhHans } from './translations/zh-Hans';
import { zhHant } from './translations/zh-Hant';

/**
 * Recursively extract all leaf key paths from a translation object.
 * Leaves are string | function values; internal nodes are plain objects.
 * Returns a Set of dot-notation paths, e.g. 'common.cancel', 'tools.names.task'.
 */
function extractKeyPaths(obj: Record<string, unknown>, prefix = ''): Set<string> {
    const result = new Set<string>();
    for (const [key, value] of Object.entries(obj)) {
        const path = prefix ? `${prefix}.${key}` : key;
        if (typeof value === 'string' || typeof value === 'function') {
            result.add(path);
        } else if (value !== null && typeof value === 'object') {
            for (const nested of extractKeyPaths(value as Record<string, unknown>, path)) {
                result.add(nested);
            }
        }
    }
    return result;
}

const REFERENCE_KEYS = extractKeyPaths(en as unknown as Record<string, unknown>);

const ALL_LANGUAGES: Array<{ name: string; translations: unknown }> = [
    { name: 'en (translations/en.ts)', translations: enLang },
    { name: 'ru', translations: ru },
    { name: 'pl', translations: pl },
    { name: 'es', translations: es },
    { name: 'ca', translations: ca },
    { name: 'it', translations: itLang },
    { name: 'pt', translations: pt },
    { name: 'ja', translations: ja },
    { name: 'zh-Hans', translations: zhHans },
    { name: 'zh-Hant', translations: zhHant },
];

describe('TC-07: Translation key completeness', () => {
    it('reference (_default.ts en) should have 695 keys', () => {
        expect(REFERENCE_KEYS.size).toBe(695);
    });

    for (const lang of ALL_LANGUAGES) {
        it(`[${lang.name}] should contain all reference keys with no missing or extra keys`, () => {
            const langKeys = extractKeyPaths(lang.translations as Record<string, unknown>);

            const missing = [...REFERENCE_KEYS].filter(k => !langKeys.has(k));
            const extra = [...langKeys].filter(k => !REFERENCE_KEYS.has(k));

            if (missing.length > 0) {
                console.error(`[${lang.name}] Missing keys (${missing.length}):\n  ${missing.join('\n  ')}`);
            }
            if (extra.length > 0) {
                console.error(`[${lang.name}] Extra keys (${extra.length}):\n  ${extra.join('\n  ')}`);
            }

            expect(missing, `Missing keys in ${lang.name}`).toEqual([]);
            expect(extra, `Extra keys in ${lang.name}`).toEqual([]);
        });
    }
});
