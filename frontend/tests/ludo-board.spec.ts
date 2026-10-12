import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';

import { manualClock, type ManualClock } from '../src/lib/clock.ts';
import type { Haptic } from '../src/lib/haptics.ts';
import type { LudoBoard } from '../src/data/match.ts';
import { ENTER_MS, HOME_MS, KNOCK_MS, PASS_LEAST, PASS_MS, SLIDE_MS, STEP_LEAST, STEP_MS, TUMBLE_MS, WIN_LEAST, WIN_MS, createLudoBoard } from '../src/game/board/ludo-board.ts';
import type { BoardHandle, Facts } from '../src/game/bridge.ts';
import { BLOCK, CELL, HOME_SCALE, MARGIN, centreOf } from '../src/game/layout.ts';
import { HISTORY, feltOf, homeAt, nestAt, type Felt, type Told } from '../src/game/ludo-felt.ts';
import { createDirector, type Director } from '../src/game/stage/director.ts';
import { LAYER } from '../src/game/stage/layers.ts';
import type { Act, Batch } from '../src/game/stage/feed.ts';
import { createPresenter, type Sight } from '../src/game/stage/presenter.ts';
import { createStage, type Stage } from '../src/game/stage/stage.ts';
import type { Cue, SoundHandle } from '../src/game/sound.ts';
import { ludoEngine } from '../../backend/src/domains/match/engines/ludo.ts';
import { apply } from '../../backend/src/domains/match/ludo/engine.ts';
import { FINISHED, YARD, cellAt, coloursFor, type LudoColour } from '../../backend/src/domains/match/ludo/board.ts';
import type { EngineAction, LudoState } from '../../backend/src/domains/match/ludo/state.ts';

interface Drawn
{
    el: Element;
    frames: Keyframe[];
    options: KeyframeAnimationOptions;
}

const C = CELL * 100;

const HOME = [FINISHED, FINISHED, FINISHED, FINISHED];

const EMPTY = [YARD, YARD, YARD, YARD];

const cq = (value: number) => `${ value.toFixed(3) }cqi`;

const footOf = (place: { col: number; row: number }, dx = 0, dy = 0) =>
    `${ cq(MARGIN * 100 + (place.col + 0.5) * C + dx * C) } ${ cq(MARGIN * 100 + (place.row + 0.6) * C + dy * C) }`;

const onSquare = (colour: LudoColour, progress: number) => footOf(cellAt(colour, progress)!);

const inNest = (colour: LudoColour, seat: number) => footOf(nestAt(colour, seat));

const atHome = (colour: LudoColour, slot: number) => footOf(homeAt(colour, slot));

const standing = (pieces: number[][], die: number | null, turn = 0, sixes = die === 6 ? 1 : 0, sides = pieces.map((_, seat) => seat)): LudoState =>
{
    const colours = coloursFor(pieces.length);

    return {
        v: 1,
        game: 'ludo',
        players: pieces.map((row, seat) => ({ seat, colour: colours[seat], pieces: [...row], out: false, side: sides[seat] })),
        turn,
        die,
        sixes,
        rev: 1,
        winner: null
    };
};

const winnersOf = (state: LudoState) =>
    (state.winner === null ? [] : state.players.filter((player) => player.side === state.winner).map((player) => player.colour));

const feltAt = (state: LudoState, winners = winnersOf(state)) =>
    feltOf(ludoEngine.view(state, null) as LudoBoard, ludoEngine.turnOf(state) ?? undefined, winners);

const sight = (state: LudoState, seat: number | null = 0, id = 'm', winners = winnersOf(state)): Sight<Felt> => ({ id, rev: state.rev, seat, view: feltAt(state, winners) });

const stepped = (state: LudoState, action: EngineAction) =>
{
    const outcome = apply(state, action);

    if (!outcome.ok)
    {
        throw new Error(outcome.reason);
    }

    return { state: outcome.state, act: { rev: outcome.state.rev, seat: action.seat, moves: outcome.events as readonly Told[] } as Act<Told> };
};

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
let table: BoardHandle;
let cues: Cue[];
let felt: Haptic[];
let drawn: Drawn[];
let still: boolean;
let broke: unknown[];
let picked: string[];
let facts: Facts[];

const elapse = async (ms: number) =>
{
    for (let left = ms; left > 0; left -= 5)
    {
        clock.advance(Math.min(5, left));
        await flush();
    }

    await flush();
};

const play = (acts: Act<Told>[], seen: Sight<Felt>) => director.enqueue((ctx) => table.play(acts, seen, ctx), { estimate: table.estimate(acts) });

const pawn = (key: string) => host.querySelector<HTMLElement>(`.lp[data-key="${ key }"]`)!;

const pawns = () => [...host.querySelectorAll<HTMLElement>('.lp')];

const board = () => host.querySelector<HTMLElement>('.lb')!;

const die = () => host.querySelector<HTMLElement>('.lb-die')!;

const of = (el: Element) => drawn.filter((one) => one.el === el);

const routed = (el: Element) => of(el).filter((one) => one.frames.some((frame) => 'translate' in frame));

const others = (key: string) => drawn.filter((one) => one.el.classList.contains('lp') && one.el !== pawn(key));

const flecks = () => [...host.querySelectorAll<HTMLElement>('.lb > span')].filter((one) => one.style.background !== '');

