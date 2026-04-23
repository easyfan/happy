import { describe, expect, it } from 'vitest';
import { interpretRemoteModeKeypress } from './RemoteModeDisplay';

describe('interpretRemoteModeKeypress', () => {
    it('switches immediately on Ctrl+T', () => {
        const result = interpretRemoteModeKeypress(
            { confirmationMode: null, actionInProgress: null },
            't',
            { ctrl: true },
        );
        expect(result.action).toBe('switch');
    });

    it('requires double space to switch when using spacebar', () => {
        const first = interpretRemoteModeKeypress(
            { confirmationMode: null, actionInProgress: null },
            ' ',
            {},
        );
        expect(first.action).toBe('confirm-switch');

        const second = interpretRemoteModeKeypress(
            { confirmationMode: 'switch', actionInProgress: null },
            ' ',
            {},
        );
        expect(second.action).toBe('switch');
    });

    it('requires double Ctrl-C to exit', () => {
        const first = interpretRemoteModeKeypress(
            { confirmationMode: null, actionInProgress: null },
            'c',
            { ctrl: true },
        );
        expect(first.action).toBe('confirm-exit');

        const second = interpretRemoteModeKeypress(
            { confirmationMode: 'exit', actionInProgress: null },
            'c',
            { ctrl: true },
        );
        expect(second.action).toBe('exit');
    });

    it('resets confirmation on any other key', () => {
        const result = interpretRemoteModeKeypress(
            { confirmationMode: 'switch', actionInProgress: null },
            'x',
            {},
        );
        expect(result.action).toBe('reset');
    });

    it('is a no-op when action is in progress', () => {
        const result = interpretRemoteModeKeypress(
            { confirmationMode: null, actionInProgress: 'switching' },
            't',
            { ctrl: true },
        );
        expect(result.action).toBe('none');
    });
});
