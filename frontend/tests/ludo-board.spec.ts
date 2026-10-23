import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';

import { manualClock, type ManualClock } from '../src/lib/clock.ts';
import type { Haptic } from '../src/lib/haptics.ts';
import type { LudoBoard } from '../src/data/match.ts';
import { DIE_REST_MS, DIE_SIZE, ENTER_MS, GONE_MS, HAND, HOME_MS, KNOCK_MS, LIFTED, PASS_LEAST, PASS_MS, PICKUP_MS, SLIDE_MS, STEP_LEAST, STEP_MS, WIN_LEAST, WIN_MS, createLudoBoard, dieRest } from '../src/game/board/ludo-board.ts';
import type { BoardHandle, Facts } from '../src/game/bridge.ts';
import { BLOCK, CELL, HOME_SCALE, MARGIN, centreOf } from '../src/game/layout.ts';
import { HISTORY, feltOf, homeAt, nestAt, type Felt, type Told } from '../src/game/ludo-felt.ts';
import { hashOf } from '../src/game/stage/curves.ts';
import { planThrow } from '../src/game/stage/dice.ts';
import { createDirector, type Director } from '../src/game/stage/director.ts';
import { LAYER } from '../src/game/stage/layers.ts';
import type { Act, Batch } from '../src/game/stage/feed.ts';
import { LIVE_OVER, createPresenter, type Sight } from '../src/game/stage/presenter.ts';
import { createStage, type Stage } from '../src/game/stage/stage.ts';
import type { Cue, SoundHandle } from '../src/game/sound.ts';
import { ludoEngine } from '../../backend/src/domains/match/engines/ludo.ts';
import { apply } from '../../backend/src/domains/match/ludo/engine.ts';
import { FINISHED, RING_STEPS, YARD, cellAt, coloursFor, ringIndex, type LudoColour } from '../../backend/src/domains/match/ludo/board.ts';
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
let byKey: boolean[];
let facts: Facts[];
let passes: [number, number, string][];

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

const die = () => host.querySelector<HTMLElement>('.lb-die')!;

const of = (el: Element) => drawn.filter((one) => one.el === el);

const routed = (el: Element) => of(el).filter((one) => one.frames.some((frame) => 'translate' in frame));

const others = (key: string) => drawn.filter((one) => one.el.classList.contains('lp') && one.el !== pawn(key));

const flecks = () => [...host.querySelectorAll<HTMLElement>('.lb > span')].filter((one) => one.style.background !== '');

const cube = () => host.querySelector<HTMLElement>('.lb-die .die3d')!;

const thrown = (act: Act<Told>, id = 'm') => planThrow(hashOf(id, act.rev), 1, { x: 0, y: 0 });

const spotOf = (colour: LudoColour) => `${ cq(dieRest(colour).x) } ${ cq(dieRest(colour).y) }`;

const MIDDLE = `${ cq(50) } ${ cq(50) }`;

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
    byKey = [];
    facts = [];
    passes = [];
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
        onPick: (key, keyed) =>
        {
            picked.push(key);
            byKey.push(keyed);
        },
        onFacts: (next) => facts.push(next),
        onPass: (roller, face, fate) => passes.push([roller, face, fate])
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
        table.lit(new Set(['0-0']), true, []);

        expect(pawns().filter((one) => one.hasAttribute('data-movable')).map((one) => one.dataset.key)).toEqual(['0-0']);

        host.dispatchEvent(new MouseEvent('pointerup', { clientX: far.x, clientY: far.y - CELL * 300, bubbles: true }));

        expect(picked).toEqual([]);

        table.lit(new Set(['0-0']), false, []);

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

        expect(cues).toEqual(['pawn-step', 'pawn-step', 'pawn-step', 'pawn-step']);
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

        expect(cues).toEqual(['pawn-step']);
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
        expect(cues).not.toContain('pawn-hit');

        await elapse(140);

        expect(cues).toEqual(['pawn-step', 'pawn-step', 'pawn-hit']);
        expect(routed(pawn('1-0'))).toHaveLength(1);
        expect(routed(pawn('1-0'))[0].frames.some((frame) => String(frame.rotate ?? '0deg') !== '0deg' && frame.rotate !== '0.0deg')).toBe(true);
        expect(felt).toEqual(['tick', 'capture']);

        await elapse(KNOCK_MS + 40);

        expect(cues).toEqual(['pawn-step', 'pawn-step', 'pawn-hit', 'pawn-yard']);
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
        expect(cues.filter((cue) => cue === 'pawn-hit')).toHaveLength(1);

        await elapse(KNOCK_MS + 40);

        expect(cues.filter((cue) => cue === 'pawn-yard')).toHaveLength(1);
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

        expect(lastFacts()).toMatchObject({ die: { roller: 0, face: 3, fate: 'pending' }, plate: true });

        play([gone.act], sight(gone.state));
        await flush();

        expect(lastFacts(), 'the plate kept a roll whose seat had gone').toMatchObject({ die: null, plate: false });
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