const facing = () => die().style.getPropertyValue('--face');

const lastFacts = () => facts[facts.length - 1];

beforeEach(async () =>
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
    picked = [];
    facts = [];
    still = false;
    host = document.createElement('div');
    document.body.append(host);

    vi.spyOn(Element.prototype, 'animate').mockImplementation(function (this: Element, frames, options)
    {
        drawn.push({ el: this, frames: frames as Keyframe[], options: options as KeyframeAnimationOptions });

        const running = animate.call(this, frames, options);

        running.finished.catch(() => undefined);

        return running;
    });

    stage = createStage({ clock, quiet: () => still, report: (error) => broke.push(error) });
    director = createDirector(stage, clock, (error) => broke.push(error));
    table = await createLudoBoard({
        host,
        plate: '',
        stage,
        sound: () => sound,
        feel: (kind) => felt.push(kind),
        onPick: (key) => picked.push(key),
        onFacts: (next) => facts.push(next)
    });
});

afterEach(() =>
{
    director.cancel();
    table.dispose();
    host.remove();
    vi.restoreAllMocks();
    expect(broke).toEqual([]);
});

describe('the ludo board as it is drawn', () =>
{
    it('gives every pawn a name and a seat of its own in its yard', () =>
    {
        const state = standing([EMPTY, EMPTY, EMPTY, EMPTY], null);

        table.reset(sight(state));

        expect(pawns().map((one) => one.dataset.key)).toEqual([0, 1, 2, 3].flatMap((owner) => [0, 1, 2, 3].map((piece) => `${ owner }-${ piece }`)));

        for (const [owner, colour] of coloursFor(4).entries())
        {
            for (const piece of [0, 1, 2, 3])
            {
                expect(pawn(`${ owner }-${ piece }`).style.translate).toBe(inNest(colour, piece));
                expect(pawn(`${ owner }-${ piece }`).dataset.colour).toBe(colour);
            }
        }
    });

    it('stands a finished pawn in its triangle, smaller, and a pawn on the ring on its square', () =>
    {
        table.reset(sight(standing([[FINISHED, FINISHED, 12, YARD], EMPTY], null)));

        expect(pawn('0-0').style.translate).toBe(atHome('red', 0));
        expect(pawn('0-1').style.translate).toBe(atHome('red', 1));
        expect(pawn('0-0').style.scale).toBe(String(HOME_SCALE));
        expect(pawn('0-0').hasAttribute('data-home')).toBe(true);
        expect(pawn('0-2').style.translate).toBe(onSquare('red', 12));
        expect(pawn('0-2').style.scale).toBe('1');
        expect(lastFacts().home).toEqual({ 0: 2, 1: 0 });
        expect(lastFacts().out).toEqual([]);
    });

    it('draws two of one side on a square as one standing on the other, and two opponents side by side', () =>
    {
        table.reset(sight(standing([[8, YARD, YARD, YARD], [34, YARD, YARD, YARD]], null)));

        expect(pawn('0-0').style.translate).toBe(footOf(cellAt('red', 8)!, -0.17, -0.05));
        expect(pawn('1-0').style.translate).toBe(footOf(cellAt('red', 8)!, 0.17, 0.05));
        expect([pawn('0-0').style.scale, pawn('1-0').style.scale]).toEqual(['0.7', '0.7']);
        expect(pawns().filter((one) => one.hasAttribute('data-stacked'))).toHaveLength(0);

        table.reset(sight(standing([[14, 14, YARD, YARD], EMPTY], null)));

        expect(pawn('0-0').style.translate).toBe(footOf(cellAt('red', 14)!, BLOCK[0].dx, BLOCK[0].dy));
        expect(pawn('0-1').style.translate).toBe(footOf(cellAt('red', 14)!, BLOCK[1].dx, BLOCK[1].dy));
        expect(pawn('0-1').hasAttribute('data-stacked')).toBe(true);
        expect(pawn('0-0').hasAttribute('data-stacked')).toBe(false);
    });

    it('stands a pawn on its partner\'s as a pair of two colours, and never three as a pair', () =>
    {
        table.reset(sight(standing([[30, YARD, YARD, YARD], [20, YARD, YARD, YARD], [4, 4, YARD, YARD], EMPTY], null, 0, 0, [0, 1, 0, 1])));

        expect(pawns().filter((one) => one.hasAttribute('data-stacked')).map((one) => one.dataset.key)).toEqual([]);
        expect(pawn('0-0').style.scale).toBe('0.66');

        table.reset(sight(standing([[30, YARD, YARD, YARD], [20, YARD, YARD, YARD], [4, YARD, YARD, YARD], EMPTY], null, 0, 0, [0, 1, 0, 1])));

        expect(pawns().filter((one) => one.hasAttribute('data-stacked')).map((one) => one.dataset.key)).toEqual(['2-0']);
        expect(pawn('0-0').style.translate).toBe(footOf(cellAt('red', 30)!, BLOCK[0].dx, BLOCK[0].dy));
        expect(pawn('2-0').style.translate).toBe(footOf(cellAt('red', 30)!, BLOCK[1].dx, BLOCK[1].dy));
    });

    it('lights only the pawns it is told may move, and only while hints are on, and takes a tap near one either way', () =>
    {
        const state = standing([[10, YARD, YARD, YARD], [5, YARD, YARD, YARD]], 3);
        const near = centreOf(cellAt('red', 10)!.col, cellAt('red', 10)!.row, 1000);
        const far = centreOf(cellAt('yellow', 5)!.col, cellAt('yellow', 5)!.row, 1000);

        vi.spyOn(host, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, right: 1000, bottom: 1000, width: 1000, height: 1000, x: 0, y: 0, toJSON: () => ({}) });
        table.reset(sight(state));
        table.lit(new Set(['0-0']), true);

        expect(pawns().filter((one) => one.hasAttribute('data-movable')).map((one) => one.dataset.key)).toEqual(['0-0']);

        host.dispatchEvent(new MouseEvent('pointerup', { clientX: far.x, clientY: far.y - CELL * 300, bubbles: true }));

        expect(picked).toEqual([]);

        table.lit(new Set(['0-0']), false);

        expect(pawns().filter((one) => one.hasAttribute('data-movable'))).toHaveLength(0);

        host.dispatchEvent(new MouseEvent('pointerup', { clientX: near.x + 12, clientY: near.y - CELL * 300, bubbles: true }));

        expect(picked).toEqual(['0-0']);
    });

    it('lets the pawn that was tapped be the one that leaves the yard', () =>
    {
        table.reset(sight(standing([EMPTY, EMPTY], 6)));
        table.swap('0-3', '0-0');

        expect(pawn('0-0').style.translate).toBe(inNest('red', 3));
        expect(pawn('0-3').style.translate).toBe(inNest('red', 0));
        expect(pawn('0-1').style.translate).toBe(inNest('red', 1));
    });

    it('seats a new game from the beginning, and keeps what a tap changed through a redraw of the same game', () =>
    {
        const state = standing([EMPTY, EMPTY], 6);

        table.reset(sight(state));
        table.swap('0-3', '0-0');
        table.reset(sight(state));

        expect(pawn('0-0').style.translate).toBe(inNest('red', 3));

        table.reset(sight(state, 0, 'another'));

        expect(pawn('0-0').style.translate).toBe(inNest('red', 0));
    });
});

