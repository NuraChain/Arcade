import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';

import { manualClock, type ManualClock } from '../src/lib/clock.ts';
import type { Haptic } from '../src/lib/haptics.ts';
import { SIZE, SQUARE, spotOf, type Foot } from '../src/game/chess-layout.ts';
import { feltOf, type Told } from '../src/game/chess-felt.ts';
import { GLIDE_MOST, HISTORY, KNIGHT_MS, PROMOTE_MS, ROOK_MS, TAKE_MS, TIP_MS, costOf, createChessTable, type ChessFacts, type ChessTable, type Lay } from '../src/game/board/chess-table.ts';
import { createDirector, type Director } from '../src/game/stage/director.ts';
import type { Act } from '../src/game/stage/feed.ts';
import { LAYER } from '../src/game/stage/layers.ts';
import type { Sight } from '../src/game/stage/presenter.ts';
import { createStage, type Stage } from '../src/game/stage/stage.ts';
import type { Cue, SoundHandle } from '../src/game/sound.ts';
import { parseFen, squareNamed } from '../../backend/src/domains/match/chess/board.ts';

interface Drawn
{
    el: Element;
    frames: Keyframe[];
    options: KeyframeAnimationOptions;
}

const sq = (name: string) => squareNamed(name)!;

const cq = (units: number) => `${ (units / SIZE * 100).toFixed(3) }cqw`;

const at = (square: number, foot: Foot = 'w') =>
{
    const spot = spotOf(square, foot);

    return `${ cq(spot.x) } ${ cq(spot.y) }`;
};

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

const lay = (fen: string, over: Partial<Lay> = {}): Lay =>
{
    const position = parseFen(fen)!;

    return { ...feltOf({ board: position.board, turn: position.turn, last: undefined }), foot: 'w', mated: null, ...over };
};

const sight = (view: Lay, rev = 5, seat: number | null = 0): Sight<Lay> => ({ id: 'm', rev, seat, view });

const act = (rev: number, seat: number, moves: Told[]): Act<Told> => ({ rev, seat, moves });

const move = (from: string, to: string, piece: string, extra: Partial<Told> = {}): Told => ({ e: 'move', seat: 0, from: sq(from), to: sq(to), piece: piece as never, san: '', ...extra });

const flush = async () =>
{
    for (let turn = 0; turn < 12; turn += 1)
    {
        await Promise.resolve();
    }
};

let clock: ManualClock;
let host: HTMLElement;
let stage: Stage;
let director: Director;
let table: ChessTable;
let cues: Cue[];
let felt: Haptic[];
let drawn: Drawn[];
let still: boolean;
let animals: boolean;
let broke: unknown[];
let facts: ChessFacts[];

const elapse = async (ms: number) =>
{
    for (let left = ms; left > 0; left -= 5)
    {
        clock.advance(Math.min(5, left));
        await flush();
    }

    await flush();
};

const play = (acts: Act<Told>[], seen: Sight<Lay>) => director.enqueue((ctx) => table.play(acts, seen, ctx), { estimate: table.estimate(acts) });

const pieces = () => [...host.querySelectorAll<HTMLElement>('.cp')];

const on = (square: number, foot: Foot = 'w') => pieces().filter((el) => el.style.translate === at(square, foot) && !el.hasAttribute('data-gone'));

const marks = (kind: string) => [...host.querySelectorAll<HTMLElement>(`.cmk[data-kind="${ kind }"]`)].filter((mark) => !mark.hidden);

const of = (el: Element) => drawn.filter((one) => one.el === el);

beforeEach(() =>
{
    const animate = Element.prototype.animate;
    const sound: SoundHandle = {
        play: (cue) =>
        {
            cues.push(cue);
        },
        setEnabled: () => undefined,
        dispose: () => undefined
    };

    clock = manualClock(1000);
    cues = [];
    felt = [];
    drawn = [];
    broke = [];
    facts = [];
    still = false;
    animals = true;
    host = document.createElement('div');
    host.className = 'chess-layer';
    document.body.append(host);

    vi.spyOn(Element.prototype, 'animate').mockImplementation(function (this: Element, frames, options)
    {
        drawn.push({ el: this, frames: frames as Keyframe[], options: options as KeyframeAnimationOptions });

        return animate.call(this, frames, options);
    });

    stage = createStage({ clock, quiet: () => still, report: (error) => broke.push(error) });
    director = createDirector(stage, clock, (error) => broke.push(error));
    table = createChessTable({ host, stage, sound: () => sound, animals: () => animals, feel: (kind) => felt.push(kind), onFacts: (now) => facts.push(now) });
});

