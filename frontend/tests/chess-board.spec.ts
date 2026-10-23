import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, renderTest } from '@azerothjs/testing';
import { batch, createSignal } from 'azerothjs';

import ChessBoard from '../src/components/games/chess-board.component.azeroth';
import MatchResult from '../src/components/games/match-result.component.azeroth';
import { SIZE, SQUARE, spotOf, type Foot } from '../src/game/chess-layout.ts';
import { GLIDE_MOST } from '../src/game/board/chess-table.ts';
import { manualClock, type ManualClock } from '../src/lib/clock.ts';
import { resetRuntime, runtime, setRuntime } from '../src/lib/runtime.ts';
import '../src/locales/app-catalogue.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { NO_EVENTS, useBoard, type EventBatch, type MatchEvent } from '../src/stores/match.store.ts';
import { useReview } from '../src/stores/review.store.ts';
import { useSettings } from '../src/stores/settings.store.ts';
import type { MatchView } from '../src/api.ts';
import { parseFen, squareNamed } from '../../backend/src/domains/match/chess/board.ts';

const told = vi.hoisted(() => ({ heard: [] as string[], games: [] as string[] }));

vi.mock('../src/game/sound.ts', async (original) =>
{
    const real = await original<typeof import('../src/game/sound.ts')>();

    return {
        ...real,
        createSound: (_on: boolean, game?: string) =>
        {
            told.games.push(game ?? 'none');

            return {
                play: (cue: string) =>
                {
                    told.heard.push(cue);
                },
                setEnabled: () => undefined,
                dispose: () => undefined
            };
        }
    };
});

type Rendered = HTMLElement;

type Chess = Extract<MatchView['view'], { kind: 'chess' }>;

type Played = Extract<MatchEvent['log'], { kind: 'chess' }>['moves'][number];

const sq = (name: string) => squareNamed(name)!;

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

const fen = (text: string) =>
{
    const position = parseFen(text)!;

    return { board: position.board, turn: position.turn, castling: position.castling, ...(position.ep === null ? {} : { ep: position.ep }), halfmove: position.halfmove, fullmove: position.fullmove };
};

const match = (view: Partial<Chess> = {}, mine: number | null = 0, over: Partial<MatchView> = {}): MatchView => ({
    id: 'match-chess',
    tableId: 'table-chess',
    game: 'chess',
    rev: 4,
    seats: 2,
    players: [0, 1].map((seat) => ({ seat, who: seat === 0 ? 'dana.w' : 'omid.k', timeouts: 0 })) as MatchView['players'],
    turn: 0,
    ...(mine === null ? {} : { mine }),
    startedAt: new Date(400_000).toISOString(),
    remainingMs: 600_000,
    view: {
        kind: 'chess',
        white: 0,
        ...fen(START),
        ply: 0,
        clock: { base: 600_000, increment: 0, left: [600_000, 600_000] },
        notation: [],
        moved: [true, true],
        offered: [-1, -1],
        ...view
    },
    ...over
});

const happened = (rev: number, seat: number, moves: Played[]): MatchEvent => ({ rev, seat, at: '', log: { kind: 'chess', moves } });

const flush = async () =>
{
    for (let turn = 0; turn < 12; turn += 1)
    {
        await Promise.resolve();
    }
};

const elapse = async (ms: number) =>
{
    const clock = runtime().clock as ManualClock;

    for (let left = ms; left > 0; left -= 10)
    {
        clock.advance(Math.min(10, left));
        await flush();
    }

    await flush();
};

const live = async (first: MatchView, heard: EventBatch = NO_EVENTS) =>
{
    const [current, setCurrent] = createSignal(first);
    const [told, setTold] = createSignal<EventBatch>(heard);
    const view = renderTest(() => ChessBoard({
        get match()
        {
            return current();
        },
        get events()
        {
            return told();
        }
    }) as Rendered);

    await flush();

    return {
        ...view,
        current,
        move: (next: MatchView) => setCurrent(next),
        tell: (next: MatchView, events: MatchEvent[]) => batch(() =>
        {
            setCurrent(next);
            setTold((held) => ({ seq: held.seq + 1, id: next.id, events, live: true, jump: false }));
        })
    };
};

const wood = (container: HTMLElement) =>
{
    const el = container.querySelector<HTMLElement>('.chess-wood')!;

    el.getBoundingClientRect = () => ({ left: 0, top: 0, width: SIZE, height: SIZE, right: SIZE, bottom: SIZE, x: 0, y: 0, toJSON: () => ({}) });

    return el;
};