describe('a ludo move, played', () =>
{
    it('walks every square of its way, one hop a square, and moves nobody else', async () =>
    {
        const before = standing([[10, YARD, YARD, YARD], [5, YARD, YARD, YARD]], 4);
        const { state, act } = stepped(before, { kind: 'move', seat: 0, piece: 0 });

        table.reset(sight(before));
        drawn.length = 0;
        play([act], sight(state));
        await flush();

        const walk = routed(pawn('0-0'));

        expect(walk).toHaveLength(1);

        for (const progress of [11, 12, 13, 14])
        {
            expect(walk[0].frames.some((frame) => frame.translate === onSquare('red', progress)), `square ${ progress } is not on the way`).toBe(true);
        }

        expect(walk[0].frames[0].translate).toBe(onSquare('red', 10));
        expect(Number(walk[0].options.duration)).toBeGreaterThanOrEqual(STEP_LEAST * 4);
        expect(Number(walk[0].options.duration)).toBeLessThanOrEqual(STEP_MS * 4.2);
        expect(others('0-0')).toHaveLength(0);
        expect(pawn('0-0').hasAttribute('data-moving')).toBe(true);

        await elapse(700);

        expect(cues).toEqual(['token-step', 'token-step', 'token-step', 'token-step']);
        expect(pawn('0-0').style.translate).toBe(onSquare('red', 14));
        expect(pawn('0-0').hasAttribute('data-moving')).toBe(false);
        expect(felt).toEqual(['tick']);
        expect(table.same(sight(state))).toBe(true);
        expect(director.busy()).toBe(false);
    });

    it('brings a pawn out in one arc from its own seat to its start square', async () =>
    {
        const before = standing([EMPTY, EMPTY], 6);
        const { state, act } = stepped(before, { kind: 'move', seat: 0, piece: 0 });

        table.reset(sight(before));
        drawn.length = 0;
        play([act], sight(state));
        await flush();

        const arc = routed(pawn('0-0'));

        expect(arc).toHaveLength(1);
        expect(arc[0].frames[0].translate).toBe(inNest('red', 0));
        expect(arc[0].frames[arc[0].frames.length - 1].translate).toBe(onSquare('red', 0));
        expect(arc[0].options.duration).toBe(ENTER_MS);
        expect(others('0-0')).toHaveLength(0);

        await elapse(ENTER_MS + 40);

        expect(cues).toEqual(['token-step']);
        expect(pawn('0-0').style.translate).toBe(onSquare('red', 0));
        expect(pawn('0-1').style.translate).toBe(inNest('red', 1));
    });

    it('sends a captured pawn home only once the attacker has landed, and says so to both of them', async () =>
    {
        const before = standing([[10, YARD, YARD, YARD], [38, YARD, YARD, YARD]], 2);
        const { state, act } = stepped(before, { kind: 'move', seat: 0, piece: 0 });

        expect(act.moves.map((move) => move.e)).toEqual(['step', 'capture']);

        table.reset(sight(before));
        drawn.length = 0;
        play([act], sight(state));
        await flush();
        await elapse(150);

        expect(routed(pawn('1-0'))).toHaveLength(0);
        expect(pawn('1-0').style.translate).toBe(onSquare('yellow', 38));
        expect(cues).not.toContain('token-capture');

        await elapse(140);

        expect(cues).toEqual(['token-step', 'token-step', 'token-capture']);
        expect(routed(pawn('1-0'))).toHaveLength(1);
        expect(routed(pawn('1-0'))[0].frames.some((frame) => String(frame.rotate ?? '0deg') !== '0deg' && frame.rotate !== '0.0deg')).toBe(true);
        expect(felt).toEqual(['tick', 'capture']);

        await elapse(KNOCK_MS + 40);

        expect(cues).toEqual(['token-step', 'token-step', 'token-capture', 'token-yard']);
        expect(pawn('1-0').style.translate).toBe(inNest('yellow', 0));
        expect(table.same(sight(state))).toBe(true);

        table.reset(sight(before, 1));
        felt.length = 0;
        play([act], sight(state, 1));
        await elapse(1200);

        expect(felt).toEqual(['hit']);

        table.reset(sight(before, null));
        felt.length = 0;
        play([act], sight(state, null));
        await elapse(1200);

        expect(felt).toEqual([]);
    });

    it('sends everybody on a start square home together when a pawn comes out onto it', async () =>
    {
        const before = standing([EMPTY, [39, 5, YARD, YARD], [26, YARD, YARD, YARD]], 6);
        const { state, act } = stepped(before, { kind: 'move', seat: 0, piece: 0 });

        table.reset(sight(before));
        drawn.length = 0;
        play([act], sight(state));
        await elapse(ENTER_MS - 20);

        expect(routed(pawn('1-0'))).toHaveLength(0);
        expect(routed(pawn('2-0'))).toHaveLength(0);

        await elapse(40);

        expect(routed(pawn('1-0'))).toHaveLength(1);
        expect(routed(pawn('2-0'))).toHaveLength(1);
        expect(cues.filter((cue) => cue === 'token-capture')).toHaveLength(1);

        await elapse(KNOCK_MS + 40);

        expect(cues.filter((cue) => cue === 'token-yard')).toHaveLength(1);
        expect(pawn('1-0').style.translate).toBe(inNest('green', 0));
        expect(pawn('2-0').style.translate).toBe(inNest('yellow', 0));
        expect(pawn('1-1').style.translate).toBe(onSquare('green', 5));
    });

    it('walks the home run and then goes into its triangle, and counts the pawn home only then', async () =>
    {
        const before = standing([[53, YARD, YARD, YARD], EMPTY], 3);
        const { state, act } = stepped(before, { kind: 'move', seat: 0, piece: 0 });

        expect(act.moves.map((move) => move.e)).toEqual(['step', 'home']);

        table.reset(sight(before));
        drawn.length = 0;
        play([act], sight(state));
        await flush();

        const walk = routed(pawn('0-0'))[0];

        expect(walk.frames.some((frame) => frame.translate === onSquare('red', 54))).toBe(true);
        expect(walk.frames[walk.frames.length - 1].translate).toBe(onSquare('red', 55));
        expect(lastFacts().home[0]).toBe(0);

        await elapse(Number(walk.options.duration) + 20);

        expect(cues).toContain('home');
        expect(lastFacts().home[0]).toBe(0);

        await elapse(HOME_MS + 20);

        expect(lastFacts().home[0]).toBe(1);
        expect(pawn('0-0').style.translate).toBe(atHome('red', 0));
        expect(pawn('0-0').style.scale).toBe(String(HOME_SCALE));
        expect(pawn('0-0').hasAttribute('data-home')).toBe(true);
        expect(felt).toEqual(['tick', 'select']);
    });

    it('makes a pair when a pawn lands beside one of its own, and only when it has landed', async () =>
    {
        const before = standing([[10, 14, YARD, YARD], EMPTY], 4);
        const { state, act } = stepped(before, { kind: 'move', seat: 0, piece: 0 });

        table.reset(sight(before));
        play([act], sight(state));
        await elapse(200);

        expect(pawn('0-1').style.translate).toBe(onSquare('red', 14));
        expect(pawn('0-1').hasAttribute('data-stacked')).toBe(false);

        await elapse(500);

        expect(pawn('0-0').style.translate).toBe(footOf(cellAt('red', 14)!, BLOCK[0].dx, BLOCK[0].dy));
        expect(pawn('0-1').style.translate).toBe(footOf(cellAt('red', 14)!, BLOCK[1].dx, BLOCK[1].dy));
        expect(pawn('0-1').hasAttribute('data-stacked')).toBe(true);
    });

    it('slides a seat that left home quietly when the game goes on, and moves nothing when its leaving ends the game', async () =>
    {
        const three = standing([[10, 20, YARD, YARD], [5, YARD, YARD, YARD], [7, 30, YARD, YARD]], null);
        const gone = stepped(three, { kind: 'forfeit', seat: 0, reason: 'left' });

        table.reset(sight(three));
        drawn.length = 0;
        play([gone.act], sight(gone.state));
        await flush();

        expect(lastFacts().out, 'the plate was told a seat had gone while its pawns still stood on the board').toEqual([]);
        expect(routed(pawn('0-0'))).toHaveLength(1);
        expect(routed(pawn('0-0'))[0].frames).toHaveLength(2);
        expect(routed(pawn('0-0'))[0].options.duration).toBe(SLIDE_MS);
        expect(routed(pawn('1-0'))).toHaveLength(0);

        await elapse(SLIDE_MS + 20);

        expect(cues).toEqual([]);
        expect(lastFacts().out).toEqual([0]);
        expect(pawn('0-0').style.translate).toBe(inNest('red', 0));
        expect(pawn('0-1').style.translate).toBe(inNest('red', 1));

        const two = standing([[10, 20, YARD, YARD], [5, YARD, YARD, YARD]], null);
        const ended = stepped(two, { kind: 'forfeit', seat: 0, reason: 'left' });

        table.reset(sight(two));
        drawn.length = 0;
        play([ended.act], sight(ended.state, 1, 'm', []));
        await elapse(600);

        expect(drawn.filter((one) => one.el.classList.contains('lp'))).toHaveLength(0);
        expect(pawn('0-0').style.translate).toBe(onSquare('red', 10));
        expect(lastFacts().out).toEqual([0]);
        expect(flecks()).toHaveLength(0);
        expect(cues).toEqual([]);
    });

    it('picks a roll up from the board and the plate at once when whoever rolled it leaves, before the seat is called gone', async () =>
    {
        const three = standing([[10, 20, YARD, YARD], [5, YARD, YARD, YARD], [7, 30, YARD, YARD]], 3);
        const gone = stepped(three, { kind: 'forfeit', seat: 0, reason: 'timeout' });

        table.reset(sight(three));

        expect(board().hasAttribute('data-rolled')).toBe(true);
        expect(lastFacts().die).toEqual({ roller: 0, face: 3, fate: 'pending' });

        play([gone.act], sight(gone.state));
        await flush();

        expect(board().hasAttribute('data-rolled')).toBe(false);
        expect(lastFacts().die, 'the plate kept a roll the board had already picked up').toBeNull();
        expect(lastFacts().out).toEqual([]);

        await elapse(SLIDE_MS + 20);

        expect(lastFacts().out).toEqual([0]);
        expect(table.same(sight(gone.state))).toBe(true);
    });

    it('throws confetti in the winners\' colours when the last pawn is home, after it is home', async () =>
    {
        const before = standing([[FINISHED, FINISHED, FINISHED, 54], EMPTY], 2);
        const { state, act } = stepped(before, { kind: 'move', seat: 0, piece: 3 });

        expect(act.moves.map((move) => move.e)).toEqual(['step', 'home', 'finish']);

        table.reset(sight(before));
        play([act], sight(state));
        await elapse(100);

        expect(flecks()).toHaveLength(0);

        await elapse(STEP_MS + HOME_MS + 40);

        expect(cues).toContain('win');
        expect(flecks().length).toBeGreaterThan(10);
        expect(lastFacts().home[0]).toBe(4);
        expect(director.busy(), 'the table was done while its confetti was still in the air').toBe(true);

        await elapse(WIN_MS - 200);

        expect(director.busy()).toBe(true);

        await elapse(2000);

        expect(director.busy()).toBe(false);
        expect(flecks()).toHaveLength(0);
        expect(table.same(sight(state))).toBe(true);
    });

    it('holds the end no longer than its least when something waits, and not at all when nothing is thrown', async () =>
    {
        const before = standing([[FINISHED, FINISHED, FINISHED, 54], EMPTY], 2);
        const { state, act } = stepped(before, { kind: 'move', seat: 0, piece: 3 });

        table.reset(sight(before));
        play([act], sight(state));
        await elapse(STEP_MS + HOME_MS + 40);
        director.enqueue(() => undefined, { cuts: true });
        await elapse(WIN_LEAST + 20);

        expect(director.busy(), 'the celebration held up what was waiting behind it').toBe(false);

        still = true;
        table.reset(sight(before));
        play([act], sight(state));
        await elapse(400);

        expect(cues.filter((cue) => cue === 'win')).toHaveLength(2);
        expect(flecks()).toHaveLength(0);
        expect(director.busy(), 'a table that throws nothing held its result back').toBe(false);
    });
});

