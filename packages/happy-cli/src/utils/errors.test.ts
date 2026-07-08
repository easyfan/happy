import { describe, it, expect } from 'vitest';
import { AppError, isAppError } from './errors';

describe('AppError', () => {
    it('carries code, message, and optional detail', () => {
        const err = new AppError('SOME_CODE', 'human message', { extra: 1 });
        expect(err.code).toBe('SOME_CODE');
        expect(err.message).toBe('human message');
        expect(err.detail).toEqual({ extra: 1 });
        expect(err).toBeInstanceOf(Error);
        expect(err).toBeInstanceOf(AppError);
        expect(err.name).toBe('AppError');
    });

    it('detail is optional', () => {
        const err = new AppError('NO_DETAIL', 'msg');
        expect(err.detail).toBeUndefined();
    });
});

describe('isAppError', () => {
    it('matches any AppError without code filter', () => {
        expect(isAppError(new AppError('A', 'm'))).toBe(true);
    });

    it('matches only the given code when provided', () => {
        const err = new AppError('A', 'm');
        expect(isAppError(err, 'A')).toBe(true);
        expect(isAppError(err, 'B')).toBe(false);
    });

    it('rejects plain Error and non-errors', () => {
        expect(isAppError(new Error('x'))).toBe(false);
        expect(isAppError('x')).toBe(false);
        expect(isAppError(null)).toBe(false);
    });
});