const centre = (square: number, foot: Foot = 'w') =>
{
    const spot = spotOf(square, foot);

    return { x: spot.x + SQUARE / 2, y: spot.y + SQUARE / 2 };
};

const pointer = (container: HTMLElement, type: string, x: number, y: number, over: PointerEventInit = {}) =>
{
    wood(container).dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, bubbles: true, pointerId: 3, isPrimary: true, button: 0, pointerType: 'mouse', ...over }));
};

const tap = (container: HTMLElement, name: string, foot: Foot = 'w') =>
{
    const { x, y } = centre(sq(name), foot);

    pointer(container, 'pointerdown', x, y);
    pointer(container, 'pointerup', x, y);
};

const drag = (container: HTMLElement, from: string, to: string, foot: Foot = 'w') =>
{
    const start = centre(sq(from), foot);
    const end = centre(sq(to), foot);

    pointer(container, 'pointerdown', start.x, start.y);
    pointer(container, 'pointermove', start.x + 20, start.y - 20);
    pointer(container, 'pointermove', end.x, end.y);
    pointer(container, 'pointerup', end.x, end.y);
};

const cq = (units: number) => `${ (units / SIZE * 100).toFixed(3) }cqw`;

const at = (square: number, foot: Foot = 'w') =>
{
    const spot = spotOf(square, foot);

    return `${ cq(spot.x) } ${ cq(spot.y) }`;
};

const pieceOn = (container: HTMLElement, name: string, foot: Foot = 'w') =>
    [...container.querySelectorAll<HTMLElement>('.chess-layer .cp')].find((el) => el.style.translate === at(sq(name), foot) && !el.hasAttribute('data-gone')) ?? null;

const marks = (container: HTMLElement, kind: string) =>
    [...container.querySelectorAll<HTMLElement>(`.chess-layer .cmk[data-kind="${ kind }"]`)].filter((mark) => !mark.hidden);

const button = (container: HTMLElement, label: string) =>
    [...container.querySelectorAll('button')].find((one) => one.getAttribute('aria-label') === label || one.textContent?.trim() === label) as HTMLButtonElement | undefined;

const said = (container: HTMLElement) => container.querySelector('.chess-bar [aria-live="polite"]')?.textContent ?? null;

const stageOf = (container: HTMLElement) => container.querySelector('.table-stage') as HTMLElement;

beforeEach(() =>
{
    cleanup();
    resetRuntime();
    setRuntime({ clock: manualClock(400_000), seed: 3 });
    useLocale().setLocale('en');
    useSettings().reset();
    told.heard = [];
    told.games = [];
});

afterEach(() =>
{
    cleanup();
    vi.restoreAllMocks();
});

describe('a chess board, drawn', () =>
{
    it('plays from chess\'s own sounds, and its clocks from the shared ones', async () =>
    {
        await live(match());

        expect(told.games).toContain('chess');
        expect(told.games.filter((game) => game !== 'none')).toEqual(['chess']);
    });

    it('stands the pieces where the board says, with the reader\'s colour at the foot', async () =>
    {
        const white = await live(match());

        expect(white.container.querySelectorAll('.chess-layer .cp')).toHaveLength(32);
        expect(pieceOn(white.container, 'e1')?.dataset.piece).toBe('wk');
        expect(spotOf(sq('e1'), 'w').y).toBeGreaterThan(SIZE / 2);
        white.unmount();

        const black = await live(match({}, 1));

        expect(pieceOn(black.container, 'e8', 'b')?.dataset.piece).toBe('bk');
        expect(spotOf(sq('e8'), 'b').y).toBeGreaterThan(SIZE / 2);
    });

    it('stands White at the foot for somebody watching, and gives them nothing on the board to press', async () =>
    {
        const { container } = await live(match({}, null));

        expect(pieceOn(container, 'e1')?.dataset.piece).toBe('wk');
        expect(container.querySelector('.chess-cursor')).toBeNull();

        tap(container, 'e2');

        expect(marks(container, 'held')).toEqual([]);
    });

    it('keeps the board left to right in Persian, as a printed board is', async () =>
    {
        useLocale().setLocale('fa');

        const { container } = await live(match());

        expect(container.querySelector('.chess-cursor')?.getAttribute('aria-label')).toBe('صفحه');
        expect(pieceOn(container, 'a1')?.dataset.piece).toBe('wr');
        expect(spotOf(sq('a1'), 'w').x).toBeLessThan(SIZE / 2);
    });

    it('keeps every piece the node it was when the same board is read again', async () =>
    {
        const table = await live(match());
        const before = [...table.container.querySelectorAll('.chess-layer .cp')];

        table.move({ ...table.current(), view: { ...table.current().view } });
        await flush();

        expect([...table.container.querySelectorAll('.chess-layer .cp')]).toEqual(before);
        expect(before.every((el) => el.isConnected)).toBe(true);
    });
});