describe('the layers of a ludo board', () =>
{
    const layerOf = (el: HTMLElement) => Number(el.style.zIndex);

    it('draws a pawn lower on the board over one above it, and the upper pawn of a pair over the other', () =>
    {
        const one = cellAt('red', 8)!;
        const other = cellAt('red', 30)!;

        expect(one.row).not.toBe(other.row);

        table.reset(sight(standing([[8, 30, YARD, YARD], [8, 8, YARD, YARD]], null)));

        const [behind, before] = one.row < other.row ? [pawn('0-0'), pawn('0-1')] : [pawn('0-1'), pawn('0-0')];
        const top = pawn('1-0').hasAttribute('data-stacked') ? pawn('1-0') : pawn('1-1');
        const under = top === pawn('1-0') ? pawn('1-1') : pawn('1-0');

        expect(layerOf(before)).toBeGreaterThan(layerOf(behind));
        expect(top.hasAttribute('data-stacked')).toBe(true);
        expect(layerOf(top)).toBeGreaterThan(layerOf(under));
    });

    it('keeps a walking pawn over the one it is about to take, a pawn knocked home over every pawn, and the die over that', async () =>
    {
        const before = standing([[10, YARD, YARD, YARD], [38, YARD, YARD, YARD]], 2);
        const { state, act } = stepped(before, { kind: 'move', seat: 0, piece: 0 });

        table.reset(sight(before));
        play([act], sight(state));
        await flush();
        await elapse(100);

        expect(pawn('0-0').hasAttribute('data-moving')).toBe(true);
        expect(layerOf(pawn('0-0')), 'a walking pawn went under the one it is about to take').toBeGreaterThan(layerOf(pawn('1-0')));
        expect(layerOf(pawn('0-0')), 'a walking pawn left the rung the pawns stand on').toBeLessThan(layerOf(die()));

        await elapse(200);

        const flying = layerOf(pawn('1-0'));
        const rest = pawns().filter((one) => one !== pawn('1-0')).map(layerOf);

        expect(pawn('1-0').hasAttribute('data-moving')).toBe(true);
        expect(flying, 'a pawn knocked home flew under another pawn').toBeGreaterThan(Math.max(...rest));
        expect(layerOf(die()), 'the die was drawn under a pawn in the air').toBeGreaterThan(flying);
        expect(layerOf(die()) / LAYER.dice, 'the die and the air are not rungs of one ladder').toBe(flying / LAYER.airborne);

        await elapse(KNOCK_MS + 40);

        expect(pawn('1-0').hasAttribute('data-moving')).toBe(false);
        expect(layerOf(pawn('1-0')), 'a pawn that has landed in its yard stayed in the air').toBeLessThan(flying);
    });

    it('throws confetti over the die and everything else on the board', async () =>
    {
        const before = standing([[FINISHED, FINISHED, FINISHED, 54], EMPTY], 2);
        const { state, act } = stepped(before, { kind: 'move', seat: 0, piece: 3 });

        table.reset(sight(before));
        play([act], sight(state));
        await elapse(STEP_MS + HOME_MS + 140);

        const thrown = flecks().map(layerOf);

        expect(thrown.length).toBeGreaterThan(10);
        expect(Math.min(...thrown)).toBeGreaterThan(layerOf(die()));
        expect(Math.min(...thrown) / LAYER.burst).toBe(layerOf(die()) / LAYER.dice);
        expect(layerOf(die())).toBeGreaterThan(Math.max(...pawns().map(layerOf)));

        await elapse(2500);
    });
});