afterEach(() =>
{
    director.cancel();
    table.dispose();
    host.remove();
    vi.restoreAllMocks();
    expect(broke).toEqual([]);
});

describe('a chess table, drawn from a board', () =>
{
    it('stands thirty-two pieces on their squares, each a piece of its own', () =>
    {
        table.reset(sight(lay(START)));

        expect(pieces()).toHaveLength(32);
        expect(new Set(pieces().map((el) => el.dataset.key)).size).toBe(32);
        expect(on(sq('e1')).map((el) => el.dataset.piece)).toEqual(['wk']);
        expect(on(sq('d8')).map((el) => el.dataset.piece)).toEqual(['bq']);
        expect(on(sq('a2')).map((el) => el.dataset.piece)).toEqual(['wp']);
        expect(pieces().every((el) => el.style.zIndex === String(LAYER.piece))).toBe(true);
        expect(table.same(sight(lay(START)))).toBe(true);
    });

    it('writes the files along the foot and the ranks up the side, turned round for Black', () =>
    {
        table.reset(sight(lay(START)));

        const labels = () => [...host.querySelectorAll<HTMLElement>('.cco')].map((el) => el.textContent);

        expect(labels()).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', '8', '7', '6', '5', '4', '3', '2', '1']);

        table.reset(sight(lay(START, { foot: 'b' })));

        expect(labels()).toEqual(['h', 'g', 'f', 'e', 'd', 'c', 'b', 'a', '1', '2', '3', '4', '5', '6', '7', '8']);
        expect(on(sq('a1'), 'b').map((el) => el.dataset.piece)).toEqual(['wr']);
        expect(spotOf(sq('a1'), 'b')).toEqual({ x: SIZE - spotOf(sq('a1'), 'w').x - SQUARE, y: SIZE - spotOf(sq('a1'), 'w').y - SQUARE });
    });

    it('is the same table only while the board, the turn, the last move, the foot and a mated king all agree', () =>
    {
        const shown = lay(START);

        table.reset(sight(shown));

        expect(table.same(sight({ ...shown, turn: 'b' }))).toBe(false);
        expect(table.same(sight({ ...shown, last: { from: sq('e2'), to: sq('e4') } }))).toBe(false);
        expect(table.same(sight({ ...shown, foot: 'b' }))).toBe(false);
        expect(table.same(sight({ ...shown, mated: 'w' }))).toBe(false);
        expect(table.same(sight(lay('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1')))).toBe(false);
    });

    it('marks the move made last, and a king in check', () =>
    {
        table.reset(sight(lay('rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3', { last: { from: sq('d8'), to: sq('h4') } })));

        expect(marks('last').map((mark) => mark.style.translate).sort()).toEqual([at(sq('d8')), at(sq('h4'))].sort());
        expect(marks('check').map((mark) => mark.style.translate)).toEqual([at(sq('e1'))]);
        expect(facts.at(-1)?.check).toBe(sq('e1'));
    });

    it('lays a mated king on its side', () =>
    {
        table.reset(sight(lay('rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3', { mated: 'w' })));

        expect(on(sq('e1'))[0].hasAttribute('data-tipped')).toBe(true);
        expect(on(sq('e8'))[0].hasAttribute('data-tipped')).toBe(false);
    });

    it('draws again everything it owns after it is reset', () =>
    {
        table.reset(sight(lay(START)));
        table.reset(sight(lay(START, { last: { from: sq('e2'), to: sq('e4') } })));

        expect(pieces()).toHaveLength(32);
        expect(marks('last')).toHaveLength(2);
        expect(host.querySelectorAll('.cco')).toHaveLength(16);
    });
});