describe('a chess move, made on the board', () =>
{
    it('lifts a piece that may move and marks every square it may go to', async () =>
    {
        const { container } = await live(match());

        tap(container, 'e2');

        expect(pieceOn(container, 'e2')?.hasAttribute('data-held')).toBe(true);
        expect(marks(container, 'held').map((mark) => mark.style.translate)).toEqual([at(sq('e2'))]);
        expect(marks(container, 'aim').map((mark) => mark.style.translate).sort()).toEqual([at(sq('e3')), at(sq('e4'))].sort());
    });

    it('marks no square when the move hint is off, and still lets the piece move', async () =>
    {
        useSettings().update({ hintMoves: false });

        const play = vi.spyOn(useBoard(), 'play').mockResolvedValue('now');
        const { container } = await live(match());

        tap(container, 'e2');

        expect(marks(container, 'aim')).toEqual([]);

        tap(container, 'e4');
        await flush();

        expect(play).toHaveBeenCalledWith({ kind: 'chess', verb: 'move', from: sq('e2'), to: sq('e4') });
    });

    it('sends the move when its square is pressed, and the piece goes there at the press', async () =>
    {
        const play = vi.spyOn(useBoard(), 'play').mockResolvedValue('now');
        const { container } = await live(match());
        const pawn = pieceOn(container, 'e2')!;

        tap(container, 'e2');
        tap(container, 'e4');
        await flush();

        expect(play).toHaveBeenCalledWith({ kind: 'chess', verb: 'move', from: sq('e2'), to: sq('e4') });
        expect(pawn.style.translate).toBe(at(sq('e4')));
        expect(marks(container, 'held')).toEqual([]);
        expect(marks(container, 'aim')).toEqual([]);
    });

    it('puts the piece down again when it is pressed a second time, or anywhere it cannot go', async () =>
    {
        const play = vi.spyOn(useBoard(), 'play').mockResolvedValue('now');
        const { container } = await live(match());

        tap(container, 'e2');
        tap(container, 'e2');

        expect(marks(container, 'held')).toEqual([]);

        tap(container, 'g1');
        tap(container, 'g4');

        expect(marks(container, 'held')).toEqual([]);
        expect(play).not.toHaveBeenCalled();
    });

    it('moves from one piece to another of the reader\'s with one press', async () =>
    {
        const { container } = await live(match());

        tap(container, 'e2');
        tap(container, 'g1');

        expect(marks(container, 'held').map((mark) => mark.style.translate)).toEqual([at(sq('g1'))]);
        expect(marks(container, 'aim').map((mark) => mark.style.translate).sort()).toEqual([at(sq('f3')), at(sq('h3'))].sort());
    });

    it('offers nothing to press while it is the other player\'s move', async () =>
    {
        const play = vi.spyOn(useBoard(), 'play').mockResolvedValue('now');
        const { container } = await live(match({ ...fen('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1'), ply: 1 }));

        tap(container, 'd2');
        tap(container, 'd4');

        expect(marks(container, 'held')).toEqual([]);
        expect(play).not.toHaveBeenCalled();
        expect(container.querySelectorAll('.chess-stop')).toHaveLength(0);
    });

    it('carries a piece in the hand to where it is let go, and plays it there', async () =>
    {
        const play = vi.spyOn(useBoard(), 'play').mockResolvedValue('now');
        const { container } = await live(match());
        const knight = pieceOn(container, 'g1')!;

        drag(container, 'g1', 'f3');
        await flush();

        expect(play).toHaveBeenCalledWith({ kind: 'chess', verb: 'move', from: sq('g1'), to: sq('f3') });
        expect(knight.hasAttribute('data-carried')).toBe(false);
        expect(knight.style.translate).toBe(at(sq('f3')));
    });

    it('puts a carried piece back where it came from when it is let go where it may not go', async () =>
    {
        const play = vi.spyOn(useBoard(), 'play').mockResolvedValue('now');
        const { container } = await live(match());
        const knight = pieceOn(container, 'g1')!;

        drag(container, 'g1', 'g3');
        await elapse(300);

        expect(play).not.toHaveBeenCalled();
        expect(knight.style.translate).toBe(at(sq('g1')));
    });

    it('takes a press that barely moved as a tap, not a carry', async () =>
    {
        const { container } = await live(match());
        const start = centre(sq('e2'));

        pointer(container, 'pointerdown', start.x, start.y);
        pointer(container, 'pointermove', start.x + 2, start.y + 1);
        pointer(container, 'pointerup', start.x + 2, start.y + 1);

        expect(container.querySelector('.cp[data-carried]')).toBeNull();
        expect(marks(container, 'held').map((mark) => mark.style.translate)).toEqual([at(sq('e2'))]);
    });

    it('takes the move back when the server will not have it', async () =>
    {
        vi.spyOn(useBoard(), 'play').mockResolvedValue('failed');

        const { container } = await live(match());
        const pawn = pieceOn(container, 'e2')!;

        tap(container, 'e2');
        tap(container, 'e4');
        await elapse(GLIDE_MOST + 400);

        expect(pawn.style.translate).toBe(at(sq('e2')));
        expect(stageOf(container).hasAttribute('data-presenting')).toBe(false);
    });

    it('asks what a pawn on the last rank becomes, at its square, and sends the choice', async () =>
    {
        const play = vi.spyOn(useBoard(), 'play').mockResolvedValue('now');
        const { container } = await live(match({ ...fen('8/4P2k/8/8/8/8/8/4K3 w - - 0 1'), ply: 40 }));

        tap(container, 'e7');
        tap(container, 'e8');

        const choices = [...container.querySelectorAll<HTMLButtonElement>('.chess-promote-piece')];

        expect(choices.map((one) => one.dataset.piece)).toEqual(['wq', 'wr', 'wb', 'wn']);
        expect(choices.map((one) => one.getAttribute('aria-label'))).toEqual(['Promote to a queen', 'Promote to a rook', 'Promote to a bishop', 'Promote to a knight']);
        expect(play).not.toHaveBeenCalled();

        choices[3].click();
        await flush();

        expect(play).toHaveBeenCalledWith({ kind: 'chess', verb: 'move', from: sq('e7'), to: sq('e8'), promotion: 'n' });
        expect(container.querySelector('.chess-promote')).toBeNull();
    });

    it('lets the question of a promotion be put away, and the pawn stays where it was', async () =>
    {
        const play = vi.spyOn(useBoard(), 'play').mockResolvedValue('now');
        const { container } = await live(match({ ...fen('8/4P2k/8/8/8/8/8/4K3 w - - 0 1'), ply: 40 }));

        tap(container, 'e7');
        tap(container, 'e8');
        container.querySelector<HTMLButtonElement>('.chess-promote-veil')!.click();
        await flush();

        expect(container.querySelector('.chess-promote')).toBeNull();
        expect(play).not.toHaveBeenCalled();
        expect(pieceOn(container, 'e7')?.dataset.piece).toBe('wp');
    });

    it('plays the reader\'s own move once, at the press, and not again when the server answers with it', async () =>
    {
        vi.spyOn(useBoard(), 'play').mockResolvedValue('now');

        const animate = vi.spyOn(Element.prototype, 'animate');
        const table = await live(match());
        const pawn = pieceOn(table.container, 'e2')!;
        const glides = () => animate.mock.contexts.filter((one) => one === pawn).length;

        tap(table.container, 'e2');
        tap(table.container, 'e4');
        await elapse(GLIDE_MOST + 50);

        expect(glides()).toBe(1);

        table.tell(match({ ...fen('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1'), ply: 1, last: { from: sq('e2'), to: sq('e4') } }, 0, { rev: 5 }), [
            happened(5, 0, [{ e: 'move', seat: 0, from: sq('e2'), to: sq('e4'), piece: 'P', san: 'e4' }])
        ]);
        await elapse(GLIDE_MOST + 50);

        expect(glides()).toBe(1);
        expect(pawn.style.translate).toBe(at(sq('e4')));
        expect(stageOf(table.container).hasAttribute('data-presenting')).toBe(false);
    });

    it('plays the other player\'s move on the board and says it once it has landed', async () =>
    {
        const table = await live(match({ ...fen('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1'), ply: 1 }, 0, { rev: 5 }));
        const knight = pieceOn(table.container, 'g8')!;

        table.tell(match({ ...fen('rnbqkb1r/pppppppp/5n2/8/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 1 2'), ply: 2, last: { from: sq('g8'), to: sq('f6') } }, 0, { rev: 6 }), [
            happened(6, 1, [{ e: 'move', seat: 1, from: sq('g8'), to: sq('f6'), piece: 'n', san: 'Nf6' }])
        ]);
        await flush();

        expect(said(table.container)).toBe('');

        await elapse(GLIDE_MOST + 100);

        expect(knight.style.translate).toBe(at(sq('f6')));
        expect(said(table.container)).toBe('omid.k: knight from g8 to f6.');
    });
});