describe('a ludo roll, played', () =>
{
    it('shows a roll that waits for its move, and hands it to the plate only when it has landed', async () =>
    {
        const before = standing([[10, YARD, YARD, YARD], EMPTY], null);
        const { state, act } = stepped(before, { kind: 'roll', seat: 0, die: 3 });

        table.reset(sight(before));
        play([act], sight(state));
        await elapse(TUMBLE_MS - 40);

        expect(board().hasAttribute('data-rolled')).toBe(true);
        expect(lastFacts().die).toBeNull();

        await elapse(60);

        expect(facing()).toBe('2');
        expect(lastFacts().die).toEqual({ roller: 0, face: 3, fate: 'pending' });
        expect(cues).toEqual(['die-land']);
        expect(director.busy()).toBe(false);
        expect(table.same(sight(state))).toBe(true);
    });

    it('rings for a six that keeps the turn', async () =>
    {
        const before = standing([[10, YARD, YARD, YARD], EMPTY], null);
        const { state, act } = stepped(before, { kind: 'roll', seat: 0, die: 6 });

        table.reset(sight(before));
        play([act], sight(state));
        await elapse(TUMBLE_MS + 20);

        expect(cues).toEqual(['die-land', 'bonus']);
        expect(die().hasAttribute('data-spent')).toBe(false);
    });

    it('dims a roll nobody could play and holds it, a third six with its own sound, and a wasted six as a six', async () =>
    {
        const stuck = stepped(standing([EMPTY, EMPTY], null), { kind: 'roll', seat: 0, die: 3 });

        table.reset(sight(standing([EMPTY, EMPTY], null)));
        play([stuck.act], sight(stuck.state));
        await elapse(TUMBLE_MS + 20);

        expect(die().getAttribute('data-spent')).toBe('no-move');
        expect(cues).toEqual(['die-land', 'pass']);
        expect(lastFacts().die).toBeNull();
        expect(director.busy()).toBe(true);

        await elapse(PASS_MS);

        expect(director.busy()).toBe(false);

        const thirdFrom = standing([[10, YARD, YARD, YARD], EMPTY], null, 0, 2);
        const third = stepped(thirdFrom, { kind: 'roll', seat: 0, die: 6 });

        cues.length = 0;
        table.reset(sight(thirdFrom));
        play([third.act], sight(third.state));
        await elapse(TUMBLE_MS + 20);

        expect(die().getAttribute('data-spent')).toBe('three-sixes');
        expect(cues).toEqual(['die-land', 'deny']);
        expect(felt).toEqual(['deny']);

        await elapse(PASS_MS);

        const wastedFrom = standing([[52, FINISHED, FINISHED, FINISHED], EMPTY], null);
        const wasted = stepped(wastedFrom, { kind: 'roll', seat: 0, die: 6 });

        cues.length = 0;
        table.reset(sight(wastedFrom));
        play([wasted.act], sight(wasted.state));
        await elapse(TUMBLE_MS + 20);

        expect(die().getAttribute('data-spent')).toBe('wasted');
        expect(cues).toEqual(['die-land', 'bonus']);
    });

    it('cuts the hold on a spent roll to its least when more of the same batch waits', async () =>
    {
        const from = standing([EMPTY, [10, YARD, YARD, YARD]], null);
        const first = stepped(from, { kind: 'roll', seat: 0, die: 3 });
        const second = stepped(first.state, { kind: 'roll', seat: 1, die: 2 });

        table.reset(sight(from));
        play([first.act, second.act], sight(second.state));
        await elapse(TUMBLE_MS + PASS_LEAST + 60);

        expect(cues.filter((cue) => cue === 'die-land')).toHaveLength(2);
    });

    it('takes the die away when the move it was for is made', async () =>
    {
        const before = standing([[10, YARD, YARD, YARD], EMPTY], null);
        const rolled = stepped(before, { kind: 'roll', seat: 0, die: 3 });
        const moved = stepped(rolled.state, { kind: 'move', seat: 0, piece: 0 });

        table.reset(sight(before));
        play([rolled.act], sight(rolled.state));
        await elapse(TUMBLE_MS + 20);

        expect(lastFacts().die).not.toBeNull();

        play([moved.act], sight(moved.state));
        await flush();

        expect(lastFacts().die).toBeNull();
        expect(board().hasAttribute('data-rolled')).toBe(false);
    });
});

