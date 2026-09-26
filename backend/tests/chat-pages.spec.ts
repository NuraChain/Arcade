import { describe, it, expect } from 'vitest';

import { THREAD_MOST, THREAD_PAGE, threadSize } from '../src/domains/chat/pages.ts';

describe('how much of a thread one read may ask for', () =>
{
    it('is a page when the reader asks for nothing in particular', () =>
    {
        expect(threadSize(undefined)).toBe(THREAD_PAGE);
        expect(threadSize('')).toBe(THREAD_PAGE);
        expect(threadSize('lots')).toBe(THREAD_PAGE);
    });

    it('is what the reader asked for while that is a sensible number', () =>
    {
        expect(threadSize('80')).toBe(80);
        expect(threadSize('1')).toBe(1);
    });

    it('never lets one request walk the whole of a long conversation', () =>
    {
        expect(threadSize('999')).toBe(THREAD_MOST);
        expect(threadSize('0')).toBe(1);
        expect(threadSize('-40')).toBe(1);
    });
});