describe('a draw, offered and answered', () =>
{
    it('asks the reader on the board when the other player offers one, and sends the answer', async () =>
    {
        const play = vi.spyOn(useBoard(), 'play').mockResolvedValue('now');
        const { container } = await live(match({ ply: 6, offer: 1, offered: [-1, 3] }));

        expect(container.querySelector('.chess-ask-title')?.textContent).toBe('omid.k offers a draw.');

        button(container, 'Accept the draw')!.click();
        await flush();

        expect(play).toHaveBeenCalledWith({ kind: 'chess', verb: 'accept' });

        button(container, 'Play on')!.click();
        await flush();

        expect(play).toHaveBeenLastCalledWith({ kind: 'chess', verb: 'decline' });
    });

    it('offers the reader a draw once they have moved, and not again until they move again', async () =>
    {
        const play = vi.spyOn(useBoard(), 'play').mockResolvedValue('now');
        const fresh = await live(match({ ply: 0 }));

        expect(button(fresh.container, 'Offer a draw')).toBeUndefined();
        fresh.unmount();

        const played = await live(match({ ply: 4 }));

        button(played.container, 'Offer a draw')!.click();
        await flush();

        expect(play).toHaveBeenCalledWith({ kind: 'chess', verb: 'offer' });
        played.unmount();

        const offered = await live(match({ ply: 4, offered: [2, -1] }));

        expect(button(offered.container, 'Offer a draw')).toBeUndefined();
    });

    it('tags the plate of whoever has offered, and asks nobody but the other player', async () =>
    {
        const { container } = await live(match({ ply: 4, offer: 0, offered: [2, -1] }));

        expect([...container.querySelectorAll('.table-plate')].map((plate) => plate.textContent)).toContainEqual(expect.stringContaining('Offered a draw'));
        expect(container.querySelector('.chess-ask')).toBeNull();
    });
});