describe('the ludo board, when it is asked for less motion', () =>
{
    it('moves nothing across the board and still makes every sound, in order', async () =>
    {
        const before = standing([[10, YARD, YARD, YARD], [38, YARD, YARD, YARD]], 2);
        const { state, act } = stepped(before, { kind: 'move', seat: 0, piece: 0 });

        still = true;
        table.reset(sight(before));
        drawn.length = 0;
        play([act], sight(state));
        await elapse(900);

        expect(drawn.filter((one) => one.frames.some((frame) => 'translate' in frame || 'rotate' in frame))).toHaveLength(0);
        expect(cues).toEqual(['token-step', 'token-capture', 'token-yard']);
        expect(pawn('0-0').style.translate).toBe(onSquare('red', 12));
        expect(pawn('1-0').style.translate).toBe(inNest('yellow', 0));
        expect(felt).toEqual(['tick', 'capture']);
        expect(host.querySelectorAll('.lb > span')).toHaveLength(0);
    });
});

describe('the ludo board, drawn again', () =>
{
    it('keeps everything it owns, and nothing that was only passing, after it is stopped in the middle of a capture', async () =>
    {
        const before = standing([[10, YARD, YARD, YARD], [38, YARD, YARD, YARD]], 2);
        const { state, act } = stepped(before, { kind: 'move', seat: 0, piece: 0 });

        table.reset(sight(before));
        play([act], sight(state));
        await elapse(360);

        expect(host.querySelectorAll('.lb > span').length).toBeGreaterThan(0);

        director.cancel();
        table.reset(sight(state));

        expect(pawns()).toHaveLength(8);
        expect(pawns().every((one) => one.isConnected && !one.hasAttribute('data-moving'))).toBe(true);
        expect(host.querySelectorAll('.lb > span')).toHaveLength(0);
        expect(host.querySelectorAll('.lp-lift img')).toHaveLength(8);
        expect(pawn('0-0').style.translate).toBe(onSquare('red', 12));
        expect(pawn('1-0').style.translate).toBe(inNest('yellow', 0));
        expect(die().isConnected).toBe(true);
        expect(table.same(sight(state))).toBe(true);
    });

    it('slides quietly to a board nothing explained, and goes straight there when most of the board moved', async () =>
    {
        const before = standing([[10, YARD, YARD, YARD], [5, YARD, YARD, YARD]], null);
        const after = standing([[14, YARD, YARD, YARD], [5, YARD, YARD, YARD]], null);
        const reseated = standing([[20, 21, 22, 23], [5, 6, 7, 8], [9, 10, 11, 12]], null);

        table.reset(sight(before));
        drawn.length = 0;
        director.enqueue((ctx) => table.settle(sight(after), ctx));
        await flush();

        expect(routed(pawn('0-0'))).toHaveLength(1);
        expect(routed(pawn('0-0'))[0].frames).toHaveLength(2);

        await elapse(SLIDE_MS + 20);

        expect(cues).toEqual([]);
        expect(pawn('0-0').style.translate).toBe(onSquare('red', 14));
        expect(table.same(sight(after))).toBe(true);

        table.reset(sight(standing([EMPTY, EMPTY, EMPTY], null)));
        drawn.length = 0;
        director.enqueue((ctx) => table.settle(sight(reseated), ctx));
        await flush();

        expect(drawn.filter((one) => one.el.classList.contains('lp'))).toHaveLength(0);
        expect(pawn('2-3').style.translate).toBe(onSquare('yellow', 12));
    });

    it('celebrates a result that arrived with nothing said, once', async () =>
    {
        const state = standing([HOME, EMPTY], null);

        table.reset(sight(state, 0, 'm', []));
        director.enqueue((ctx) => table.settle(sight(state, 0, 'm', ['red']), ctx));
        await flush();

        expect(cues).toEqual(['win']);
        expect(flecks().length).toBeGreaterThan(10);

        director.enqueue((ctx) => table.settle(sight(state, 0, 'm', ['red']), ctx));
        await flush();

        expect(cues).toEqual(['win']);
    });
});

