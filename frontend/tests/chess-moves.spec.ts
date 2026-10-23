import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, fire, renderTest } from '@azerothjs/testing';
import { createSignal } from 'azerothjs';

import ChessMoves, { figuresOf } from '../src/components/games/chess-moves.component.azeroth';
import { manualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import '../src/locales/app-catalogue.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { useReview } from '../src/stores/review.store.ts';
import { useToasts } from '../src/stores/toasts.store.ts';
import type { MatchView } from '../src/api.ts';

type Rendered = HTMLElement;

type Chess = Extract<MatchView['view'], { kind: 'chess' }>;

const LEGAL = ['e4', 'e5', 'Nf3', 'd6', 'Bc4', 'Bg4', 'Nc3', 'g6', 'Nxe5', 'Bxd1', 'Bxf7+', 'Ke7', 'Nd5#'];

const match = (view: Partial<Chess> = {}, over: Partial<MatchView> = {}): MatchView => ({
    id: 'match-chess',
    tableId: 'table-chess',
    game: 'chess',
    rev: 14,
    seats: 2,
    players: [{ seat: 0, who: 'dana.w', timeouts: 0 }, { seat: 1, who: 'sara.k', timeouts: 0 }] as MatchView['players'],
    turn: 1,
    mine: 0,
    startedAt: new Date(Date.UTC(2026, 9, 23, 12)).toISOString(),
    remainingMs: 600_000,
    view: {
        kind: 'chess',
        white: 0,
        board: 'RNBQKBNRPPPPPPPP................................pppppppprnbqkbnr',
        turn: 'b',
        castling: 'KQkq',
        halfmove: 0,
        fullmove: 1,
        ply: LEGAL.length,
        clock: { base: 600_000, increment: 0, left: [600_000, 600_000] },
        notation: LEGAL,
        moved: [true, true],
        offered: [-1, -1],
        ...view
    },
    ...over
});

const flush = async () =>
{
    for (let turn = 0; turn < 12; turn += 1)
    {
        await Promise.resolve();
    }
};

const cells = (container: HTMLElement) => [...container.querySelectorAll<HTMLElement>('.chess-san')];

beforeEach(() =>
{
    cleanup();
    resetRuntime();
    setRuntime({ clock: manualClock(400_000), seed: 5 });
    useLocale().setLocale('en');
    useToasts().reset();
});

afterEach(() =>
{
    cleanup();
    vi.restoreAllMocks();
});

describe('a move written as a figurine score sheet writes it', () =>
{
    it('draws the piece that moved from the ivory set, whichever side moved it, and writes the squares', () =>
    {
        expect(figuresOf('Nf3')).toEqual({ lead: 'wn', head: 'f3', promo: undefined, tail: '' });
        expect(figuresOf('Bxd1')).toEqual({ lead: 'wb', head: 'xd1', promo: undefined, tail: '' });
        expect(figuresOf('e4')).toEqual({ lead: undefined, head: 'e4', promo: undefined, tail: '' });
        expect(figuresOf('O-O-O+')).toEqual({ lead: undefined, head: 'O-O-O+', promo: undefined, tail: '' });
    });

    it('draws the piece a pawn became', () =>
    {
        expect(figuresOf('exd8=Q+')).toEqual({ lead: undefined, head: 'exd8', promo: 'wq', tail: '+' });
        expect(figuresOf('a1=N')).toEqual({ lead: undefined, head: 'a1', promo: 'wn', tail: '' });
    });
});

describe('the moves of a chess game', () =>
{
    it('lists every move by number, White\'s first, marks the last one, and reads them left to right in Persian too', async () =>
    {
        useLocale().setLocale('fa');

        const { container } = renderTest(() => ChessMoves({ match: match() }) as Rendered);

        await flush();

        const list = container.querySelector<HTMLElement>('.chess-moves')!;

        expect(list.getAttribute('dir')).toBe('ltr');
        expect(cells(container)).toHaveLength(LEGAL.length);
        expect([...container.querySelectorAll('.chess-moves-n:not([data-black])')].map((one) => one.textContent)).toEqual(['۱.', '۲.', '۳.', '۴.', '۵.', '۶.', '۷.']);
        expect(cells(container).filter((one) => one.hasAttribute('data-last'))).toEqual([cells(container).at(-1)]);
        expect(cells(container)[2].querySelector('i[data-piece="wn"]')).not.toBeNull();
        expect(cells(container)[9].querySelector('i[data-piece="wb"]')).not.toBeNull();
        expect(cells(container)[0].querySelector('i[data-piece]')).toBeNull();
        expect(cells(container)[12].querySelector('.sr-only')?.textContent).toBe('۷. Nd5#');
    });

    it('takes a move in where it stands, the rows kept, and moves the mark to it', async () =>
    {
        const [current, setCurrent] = createSignal(match({ notation: LEGAL.slice(0, 12), ply: 12 }));
        const { container } = renderTest(() => ChessMoves({
            get match()
            {
                return current();
            }
        }) as Rendered);

        await flush();

        const before = cells(container);

        setCurrent(match());
        await flush();

        expect(cells(container).slice(0, 12)).toEqual(before);
        expect(cells(container).at(-1)?.hasAttribute('data-last')).toBe(true);
        expect(before.at(-1)?.hasAttribute('data-last')).toBe(false);
    });

    it('says there are no moves yet, and offers no PGN of nothing', async () =>
    {
        const { container } = renderTest(() => ChessMoves({ match: match({ notation: [], ply: 0 }) }) as Rendered);

        await flush();

        expect(container.textContent).toContain('No moves yet.');
        expect([...container.querySelectorAll('button')].find((one) => one.textContent?.includes('Copy PGN'))?.disabled).toBe(true);
    });

    it('copies the game as PGN, with who played which side and how it ended', async () =>
    {
        const writeText = vi.fn<(text: string) => Promise<void>>(async () => undefined);

        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });

        const finished = match({ over: { reason: 'checkmate', winner: 0 } }, { finishedAt: new Date(Date.UTC(2026, 9, 23, 12, 9)).toISOString() });
        const { container } = renderTest(() => ChessMoves({ match: finished }) as Rendered);

        await flush();
        fire([...container.querySelectorAll('button')].find((one) => one.textContent?.includes('Copy PGN'))!, 'click');
        await flush();

        const pgn = String(writeText.mock.calls[0]?.[0] ?? '');

        expect(pgn).toContain('[White "dana.w"]');
        expect(pgn).toContain('[Black "sara.k"]');
        expect(pgn).toContain('[Result "1-0"]');
        expect(pgn).toContain('[TimeControl "600"]');
        expect(pgn).toContain('7. Nd5# 1-0');
        expect(useToasts().items().map((one) => one.text)).toContain('The game is copied as PGN.');

        Reflect.deleteProperty(navigator, 'clipboard');
    });

    it.each([
        ['a win for Black', { over: { reason: 'resign', winner: 1 } }, '0-1'],
        ['a draw', { over: { reason: 'stalemate' } }, '1/2-1/2'],
        ['a game called off', { over: { reason: 'abort' } }, '*']
    ] as const)('writes %s as PGN does', async (_, view, result) =>
    {
        const writeText = vi.fn<(text: string) => Promise<void>>(async () => undefined);

        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });

        const { container } = renderTest(() => ChessMoves({ match: match(view as Partial<Chess>, { finishedAt: new Date(Date.UTC(2026, 9, 23, 12, 9)).toISOString() }) }) as Rendered);

        await flush();
        fire([...container.querySelectorAll('button')].find((one) => one.textContent?.includes('Copy PGN'))!, 'click');
        await flush();

        expect(String(writeText.mock.calls[0]?.[0] ?? '')).toContain(`[Result "${ result }"]`);

        Reflect.deleteProperty(navigator, 'clipboard');
    });

    it('writes a game still going as one with no result', async () =>
    {
        const writeText = vi.fn<(text: string) => Promise<void>>(async () => undefined);

        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });

        const { container } = renderTest(() => ChessMoves({ match: match() }) as Rendered);

        await flush();
        fire([...container.querySelectorAll('button')].find((one) => one.textContent?.includes('Copy PGN'))!, 'click');
        await flush();

        expect(String(writeText.mock.calls[0]?.[0] ?? '')).toContain('[Result "*"]');

        Reflect.deleteProperty(navigator, 'clipboard');
    });
});