describe('the chess clock', () =>
{
    const faces = (container: HTMLElement) => [...container.querySelectorAll<HTMLElement>('.chess-clock')].map((one) => [one.textContent?.trim(), one.hasAttribute('data-running')]);

    it('shows both banks, and counts down the side to move from what the server said it had', async () =>
    {
        const { container } = await live(match({ clock: { base: 300_000, increment: 0, left: [300_000, 245_000] } }, 0, { remainingMs: 291_000 }));

        expect(faces(container)).toEqual([['4:05', false], ['4:51', true]]);

        await elapse(3000);

        expect(faces(container)).toEqual([['4:05', false], ['4:48', true]]);
    });

    it('shows tenths when the time runs low, and red under ten seconds', async () =>
    {
        const { container } = await live(match({ clock: { base: 300_000, increment: 0, left: [12_000, 245_000] } }, 0, { remainingMs: 12_000 }));
        const mine = () => [...container.querySelectorAll<HTMLElement>('.chess-clock')].find((one) => one.hasAttribute('data-running'))!;

        expect(mine().textContent?.trim()).toBe('0:12.0');
        expect(mine().hasAttribute('data-low')).toBe(false);

        await elapse(2500);

        expect(mine().textContent?.trim()).toBe('0:09.5');
        expect(mine().hasAttribute('data-low')).toBe(true);
    });

    it('claims the flag when the other side\'s time runs out, without a word if it is refused', async () =>
    {
        const play = vi.spyOn(useBoard(), 'play').mockResolvedValue('failed');

        await live(match({ ...fen('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1'), ply: 1 }, 0, { remainingMs: 1000 }));
        await elapse(900);

        expect(play).not.toHaveBeenCalled();

        await elapse(300);

        expect(play).toHaveBeenCalledWith({ kind: 'chess', verb: 'flag' }, true);

        await elapse(1100);

        expect(play).toHaveBeenCalledTimes(2);
    });

    it('never claims its own reader\'s flag', async () =>
    {
        const play = vi.spyOn(useBoard(), 'play').mockResolvedValue('now');

        await live(match({}, 0, { remainingMs: 1000 }));
        await elapse(2000);

        expect(play).not.toHaveBeenCalled();
    });

    it('keeps the bank still before a side has moved, and counts the first move\'s time beside it', async () =>
    {
        const { container } = await live(match({ moved: [false, false] }, 0, { remainingMs: 30_000 }));

        expect(faces(container)).toEqual([['10:00', false], ['10:00', false]]);
        expect(container.querySelectorAll('.chess-first')).toHaveLength(1);
    });

    it('draws no bank at a table played a move a day', async () =>
    {
        const { container } = await live(match({ clock: undefined }, 0, { remainingMs: 86_000_000 }));

        expect(container.querySelectorAll('.chess-clock')).toHaveLength(0);
        expect(container.querySelectorAll('.chess-first')).toHaveLength(1);
    });
});