describe('the reader\'s own pawn', () =>
{
    it('walks at the press, and its answer walks nothing a second time', async () =>
    {
        const before = standing([[10, YARD, YARD, YARD], [38, YARD, YARD, YARD]], 2);
        const { state, act } = stepped(before, { kind: 'move', seat: 0, piece: 0 });

        table.reset(sight(before));
        drawn.length = 0;
        void table.advance('0-0', 12);
        await flush();

        expect(routed(pawn('0-0'))).toHaveLength(1);
        expect(lastFacts().die).toBeNull();

        await elapse(400);

        expect(pawn('0-0').style.translate).toBe(onSquare('red', 12));
        expect(pawn('1-0').style.translate).toBe(onSquare('yellow', 38));
        expect(cues).toEqual(['token-step', 'token-step']);
        expect(table.same(sight(before))).toBe(false);

        play([act], sight(state));
        await flush();

        expect(routed(pawn('0-0'))).toHaveLength(1);
        expect(cues).toEqual(['token-step', 'token-step', 'token-capture']);
        expect(routed(pawn('1-0'))).toHaveLength(1);

        await elapse(KNOCK_MS + 40);

        expect(pawn('1-0').style.translate).toBe(inNest('yellow', 0));
        expect(table.same(sight(state))).toBe(true);
    });

    it('stops at the door of its home until the answer says it is in', async () =>
    {
        const before = standing([[53, YARD, YARD, YARD], EMPTY], 3);
        const { state, act } = stepped(before, { kind: 'move', seat: 0, piece: 0 });

        table.reset(sight(before));
        void table.advance('0-0', FINISHED);
        await elapse(400);

        expect(pawn('0-0').style.translate).toBe(onSquare('red', 55));
        expect(pawn('0-0').hasAttribute('data-home')).toBe(false);
        expect(lastFacts().home[0]).toBe(0);
        expect(cues).not.toContain('home');

        play([act], sight(state));
        await elapse(HOME_MS + 40);

        expect(pawn('0-0').style.translate).toBe(atHome('red', 0));
        expect(lastFacts().home[0]).toBe(1);
        expect(cues).toContain('home');
    });

    it('does not make a pair with what it lands beside until the answer comes, and goes back when there is none', async () =>
    {
        const before = standing([[10, 14, YARD, YARD], EMPTY], 4);

        table.reset(sight(before));
        void table.advance('0-0', 14);
        await elapse(600);

        expect(pawn('0-0').style.translate).toBe(onSquare('red', 14));
        expect(pawn('0-1').style.translate).toBe(onSquare('red', 14));
        expect(pawn('0-1').hasAttribute('data-stacked')).toBe(false);

        director.enqueue((ctx) => table.settle(sight(before), ctx));
        await elapse(SLIDE_MS + 20);

        expect(pawn('0-0').style.translate).toBe(onSquare('red', 10));
        expect(table.same(sight(before))).toBe(true);
    });
});

