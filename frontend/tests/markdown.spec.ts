import { describe, expect, it } from 'vitest';

import { decodeReaction, decodeText, encodeReaction, encodeText, isEmoji } from '../src/lib/body.ts';
import { parseInline, parseMarkdown, plainOf, safeHref } from '../src/lib/markdown.ts';

describe('inline formatting, the way Discord reads it', () =>
{
    it('reads bold, italic, underline, strike, spoiler and code', () =>
    {
        expect(parseInline('**bold** *it* _it_ __under__ ~~gone~~ ||secret|| `x`')).toEqual([
            { t: 'b', c: [{ t: 'text', v: 'bold' }] },
            { t: 'text', v: ' ' },
            { t: 'i', c: [{ t: 'text', v: 'it' }] },
            { t: 'text', v: ' ' },
            { t: 'i', c: [{ t: 'text', v: 'it' }] },
            { t: 'text', v: ' ' },
            { t: 'u', c: [{ t: 'text', v: 'under' }] },
            { t: 'text', v: ' ' },
            { t: 's', c: [{ t: 'text', v: 'gone' }] },
            { t: 'text', v: ' ' },
            { t: 'spoiler', c: [{ t: 'text', v: 'secret' }] },
            { t: 'text', v: ' ' },
            { t: 'code', v: 'x' }
        ]);
    });

    it('nests, and takes three asterisks as bold around italic', () =>
    {
        expect(parseInline('***both***')).toEqual([{ t: 'b', c: [{ t: 'i', c: [{ t: 'text', v: 'both' }] }] }]);
        expect(parseInline('**a *b* c**')).toEqual([{ t: 'b', c: [
            { t: 'text', v: 'a ' },
            { t: 'i', c: [{ t: 'text', v: 'b' }] },
            { t: 'text', v: ' c' }
        ] }]);
    });

    it('leaves an unterminated marker as the character somebody typed', () =>
    {
        expect(parseInline('2 * 3 = 6')).toEqual([{ t: 'text', v: '2 * 3 = 6' }]);
        expect(parseInline('**open')).toEqual([{ t: 'text', v: '**open' }]);
    });

    it('does not italicise inside a word, so snake_case stays a name', () =>
    {
        expect(parseInline('snake_case_name')).toEqual([{ t: 'text', v: 'snake_case_name' }]);
    });

    it('honours a backslash and keeps code literal', () =>
    {
        expect(parseInline('\\*not\\*')).toEqual([{ t: 'text', v: '*not*' }]);
        expect(parseInline('`**raw**`')).toEqual([{ t: 'code', v: '**raw**' }]);
    });

    it('links a bare http url and leaves the sentence punctuation outside it', () =>
    {
        expect(parseInline('see https://nura.games/a.')).toEqual([
            { t: 'text', v: 'see ' },
            { t: 'link', href: 'https://nura.games/a' },
            { t: 'text', v: '.' }
        ]);
        expect(parseInline('(https://nura.games/x)')).toEqual([
            { t: 'text', v: '(' },
            { t: 'link', href: 'https://nura.games/x' },
            { t: 'text', v: ')' }
        ]);
    });

    it('never turns anything but http into a link', () =>
    {
        expect(safeHref('javascript:alert(1)')).toBeNull();
        expect(safeHref('data:text/html,hi')).toBeNull();
        expect(parseInline('javascript:alert(1)').some((node) => node.t === 'link')).toBe(false);
    });

    it('reads Persian inside the markers as it reads English', () =>
    {
        expect(parseInline('**سلام**')).toEqual([{ t: 'b', c: [{ t: 'text', v: 'سلام' }] }]);
    });
});

describe('blocks', () =>
{
    it('reads headings, quotes, lists and fenced code', () =>
    {
        const blocks = parseMarkdown('# Title\n> quoted\n> still\n- one\n- two\n1. first\n2. second\n```ts\nconst a = 1;\n```\nafter');

        expect(blocks.map((block) => block.t)).toEqual(['h', 'quote', 'list', 'list', 'pre', 'p']);
        expect(blocks[1]).toEqual({ t: 'quote', c: [{ t: 'text', v: 'quoted\nstill' }] });
        expect(blocks[3]).toMatchObject({ ordered: true, start: 1 });
        expect(blocks[4]).toEqual({ t: 'pre', v: 'const a = 1;', lang: 'ts' });
    });

    it('keeps an unclosed fence as text, and the lines of one paragraph together', () =>
    {
        expect(parseMarkdown('```\nno end')).toEqual([{ t: 'p', c: [{ t: 'text', v: '```\nno end' }] }]);
        expect(parseMarkdown('line one\nline two')).toEqual([{ t: 'p', c: [{ t: 'text', v: 'line one\nline two' }] }]);
    });

    it('needs the space after a heading mark, so a hashtag is not a heading', () =>
    {
        expect(parseMarkdown('#ludo')[0].t).toBe('p');
    });

    it('quotes everything after a triple quote mark', () =>
    {
        expect(parseMarkdown('>>> all\nof this')).toEqual([{ t: 'quote', c: [{ t: 'text', v: 'all\nof this' }] }]);
    });

    it('flattens to words for a preview, with the spoiler replaced', () =>
    {
        expect(plainOf('**hi** ||the end||', '[spoiler]')).toBe('hi [spoiler]');
    });
});

describe('the sealed plaintext is a document', () =>
{
    it('round-trips a reply and a forward', () =>
    {
        expect(decodeText(encodeText({ text: 'hi', reply: 'm1', fwd: true }))).toEqual({ text: 'hi', reply: 'm1', fwd: true });
        expect(decodeText(encodeText({ text: 'hi' }))).toEqual({ text: 'hi' });
    });

    it('refuses what is not a text document', () =>
    {
        expect(decodeText('just words')).toBeNull();
        expect(decodeText('[1]')).toBeNull();
        expect(decodeText(JSON.stringify({ text: 1 }))).toBeNull();
        expect(decodeText(JSON.stringify({ text: 'a', fwd: 'yes' }))).toBeNull();
    });

    it('refuses a reaction the server moved onto another message', () =>
    {
        const sealed = encodeReaction({ react: '👍', on: 'm1' });

        expect(decodeReaction(sealed, 'm1')).toBe('👍');
        expect(decodeReaction(sealed, 'm2')).toBeNull();
    });

    it('takes exactly one emoji as a reaction, and never a sentence', () =>
    {
        expect(isEmoji('👍')).toBe(true);
        expect(isEmoji('👨‍👩‍👧')).toBe(true);
        expect(isEmoji('🇮🇷')).toBe(true);
        expect(isEmoji('1️⃣')).toBe(true);
        expect(isEmoji('👍👍')).toBe(false);
        expect(isEmoji('buy now')).toBe(false);
        expect(decodeReaction(JSON.stringify({ react: 'buy now', on: 'm1' }), 'm1')).toBeNull();
    });
});