describe('what each side has taken', () =>
{
    it('lays the pieces a side took on its rail, and how far ahead that leaves it', async () =>
    {
        const { container } = await live(match({ ...fen('rnbqkbnr/ppp1pppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 3'), ply: 4 }));
        const rails = [...container.querySelectorAll<HTMLElement>('.chess-rail')];
        const mine = rails.find((rail) => rail.hasAttribute('data-me'))!;
        const theirs = rails.find((rail) => !rail.hasAttribute('data-me'))!;

        expect([...mine.querySelectorAll<HTMLElement>('.chess-taken > i')].map((one) => one.dataset.piece)).toEqual(['bp']);
        expect(mine.querySelector('.chess-lead')?.hasAttribute('data-shown')).toBe(true);
        expect(mine.querySelector('.chess-lead')?.textContent).toBe('+1');
        expect(mine.textContent).toContain('Ahead by 1 in material');
        expect(theirs.querySelectorAll('.chess-taken > i')).toHaveLength(0);
        expect(theirs.querySelector('.chess-lead')?.hasAttribute('data-shown')).toBe(false);
    });
});

describe('a chess board played from a keyboard', () =>
{
    const stops = (container: HTMLElement) => [...container.querySelectorAll<HTMLElement>('.chess-stop')];

    const key = (target: Element, name: string) => target.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true }));

    it('stops on every piece that may move, named, one of them in the order of the Tab key', async () =>
    {
        const { container } = await live(match());

        expect(stops(container)).toHaveLength(10);
        expect(stops(container).filter((stop) => stop.tabIndex === 0)).toHaveLength(1);
        expect(stops(container).map((stop) => stop.getAttribute('aria-label'))).toContain('g1, the knight. Pick it up.');
    });

    it('picks a piece up with Enter, walks its squares with the arrows, and plays one with Enter', async () =>
    {
        const play = vi.spyOn(useBoard(), 'play').mockResolvedValue('now');
        const { container } = await live(match());
        const knight = stops(container).find((stop) => stop.getAttribute('aria-label') === 'g1, the knight. Pick it up.')!;

        knight.focus();
        key(knight, 'Enter');
        await flush();
        await flush();

        expect(stops(container).map((stop) => stop.getAttribute('aria-label'))).toEqual(['f3. Move the knight here.', 'h3. Move the knight here.', 'g1. Put the knight back.']);
        expect(document.activeElement?.getAttribute('aria-label')).toBe('f3. Move the knight here.');

        key(document.activeElement!, 'ArrowRight');

        expect(document.activeElement?.getAttribute('aria-label')).toBe('h3. Move the knight here.');

        key(document.activeElement!, 'Enter');
        await flush();

        expect(play).toHaveBeenCalledWith({ kind: 'chess', verb: 'move', from: sq('g1'), to: sq('h3') });
    });

    it('puts a piece down again with Escape', async () =>
    {
        const { container } = await live(match());
        const pawn = stops(container).find((stop) => stop.getAttribute('aria-label') === 'e2, the pawn. Pick it up.')!;

        pawn.focus();
        key(pawn, 'Enter');
        await flush();
        key(document.activeElement ?? pawn, 'Escape');
        await flush();

        expect(marks(container, 'held')).toEqual([]);
        expect(stops(container)).toHaveLength(10);
    });
});

describe('how a chess game ended, under its result', () =>
{
    it('says the reason beside the headline', () =>
    {
        const finished = match({ ...fen('rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3'), ply: 4, over: { reason: 'checkmate', winner: 1 } }, 0, {
            finishedAt: new Date(500_000).toISOString(),
            outcome: 'won',
            players: [{ seat: 0, who: 'dana.w', timeouts: 0, result: 'lost' }, { seat: 1, who: 'omid.k', timeouts: 0, result: 'won' }] as MatchView['players']
        });
        const { container } = renderTest(() => MatchResult({ match: finished, mine: 0 }) as Rendered);

        expect(container.textContent).toContain('By checkmate.');
    });

    it('says a draw was agreed', () =>
    {
        const finished = match({ ply: 30, over: { reason: 'agreement' } }, 0, {
            finishedAt: new Date(500_000).toISOString(),
            outcome: 'drawn',
            players: [{ seat: 0, who: 'dana.w', timeouts: 0, result: 'drawn' }, { seat: 1, who: 'omid.k', timeouts: 0, result: 'drawn' }] as MatchView['players']
        });
        const { container } = renderTest(() => MatchResult({ match: finished, mine: 0 }) as Rendered);

        expect(container.textContent).toContain('It’s a draw.');
        expect(container.textContent).toContain('By agreement.');
    });
});

