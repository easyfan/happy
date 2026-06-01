// @vitest-environment node
// TC-A1：验证 resumeSessionUnknownError 翻译 key 存在且非空（BUG-RESUME-A）
import { describe, it, expect } from 'vitest';
import { en } from '@/text/translations/en';
import { ru } from '@/text/translations/ru';
import { pl } from '@/text/translations/pl';
import { es } from '@/text/translations/es';
import { ca } from '@/text/translations/ca';
import { it as itLang } from '@/text/translations/it';
import { pt } from '@/text/translations/pt';
import { ja } from '@/text/translations/ja';
import { zhHans } from '@/text/translations/zh-Hans';
import { zhHant } from '@/text/translations/zh-Hant';

const ALL_LANGS: Record<string, typeof en> = {
    en, ru, pl, es, ca, it: itLang, pt, ja, zhHans, zhHant,
};

describe('BUG-RESUME-A: resumeSessionUnknownError translation key', () => {
    it('exists and is non-empty in all 10 language files', () => {
        for (const [lang, translations] of Object.entries(ALL_LANGS)) {
            const key = translations.sessionInfo?.resumeSessionUnknownError;
            expect(key, `Language ${lang}: sessionInfo.resumeSessionUnknownError missing`).toBeTruthy();
            expect(typeof key, `Language ${lang}: key should be string`).toBe('string');
        }
    });

    it('switch default case exists in useSessionQuickActions source', async () => {
        const fs = await import('fs');
        const path = await import('path');
        const src = fs.readFileSync(
            path.resolve(__dirname, 'useSessionQuickActions.ts'),
            'utf-8'
        );
        expect(src).toContain('resumeSessionUnknownError');
        expect(src).toContain('default:');
    });
});
