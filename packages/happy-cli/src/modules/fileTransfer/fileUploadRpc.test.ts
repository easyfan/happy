import { describe, expect, it } from 'vitest';
import * as path from 'node:path';

/**
 * TECH-23: 验证 path.basename 对路径穿越攻击向量的截断行为。
 *
 * 这些测试覆盖 fileUploadRpc.ts 行 76 的核心防御逻辑：
 *   path.join(uploadDir, `${params.uploadId}-${path.basename(filename)}`)
 *
 * 不需要 mock 或真实 server：path.basename 是纯函数，行为确定。
 */
describe('fileUploadRpc — filename path traversal defense (TECH-23)', () => {
    describe('path.basename strips directory components', () => {
        it('strips single ../ prefix: ../evil.txt -> evil.txt', () => {
            const filename = '../evil.txt';
            const safe = path.basename(filename);
            expect(safe).toBe('evil.txt');
        });

        it('strips multi-level traversal: ../../etc/passwd -> passwd', () => {
            const filename = '../../etc/passwd';
            const safe = path.basename(filename);
            expect(safe).toBe('passwd');
        });

        it('strips absolute path: /etc/shadow -> shadow', () => {
            const filename = '/etc/shadow';
            const safe = path.basename(filename);
            expect(safe).toBe('shadow');
        });

        it('strips nested subdir: subdir/nested/file.pdf -> file.pdf', () => {
            const filename = 'subdir/nested/file.pdf';
            const safe = path.basename(filename);
            expect(safe).toBe('file.pdf');
        });
    });

    describe('path.basename preserves legitimate filenames unchanged', () => {
        it('plain filename without dirs: photo.jpg -> photo.jpg', () => {
            const filename = 'photo.jpg';
            const safe = path.basename(filename);
            expect(safe).toBe('photo.jpg');
        });

        it('filename with dots but no dir: report.v2.final.pdf -> report.v2.final.pdf', () => {
            const filename = 'report.v2.final.pdf';
            const safe = path.basename(filename);
            expect(safe).toBe('report.v2.final.pdf');
        });

        it('filename with spaces: my document.docx -> my document.docx', () => {
            const filename = 'my document.docx';
            const safe = path.basename(filename);
            expect(safe).toBe('my document.docx');
        });

        it('hidden file (dotfile): .env -> .env', () => {
            const filename = '.env';
            const safe = path.basename(filename);
            expect(safe).toBe('.env');
        });
    });

    describe('path.join + path.basename cannot escape uploadDir', () => {
        it('joining uploadDir with traversal filename stays within uploadDir', () => {
            const uploadDir = '/home/user/.happy/uploads/session-abc';
            const uploadId = 'upload-001';
            const filename = '../evil.txt';

            const localPath = path.join(uploadDir, `${uploadId}-${path.basename(filename)}`);

            // Must start with uploadDir
            expect(localPath.startsWith(uploadDir)).toBe(true);
            // Must end with the safe filename, not escape the dir
            expect(localPath).toBe(`${uploadDir}/${uploadId}-evil.txt`);
        });

        it('joining uploadDir with absolute path filename stays within uploadDir', () => {
            const uploadDir = '/home/user/.happy/uploads/session-abc';
            const uploadId = 'upload-002';
            const filename = '/etc/passwd';

            const localPath = path.join(uploadDir, `${uploadId}-${path.basename(filename)}`);

            expect(localPath.startsWith(uploadDir)).toBe(true);
            expect(localPath).toBe(`${uploadDir}/${uploadId}-passwd`);
        });

        it('joining uploadDir with legitimate filename produces expected path', () => {
            const uploadDir = '/home/user/.happy/uploads/session-abc';
            const uploadId = 'upload-003';
            const filename = 'photo.jpg';

            const localPath = path.join(uploadDir, `${uploadId}-${path.basename(filename)}`);

            expect(localPath).toBe(`${uploadDir}/${uploadId}-photo.jpg`);
        });
    });
});