describe('the chime when the turn comes round', () =>
{
    const theirs = () => match({ ...fen('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1'), ply: 1 }, 0, { rev: 4 });

    const mine = () => match({ ...fen('rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2'), ply: 2 }, 0, { rev: 5 });

    afterEach(() =>
    {
        Reflect.deleteProperty(document, 'visibilityState');
    });

    it('rings when the turn comes round while nobody is looking at the page', async () =>
    {
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });

        const table = await live(theirs());

        table.move(mine());
        await flush();

        expect(told.heard).toContain('turn');
    });

    it('lets the move itself be heard on a page that is looked at, and rings nothing more', async () =>
    {
        const table = await live(theirs());

        table.move(mine());
        await flush();

        expect(told.heard).not.toContain('turn');
    });
});

describe('a finished game stepped through on the board', () =>
{
    const LEGAL = ['e4', 'e5', 'Nf3', 'd6', 'Bc4', 'Bg4', 'Nc3', 'g6', 'Nxe5', 'Bxd1', 'Bxf7+', 'Ke7', 'Nd5#'];

    const mated = () => match({ ...fen('rn1q1bnr/ppp1kB1p/3p2p1/3NN3/4P3/8/PPPP1PPP/R1BbK2R b KQ - 2 7'), ply: 13, notation: LEGAL, last: { from: sq('c3'), to: sq('d5') }, over: { reason: 'checkmate', winner: 0 } }, 0, {
        rev: 20,
        finishedAt: new Date(500_000).toISOString(),
        outcome: 'won',
        players: [{ seat: 0, who: 'dana.w', timeouts: 0, result: 'won' }, { seat: 1, who: 'omid.k', timeouts: 0, result: 'lost' }] as MatchView['players']
    });

    const pieceAt = (container: HTMLElement, name: string) => pieceOn(container, name)?.dataset.piece ?? null;

    beforeEach(() =>
    {
        useReview().end();
    });

    it('shows the board after the move stepped back to, quietly, with the result folded away', async () =>
    {
        const table = await live(mated());

        await elapse(400);

        expect(table.container.querySelector('.table-result')).not.toBeNull();

        told.heard = [];
        useReview().show('match-chess', 2);
        await elapse(GLIDE_MOST + 400);

        expect(pieceAt(table.container, 'e4')).toBe('wp');
        expect(pieceAt(table.container, 'e5')).toBe('bp');
        expect(pieceAt(table.container, 'g1')).toBe('wn');
        expect(pieceAt(table.container, 'd5')).toBeNull();
        expect(pieceAt(table.container, 'e8')).toBe('bk');
        expect(table.container.querySelector('.table-result')).toBeNull();
        expect(table.container.querySelector('.table-result-tab')).toBeNull();
        expect(told.heard).toEqual([]);
    });

    it('plays a step forward as the move it was, heard as that piece, and comes back to the end with the king down', async () =>
    {
        const table = await live(mated());

        await elapse(400);
        useReview().show('match-chess', 2);
        await elapse(GLIDE_MOST + 400);
        told.heard = [];

        useReview().show('match-chess', 3);
        await elapse(GLIDE_MOST + 400);

        expect(pieceAt(table.container, 'f3')).toBe('wn');
        expect(pieceAt(table.container, 'g1')).toBeNull();
        expect(told.heard).toEqual(['horse-step']);

        useReview().end();
        await elapse(GLIDE_MOST + 400);

        expect(pieceAt(table.container, 'd5')).toBe('wn');
        expect(pieceOn(table.container, 'e7')?.hasAttribute('data-tipped')).toBe(true);
        expect(table.container.querySelector('.table-result-tab')).not.toBeNull();
    });

    it('steps into the end as the mating move itself, and lays the king down after it', async () =>
    {
        const table = await live(mated());

        await elapse(400);
        useReview().show('match-chess', 12);
        await elapse(GLIDE_MOST + 400);

        expect(pieceAt(table.container, 'c3')).toBe('wn');
        expect(pieceOn(table.container, 'e7')?.hasAttribute('data-tipped')).toBe(false);

        told.heard = [];
        useReview().end();
        await elapse(GLIDE_MOST + 800);

        expect(told.heard[0]).toBe('horse-step');
        expect(pieceAt(table.container, 'd5')).toBe('wn');
        expect(pieceOn(table.container, 'e7')?.hasAttribute('data-tipped')).toBe(true);
    });

    it('lets go of the game it was stepping through once the board goes, and minds no other game', async () =>
    {
        useReview().show('another-match', 4);

        const table = await live(mated());

        await elapse(400);

        expect(useReview().looking()).toBeNull();
        expect(pieceAt(table.container, 'd5')).toBe('wn');

        useReview().show('another-match', 4);
        await elapse(GLIDE_MOST + 400);

        expect(pieceAt(table.container, 'd5')).toBe('wn');
        expect(pieceAt(table.container, 'g1')).toBeNull();

        useReview().show('match-chess', 4);
        table.unmount();

        expect(useReview().looking()).toBeNull();
    });
});