describe('a finished game stepped through from its moves', () =>
{
    const finished = () => match({ over: { reason: 'checkmate', winner: 0 } }, { finishedAt: new Date(Date.UTC(2026, 9, 23, 12, 9)).toISOString() });

    const press = (container: HTMLElement, label: string) => fire([...container.querySelectorAll<HTMLButtonElement>('button')].find((one) => one.getAttribute('aria-label') === label)!, 'click');

    const control = (container: HTMLElement, label: string) => [...container.querySelectorAll<HTMLButtonElement>('button')].find((one) => one.getAttribute('aria-label') === label);

    const key = (container: HTMLElement, name: string) => container.querySelector('section')!.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }));

    const line = (container: HTMLElement) => container.querySelector('[aria-live="polite"]')?.textContent ?? '';

    beforeEach(() =>
    {
        useReview().end();
    });

    it('makes every move a button that shows the board after it, and marks the move it shows', async () =>
    {
        const { container } = renderTest(() => ChessMoves({ match: finished() }) as Rendered);

        await flush();

        expect(cells(container).every((one) => one.tagName === 'BUTTON')).toBe(true);
        expect(cells(container).at(-1)?.getAttribute('aria-current')).toBe('step');
        expect(line(container)).toBe('');

        fire(cells(container)[2], 'click');
        await flush();

        expect(useReview().looking()).toEqual({ match: 'match-chess', ply: 3 });
        expect(cells(container).filter((one) => one.hasAttribute('data-last'))).toEqual([cells(container)[2]]);
        expect(cells(container)[2].getAttribute('aria-current')).toBe('step');
        expect(line(container)).toBe('The board after 2. Nf3');

        fire(cells(container).at(-1)!, 'click');
        await flush();

        expect(useReview().looking()).toBeNull();
    });

    it('steps back and on, to the start and to the end, by its buttons and its keys, and stops at each end', async () =>
    {
        const { container } = renderTest(() => ChessMoves({ match: finished() }) as Rendered);

        await flush();

        expect(control(container, 'One move on')?.disabled).toBe(true);
        expect(control(container, 'To the end')?.disabled).toBe(true);

        press(container, 'One move back');
        await flush();

        expect(useReview().looking()?.ply).toBe(12);

        key(container, 'ArrowLeft');
        await flush();

        expect(useReview().looking()?.ply).toBe(11);
        expect(line(container)).toBe('The board after 6. Bxf7+');

        key(container, 'Home');
        await flush();

        expect(useReview().looking()?.ply).toBe(0);
        expect(cells(container).some((one) => one.hasAttribute('data-last'))).toBe(false);
        expect(line(container)).toBe('The board before the first move');
        expect(control(container, 'To the start')?.disabled).toBe(true);
        expect(control(container, 'One move back')?.disabled).toBe(true);

        press(container, 'One move back');
        key(container, 'ArrowRight');
        await flush();

        expect(useReview().looking()?.ply).toBe(1);

        press(container, 'To the end');
        await flush();

        expect(useReview().looking()).toBeNull();
        expect(line(container)).toBe('');

        key(container, 'ArrowRight');
        await flush();

        expect(useReview().looking()).toBeNull();

        key(container, 'ArrowLeft');
        key(container, 'End');
        await flush();

        expect(useReview().looking()).toBeNull();
    });

    it('minds no other game that is being stepped through', async () =>
    {
        useReview().show('another-match', 2);

        const { container } = renderTest(() => ChessMoves({ match: finished() }) as Rendered);

        await flush();

        expect(cells(container).filter((one) => one.hasAttribute('data-last'))).toEqual([cells(container).at(-1)]);
        expect(line(container)).toBe('');
        expect(control(container, 'One move on')?.disabled).toBe(true);
    });

    it('offers no stepping while the game goes on, and says nothing about another game being stepped through', async () =>
    {
        useReview().show('another-match', 2);

        const { container } = renderTest(() => ChessMoves({ match: match() }) as Rendered);

        await flush();

        expect(cells(container).every((one) => one.tagName === 'SPAN')).toBe(true);
        expect(control(container, 'To the start')).toBeUndefined();
        expect(cells(container).at(-1)?.hasAttribute('data-last')).toBe(true);

        key(container, 'Home');
        await flush();

        expect(useReview().looking()).toEqual({ match: 'another-match', ply: 2 });
    });

    it('steps in Persian with the same keys, the moves still read left to right', async () =>
    {
        useLocale().setLocale('fa');

        const { container } = renderTest(() => ChessMoves({ match: finished() }) as Rendered);

        await flush();
        key(container, 'ArrowLeft');
        await flush();

        expect(useReview().looking()?.ply).toBe(12);
        expect(line(container)).toBe('صفحه بعد از ۶... Ke7');
        expect(container.querySelector('[role="group"]')?.getAttribute('dir')).toBe('ltr');
    });
});
