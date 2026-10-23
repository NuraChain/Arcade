import { describe, expect, it } from 'vitest';

import { searchedWords, searchLines } from '../src/components/chat/search-lines.ts';
import type { Message } from '../src/data/chat.ts';

const line = (id: string, text: string, at: number, extra: Partial<Message> = {}) =>
    ({ id, conversationId: 'room', from: 'sara.k', kind: 'text', text, at, ref: null, ...extra }) as Message;

const ids = (found: Message[]) => found.map((one) => one.id);

describe('the lines of a thread a search finds', () =>
{
    it('are those whose words hold what was typed, the newest first, folded as every search here folds', () =>
    {
        const lines = [
            line('a', 'You never resign', 10),
            line('b', 'NEVER.', 30),
            line('c', 'tonight at nine', 20)
        ];

        expect(ids(searchLines(lines, 'room', 'never', searchedWords))).toEqual(['b', 'a']);
        expect(ids(searchLines(lines, 'room', '  Never ', searchedWords)), 'spaces and case are not words').toEqual(['b', 'a']);
        expect(searchLines(lines, 'room', '   ', searchedWords), 'nothing typed finds nothing').toEqual([]);
    });

    it('reads Persian as it is typed, in Arabic letterforms or Persian digits', () =>
    {
        const lines = [line('a', 'جمعه قطعیه. ساعت ۹ میز بزرگ.', 10)];

        expect(ids(searchLines(lines, 'room', 'قطعيه', searchedWords)), 'an Arabic yeh').toEqual(['a']);
        expect(ids(searchLines(lines, 'room', 'ساعت 9', searchedWords)), 'a Latin digit for a Persian one').toEqual(['a']);
    });

    it('reads the words and not their marks, and never what a spoiler hides', () =>
    {
        const lines = [
            line('a', 'bring **the cards** and _the dice_', 10),
            line('b', 'the answer is ||nine||', 20)
        ];

        expect(ids(searchLines(lines, 'room', 'the cards and the dice', searchedWords))).toEqual(['a']);
        expect(searchLines(lines, 'room', 'nine', searchedWords), 'finding it would give the spoiler away').toEqual([]);
        expect(ids(searchLines(lines, 'room', 'the answer', searchedWords))).toEqual(['b']);
    });

    it('leaves out other rooms, lines it could not open, and lines nobody typed', () =>
    {
        const lines = [
            line('a', 'never', 10, { conversationId: 'elsewhere' }),
            line('b', 'never', 20, { locked: 'no-epoch-key' }),
            line('c', 'never', 30, { kind: 'system' }),
            line('d', 'never', 40, { kind: 'deleted' }),
            line('e', 'never', 50)
        ];

        expect(ids(searchLines(lines, 'room', 'never', searchedWords))).toEqual(['e']);
    });

    it('counts a line once however many lists hold it, the first holding it winning', () =>
    {
        const onScreen = [line('a', 'never again', 10)];
        const opened = [line('a', 'a line since edited', 10), line('b', 'never', 5)];

        expect(ids(searchLines([...onScreen, ...opened], 'room', 'never', searchedWords))).toEqual(['a', 'b']);
        expect(ids(searchLines([...opened, ...onScreen], 'room', 'never', searchedWords)), 'the edited words are what is found').toEqual(['b']);
    });
});