describe('a ludo turn the server played all at once', () =>
{
    it('is played through, compressed and not skipped, and the roll that follows it is thrown', async () =>
    {
        const from = standing([EMPTY, [20, YARD, YARD, YARD]], null);
        const moves: EngineAction[] = [
            { kind: 'roll', seat: 0, die: 6 },
            { kind: 'move', seat: 0, piece: 0 },
            { kind: 'roll', seat: 0, die: 6 },
            { kind: 'move', seat: 0, piece: 0 },
            { kind: 'roll', seat: 0, die: 2 },
            { kind: 'move', seat: 0, piece: 0 }
        ];
        const acts: Act<Told>[] = [];
        let state = from;

        for (const action of moves)
        {
            const next = stepped(state, action);

            state = next.state;
            acts.push(next.act);
        }

        const after = stepped(state, { kind: 'roll', seat: 1, die: 4 });
        const batchOf = (seq: number, run: Act<Told>[]): Batch => ({
            seq,
            id: 'm',
            events: run.map((one) => ({ rev: one.rev, seat: one.seat, log: { kind: 'ludo', moves: one.moves } })),
            live: true,
            jump: false
        });
        let seen = sight(from);
        const resets = vi.spyOn(table, 'reset');
        const presenter = createPresenter<Felt, Told>({ stage, clock, table, sight: () => seen, report: (error) => broke.push(error) });

        presenter.see({ seq: 0, id: 'm', events: [], live: false, jump: false });

        expect(resets).toHaveBeenCalledTimes(1);

        seen = sight(state);
        presenter.see(batchOf(1, acts));
        await flush();

        expect(presenter.presenting()).toBe(true);
        expect(table.estimate(acts)).toBeLessThan(HISTORY);

        await elapse(400);

        seen = sight(after.state);
        presenter.see(batchOf(2, [after.act]));
        await elapse(4000);

        expect(resets).toHaveBeenCalledTimes(1);
        expect(cues.filter((cue) => cue === 'die-land')).toHaveLength(4);
        expect(cues.filter((cue) => cue === 'token-step').length).toBeGreaterThanOrEqual(1 + 6 + 2);
        expect(pawn('0-0').style.translate).toBe(onSquare('red', 8));
        expect(lastFacts().die).toEqual({ roller: 1, face: 4, fate: 'pending' });
        expect(presenter.presenting()).toBe(false);

        presenter.dispose();
    });
});