describe('the horse and the elephant, as the reader\'s device has them', () =>
{
    const answered = async () =>
    {
        const table = await live(match({ ...fen('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1'), ply: 1 }, 0, { rev: 5 }));

        table.tell(match({ ...fen('rnbqkb1r/pppppppp/5n2/8/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 1 2'), ply: 2, last: { from: sq('g8'), to: sq('f6') } }, 0, { rev: 6 }), [
            happened(6, 1, [{ e: 'move', seat: 1, from: sq('g8'), to: sq('f6'), piece: 'n', san: 'Nf6' }])
        ]);
        await elapse(GLIDE_MOST + 100);
    };

    it('hears the other side\'s knight land on its hooves', async () =>
    {
        await answered();

        expect(told.heard).toContain('horse-step');
        expect(told.heard).not.toContain('piece-move');
    });

    it('hears the click instead once the device has turned the animals off', async () =>
    {
        useSettings().update({ animalSounds: false });

        await answered();

        expect(told.heard).toContain('piece-move');
        expect(told.heard).not.toContain('horse-step');
    });
});

describe('the rules coach at a chess table', () =>
{
    const lamp = (container: HTMLElement) => container.querySelector('.chess-rail[data-me] .coach-line[data-lamp]');

    const checked = (mine: number | null = 0) => match({ ...fen('4k3/8/8/4r3/R7/8/8/4K3 w - - 0 1'), ply: 30 }, mine);

    it('lights a lamp in the reader\'s own rail with the rule that matters now, and in no other', async () =>
    {
        const { container } = await live(checked());

        expect(lamp(container)?.textContent).toContain('You are in check');
        expect(container.querySelectorAll('.coach-line')).toHaveLength(1);
    });

    it('tells the reader about the first move before they have made one', async () =>
    {
        const { container } = await live(match({ moved: [false, false] }, 0, { remainingMs: 30_000 }));

        expect(lamp(container)?.textContent).toContain('Your clock starts after your first move');
    });

    it('says what running out costs when the reader\'s own clock is under a minute, and only at a clocked table', async () =>
    {
        const quiet = { ...fen('4k3/8/8/8/8/8/8/R3K3 w - - 0 1'), ply: 40 };
        const short = await live(match(quiet, 0, { remainingMs: 45_000 }));

        expect(lamp(short.container)?.textContent).toContain('Under a minute left');
        short.unmount();

        const daily = await live(match({ ...quiet, clock: undefined }, 0, { remainingMs: 45_000 }));

        expect(lamp(daily.container)).toBeNull();
    });

    it('says in Persian what it says', async () =>
    {
        useLocale().setLocale('fa');

        const { container } = await live(checked());

        expect(lamp(container)?.textContent).toContain('کیش شدی');
    });

    it('lights nothing for somebody watching, or when the coach is turned off', async () =>
    {
        const watching = await live(checked(null));

        expect(watching.container.querySelector('.coach-line')).toBeNull();
        watching.unmount();

        useSettings().update({ hintRules: false });

        const off = await live(checked());

        expect(off.container.querySelector('.coach-line')).toBeNull();
    });

    it('waits for the other side\'s move to land before it speaks about the position it leaves', async () =>
    {
        const table = await live(match({ ...fen('4k3/8/8/7r/R7/8/8/4K3 b - - 0 1'), ply: 29 }, 0, { rev: 4 }));
        const checking: Played = { e: 'move', seat: 1, from: sq('h5'), to: sq('e5'), piece: 'r', check: true, san: 'Re5+' };

        table.tell(match({ ...fen('4k3/8/8/4r3/R7/8/8/4K3 w - - 1 2'), ply: 30, last: { from: sq('h5'), to: sq('e5') } }, 0, { rev: 5 }), [happened(5, 1, [checking])]);
        await flush();

        expect(lamp(table.container)).toBeNull();

        await elapse(GLIDE_MOST + 60);

        expect(lamp(table.container)?.textContent).toContain('You are in check');
    });
});