describe('a ludo landing, with timers that fire one at a time as a browser\'s do', () =>
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

    it('sounds the last step of a walk before the capture or the home it sets off, and an entry before whoever it sends home', async () =>
    {
        const timers = tasks(1000);
        const heard: Cue[] = [];
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
        const board = await createLudoBoard({ host: own, plate: '', stage: ownStage, sound: () => sound, feel: () => undefined });
        const shown = async (acts: Act<Told>[], seen: Sight<Felt>) =>
        {
            heard.length = 0;
            void ownDirector.enqueue((ctx) => board.play(acts, seen, ctx), { estimate: board.estimate(acts) });
            await timers.elapse(2000);

            return [...heard];
        };

        document.body.append(own);

        const taking = standing([[10, YARD, YARD, YARD], [38, YARD, YARD, YARD]], 2);
        const took = stepped(taking, { kind: 'move', seat: 0, piece: 0 });

        board.reset(sight(taking));

        expect(await shown([took.act], sight(took.state))).toEqual(['pawn-step', 'pawn-step', 'pawn-hit', 'pawn-yard']);

        const homing = standing([[53, YARD, YARD, YARD], EMPTY], 3);
        const homed = stepped(homing, { kind: 'move', seat: 0, piece: 0 });

        board.reset(sight(homing, 0, 'n'));

        expect(await shown([homed.act], sight(homed.state, 0, 'n'))).toEqual(['pawn-step', 'pawn-step', 'home']);

        const crowded = standing([EMPTY, [39, 5, YARD, YARD], [26, YARD, YARD, YARD]], 6);
        const came = stepped(crowded, { kind: 'move', seat: 0, piece: 0 });

        board.reset(sight(crowded, 0, 'o'));

        expect(await shown([came.act], sight(came.state, 0, 'o'))).toEqual(['pawn-step', 'pawn-hit', 'pawn-yard']);

        ownDirector.cancel();
        board.dispose();
        own.remove();
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
    const frameOf = (transform: unknown) =>
    {
        const found = /translate\((-?[\d.]+)em, (-?[\d.]+)em\) scale\(([\d.]+)\)/.exec(String(transform));

        return found === null ? null : { x: Number(found[1]), y: Number(found[2]), scale: Number(found[3]) };
    };

    const flightOf = () => [...drawn].reverse().find((one) => one.el.classList.contains('die3d-body'))!;

    it('throws the die in over the roller\'s own corner, sounds every bounce, and says what was rolled only when it has landed', async () =>
    {
        const before = standing([[10, YARD, YARD, YARD], EMPTY], null);
        const { state, act } = stepped(before, { kind: 'roll', seat: 0, die: 3 });
        const plan = thrown(act);

        table.reset(sight(before));

        expect(die().hidden).toBe(true);
        expect(lastFacts()).toMatchObject({ die: null, plate: false });

        drawn.length = 0;
        play([act], sight(state));
        await flush();

        const flight = flightOf();
        const first = frameOf(flight.frames[0].transform)!;
        const last = frameOf(flight.frames[flight.frames.length - 1].transform)!;

        expect(die().hidden).toBe(false);
        expect(die().style.translate).toBe(spotOf('red'));
        expect(lastFacts()).toMatchObject({ die: null, plate: false });
        expect(first.x, 'a throw began inside the board').toBeLessThan(-1.5);
        expect(first.y).toBeLessThan(-1.5);
        expect(first.scale, 'a die in the air is nearer whoever looks').toBeGreaterThan(1.1);
        expect([last.x, last.y, last.scale]).toEqual([0, 0, 1]);
        expect(flight.options.duration).toBe(plan.duration);
        expect(String(flight.frames[0].transform)).not.toContain('perspective');

        await elapse(plan.duration - 30);

        expect(cues).toEqual(plan.impacts.map(() => 'die-land'));
        expect(lastFacts().die, 'a roll was told while its die was still in the air').toBeNull();
        expect(director.busy(), 'the table was done before its die had landed').toBe(true);

        await elapse(40);

        expect(cube().dataset.face).toBe('3');
        expect(lastFacts()).toMatchObject({ die: { roller: 0, face: 3, fate: 'pending' }, plate: false });
        expect(director.busy()).toBe(false);
        expect(table.same(sight(state))).toBe(true);
        expect(plan.duration).toBeLessThan(1200);
    });

    it('sizes the die on the die itself, because the stylesheet gives every die a size of its own', () =>
    {
        table.reset(sight(standing([[10, YARD, YARD, YARD], EMPTY], null)));

        expect(cube().style.getPropertyValue('--die')).toBe(`calc(var(--c) * ${ DIE_SIZE })`);
        expect(die().style.getPropertyValue('--die'), 'a size set above the die is the one the stylesheet replaces').toBe('');
    });

    it('throws for the other seat from that seat\'s corner, and rests the die in that seat\'s yard', async () =>
    {
        const before = standing([[10, YARD, YARD, YARD], [5, YARD, YARD, YARD]], null, 1);
        const { state, act } = stepped(before, { kind: 'roll', seat: 1, die: 2 });

        table.reset(sight(before));
        drawn.length = 0;
        play([act], sight(state));
        await flush();

        const first = frameOf(flightOf().frames[0].transform)!;

        expect(die().style.translate).toBe(spotOf('yellow'));
        expect(first.x, 'a throw for the far corner came from the near one').toBeGreaterThan(1.5);
        expect(first.y).toBeGreaterThan(1.5);

        await elapse(1300);

        expect(lastFacts().die).toEqual({ roller: 1, face: 2, fate: 'pending' });
    });

    it('throws another seat\'s die from that seat\'s corner though one lies in the reader\'s hand, and keeps the press the reader made', async () =>
    {
        const before = standing([[10, YARD, YARD, YARD], [5, YARD, YARD, YARD]], null, 1);
        const rolled = stepped(before, { kind: 'roll', seat: 1, die: 2 });
        const moved = stepped(rolled.state, { kind: 'move', seat: 1, piece: 0 });

        table.reset(sight(before));
        table.offer(0);
        table.rattle(true);
        drawn.length = 0;
        play([rolled.act], sight(rolled.state));
        await flush();

        const first = frameOf(flightOf().frames[0].transform)!;

        expect(die().style.translate).toBe(spotOf('yellow'));
        expect(die().hasAttribute('data-hand')).toBe(false);
        expect(first.x, 'somebody else\'s die was thrown out of the reader\'s hand').toBeGreaterThan(1.5);
        expect(first.y).toBeGreaterThan(1.5);

        await elapse(thrown(rolled.act).duration + DIE_REST_MS + PICKUP_MS + 40);

        expect(die().hidden).toBe(true);

        play([moved.act], sight(moved.state));
        await flush();

        expect(die().style.translate).toBe(MIDDLE);
        expect(die().hasAttribute('data-rattle'), 'the press the reader made was forgotten when somebody else threw').toBe(true);
        expect(cues.filter((cue) => cue === 'die-shake')).toHaveLength(2);
    });

    it('lets the die lie where it fell, then takes it out over its corner to the roller\'s plate', async () =>
    {
        const before = standing([[10, YARD, YARD, YARD], EMPTY], null);
        const { state, act } = stepped(before, { kind: 'roll', seat: 0, die: 3 });

        table.reset(sight(before));
        play([act], sight(state));
        await elapse(thrown(act).duration + 10);
        drawn.length = 0;
        await elapse(DIE_REST_MS - 40);

        expect(die().hidden).toBe(false);
        expect(lastFacts().plate, 'the plate showed a die that was still lying on the board').toBe(false);
        expect(of(die())).toHaveLength(0);

        await elapse(60);

        const leaving = of(die());
        const from = String(leaving[0].frames[0].translate).split(' ').map(Number.parseFloat);
        const to = String(leaving[0].frames[1].translate).split(' ').map(Number.parseFloat);

        expect(leaving).toHaveLength(1);
        expect(leaving[0].frames[0].translate).toBe(spotOf('red'));
        expect(to[0], 'the die left towards the middle of the board').toBeLessThan(from[0]);
        expect(to[1]).toBeLessThan(from[1]);
        expect(leaving[0].frames[1].opacity).toBe(0);
        expect(lastFacts().plate).toBe(false);

        await elapse(PICKUP_MS);

        expect(die().hidden).toBe(true);
        expect(lastFacts()).toMatchObject({ die: { roller: 0, face: 3, fate: 'pending' }, plate: true });
    });

    it('waits in the middle for the reader, is lifted while the roll is asked for, and is thrown from there at the size it was held', async () =>
    {
        const before = standing([[10, YARD, YARD, YARD], EMPTY], null);
        const { state, act } = stepped(before, { kind: 'roll', seat: 0, die: 5 });

        table.reset(sight(before));
        table.offer(0);

        expect(die().hidden).toBe(false);
        expect(die().style.translate).toBe(MIDDLE);
        expect(die().style.scale).toBe(String(HAND));
        expect(die().hasAttribute('data-hand')).toBe(true);
        expect(cues).toEqual([]);

        table.rattle(true);

        expect(die().hasAttribute('data-rattle')).toBe(true);
        expect(die().style.scale).toBe(String(LIFTED));
        expect(cues).toEqual(['die-shake']);

        table.rattle(true);

        expect(cues, 'one press shook the die twice').toEqual(['die-shake']);

        table.offer(null);

        expect(die().hidden, 'the die left the hand while its roll was still being asked for').toBe(false);

        drawn.length = 0;
        play([act], sight(state));
        await flush();

        const first = frameOf(flightOf().frames[0].transform)!;
        const rest = dieRest('red');

        expect(die().hasAttribute('data-hand')).toBe(false);
        expect(die().hasAttribute('data-rattle')).toBe(false);
        expect(die().style.translate).toBe(spotOf('red'));
        expect(die().style.scale).toBe('1');
        expect(first.x).toBeCloseTo((50 - rest.x) / (DIE_SIZE * C), 2);
        expect(first.y).toBeCloseTo((50 - rest.y) / (DIE_SIZE * C), 2);
        expect(first.scale, 'the die changed size as it left the hand').toBeCloseTo(LIFTED, 2);

        await elapse(1300);

        expect(lastFacts().die).toEqual({ roller: 0, face: 5, fate: 'pending' });
        expect(host.querySelectorAll('.lb-die')).toHaveLength(1);
    });

    it('gives every die it lays a name of its own, and the die thrown from the hand the name it had there', async () =>
    {
        const mine = standing([[10, YARD, YARD, YARD], [5, YARD, YARD, YARD]], null);
        const theirs = standing([[10, YARD, YARD, YARD], [5, YARD, YARD, YARD]], null, 1);
        const rolled = stepped(mine, { kind: 'roll', seat: 0, die: 5 });
        const other = stepped(theirs, { kind: 'roll', seat: 1, die: 2 });

        table.reset(sight(mine));

        expect(cube().dataset.key, 'a die nobody has laid has a name').toBeUndefined();

        table.offer(0);

        const held = cube().dataset.key;

        expect(held).toMatch(/^die-\d+$/);

        table.rattle(true);
        table.offer(null);
        play([rolled.act], sight(rolled.state));
        await flush();

        expect(cube().dataset.key, 'the die thrown from the hand was called another die').toBe(held);

        await elapse(thrown(rolled.act).duration + 40);

        expect(cube().dataset.key).toBe(held);

        table.reset(sight(theirs, 0, 'n'));
        play([other.act], sight(other.state, 0, 'n'));
        await flush();

        const thrownIn = cube().dataset.key;

        expect(thrownIn).toMatch(/^die-\d+$/);
        expect(thrownIn, 'another seat\'s die came in under the name of the one before').not.toBe(held);

        await elapse(thrown(other.act, 'n').duration + 40);
        table.reset(sight(mine, 0, 'o'));
        table.offer(0);

        expect([held, thrownIn], 'a die laid in the hand again kept an old name').not.toContain(cube().dataset.key);
        expect(host.querySelectorAll('.die3d')).toHaveLength(1);
    });

    it('stops shaking once its roll has been thrown, so the hand it comes back to is a still one', async () =>
    {
        const before = standing([[10, YARD, YARD, YARD], EMPTY], null);
        const rolled = stepped(before, { kind: 'roll', seat: 0, die: 6 });
        const moved = stepped(rolled.state, { kind: 'move', seat: 0, piece: 0 });

        table.reset(sight(before));
        table.offer(0);
        table.rattle(true);
        play([rolled.act], sight(rolled.state));
        await elapse(thrown(rolled.act).duration + 20);
        table.offer(null);
        play([moved.act], sight(moved.state));
        await elapse(1100);
        table.offer(0);

        expect(die().hasAttribute('data-hand')).toBe(true);
        expect(die().hasAttribute('data-rattle'), 'a die went on shaking after its roll had been thrown').toBe(false);
        expect(die().style.scale).toBe(String(HAND));
        expect(cues.filter((cue) => cue === 'die-shake')).toHaveLength(1);
    });

    it('puts the die down again when the roll was refused, and takes it away when the roll is no longer the reader\'s', () =>
    {
        table.reset(sight(standing([[10, YARD, YARD, YARD], EMPTY], null)));
        table.offer(0);
        table.rattle(true);
        table.rattle(false);

        expect(die().hidden).toBe(false);
        expect(die().hasAttribute('data-rattle')).toBe(false);
        expect(die().style.scale).toBe(String(HAND));

        table.offer(null);

        expect(die().hidden).toBe(true);

        table.rattle(true);
        table.offer(null);
        table.rattle(false);

        expect(die().hidden, 'a refused roll left a die in the middle for nobody').toBe(true);
    });

    it('keeps a die that is in the air out of the hand, and brings it back to the middle when the table is done with it', async () =>
    {
        const from = standing([[52, FINISHED, FINISHED, FINISHED], EMPTY], null);
        const wasted = stepped(from, { kind: 'roll', seat: 0, die: 6 });

        table.reset(sight(from));
        table.offer(0);
        play([wasted.act], sight(wasted.state));
        await flush();
        table.offer(0);
        table.rattle(true);

        expect(die().style.translate, 'a die in the air jumped back to the middle').toBe(spotOf('red'));
        expect(die().hasAttribute('data-hand')).toBe(false);
        expect(cues).not.toContain('die-shake');

        await elapse(thrown(wasted.act).duration + 10);

        expect(cube().dataset.spent).toBe('wasted');
        expect(die().style.translate).toBe(spotOf('red'));

        await elapse(PASS_MS + 20);

        expect(die().style.translate, 'the die on the board was snatched to the middle before it had gone').toBe(spotOf('red'));
        expect(die().hasAttribute('data-hand')).toBe(false);
        expect(cues).not.toContain('die-shake');

        await elapse(GONE_MS + 20);

        expect(die().hidden).toBe(false);
        expect(die().style.translate).toBe(MIDDLE);
        expect(die().hasAttribute('data-rattle'), 'the press made while the die was away was forgotten').toBe(true);
        expect(cube().hasAttribute('data-spent')).toBe(false);
        expect(cues.filter((cue) => cue === 'die-shake')).toHaveLength(1);
    });

    it('rings for a six that keeps the turn', async () =>
    {
        const before = standing([[10, YARD, YARD, YARD], EMPTY], null);
        const { state, act } = stepped(before, { kind: 'roll', seat: 0, die: 6 });

        table.reset(sight(before));
        play([act], sight(state));
        await elapse(thrown(act).duration + 20);

        expect(cues).toEqual([...thrown(act).impacts.map(() => 'die-land'), 'bonus']);
        expect(cube().hasAttribute('data-spent')).toBe(false);
        expect(passes).toEqual([]);
    });

    it('greys a roll nobody could play, says so, holds it and takes it away; a third six and a wasted six each in their own way', async () =>
    {
        const stuckFrom = standing([EMPTY, EMPTY], null);
        const stuck = stepped(stuckFrom, { kind: 'roll', seat: 0, die: 3 });
        const lands = (act: Act<Told>) => thrown(act).impacts.map(() => 'die-land');

        table.reset(sight(stuckFrom));
        play([stuck.act], sight(stuck.state));
        await elapse(thrown(stuck.act).duration - 30);

        expect(passes, 'a roll was called unplayable while its die was still in the air').toEqual([]);

        await elapse(50);

        expect(cube().dataset.spent).toBe('no-move');
        expect(cues).toEqual([...lands(stuck.act), 'pass']);
        expect(passes).toEqual([[0, 3, 'no-move']]);
        expect(lastFacts()).toMatchObject({ die: null, plate: false });
        expect(director.busy()).toBe(true);

        await elapse(PASS_MS);

        expect(director.busy()).toBe(false);
        expect(die().hidden, 'a spent die was whisked away with no time to see it go').toBe(false);

        await elapse(GONE_MS + 20);

        expect(die().hidden).toBe(true);
        expect(lastFacts().plate).toBe(false);

        const thirdFrom = standing([[10, YARD, YARD, YARD], EMPTY], null, 0, 2);
        const third = stepped(thirdFrom, { kind: 'roll', seat: 0, die: 6 });

        cues.length = 0;
        passes.length = 0;
        table.reset(sight(thirdFrom));
        play([third.act], sight(third.state));
        await elapse(thrown(third.act).duration + 20);

        expect(cube().dataset.spent).toBe('three-sixes');
        expect(cues).toEqual([...lands(third.act), 'deny']);
        expect(felt).toEqual(['deny']);
        expect(passes).toEqual([[0, 6, 'three-sixes']]);

        await elapse(PASS_MS + GONE_MS + 20);

        const wastedFrom = standing([[52, FINISHED, FINISHED, FINISHED], EMPTY], null);
        const wasted = stepped(wastedFrom, { kind: 'roll', seat: 0, die: 6 });

        cues.length = 0;
        passes.length = 0;
        table.reset(sight(wastedFrom));
        play([wasted.act], sight(wasted.state));
        await elapse(thrown(wasted.act).duration + 20);

        expect(cube().dataset.spent).toBe('wasted');
        expect(cues).toEqual([...lands(wasted.act), 'bonus']);
        expect(passes).toEqual([[0, 6, 'wasted']]);
    });

    it('cuts the hold on a spent roll to its least when more of the same batch waits', async () =>
    {
        const from = standing([EMPTY, [10, YARD, YARD, YARD]], null);
        const first = stepped(from, { kind: 'roll', seat: 0, die: 3 });
        const second = stepped(first.state, { kind: 'roll', seat: 1, die: 2 });

        table.reset(sight(from));
        play([first.act, second.act], sight(second.state));
        await elapse(thrown(first.act).duration + PASS_LEAST + 60);

        expect(die().style.translate, 'the next roll waited out the whole hold').toBe(spotOf('yellow'));
        expect(cube().hasAttribute('data-spent')).toBe(false);
        expect(director.busy()).toBe(true);
    });

    it('takes the die away when the move it was for is made, from the board or from the plate', async () =>
    {
        const before = standing([[10, YARD, YARD, YARD], EMPTY], null);
        const rolled = stepped(before, { kind: 'roll', seat: 0, die: 3 });
        const moved = stepped(rolled.state, { kind: 'move', seat: 0, piece: 0 });

        table.reset(sight(before));
        play([rolled.act], sight(rolled.state));
        await elapse(thrown(rolled.act).duration + 20);

        expect(lastFacts().die).not.toBeNull();
        expect(die().hidden).toBe(false);

        play([moved.act], sight(moved.state));
        await flush();

        expect(lastFacts()).toMatchObject({ die: null, plate: false });

        await elapse(GONE_MS + 20);

        expect(die().hidden).toBe(true);

        await elapse(600);
        table.reset(sight(rolled.state));

        expect(lastFacts()).toMatchObject({ die: { roller: 0, face: 3, fate: 'pending' }, plate: true });
        expect(die().hidden, 'a board opened on a roll that waits threw it again').toBe(true);

        play([moved.act], sight(moved.state));
        await flush();

        expect(lastFacts()).toMatchObject({ die: null, plate: false });
        expect(die().hidden).toBe(true);
    });

    it('lets a die that is being picked up finish leaving when its move is made, and puts it on no plate', async () =>
    {
        const before = standing([[10, YARD, YARD, YARD], EMPTY], null);
        const rolled = stepped(before, { kind: 'roll', seat: 0, die: 3 });
        const moved = stepped(rolled.state, { kind: 'move', seat: 0, piece: 0 });

        table.reset(sight(before));
        play([rolled.act], sight(rolled.state));
        await elapse(thrown(rolled.act).duration + DIE_REST_MS + 60);
        play([moved.act], sight(moved.state));
        await flush();

        expect(die().hidden, 'a die on its way off the board vanished when its move was made').toBe(false);
        expect(lastFacts()).toMatchObject({ die: null, plate: false });

        await elapse(PICKUP_MS);

        expect(die().hidden).toBe(true);
        expect(lastFacts(), 'a roll that had been used was put on its roller\'s plate').toMatchObject({ die: null, plate: false });
    });

    it('hands the die to the reader the moment the roll before theirs is used, though it lay on its roller\'s plate', async () =>
    {
        const before = standing([EMPTY, [10, YARD, YARD, YARD]], null, 1);
        const rolled = stepped(before, { kind: 'roll', seat: 1, die: 3 });
        const moved = stepped(rolled.state, { kind: 'move', seat: 1, piece: 0 });

        table.reset(sight(before));
        play([rolled.act], sight(rolled.state));
        await elapse(thrown(rolled.act).duration + DIE_REST_MS + PICKUP_MS + 40);

        expect(lastFacts()).toMatchObject({ die: { roller: 1, face: 3 }, plate: true });

        table.offer(0);

        expect(die().hidden, 'the reader was handed a die that still lies on another plate').toBe(true);

        play([moved.act], sight(moved.state));
        await flush();

        expect(lastFacts()).toMatchObject({ die: null, plate: false });
        expect(die().hidden, 'nobody was handed the die when the roll before theirs had been used').toBe(false);
        expect(die().style.translate).toBe(MIDDLE);
        expect(die().hasAttribute('data-hand')).toBe(true);
    });

    it('makes no second throw of a roll it was told of again, and one die is all there ever is', async () =>
    {
        const before = standing([[10, YARD, YARD, YARD], EMPTY], null);
        const { state, act } = stepped(before, { kind: 'roll', seat: 0, die: 4 });

        table.reset(sight(before));
        play([act], sight(state));
        await elapse(thrown(act).duration + DIE_REST_MS + PICKUP_MS + 40);
        drawn.length = 0;
        void director.enqueue((ctx) => table.settle(sight(state), ctx), { estimate: 400 });
        await elapse(600);

        expect(drawn.filter((one) => one.el.classList.contains('die3d-body'))).toHaveLength(0);
        expect(lastFacts()).toMatchObject({ die: { roller: 0, face: 4, fate: 'pending' }, plate: true });
        expect(host.querySelectorAll('.lb-die')).toHaveLength(1);
        expect(host.querySelectorAll('.die3d')).toHaveLength(1);
    });
});

describe('whose turn the ludo table says it is', () =>
{
    const two = (die: number | null, turn: number) => standing([[10, YARD, YARD, YARD], [5, YARD, YARD, YARD]], die, turn);

    it('is the board\'s for a table that is simply drawn', () =>
    {
        table.reset(sight(two(null, 1)));

        expect(lastFacts().turn).toBe(1);
    });

    it('stays with a pawn while it walks, and goes to whoever is next as their die is thrown, before anything is told of the roll', async () =>
    {
        const start = two(4, 0);
        const moved = stepped(start, { kind: 'move', seat: 0, piece: 0 });
        const rolled = stepped(moved.state, { kind: 'roll', seat: 1, die: 3 });

        table.reset(sight(start));

        expect(lastFacts().turn).toBe(0);

        play([moved.act, rolled.act], sight(rolled.state));
        await elapse(120);

        expect(lastFacts().turn, 'the turn was passed while the pawn that ends it was still walking').toBe(0);

        for (let waited = 0; waited < 4000 && lastFacts().turn !== 1; waited += 20)
        {
            await elapse(20);
        }

        expect(lastFacts().turn).toBe(1);
        expect(pawn('0-0').style.translate, 'the turn was passed before the pawn that ends it had landed').toBe(onSquare('red', 14));
        expect(lastFacts().die, 'the roll was told with the turn, before the die had landed').toBeNull();
        expect(cues, 'the turn waited for the die to come down').not.toContain('die-land');

        await elapse(4000);

        expect(lastFacts()).toMatchObject({ turn: 1, die: { roller: 1, face: 3 } });
    });

    it('goes to whoever is next when the pawn has landed, where nothing else has been told', async () =>
    {
        const start = two(4, 0);
        const moved = stepped(start, { kind: 'move', seat: 0, piece: 0 });

        table.reset(sight(start));
        play([moved.act], sight(moved.state));
        await elapse(120);

        expect(lastFacts().turn).toBe(0);

        await elapse(3000);

        expect(lastFacts().turn).toBe(1);
        expect(director.busy()).toBe(false);
    });

    it('knows a board that differs only in whose turn it is from the one it shows', () =>
    {
        table.reset(sight(two(null, 0)));

        expect([table.same(sight(two(null, 0))), table.same(sight(two(null, 1)))]).toEqual([true, false]);
    });
});

describe('where a ludo die comes to rest', () =>
{
    const centreOfDie = (colour: LudoColour) => ({ col: (dieRest(colour).x - MARGIN * 100) / C, row: (dieRest(colour).y - MARGIN * 100) / C });

    const reach = DIE_SIZE / Math.SQRT2;

    it('is inside its roller\'s own yard, whichever way it turned as it stopped', () =>
    {
        const yards: Record<LudoColour, readonly [number, number]> = { red: [0, 0], green: [9, 0], yellow: [9, 9], blue: [0, 9] };

        for (const colour of ['red', 'green', 'yellow', 'blue'] as const)
        {
            const { col, row } = centreOfDie(colour);

            expect(col - reach, colour).toBeGreaterThan(yards[colour][0]);
            expect(col + reach, colour).toBeLessThan(yards[colour][0] + 6);
            expect(row - reach, colour).toBeGreaterThan(yards[colour][1]);
            expect(row + reach, colour).toBeLessThan(yards[colour][1] + 6);
        }
    });

    it('is clear of every seat a pawn waits in, of every place a pawn comes home to, and of the die in the middle', () =>
    {
        for (const colour of ['red', 'green', 'yellow', 'blue'] as const)
        {
            const { col, row } = centreOfDie(colour);

            for (let seat = 0; seat < 4; seat += 1)
            {
                const nest = nestAt(colour, seat);
                const home = homeAt(colour, seat);

                expect(Math.hypot(nest.col + 0.5 - col, nest.row + 0.5 - row), `${ colour } seat ${ seat }`).toBeGreaterThan(reach + 0.36);
                expect(Math.hypot(home.col + 0.5 - col, home.row + 0.5 - row), `${ colour } home ${ seat }`).toBeGreaterThan(reach + 0.5);
            }

            expect(Math.max(Math.abs(col - 7.5), Math.abs(row - 7.5)) - reach, `${ colour } and the middle`).toBeGreaterThan(1.6 + (HAND * DIE_SIZE) / 2);
        }
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
        expect(cues).toEqual(['pawn-step', 'pawn-hit', 'pawn-yard']);
        expect(pawn('0-0').style.translate).toBe(onSquare('red', 12));
        expect(pawn('1-0').style.translate).toBe(inNest('yellow', 0));
        expect(felt).toEqual(['tick', 'capture']);
        expect(host.querySelectorAll('.lb > span')).toHaveLength(0);
    });

    it('shows a roll where it comes to rest, with one sound, and throws nothing', async () =>
    {
        const before = standing([[10, YARD, YARD, YARD], EMPTY], null);
        const { state, act } = stepped(before, { kind: 'roll', seat: 0, die: 3 });

        still = true;
        table.reset(sight(before));
        table.offer(0);
        drawn.length = 0;
        play([act], sight(state));
        await elapse(400);

        expect(drawn.filter((one) => one.frames.some((frame) => 'translate' in frame || 'rotate' in frame || 'transform' in frame || 'scale' in frame))).toHaveLength(0);
        expect(die().style.translate).toBe(spotOf('red'));
        expect(cues).toEqual(['die-land']);
        expect(lastFacts().die).toEqual({ roller: 0, face: 3, fate: 'pending' });
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
        expect(cues).toEqual(['pawn-step', 'pawn-step']);
        expect(table.same(sight(before))).toBe(false);

        play([act], sight(state));
        await flush();

        expect(routed(pawn('0-0'))).toHaveLength(1);
        expect(cues).toEqual(['pawn-step', 'pawn-step', 'pawn-hit']);
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

describe('a move the server would not take', () =>
{
    it('walks the pawn back over the squares it crossed, says no once, and puts the roll back on its plate', async () =>
    {
        const before = standing([[10, YARD, YARD, YARD], [5, YARD, YARD, YARD]], 4);

        table.reset(sight(before));
        table.lit(new Set(['0-0']), true, []);
        void table.advance('0-0', 14);
        await elapse(700);

        expect(pawn('0-0').style.translate).toBe(onSquare('red', 14));
        expect(lastFacts().die).toBeNull();

        drawn.length = 0;
        cues.length = 0;
        felt.length = 0;
        director.enqueue((ctx) => table.settle(sight(before), ctx), { estimate: 600 });
        await flush();

        const back = routed(pawn('0-0'));

        expect(back, 'a refused pawn slid home in a straight line').toHaveLength(1);
        expect(back[0].frames[0].translate).toBe(onSquare('red', 14));

        for (const progress of [13, 12, 11])
        {
            expect(back[0].frames.some((frame) => frame.translate === onSquare('red', progress)), `square ${ progress } is not on the way back`).toBe(true);
        }

        const order = [13, 12, 11].map((progress) => back[0].frames.findIndex((frame) => frame.translate === onSquare('red', progress)));

        expect(order, 'the pawn went back the wrong way round').toEqual([...order].sort((one, other) => one - other));
        expect(back[0].frames[back[0].frames.length - 1].translate).toBe(onSquare('red', 10));
        expect(pawn('0-0').hasAttribute('data-moving')).toBe(true);
        expect(cues).toEqual(['deny']);
        expect(felt).toEqual(['deny']);
        expect(others('0-0'), 'somebody else moved for a move that was never made').toHaveLength(0);

        await elapse(STEP_LEAST * 4 + 60);

        expect(pawn('0-0').style.translate).toBe(onSquare('red', 10));
        expect(pawn('0-0').hasAttribute('data-moving')).toBe(false);
        expect(pawn('0-0').hasAttribute('data-movable'), 'the pawn that was put back could not be pressed again').toBe(true);
        expect(lastFacts()).toMatchObject({ die: { roller: 0, face: 4, fate: 'pending' }, plate: true });
        expect(table.same(sight(before))).toBe(true);
        expect(cues).toEqual(['deny']);
    });

    it('arcs a pawn that had come out back into the seat it left', async () =>
    {
        const before = standing([EMPTY, [5, YARD, YARD, YARD]], 6);

        table.reset(sight(before));
        void table.advance('0-0', 0);
        await elapse(ENTER_MS + 60);

        expect(pawn('0-0').style.translate).toBe(onSquare('red', 0));

        drawn.length = 0;
        director.enqueue((ctx) => table.settle(sight(before), ctx), { estimate: 600 });
        await flush();

        const back = routed(pawn('0-0'));

        expect(back).toHaveLength(1);
        expect(back[0].frames[0].translate).toBe(onSquare('red', 0));
        expect(back[0].frames[back[0].frames.length - 1].translate).toBe(inNest('red', 0));
        expect(Number(back[0].options.duration)).toBe(ENTER_MS);

        await elapse(ENTER_MS + 40);

        expect(pawn('0-0').style.translate).toBe(inNest('red', 0));
        expect(table.same(sight(before))).toBe(true);
    });

    it('says no to nobody about a pawn whose move the server took, whatever the board is told later', async () =>
    {
        const before = standing([[10, YARD, YARD, YARD], [5, YARD, YARD, YARD]], 4);
        const { state, act } = stepped(before, { kind: 'move', seat: 0, piece: 0 });

        table.reset(sight(before));
        void table.advance('0-0', 14);
        await elapse(700);
        play([act], sight(state));
        await elapse(300);

        expect(pawn('0-0').style.translate).toBe(onSquare('red', 14));

        cues.length = 0;
        felt.length = 0;
        director.enqueue((ctx) => table.settle(sight(before), ctx), { estimate: 600 });
        await elapse(SLIDE_MS + 60);

        expect(pawn('0-0').style.translate).toBe(onSquare('red', 10));
        expect(cues, 'a board that was only put right said no to a move the server had taken').toEqual([]);
        expect(felt).not.toContain('deny');
    });

    it('forgets a press the board was told of with nothing said, so a pawn sent home later is not refused a move', async () =>
    {
        const before = standing([EMPTY, [5, YARD, YARD, YARD]], 6);
        const { state } = stepped(before, { kind: 'move', seat: 0, piece: 0 });

        table.reset(sight(before));
        void table.advance('0-0', 0);
        await elapse(ENTER_MS + 60);
        director.enqueue((ctx) => table.settle(sight(state), ctx), { estimate: 600 });
        await elapse(SLIDE_MS + 60);

        expect(table.same(sight(state))).toBe(true);

        cues.length = 0;
        felt.length = 0;
        director.enqueue((ctx) => table.settle(sight(before), ctx), { estimate: 600 });
        await elapse(SLIDE_MS + 60);

        expect(pawn('0-0').style.translate).toBe(inNest('red', 0));
        expect(cues, 'a pawn sent home quietly was refused a move it had made long before').toEqual([]);
        expect(felt).not.toContain('deny');
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
        expect(table.estimate(acts)).toBeLessThan(HISTORY * LIVE_OVER);

        await elapse(400);

        seen = sight(after.state);
        presenter.see(batchOf(2, [after.act]));
        await elapse(4000);

        expect(resets).toHaveBeenCalledTimes(1);
        expect(cues.filter((cue) => cue === 'die-land')).toHaveLength([...acts, after.act].filter((one) => one.moves[0].e === 'roll').reduce((sum, one) => sum + thrown(one).impacts.length, 0));
        expect(cues.filter((cue) => cue === 'pawn-step').length).toBeGreaterThanOrEqual(1 + 6 + 2);
        expect(pawn('0-0').style.translate).toBe(onSquare('red', 8));
        expect(lastFacts().die).toEqual({ roller: 1, face: 4, fate: 'pending' });
        expect(presenter.presenting()).toBe(false);

        presenter.dispose();
    });
});

describe('where a lit pawn would land', () =>
{
    const marks = () => [...host.querySelectorAll<HTMLElement>('.lg')];

    const mark = (key: string) => host.querySelector<HTMLElement>(`.lg[data-goal="${ key }"]`)!;

    const steps = (key: string) => [...host.querySelectorAll<HTMLElement>(`.lg-step[data-goal="${ key }"]`)];

    const sized = () => vi.spyOn(host, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, right: 1000, bottom: 1000, width: 1000, height: 1000, x: 0, y: 0, toJSON: () => ({}) });

    const middleOf = (colour: LudoColour, progress: number) => centreOf(cellAt(colour, progress)!.col, cellAt(colour, progress)!.row, 1000);

    const point = (type: string, at: { x: number; y: number }, pointerType = 'mouse') =>
    {
        const event = new MouseEvent(type, { clientX: at.x, clientY: at.y, bubbles: true });

        Object.defineProperty(event, 'pointerType', { value: pointerType });
        host.dispatchEvent(event);
    };

    it('marks the square each lit pawn would reach, under the pawns, with the squares on the way', () =>
    {
        table.reset(sight(standing([[10, 30, YARD, YARD], [5, YARD, YARD, YARD]], 3)));
        table.lit(new Set(['0-0', '0-1']), true, [{ key: '0-0', to: 13, takes: 0, says: '' }, { key: '0-1', to: 33, takes: 0, says: '' }]);

        expect(marks().map((one) => one.dataset.goal)).toEqual(['0-0', '0-1']);
        expect(mark('0-0').style.translate).toBe(onSquare('red', 13));
        expect(mark('0-0').dataset.colour).toBe('red');
        expect(mark('0-0').hasAttribute('data-takes')).toBe(false);
        expect(mark('0-0').querySelector('.lg-burst')).toBeNull();
        expect(steps('0-0').map((one) => one.style.translate)).toEqual([onSquare('red', 11), onSquare('red', 12)]);
        expect(steps('0-1').map((one) => one.style.translate)).toEqual([onSquare('red', 31), onSquare('red', 32)]);

        const lowest = Math.min(...pawns().map((one) => Number(one.style.zIndex)));

        for (const drawn of [...marks(), ...steps('0-0'), ...steps('0-1')])
        {
            expect(Number(drawn.style.zIndex), 'a mark is drawn over a pawn').toBeLessThan(lowest);
        }
    });

    it('draws a landing that sends somebody home as another shape, and a landing at home in the home', () =>
    {
        table.reset(sight(standing([[10, FINISHED - 3, YARD, YARD], [38, YARD, YARD, YARD]], 2)));
        table.lit(new Set(['0-0', '0-1']), true, [{ key: '0-0', to: 12, takes: 1, says: '' }]);

        expect(mark('0-0').hasAttribute('data-takes')).toBe(true);
        expect(mark('0-0').querySelector('.lg-burst')).not.toBeNull();
        expect(pawns().filter((one) => one.hasAttribute('data-threat')).map((one) => one.dataset.key), 'the pawn that would be sent home, and only that one, shows it').toEqual(['1-0']);

        table.lit(new Set(['0-1']), true, [{ key: '0-1', to: FINISHED, takes: 0, says: '' }]);

        expect(marks().map((one) => one.dataset.goal)).toEqual(['0-1']);
        expect(pawn('1-0').hasAttribute('data-threat'), 'a pawn went on showing a threat that is no longer made').toBe(false);
        expect(mark('0-1').hasAttribute('data-home')).toBe(true);
        expect(mark('0-1').style.translate).toBe(atHome('red', 0));
        expect(mark('0-1').style.getPropertyValue('--s')).toBe(String(HOME_SCALE));
        expect(steps('0-1').map((one) => one.style.translate)).toEqual([onSquare('red', FINISHED - 2), onSquare('red', FINISHED - 1)]);
    });

    it('points at a home slot without taking it, so the pawn that comes home first has the first one', async () =>
    {
        const before = standing([[FINISHED - 2, FINISHED - 2, YARD, YARD], [5, YARD, YARD, YARD]], 2);
        const home = stepped(before, { kind: 'move', seat: 0, piece: 1 });

        table.reset(sight(before));
        table.lit(new Set(['0-0', '0-1']), true, [{ key: '0-0', to: FINISHED, takes: 0, says: '' }, { key: '0-1', to: FINISHED, takes: 0, says: '' }]);

        expect(mark('0-0').style.translate).toBe(atHome('red', 0));
        expect(mark('0-1').style.translate).toBe(atHome('red', 0));

        table.lit(new Set(), true, []);
        void play([home.act], sight(home.state));
        await elapse(2000);

        expect(pawn('0-1').style.translate, 'a mark kept the home slot it only pointed at').toBe(atHome('red', 0));
    });

    it('shows the threat on whoever would be sent home and never on a partner standing there', () =>
    {
        const [red, green, yellow] = coloursFor(4);
        const start = ringIndex(red, 0);
        const on = (colour: LudoColour) => Array.from({ length: RING_STEPS }, (_, progress) => progress).find((progress) => ringIndex(colour, progress) === start)!;

        table.reset(sight(standing([EMPTY, [on(green), YARD, YARD, YARD], [on(yellow), YARD, YARD, YARD], EMPTY], 6, 0, 1, [0, 1, 0, 1])));
        table.lit(new Set(['0-0', '0-1', '0-2', '0-3']), true, [{ key: '0-0', to: 0, takes: 1, says: '' }]);

        expect(pawns().filter((one) => one.hasAttribute('data-threat')).map((one) => one.dataset.key)).toEqual(['1-0']);

        const [mine, theirs] = coloursFor(2);
        const star = Array.from({ length: RING_STEPS }, (_, progress) => progress).find((progress) => ringIndex(theirs, progress) === ringIndex(mine, 13))!;

        table.reset(sight(standing([[10, YARD, YARD, YARD], [star, YARD, YARD, YARD]], 3)));
        table.lit(new Set(['0-0']), true, [{ key: '0-0', to: 13, takes: 0, says: '' }]);

        expect(pawn('1-0').style.translate, 'the other pawn does not stand on the square that is marked').toBe(mark('0-0').style.translate);
        expect(pawns().filter((one) => one.hasAttribute('data-threat')), 'a pawn safe on a star was shown a threat').toHaveLength(0);
    });

    it('marks one start square for a yard that may come out, and no square on the way', () =>
    {
        table.reset(sight(standing([EMPTY, [5, YARD, YARD, YARD]], 6)));
        table.lit(new Set(['0-0', '0-1', '0-2', '0-3']), true, [{ key: '0-0', to: 0, takes: 0, says: '' }]);

        expect(marks()).toHaveLength(1);
        expect(mark('0-0').style.translate).toBe(onSquare('red', 0));
        expect(host.querySelectorAll('.lg-step')).toHaveLength(0);

        sized();

        const seat = nestAt('red', 2);
        const body = centreOf(seat.col, seat.row, 1000);

        point('pointermove', { x: body.x, y: body.y - CELL * 300 });

        expect(pawn('0-2').hasAttribute('data-aim')).toBe(true);
        expect(mark('0-0').hasAttribute('data-aim'), 'a yard pawn that may come out does not point at the start square').toBe(true);
    });

    it('draws nothing while hints are off, for a pawn it was not told may move, or for a square behind the pawn', () =>
    {
        table.reset(sight(standing([[10, 30, YARD, YARD], [5, YARD, YARD, YARD]], 3)));
        table.lit(new Set(['0-0']), false, [{ key: '0-0', to: 13, takes: 0, says: '' }]);

        expect(marks()).toHaveLength(0);

        table.lit(new Set(['0-0']), true, [{ key: '0-0', to: 13, takes: 0, says: '' }, { key: '0-1', to: 33, takes: 0, says: '' }, { key: '9-9', to: 3, takes: 0, says: '' }]);

        expect(marks().map((one) => one.dataset.goal)).toEqual(['0-0']);

        table.lit(new Set(['0-0']), true, [{ key: '0-0', to: 10, takes: 0, says: '' }]);

        expect(marks()).toHaveLength(0);
    });

    it('marks no square on the way to a landing further off than a die reaches', () =>
    {
        table.reset(sight(standing([[10, YARD, YARD, YARD], [5, YARD, YARD, YARD]], 3)));
        table.lit(new Set(['0-0']), true, [{ key: '0-0', to: 30, takes: 0, says: '' }]);

        expect(marks()).toHaveLength(1);
        expect(steps('0-0')).toHaveLength(0);
    });

    it('lets go of a pawn under the mouse when it may no longer move, with no mark on the board', () =>
    {
        const body = middleOf('red', 10);

        sized();
        table.reset(sight(standing([[10, YARD, YARD, YARD], [5, YARD, YARD, YARD]], 3)));
        table.lit(new Set(['0-0']), true, []);
        point('pointermove', { x: body.x, y: body.y - CELL * 300 });

        expect(pawn('0-0').hasAttribute('data-aim')).toBe(true);

        table.lit(new Set(), true, []);

        expect(pawn('0-0').hasAttribute('data-aim')).toBe(false);
    });

    it('shows nothing under the mouse while the hints are off, and lets go of what it showed when they are turned off', () =>
    {
        const body = middleOf('red', 10);

        sized();
        table.reset(sight(standing([[10, YARD, YARD, YARD], [5, YARD, YARD, YARD]], 3)));
        table.lit(new Set(['0-0']), false, []);
        point('pointermove', { x: body.x, y: body.y - CELL * 300 });

        expect(host.querySelectorAll('[data-aim]'), 'a pawn showed under the mouse that it may move, with the hints off').toHaveLength(0);

        table.lit(new Set(['0-0']), true, []);
        point('pointermove', { x: body.x, y: body.y - CELL * 300 });

        expect(pawn('0-0').hasAttribute('data-aim')).toBe(true);

        table.lit(new Set(['0-0']), false, []);
        point('pointermove', { x: body.x, y: body.y - CELL * 300 });

        expect(host.querySelectorAll('[data-aim]')).toHaveLength(0);
    });

    it('keeps the marks it has drawn when it is told the same thing again', () =>
    {
        table.reset(sight(standing([[10, YARD, YARD, YARD], [5, YARD, YARD, YARD]], 3)));
        table.lit(new Set(['0-0']), true, [{ key: '0-0', to: 13, takes: 0, says: '' }]);

        const first = mark('0-0');

        table.lit(new Set(['0-0']), true, [{ key: '0-0', to: 13, takes: 0, says: '' }]);

        expect(first.isConnected).toBe(true);
        expect(mark('0-0')).toBe(first);
    });

    it('takes a press on a mark as a press on its pawn, and a press on a pawn as that pawn whatever is marked under it', () =>
    {
        sized();
        table.reset(sight(standing([[10, 12, YARD, YARD], [5, YARD, YARD, YARD]], 2)));
        table.lit(new Set(['0-0', '0-1']), true, [{ key: '0-0', to: 12, takes: 0, says: '' }, { key: '0-1', to: 14, takes: 0, says: '' }]);

        point('pointerup', middleOf('red', 14));

        expect(picked).toEqual(['0-1']);

        point('pointerup', middleOf('red', 12));

        expect(picked, 'a press on a pawn moved the pawn whose mark lies under it').toEqual(['0-1', '0-1']);

        table.reset(sight(standing([[10, YARD, YARD, YARD], [5, YARD, YARD, YARD]], 1)));
        table.lit(new Set(['0-0']), true, [{ key: '0-0', to: 11, takes: 0, says: '' }]);
        picked.length = 0;
        point('pointerup', middleOf('red', 11));

        expect(picked).toEqual(['0-0']);

        table.lit(new Set(['0-0']), false, [{ key: '0-0', to: 11, takes: 0, says: '' }]);
        picked.length = 0;
        point('pointerup', middleOf('red', 15));

        expect(picked, 'a square that is not marked took a press').toEqual([]);
    });

    it('shows which mark is a pawn\'s under a mouse, on the pawn or on the mark, and lets go when the mouse leaves', () =>
    {
        sized();
        table.reset(sight(standing([[10, 30, YARD, YARD], [5, YARD, YARD, YARD]], 3)));
        table.lit(new Set(['0-0', '0-1']), true, [{ key: '0-0', to: 13, takes: 0, says: '' }, { key: '0-1', to: 33, takes: 0, says: '' }]);

        const board = host.querySelector<HTMLElement>('.lb')!;

        point('pointermove', middleOf('red', 13));

        expect(mark('0-0').hasAttribute('data-aim')).toBe(true);
        expect(steps('0-0').every((one) => one.hasAttribute('data-aim'))).toBe(true);
        expect(pawn('0-0').hasAttribute('data-aim')).toBe(true);
        expect(mark('0-1').hasAttribute('data-aim')).toBe(false);
        expect(board.hasAttribute('data-aiming')).toBe(true);

        point('pointermove', middleOf('red', 30));

        expect(mark('0-1').hasAttribute('data-aim')).toBe(true);
        expect(pawn('0-1').hasAttribute('data-aim')).toBe(true);
        expect(mark('0-0').hasAttribute('data-aim')).toBe(false);
        expect(pawn('0-0').hasAttribute('data-aim')).toBe(false);

        point('pointerleave', middleOf('red', 30));

        expect(host.querySelectorAll('[data-aim]')).toHaveLength(0);
        expect(board.hasAttribute('data-aiming')).toBe(false);

        point('pointermove', middleOf('red', 13), 'touch');

        expect(host.querySelectorAll('[data-aim]'), 'a finger on its way somewhere is not a pointer resting').toHaveLength(0);
    });

    it('takes the marks away at the press, and puts them back when the move is refused', async () =>
    {
        const before = standing([[10, 30, YARD, YARD], [5, YARD, YARD, YARD]], 4);
        const goals = [{ key: '0-0', to: 14, takes: 0, says: '' }, { key: '0-1', to: 34, takes: 0, says: '' }];

        table.reset(sight(before));
        table.lit(new Set(['0-0', '0-1']), true, goals);
        void table.advance('0-0', 14);

        expect(marks(), 'the marks stayed on the board under a walking pawn').toHaveLength(0);
        expect(host.querySelectorAll('.lg-step')).toHaveLength(0);

        table.lit(new Set(['0-0', '0-1']), true, [...goals]);

        expect(marks().map((one) => one.dataset.goal), 'a pawn that had set off was marked again').toEqual(['0-1']);

        await elapse(700);
        director.enqueue((ctx) => table.settle(sight(before), ctx), { estimate: 600 });
        await elapse(STEP_LEAST * 4 + 200);

        expect(marks().map((one) => one.dataset.goal)).toEqual(['0-0', '0-1']);
    });

    it('draws them again, like the lit pawns, when the board is drawn again', () =>
    {
        const state = standing([[10, YARD, YARD, YARD], [5, YARD, YARD, YARD]], 3);

        table.reset(sight(state));
        table.lit(new Set(['0-0']), true, [{ key: '0-0', to: 13, takes: 0, says: '' }]);

        const first = mark('0-0');

        table.reset(sight(state));

        expect(first.isConnected, 'a mark outlived the board it was drawn on').toBe(false);
        expect(pawn('0-0').hasAttribute('data-movable')).toBe(true);
        expect(marks().map((one) => one.dataset.goal)).toEqual(['0-0']);
        expect(mark('0-0').style.translate).toBe(onSquare('red', 13));
        expect(steps('0-0')).toHaveLength(2);
    });
});

describe('the ludo board, played from a keyboard', () =>
{
    const GOALS = [{ key: '0-0', to: 13, takes: 0, says: 'first' }, { key: '0-1', to: 33, takes: 0, says: 'second' }];

    const hit = (key: string) => pawn(key).querySelector<HTMLElement>('.lp-hit')!;

    const buttons = () => [...host.querySelectorAll<HTMLElement>('.lp-hit[role="button"]')].map((one) => one.parentElement!.dataset.key);

    const press = (key: string, which: string) => hit(key).dispatchEvent(new KeyboardEvent('keydown', { key: which, bubbles: true, cancelable: true }));

    const two = () =>
    {
        table.reset(sight(standing([[10, 30, YARD, YARD], [5, YARD, YARD, YARD]], 3)));
        table.lit(new Set(['0-0', '0-1']), true, GOALS);
    };

    it('makes a button of every pawn that may move and of nothing else, under the name it was given, with one of them in the tab order', () =>
    {
        table.reset(sight(standing([[10, 30, YARD, YARD], [5, YARD, YARD, YARD]], 3)));

        expect(buttons()).toEqual([]);
        expect(host.querySelectorAll('[tabindex], [aria-label]')).toHaveLength(0);
        expect(host.querySelector('.lb-die')!.getAttribute('aria-hidden'), 'the die on the board is read beside the plate that says it').toBe('true');

        table.lit(new Set(['0-0', '0-1']), true, GOALS);

        expect(buttons()).toEqual(['0-0', '0-1']);
        expect([hit('0-0').getAttribute('aria-label'), hit('0-1').getAttribute('aria-label')]).toEqual(['first', 'second']);
        expect([hit('0-0').tabIndex, hit('0-1').tabIndex]).toEqual([0, -1]);

        table.lit(new Set(), true, []);

        expect(buttons()).toEqual([]);
        expect(host.querySelectorAll('[tabindex], [aria-label]')).toHaveLength(0);
    });

    it('names every pawn of a yard that may come out by the one way out, and keeps them buttons while the hints are off', () =>
    {
        table.reset(sight(standing([EMPTY, [5, YARD, YARD, YARD]], 6)));
        table.lit(new Set(['0-0', '0-1', '0-2', '0-3']), false, [{ key: '0-0', to: 0, takes: 0, says: 'out' }]);

        expect(buttons()).toEqual(['0-0', '0-1', '0-2', '0-3']);
        expect(['0-0', '0-1', '0-2', '0-3'].map((key) => hit(key).getAttribute('aria-label'))).toEqual(['out', 'out', 'out', 'out']);
        expect(pawns().filter((one) => one.hasAttribute('data-movable')), 'a pawn was lit with the hints off').toHaveLength(0);
    });

    it('puts the keyboard on the pawn in the tab order when it is asked to, and says when there is none', () =>
    {
        table.reset(sight(standing([[10, 30, YARD, YARD], [5, YARD, YARD, YARD]], 3)));

        expect(table.focus()).toBe(false);

        table.lit(new Set(['0-0', '0-1']), true, GOALS);

        expect(table.focus()).toBe(true);
        expect(document.activeElement).toBe(hit('0-0'));
    });

    it('walks the pawns that may move with the arrows, round and round, and keeps the last one in the tab order', () =>
    {
        table.reset(sight(standing([[10, 30, 40, YARD], [5, YARD, YARD, YARD]], 3)));
        table.lit(new Set(['0-0', '0-1', '0-2']), true, [...GOALS, { key: '0-2', to: 43, takes: 0, says: 'third' }]);
        table.focus();

        const arrow = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true });

        hit('0-0').dispatchEvent(arrow);

        expect(document.activeElement).toBe(hit('0-1'));
        expect(arrow.defaultPrevented, 'an arrow that walked the pawns also scrolled the page').toBe(true);
        expect([hit('0-0').tabIndex, hit('0-1').tabIndex, hit('0-2').tabIndex]).toEqual([-1, 0, -1]);

        press('0-1', 'ArrowDown');

        expect(document.activeElement).toBe(hit('0-2'));

        press('0-2', 'ArrowRight');

        expect(document.activeElement, 'the walk stopped at the last pawn').toBe(hit('0-0'));

        press('0-0', 'ArrowLeft');

        expect(document.activeElement, 'the walk stopped at the first pawn').toBe(hit('0-2'));

        press('0-2', 'ArrowUp');

        expect(document.activeElement).toBe(hit('0-1'));

        press('0-1', 'Home');

        expect(document.activeElement).toBe(hit('0-0'));

        press('0-0', 'End');

        expect(document.activeElement).toBe(hit('0-2'));
        expect(table.focus()).toBe(true);
        expect(document.activeElement, 'the tab order went back to the first pawn').toBe(hit('0-2'));
    });

    it('moves the pawn the keyboard is on at Enter or the space bar, and at no other key', () =>
    {
        two();

        const typed = new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true });
        const entered = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });

        hit('0-1').dispatchEvent(typed);
        press('0-1', 'Tab');

        expect(picked).toEqual([]);
        expect(typed.defaultPrevented, 'a key the board has no use for was taken from the page').toBe(false);

        hit('0-1').dispatchEvent(entered);
        press('0-0', ' ');

        expect(picked).toEqual(['0-1', '0-0']);
        expect(byKey).toEqual([true, true]);
        expect(entered.defaultPrevented).toBe(true);
    });

    it('takes a press that comes with no pointer as a press, and leaves a pointer\'s own to the board', () =>
    {
        const body = centreOf(cellAt('red', 10)!.col, cellAt('red', 10)!.row, 1000);

        vi.spyOn(host, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, right: 1000, bottom: 1000, width: 1000, height: 1000, x: 0, y: 0, toJSON: () => ({}) });
        two();
        hit('0-0').dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }));

        expect(picked).toEqual(['0-0']);
        expect(byKey).toEqual([true]);

        hit('0-0').dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));

        expect(picked, 'one press of a mouse moved the pawn twice').toEqual(['0-0']);

        host.dispatchEvent(new MouseEvent('pointerup', { clientX: body.x, clientY: body.y - CELL * 300, bubbles: true }));

        expect(picked).toEqual(['0-0', '0-0']);
        expect(byKey).toEqual([true, false]);
    });

    it('shows where the pawn under the keyboard would land, and lets go when the keyboard leaves it', () =>
    {
        two();
        hit('0-1').focus();

        expect(pawn('0-1').hasAttribute('data-aim')).toBe(true);
        expect(host.querySelector('.lg[data-goal="0-1"]')!.hasAttribute('data-aim')).toBe(true);
        expect(host.querySelector('.lb')!.hasAttribute('data-aiming')).toBe(true);
        expect(hit('0-1').tabIndex).toBe(0);

        hit('0-1').blur();

        expect(host.querySelectorAll('[data-aim]')).toHaveLength(0);
    });

    it('is no button from the moment it sets off, and hands the tab order to a pawn that still is', () =>
    {
        two();
        table.focus();
        void table.advance('0-0', 13);

        expect(buttons()).toEqual(['0-1']);
        expect(hit('0-0').hasAttribute('tabindex')).toBe(false);
        expect(hit('0-1').tabIndex).toBe(0);
    });
});