describe('a chess move, played', () =>
{
    it('carries the piece from its square to the other, and is heard and told when it lands', async () =>
    {
        const before = lay(START);

        table.reset(sight(before));

        const pawn = on(sq('e2'))[0];

        facts = [];
        play([act(6, 0, [move('e2', 'e4', 'P')])], sight(lay('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1', { last: { from: sq('e2'), to: sq('e4') } }), 6));
        await flush();

        const run = of(pawn)[0];

        expect(run.frames[0].translate).toBe(at(sq('e2')));
        expect(run.frames.at(-1)?.translate).toBe(at(sq('e4')));
        expect(Number(run.options.duration)).toBeLessThanOrEqual(GLIDE_MOST);
        expect(pawn.style.translate).toBe(at(sq('e4')));
        expect(pawn.style.zIndex).toBe(String(LAYER.moving));
        expect(marks('last').map((mark) => mark.style.translate).sort()).toEqual([at(sq('e2')), at(sq('e4'))].sort());
        expect(cues).toEqual([]);
        expect(facts.every((one) => one.turn === 'w')).toBe(true);

        await elapse(GLIDE_MOST + 40);

        expect(cues).toEqual(['piece-move']);
        expect(pawn.style.zIndex).toBe(String(LAYER.piece));
        expect(facts.at(-1)?.turn).toBe('b');
        expect(facts.at(-1)?.played?.to).toBe(sq('e4'));
        expect(on(sq('e4'))).toEqual([pawn]);
    });

    it('lifts a knight over the board in an arc', async () =>
    {
        table.reset(sight(lay(START)));

        const knight = on(sq('g1'))[0];

        play([act(6, 0, [move('g1', 'f3', 'N')])], sight(lay('rnbqkbnr/pppppppp/8/8/8/5N2/PPPPPPPP/RNBQKB1R b KQkq - 1 1'), 6));
        await flush();

        const run = of(knight)[0];
        const lifts = run.frames.map((frame) => Number(frame.scale));

        expect(Number(run.options.duration)).toBe(KNIGHT_MS);
        expect(Math.max(...lifts)).toBeGreaterThan(1.1);
        expect(lifts[0]).toBe(1);
        expect(lifts.at(-1)).toBe(1);

        await elapse(KNIGHT_MS + 40);

        expect(on(sq('f3'))).toEqual([knight]);
    });

    it('takes the captured piece as the taker arrives, and lets go of it', async () =>
    {
        const before = lay('4k3/8/8/3p4/4P3/8/8/4K3 w - - 0 1');

        table.reset(sight(before));

        const taker = on(sq('e4'))[0];
        const victim = on(sq('d5'))[0];

        play([act(6, 0, [move('e4', 'd5', 'P', { captured: 'p' })])], sight(lay('4k3/8/8/3P4/8/8/8/4K3 b - - 0 1'), 6));
        await flush();

        const run = of(taker)[0];
        const fade = of(victim)[0];

        expect(Number(fade.options.delay)).toBeGreaterThan(Number(run.options.duration) * 0.7);
        expect(Number(fade.options.delay)).toBeLessThan(Number(run.options.duration));
        expect(Number(fade.frames.at(-1)?.opacity)).toBe(0);
        expect(victim.hasAttribute('data-gone')).toBe(true);
        expect(cues).toEqual([]);

        await elapse(Number(fade.options.delay) + 5);

        expect(cues).toEqual(['piece-capture']);
        expect(felt).toEqual(['capture']);

        await elapse(GLIDE_MOST + TAKE_MS + 40);

        expect(cues).toEqual(['piece-capture', 'piece-move']);
        expect(victim.isConnected).toBe(false);
        expect(pieces()).toHaveLength(3);
        expect(facts.at(-1)?.men).toHaveLength(3);
    });

    it('is felt as a hit when it is the reader who loses the piece', async () =>
    {
        table.reset(sight(lay('4k3/8/8/3p4/4P3/8/8/4K3 b - - 0 1')));
        play([act(6, 1, [move('d5', 'e4', 'p', { seat: 1, captured: 'P' })])], sight(lay('4k3/8/8/8/4p3/8/8/4K3 w - - 0 1'), 6));
        await elapse(GLIDE_MOST + TAKE_MS + 40);

        expect(felt).toEqual(['hit']);
    });

    it('takes a pawn passed en passant from the square behind the one landed on', async () =>
    {
        table.reset(sight(lay('4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1')));

        const passed = on(sq('d5'))[0];

        play([act(6, 0, [move('e5', 'd6', 'P', { captured: 'p', enPassant: true })])], sight(lay('4k3/8/3P4/8/8/8/8/4K3 b - - 0 1'), 6));
        await elapse(GLIDE_MOST + TAKE_MS + 40);

        expect(passed.isConnected).toBe(false);
        expect(on(sq('d6')).map((el) => el.dataset.piece)).toEqual(['wp']);
        expect(pieces()).toHaveLength(3);
    });

    it('castles the king first and lifts the rook over it after', async () =>
    {
        table.reset(sight(lay('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1')));

        const king = on(sq('e1'))[0];
        const rook = on(sq('h1'))[0];

        play([act(6, 0, [move('e1', 'g1', 'K', { castle: 'k' })])], sight(lay('r3k2r/8/8/8/8/8/8/R4RK1 b kq - 1 1'), 6));
        await flush();

        const kingRun = of(king)[0];
        const rookRun = of(rook)[0];

        expect(kingRun.frames.at(-1)?.translate).toBe(at(sq('g1')));
        expect(rookRun.frames[0].translate).toBe(at(sq('h1')));
        expect(rookRun.frames.at(-1)?.translate).toBe(at(sq('f1')));
        expect(Number(rookRun.options.delay)).toBeGreaterThan(0);
        expect(Number(rookRun.options.duration)).toBe(ROOK_MS);
        expect(Math.max(...rookRun.frames.map((frame) => Number(frame.scale)))).toBeGreaterThan(1.1);

        await elapse(GLIDE_MOST + ROOK_MS + 40);

        expect(cues).toEqual(['piece-move', 'piece-move']);
        expect(on(sq('g1'))).toEqual([king]);
        expect(on(sq('f1'))).toEqual([rook]);
    });

    it('turns a pawn into its piece once it has landed, under the same name', async () =>
    {
        table.reset(sight(lay('8/4P2k/8/8/8/8/8/4K3 w - - 0 1')));

        const pawn = on(sq('e7'))[0];
        const key = pawn.dataset.key;

        play([act(6, 0, [move('e7', 'e8', 'P', { promotion: 'q' })])], sight(lay('4Q3/7k/8/8/8/8/8/4K3 b - - 0 1'), 6));
        await flush();

        expect(pawn.dataset.piece).toBe('wp');

        await elapse(Number(of(pawn)[0].options.duration) + 5);

        expect(pawn.dataset.piece).toBe('wp');
        expect(cues).toEqual(['piece-move']);

        await elapse(PROMOTE_MS + 40);

        expect(pawn.dataset.piece).toBe('wq');
        expect(pawn.dataset.key).toBe(key);
        expect(cues).toEqual(['piece-move', 'promote']);
    });

    it('lights the king that a move puts in check, with a chime', async () =>
    {
        table.reset(sight(lay('4k3/8/8/8/8/8/8/R3K3 w - - 0 1')));
        play([act(6, 0, [move('a1', 'a8', 'R')])], sight(lay('R3k3/8/8/8/8/8/8/4K3 b - - 1 1'), 6));
        await flush();

        expect(marks('check')).toEqual([]);

        await elapse(GLIDE_MOST + 40);

        expect(marks('check').map((mark) => mark.style.translate)).toEqual([at(sq('e8'))]);
        expect(cues).toEqual(['piece-move', 'check']);
        expect(facts.at(-1)?.check).toBe(sq('e8'));
    });

    it('sounds the end as it went for whoever reads it: a win, a loss, a draw, a watcher\'s close, and nothing for a game called off', async () =>
    {
        const START_LAY = lay('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
        const ended = async (finish: Told, seat: number | null) =>
        {
            cues = [];
            table.reset(sight(START_LAY, 5, seat));
            play([act(6, 1, [finish])], sight(START_LAY, 6, seat));
            await elapse(100);

            return cues;
        };

        expect(await ended({ e: 'finish', reason: 'resign', winner: 0 }, 0)).toEqual(['win']);
        expect(await ended({ e: 'finish', reason: 'flag', winner: 1 }, 0)).toEqual(['lose']);
        expect(await ended({ e: 'finish', reason: 'stalemate' }, 1)).toEqual(['draw']);
        expect(await ended({ e: 'finish', reason: 'resign', winner: 0 }, null)).toEqual(['draw']);
        expect(await ended({ e: 'finish', reason: 'abort' }, 0)).toEqual([]);
    });

    it('lays the mated king over once the mating move has landed', async () =>
    {
        table.reset(sight(lay('rnbqkbnr/pppp1ppp/8/4p3/6P1/5P2/PPPPP2P/RNBQKBNR b KQkq - 0 2')));

        const king = on(sq('e1'))[0];

        play([act(6, 1, [move('d8', 'h4', 'q', { seat: 1, check: true, mate: true }), { e: 'finish', reason: 'checkmate', winner: 1 }])], sight(lay('rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3', { mated: 'w', last: { from: sq('d8'), to: sq('h4') } }), 6));
        await elapse(100);

        expect(king.hasAttribute('data-tipped')).toBe(false);

        await elapse(GLIDE_MOST + TIP_MS + 40);

        expect(king.hasAttribute('data-tipped')).toBe(true);
        expect(of(king).at(-1)?.frames.at(-1)?.rotate).toBe('-76deg');
        expect(cues.slice(-2), 'the king is heard falling, from chess\'s own pack, and then the loss').toEqual(['king-fall', 'lose']);
        expect(table.same(sight(lay('rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3', { mated: 'w', last: { from: sq('d8'), to: sq('h4') } })))).toBe(true);
    });

    it('fades where things end up for somebody who asked for less motion, and keeps every cue in its order', async () =>
    {
        still = true;
        table.reset(sight(lay('4k3/8/8/3p4/4P3/8/8/4K3 w - - 0 1')));

        const taker = on(sq('e4'))[0];

        play([act(6, 0, [move('e4', 'd5', 'P', { captured: 'p' })])], sight(lay('4k3/8/8/3P4/8/8/8/4K3 b - - 0 1'), 6));
        await flush();

        expect(of(taker)[0].frames.every((frame) => frame.translate === undefined)).toBe(true);

        await elapse(400);

        expect(cues).toEqual(['piece-capture', 'piece-move']);
        expect(on(sq('d5'))).toEqual([taker]);
    });

    it('says how long each kind of move takes to show', () =>
    {
        expect(costOf(move('e2', 'e4', 'P'))).toBe(GLIDE_MOST);
        expect(costOf(move('g1', 'f3', 'N'))).toBe(KNIGHT_MS);
        expect(costOf(move('e1', 'g1', 'K', { castle: 'k' }))).toBeGreaterThan(GLIDE_MOST);
        expect(costOf(move('e7', 'e8', 'P', { promotion: 'q' }))).toBe(GLIDE_MOST + PROMOTE_MS);
        expect(costOf({ e: 'finish', reason: 'checkmate', winner: 1 })).toBe(TIP_MS);
        expect(costOf({ e: 'offer', seat: 0 })).toBe(0);
        expect(HISTORY).toBeGreaterThan(GLIDE_MOST * 4);
    });
});

describe('the knight and the bishop, heard as the horse and the elephant Persian names them', () =>
{
    it('sets a knight down on two hooves and a bishop down with an elephant\'s tread', async () =>
    {
        table.reset(sight(lay('4k3/8/8/8/8/8/8/1N2K3 w - - 0 1')));
        play([act(6, 0, [move('b1', 'c3', 'N')])], sight(lay('4k3/8/8/8/8/2N5/8/4K3 b - - 1 1'), 6));
        await elapse(KNIGHT_MS + 40);

        expect(cues).toEqual(['horse-step']);

        cues = [];
        table.reset(sight(lay('7k/8/8/8/8/8/8/4KB2 w - - 0 1')));
        play([act(6, 0, [move('f1', 'b5', 'B')])], sight(lay('7k/8/8/1B6/8/8/8/4K3 b - - 1 1'), 6));
        await elapse(GLIDE_MOST + 40);

        expect(cues).toEqual(['elephant-step']);
    });

    it('neighs as a knight takes a piece, beside the knock of the piece it took', async () =>
    {
        table.reset(sight(lay('4k3/8/8/8/8/2p5/8/1N2K3 w - - 0 1')));

        const victim = on(sq('c3'))[0];

        play([act(6, 0, [move('b1', 'c3', 'N', { captured: 'p' })])], sight(lay('4k3/8/8/8/8/2N5/8/4K3 b - - 0 1'), 6));
        await flush();
        await elapse(Number(of(victim)[0].options.delay) + 5);

        expect(cues).toEqual(['piece-capture', 'horse-call']);

        await elapse(KNIGHT_MS + TAKE_MS + 40);

        expect(cues).toEqual(['piece-capture', 'horse-call', 'horse-step']);
        expect(felt).toEqual(['capture']);
    });

    it('trumpets as a bishop takes a piece', async () =>
    {
        table.reset(sight(lay('7k/8/8/1p6/8/8/8/4KB2 w - - 0 1')));
        play([act(6, 0, [move('f1', 'b5', 'B', { captured: 'p' })])], sight(lay('7k/8/8/1B6/8/8/8/4K3 b - - 0 1'), 6));
        await elapse(GLIDE_MOST + TAKE_MS + 40);

        expect(cues).toEqual(['piece-capture', 'elephant-call', 'elephant-step']);
    });

    it('keeps the click for every other piece, and for a pawn that becomes a knight', async () =>
    {
        table.reset(sight(lay('4k3/8/8/8/8/8/8/R3K3 w Q - 0 1')));
        play([act(6, 0, [move('a1', 'a5', 'R')])], sight(lay('4k3/8/8/R7/8/8/8/4K3 b - - 1 1'), 6));
        await elapse(GLIDE_MOST + 40);

        expect(cues).toEqual(['piece-move']);

        cues = [];
        table.reset(sight(lay('8/4P2k/8/8/8/8/8/4K3 w - - 0 1')));
        play([act(6, 0, [move('e7', 'e8', 'P', { promotion: 'n' })])], sight(lay('4N3/7k/8/8/8/8/8/4K3 b - - 0 1'), 6));
        await elapse(GLIDE_MOST + PROMOTE_MS + 40);

        expect(cues).toEqual(['piece-move', 'promote']);
    });

    it('is the click and the knock again for somebody who turned the animals off, asked at each move', async () =>
    {
        animals = false;
        table.reset(sight(lay('4k3/8/8/8/8/2p5/8/1N2K3 w - - 0 1')));
        play([act(6, 0, [move('b1', 'c3', 'N', { captured: 'p' })])], sight(lay('4k3/8/8/8/8/2N5/8/4K3 b - - 0 1'), 6));
        await elapse(KNIGHT_MS + TAKE_MS + 40);

        expect(cues).toEqual(['piece-capture', 'piece-move']);

        animals = true;
        play([act(7, 1, [move('e8', 'd8', 'k', { seat: 1 })]), act(8, 0, [move('c3', 'e4', 'N')])], sight(lay('3k4/8/8/8/4N3/8/8/4K3 b - - 2 2'), 8));
        await elapse(GLIDE_MOST + KNIGHT_MS + 80);

        expect(cues).toEqual(['piece-capture', 'piece-move', 'piece-move', 'horse-step']);
    });
});

describe('a chess table put right with nothing said', () =>
{
    it('slides a piece that stands elsewhere now, quietly, and keeps its name', async () =>
    {
        table.reset(sight(lay(START)));

        const knight = on(sq('g1'))[0];

        director.enqueue((ctx) => table.settle(sight(lay('rnbqkbnr/pppppppp/8/8/8/5N2/PPPPPPPP/RNBQKB1R b KQkq - 1 1'), 6), ctx), { estimate: 300 });
        await elapse(400);

        expect(on(sq('f3'))).toEqual([knight]);
        expect(cues).toEqual([]);
        expect(table.same(sight(lay('rnbqkbnr/pppppppp/8/8/8/5N2/PPPPPPPP/RNBQKB1R b KQkq - 1 1'), 6))).toBe(true);
    });

    it('lets go of a piece that is gone and brings one that was not there', async () =>
    {
        table.reset(sight(lay('4k3/8/8/3p4/4P3/8/8/4K3 w - - 0 1')));

        const pawn = on(sq('d5'))[0];

        director.enqueue((ctx) => table.settle(sight(lay('4k3/8/8/8/4P3/8/8/3QK3 w - - 0 1'), 6), ctx), { estimate: 300 });
        await elapse(400);

        expect(pawn.isConnected).toBe(false);
        expect(on(sq('d1')).map((el) => el.dataset.piece)).toEqual(['wq']);
        expect(pieces()).toHaveLength(4);
    });

    it('draws the whole board again when the reader comes to the other side of it', async () =>
    {
        table.reset(sight(lay(START)));
        director.enqueue((ctx) => table.settle(sight(lay(START, { foot: 'b' }), 6), ctx), { estimate: 300 });
        await elapse(100);

        expect(on(sq('a1'), 'b').map((el) => el.dataset.piece)).toEqual(['wr']);
        expect([...host.querySelectorAll('.cco')][0].textContent).toBe('h');
    });
});

describe('a chess piece in the reader\'s hand', () =>
{
    it('lifts the piece that is chosen and marks where it may go, a capture apart', () =>
    {
        table.reset(sight(lay('4k3/8/8/3p4/4P3/8/8/4K3 w - - 0 1')));
        table.hold(sq('e4'));
        table.aim(new Map([[sq('e5'), false], [sq('d5'), true]]));

        expect(on(sq('e4'))[0].hasAttribute('data-held')).toBe(true);
        expect(marks('held').map((mark) => mark.style.translate)).toEqual([at(sq('e4'))]);
        expect(marks('aim').map((mark) => mark.style.translate)).toEqual([at(sq('e5'))]);
        expect(marks('take').map((mark) => mark.style.translate)).toEqual([at(sq('d5'))]);

        table.hold(null);
        table.aim(new Map());

        expect(on(sq('e4'))[0].hasAttribute('data-held')).toBe(false);
        expect(marks('held')).toEqual([]);
        expect(marks('aim')).toEqual([]);
    });

    it('is carried under the pointer, and the square it would go to is outlined', () =>
    {
        table.reset(sight(lay(START)));
        table.aim(new Map([[sq('e3'), false], [sq('e4'), false]]));

        expect(table.grab(sq('e2'))).toBe(true);

        const pawn = on(sq('e2'))[0];

        expect(pawn.hasAttribute('data-carried')).toBe(true);
        expect(pawn.style.zIndex).toBe(String(LAYER.airborne));

        table.drag(500, 500);
        table.hover(sq('e4'));

        expect(pawn.style.translate).toBe(`${ cq(500 - SQUARE / 2) } ${ cq(500 - SQUARE / 2) }`);
        expect(marks('over').map((mark) => mark.style.translate)).toEqual([at(sq('e4'))]);

        table.hover(sq('a6'));

        expect(marks('over')).toEqual([]);
    });

    it('goes back to its square when it is let go anywhere it may not go, with a refusal where it was put down', async () =>
    {
        table.reset(sight(lay(START)));
        table.grab(sq('e2'));
        table.drag(300, 300);

        const pawn = pieces().find((el) => el.hasAttribute('data-carried'))!;

        table.release(true);

        expect(pawn.hasAttribute('data-carried')).toBe(false);
        expect(cues).toEqual(['deny']);
        expect(felt).toEqual(['deny']);
        expect(of(pawn).at(-1)?.frames.at(-1)?.translate).toBe(at(sq('e2')));

        await elapse(300);

        expect(on(sq('e2'))).toEqual([pawn]);
    });

    it('sets a carried piece down from where it was let go, rather than gliding it from its square', async () =>
    {
        table.reset(sight(lay(START)));
        table.grab(sq('e2'));
        table.drag(450, 560);

        const pawn = pieces().find((el) => el.hasAttribute('data-carried'))!;

        expect(await Promise.race([table.advance(move('e2', 'e4', 'P')), elapse(400).then(() => 'late')])).toBe(true);
        expect(of(pawn).at(-1)?.frames[0].translate).toBe(`${ cq(450 - SQUARE / 2) } ${ cq(560 - SQUARE / 2) }`);
        expect(on(sq('e4'))).toEqual([pawn]);
    });

    it('says when a move it is handed does not start from a piece it shows', async () =>
    {
        table.reset(sight(lay(START)));

        expect(await table.advance(move('e3', 'e4', 'P'))).toBe(false);
    });
});

describe('a chess landing, with timers that fire one at a time as a browser\'s do', () =>
{
    const tasks = (start: number) =>
    {
        let now = start;
        let made = 0;
        let waiting: { at: number; order: number; run: () => void }[] = [];

        return {
            now: () => now,

            after(ms: number, run: () => void)
            {
                made += 1;

                const due = { at: now + Math.max(0, ms), order: made, run };

                waiting.push(due);

                return () =>
                {
                    waiting = waiting.filter((one) => one !== due);
                };
            },

            async elapse(ms: number)
            {
                const until = now + ms;

                for (;;)
                {
                    const next = waiting.filter((one) => one.at <= until).sort((one, other) => one.at - other.at || one.order - other.order)[0];

                    if (next === undefined)
                    {
                        break;
                    }

                    waiting = waiting.filter((one) => one !== next);
                    now = Math.max(now, next.at);
                    next.run();
                    await flush();
                }

                now = until;
                await flush();
            }
        };
    };

    it('sounds each piece set down before whatever follows it: the next move, the castled rook, the end, and a piece dropped from the hand', async () =>
    {
        const timers = tasks(1000);
        const heard: string[] = [];
        const own = document.createElement('div');
        const sound: SoundHandle = {
            play: (cue) =>
            {
                heard.push(cue);
            },
            setEnabled: () => undefined,
            dispose: () => undefined
        };
        const ownStage = createStage({ clock: timers, quiet: () => false, report: (error) => broke.push(error) });
        const ownDirector = createDirector(ownStage, timers, (error) => broke.push(error));
        const board = createChessTable({ host: own, stage: ownStage, sound: () => sound, animals: () => false, feel: () => undefined });
        const shown = async (acts: Act<Told>[], seen: Sight<Lay>) =>
        {
            heard.length = 0;
            void ownDirector.enqueue((ctx) => board.play(acts, seen, ctx), { estimate: board.estimate(acts) });
            await timers.elapse(4000);

            return [...heard];
        };

        own.className = 'chess-layer';
        document.body.append(own);

        board.reset(sight(lay(START), 4, null));

        expect(await shown([
            act(5, 0, [move('e2', 'e4', 'P')]),
            act(6, 1, [move('e7', 'e5', 'p', { seat: 1 })]),
            act(7, 1, [{ e: 'finish', reason: 'resign', winner: 0 }])
        ], sight(lay('rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2'), 7, null))).toEqual(['piece-move', 'piece-move', 'draw']);

        board.reset(sight(lay(START), 4, null));

        expect(await shown([
            act(5, 0, [move('e2', 'e4', 'P')]),
            act(6, 1, [move('g8', 'f6', 'n', { seat: 1 })]),
            act(7, 1, [{ e: 'finish', reason: 'resign', winner: 0 }])
        ], sight(lay('rnbqkb1r/pppppppp/5n2/8/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 1 2'), 7, null)), 'a knight\'s arc').toEqual(['piece-move', 'piece-move', 'draw']);

        board.reset(sight(lay('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1'), 5, 0));

        expect(await shown([
            act(6, 0, [move('e1', 'g1', 'K', { castle: 'k' })]),
            act(7, 0, [{ e: 'finish', reason: 'resign', winner: 0 }])
        ], sight(lay('r3k2r/8/8/8/8/8/8/R4RK1 b kq - 1 1'), 7, 0))).toEqual(['piece-move', 'piece-move', 'win']);

        board.reset(sight(lay(START), 4, 0));
        board.grab(sq('e2'));
        board.drag(450, 560);
        heard.length = 0;
        void board.advance(move('e2', 'e4', 'P')).then(() => heard.push('after'));
        await timers.elapse(2000);

        expect(heard, 'a piece dropped from the hand').toEqual(['piece-move', 'after']);

        ownDirector.cancel();
        board.dispose();
        own.remove();
    });
});
