import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';

import { manualClock, type ManualClock } from '../src/lib/clock.ts';
import type { Haptic } from '../src/lib/haptics.ts';
import { BAR_GAP, BAR_LEFT, BAR_WIDTH, BOTTOM, HEIGHT, MIDDLE, POINT_WIDTH, RADIUS, TOP, WIDTH, columnOf } from '../src/game/backgammon-layout.ts';
import { seedOf, spentBy, type Felt, type Told } from '../src/game/backgammon-felt.ts';
import { BACK_MOST, CUBE_MS, DROP_MOST, FLAG_MS, GAME_LEAST, GAME_MS, HISTORY, KNOCK_MS, LAST_MS, PASS_LEAST, PASS_MS, PICK_MS, ROLL_CAP, THROW_MS, WALK_MOST, createBackgammonTable, type BackgammonTable, type Facts } from '../src/game/board/backgammon-table.ts';
import { TIMING } from '../src/game/motion.ts';
import { createDirector, type Director } from '../src/game/stage/director.ts';
import type { Act } from '../src/game/stage/feed.ts';
import { LAYER } from '../src/game/stage/layers.ts';
import type { Sight } from '../src/game/stage/presenter.ts';
import { createStage, type Stage } from '../src/game/stage/stage.ts';
import type { Cue, SoundHandle, endCue } from '../src/game/sound.ts';
import { START } from '../../backend/src/domains/match/backgammon/board.ts';

interface Drawn
{
    el: Element;
    frames: Keyframe[];
    options: KeyframeAnimationOptions;
}

const row = (points: Record<number, number>) => Array.from({ length: 26 }, (_, point) => points[point] ?? 0);

const cq = (units: number) => `${ (units * 100 / WIDTH).toFixed(3) }cqw`;

const placed = (x: number, y: number) => `${ cq(x - RADIUS) } ${ cq(y - RADIUS) }`;

const felt = (over: Partial<Felt> = {}): Felt => ({
    viewer: 0,
    near: START,
    far: START,
    dice: [],
    opening: [],
    spent: spentBy(over.dice ?? [], []),
    seed: seedOf('m', 5),
    cube: { on: true, value: 1, owner: null },
    score: { near: 0, far: 0 },
    round: 1,
    turn: 'near',
    ...over
});

const sight = (view: Felt, rev = 5, seat: number | null = 0): Sight<Felt> => ({ id: 'm', rev, seat, view });

const act = (rev: number, seat: number, moves: Told[]): Act<Told> => ({ rev, seat, moves });

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
let table: BackgammonTable;
let cues: Cue[];
let felt_: Haptic[];
let drawn: Drawn[];
let still: boolean;
let broke: unknown[];
let digits: (value: number) => string = String;
let pressed: string[];
let rolls: [number, boolean][];
let faced: string[];
let passes: string[];
let unplayed: string;
let flagged: string[];
let games: string[];
let facts: Facts[];
let owned: Parameters<typeof endCue>[0];

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

const men = (tone?: string) => [...host.querySelectorAll<HTMLElement>(tone === undefined ? '.man' : `.man[data-tone="${ tone }"]`)];

const dice = () => [...host.querySelectorAll<HTMLElement>('.bgt-dice > .die3d')];

const cube = () => host.querySelector<HTMLElement>('.bgt-cube')!;

const of = (el: Element) => drawn.filter((one) => one.el === el);

const thrown = () => drawn.filter((one) => one.el.classList.contains('die3d-body'));

const fromY = (one: Drawn) => Number(/translate3d\([^,]+, ([^,]+)em/.exec(String(one.frames[0].transform))![1]);

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
    felt_ = [];
    drawn = [];
    broke = [];
    still = false;
    digits = String;
    pressed = [];
    rolls = [];
    faced = [];
    passes = [];
    unplayed = 'No move';
    flagged = [];
    games = [];
    facts = [];
    owned = undefined;
    host = document.createElement('div');
    host.className = 'bg-layer';
    document.body.append(host);

    vi.spyOn(Element.prototype, 'animate').mockImplementation(function (this: Element, frames, options)
    {
        drawn.push({ el: this, frames: frames as Keyframe[], options: options as KeyframeAnimationOptions });

        return animate.call(this, frames, options);
    });

    stage = createStage({ clock, quiet: () => still, report: (error) => broke.push(error) });
    director = createDirector(stage, clock, (error) => broke.push(error));
    table = createBackgammonTable({
        host,
        stage,
        sound: () => sound,
        feel: (kind) => felt_.push(kind),
        say: (value) => digits(value),
        onDice: () => pressed.push('dice'),
        onCube: () => pressed.push('cube'),
        onRoll: (seed, faces, landed) =>
        {
            rolls.push([seed, landed]);
            faced.push(faces.join());
        },
        noMove: () => unplayed,
        onPass: (side, faces) => passes.push(`${ side } ${ faces.join() }`),
        banner: () => flagged,
        onGame: (side, how, points) => games.push(`${ side } ${ how } ${ points }`),
        onFacts: (now) => facts.push(now),
        result: () => owned
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

describe('a backgammon table, drawn from a board', () =>
{
    it('lays out thirty checkers, the dice that were rolled and the cube', () =>
    {
        table.reset(sight(felt({ dice: [6, 1] })));

        expect(men()).toHaveLength(30);
        expect(men('light')).toHaveLength(15);
        expect(dice().map((die) => die.dataset.face)).toEqual(['6', '1']);
        expect(cube().isConnected).toBe(true);
        expect(cube().style.display).toBe('');
        expect(cube().textContent).toBe('64');
        expect(table.same(sight(felt({ dice: [6, 1] })))).toBe(true);
    });

    it('gives every checker and every die a name of its own, and dice that are thrown again new ones', async () =>
    {
        table.reset(sight(felt({ dice: [6, 1] })));

        const first = dice().map((die) => die.dataset.key);

        expect(new Set(men().map((man) => man.dataset.key)).size).toBe(30);
        expect(first.every((name) => /^die-\d+$/.test(name ?? ''))).toBe(true);
        expect(new Set(first).size).toBe(2);

        play([act(6, 1, [{ e: 'roll', seat: 1, dice: [5, 2] }])], sight(felt({ dice: [5, 2], seed: seedOf('m', 6) }), 6));
        await elapse(1600);

        const second = dice().map((die) => die.dataset.key);

        expect(new Set([...first, ...second]).size).toBe(4);
    });

    it('gives seat 0 the light checkers wherever the reader sits', () =>
    {
        table.reset(sight(felt({ viewer: 1, near: row({ 6: 15 }), far: row({ 6: 15 }) })));

        const near = men().filter((man) => man.style.translate.endsWith(cq(BOTTOM - RADIUS - RADIUS)));

        expect(near.length).toBeGreaterThan(0);
        expect(near.every((man) => man.dataset.tone === 'dark')).toBe(true);
    });

    it('stacks a point to five and writes how many there really are', () =>
    {
        table.reset(sight(felt({ near: row({ 6: 8, 5: 7 }) })));

        expect([...host.querySelectorAll('.bgt-count')].map((tag) => tag.textContent).sort()).toEqual(['7', '8']);
    });

    it('hides a cube the match does not have, and shows the value it stands at', () =>
    {
        table.reset(sight(felt({ cube: { on: false, value: 1, owner: null } })));
        expect(cube().style.display).toBe('none');

        table.reset(sight(felt({ cube: { on: true, value: 4, owner: 'near' } })));
        expect(cube().style.display).toBe('');
        expect(cube().textContent).toBe('4');
    });

    it('puts resting checkers under the count, the count under the cube and everything under what moves', () =>
    {
        table.reset(sight(felt()));

        for (const man of men())
        {
            const layer = Number(man.style.zIndex);

            expect(layer).toBeGreaterThanOrEqual(LAYER.piece);
            expect(layer).toBeLessThan(LAYER.count);
        }

        expect(host.style.getPropertyValue('--layer-dice')).toBe(String(LAYER.dice));
    });

    it('keeps the dice, the cube and the counts on the page when everything is stopped and drawn again', async () =>
    {
        const before = sight(felt({ near: row({ 6: 8, 5: 7 }), dice: [3, 3] }));
        const after = sight(felt({ near: row({ 6: 8, 5: 7 }), dice: [5, 2], seed: seedOf('m', 6) }), 6);

        table.reset(before);
        play([act(6, 1, [{ e: 'roll', seat: 1, dice: [5, 2] }])], after);
        await elapse(300);

        director.cancel();
        table.reset(after);

        expect(host.querySelector('.bgt-dice')?.isConnected).toBe(true);
        expect(dice().map((die) => die.dataset.face)).toEqual(['5', '2']);
        expect(cube().isConnected).toBe(true);
        expect(host.querySelectorAll('.bgt-count')).toHaveLength(2);
        expect(men()).toHaveLength(30);
        expect(clock.pending()).toBe(0);
    });

    it('leaves no die behind when it is stopped in the middle of picking them up', async () =>
    {
        const after = sight(felt({ near: row({ 6: 5, 8: 3, 13: 4, 7: 1, 24: 2 }) }), 6);

        table.reset(sight(felt({ dice: [6, 1] })));
        play([act(6, 0, [{ e: 'move', seat: 0, from: 13, to: 7, die: 6, hit: false }])], after);
        await elapse(WALK_MOST + 100);

        director.cancel();
        table.reset(after);

        expect(dice()).toHaveLength(0);
        expect(host.querySelectorAll('.die3d')).toHaveLength(0);
    });

    it('draws a rematch from the other chair in the other colours', () =>
    {
        table.reset(sight(felt()));

        const first = men().filter((man) => man.style.translate === placed(columnOf(6).x + POINT_WIDTH / 2, BOTTOM - RADIUS))[0];

        expect(first.dataset.tone).toBe('light');

        table.reset({ id: 'next', rev: 1, seat: 1, view: felt({ viewer: 1 }) });

        const second = men().filter((man) => man.style.translate === placed(columnOf(6).x + POINT_WIDTH / 2, BOTTOM - RADIUS))[0];

        expect(second.dataset.tone).toBe('dark');
        expect(men()).toHaveLength(30);
    });
});

describe('what happened, played on the table', () =>
{
    it('throws the dice of a roll, and they come to rest on the faces that were rolled', async () =>
    {
        const after = sight(felt({ dice: [5, 2], seed: seedOf('m', 6) }), 6);

        table.reset(sight(felt()));
        play([act(6, 1, [{ e: 'roll', seat: 1, dice: [5, 2] }])], after);
        await elapse(0);

        expect(dice().map((die) => die.dataset.face)).toEqual(['5', '2']);
        expect(cues).toEqual([]);

        expect(thrown()).toHaveLength(2);
        expect(String(thrown()[0].frames[0].transform)).toContain('translate3d(');
        expect(thrown()[0].frames.length).toBeGreaterThan(30);

        await elapse(1400);

        const landings = cues.filter((cue) => cue === 'dice-wood').length;

        expect(landings).toBeGreaterThanOrEqual(6);
        expect(landings).toBeLessThanOrEqual(8);
        expect(table.same(after)).toBe(true);
        expect(director.busy()).toBe(false);
    });

    it('throws a roll from the side of whoever rolled it', async () =>
    {
        table.reset(sight(felt()));
        play([act(6, 1, [{ e: 'roll', seat: 1, dice: [5, 2] }])], sight(felt({ dice: [5, 2] }), 6));
        await elapse(0);

        expect(thrown().map((one) => fromY(one) < -5)).toEqual([true, true]);

        director.cancel();
        drawn.length = 0;
        table.reset(sight(felt()));
        play([act(6, 0, [{ e: 'roll', seat: 0, dice: [5, 2] }])], sight(felt({ dice: [5, 2] }), 6));
        await elapse(0);

        expect(thrown().map((one) => fromY(one) > 5)).toEqual([true, true]);
    });

    it('throws each opening die from the side of whoever threw it, and keeps the first where it lies', async () =>
    {
        table.reset(sight(felt({ opening: [0, 0] })));
        play([act(2, 0, [{ e: 'throw', seat: 0, die: 6 }])], sight(felt({ opening: [6, 0], turn: 'far' }), 2));
        await elapse(0);

        expect(thrown().map((one) => fromY(one) > 5)).toEqual([true]);

        await elapse(THROW_MS + ROLL_CAP);
        drawn.length = 0;
        play([act(3, 1, [{ e: 'throw', seat: 1, die: 2 }])], sight(felt({ opening: [6, 2], turn: 'far' }), 3));
        await elapse(0);

        expect(thrown().map((one) => fromY(one) < -5), 'the second die did not come from the far side').toEqual([true]);

        await elapse(THROW_MS + ROLL_CAP);

        expect(dice().map((die) => die.dataset.face), 'the first die was picked up when the second was thrown').toEqual(['6', '2']);
    });

    it('says how it stood before its opening: the same table with no dice on it, and plays the throws and the start onto it', async () =>
    {
        const seen = sight(felt({ dice: [6, 2], seed: seedOf('m', 3) }), 3);
        const before = table.before!(seen);

        expect(before).toMatchObject({ id: 'm', rev: 3, seat: 0 });
        expect(before.view).toMatchObject({ viewer: 0, dice: [], opening: [], spent: [], seed: seen.view.seed });
        expect(table.before!(sight(felt({ opening: [0, 4] }), 2)).view.opening, 'the table before a game opened was already in its opening').toEqual([]);
        expect(before.view.near).toBe(seen.view.near);
        expect(before.view.cube).toBe(seen.view.cube);

        table.reset(before);

        expect(dice()).toHaveLength(0);
        expect(men()).toHaveLength(30);

        play([
            act(2, 0, [{ e: 'throw', seat: 0, die: 6 }]),
            act(3, 1, [{ e: 'throw', seat: 1, die: 2 }, { e: 'opening', seat: 0, dice: [6, 2] }])
        ], seen);
        await elapse((THROW_MS + ROLL_CAP) * 2 + PICK_MS * 2);

        expect(dice().map((die) => die.dataset.face)).toEqual(['6', '2']);
        expect(dice().some((die) => die.hasAttribute('data-blank'))).toBe(false);
        expect(table.same(seen)).toBe(true);
    });

    it('picks both opening dice up on a tie', async () =>
    {
        table.reset(sight(felt({ opening: [3, 0], turn: 'far' })));

        const first = dice()[0];

        expect(dice().map((die) => die.dataset.face)).toEqual(['3']);

        play([act(3, 1, [{ e: 'throw', seat: 1, die: 3 }, { e: 'tie', dice: [3, 3] }])], sight(felt({ opening: [0, 0] }), 3));
        await elapse(0);

        const second = dice().find((die) => die !== first)!;

        await elapse(THROW_MS + ROLL_CAP);
        const picked = (die: Element) => of(die).some((one) => one.options.duration === PICK_MS && one.frames.at(-1)?.opacity === 0);

        await elapse(PICK_MS + 100);

        expect([picked(first), picked(second)], 'the dice of a tie vanished instead of being picked up').toEqual([true, true]);
        expect(dice()).toHaveLength(0);
        expect(director.busy()).toBe(false);
    });

    it('lets the dice go from beyond the edge of the board, however big the board is', async () =>
    {
        const zone = host.querySelector<HTMLElement>('.bgt-dice')!;

        Object.defineProperty(host, 'clientHeight', { configurable: true, value: 880 });
        zone.style.fontSize = '44px';

        table.reset(sight(felt()));
        play([act(6, 1, [{ e: 'roll', seat: 1, dice: [5, 2] }])], sight(felt({ dice: [5, 2] }), 6));
        await elapse(0);

        expect(thrown().map((one) => fromY(one) < -(880 / 2 / 44 + 1))).toEqual([true, true]);
    });

    it('walks a checker over every point on its way, touching each, and puts it down once', async () =>
    {
        const after = sight(felt({ near: row({ 6: 5, 7: 1, 8: 3, 13: 4, 24: 2 }), dice: [6, 1] }), 6);

        table.reset(sight(felt({ dice: [6, 1] })));

        const mover = men('light').filter((man) => man.style.translate.startsWith(cq(columnOf(13).x + POINT_WIDTH / 2 - RADIUS))).at(-1)!;

        play([act(6, 0, [{ e: 'move', seat: 0, from: 13, to: 7, die: 6, hit: false }, { e: 'roll', seat: 1, dice: [6, 1] }])], after);

        const walk = of(mover)[0];
        const touched = walk.frames.filter((frame) => frame.scale === '1.000').map((frame) => frame.translate);

        for (const point of [12, 11, 10, 9, 8, 7])
        {
            expect(touched, `point ${ point }`).toContain(placed(columnOf(point).x + POINT_WIDTH / 2, BOTTOM - RADIUS));
        }

        expect(touched).toHaveLength(7);
        expect(Number(mover.style.zIndex)).toBe(LAYER.moving);
        expect(mover.style.translate).toBe(placed(columnOf(7).x + POINT_WIDTH / 2, BOTTOM - RADIUS));

        await elapse(Number(walk.options.duration));

        expect(cues.filter((cue) => cue === 'checker')).toHaveLength(1);
        expect(Number(mover.style.zIndex)).toBeLessThan(LAYER.count);
    });

    it('takes longer over a long way than a short one, so a checker never crosses the board in a blink', () =>
    {
        table.reset(sight(felt({ dice: [6, 1] })));

        const mover = men('light').filter((man) => man.style.translate.startsWith(cq(columnOf(13).x + POINT_WIDTH / 2 - RADIUS))).at(-1)!;

        play([act(6, 0, [{ e: 'move', seat: 0, from: 13, to: 7, die: 6, hit: false }])], sight(felt({ near: row({ 6: 5, 7: 1, 8: 3, 13: 4, 24: 2 }) }), 6));

        const walk = of(mover)[0];
        const length = Number(walk.options.duration);
        const lands = walk.frames.filter((frame) => frame.scale === '1.000').map((frame) => Number(frame.offset) * length);
        const across = lands[1] - lands[0];
        const along = lands[3] - lands[2];
        const units = (frame: Keyframe) => String(frame.translate).split(' ').map((one) => Number.parseFloat(one) * WIDTH / 100);
        let fastest = 0;

        for (let index = 1; index < walk.frames.length; index += 1)
        {
            const [x, y] = units(walk.frames[index]);
            const [wasX, wasY] = units(walk.frames[index - 1]);
            const took = (Number(walk.frames[index].offset) - Number(walk.frames[index - 1].offset)) * length;

            fastest = Math.max(fastest, Math.hypot(x - wasX, y - wasY) / took);
        }

        expect(across).toBeGreaterThan(along * 2.5);
        expect(along).toBeGreaterThan(60);
        expect(fastest).toBeLessThan(4);
        expect(length).toBeLessThanOrEqual(WALK_MOST);
    });

    it('knocks a blot to the bar when the checker reaches it, and the hit is heard and felt in that order', async () =>
    {
        const before = felt({ near: row({ 13: 1, 6: 14 }), far: row({ 17: 1, 12: 14 }), dice: [5, 3] });
        const after = sight(felt({ near: row({ 8: 1, 6: 14 }), far: row({ 25: 1, 12: 14 }) }), 6);

        table.reset(sight(before));

        const blot = men('dark').filter((man) => man.style.translate === placed(columnOf(8).x + POINT_WIDTH / 2, BOTTOM - RADIUS))[0];

        play([act(6, 0, [{ e: 'move', seat: 0, from: 13, to: 8, die: 5, hit: true }])], after);

        const knock = of(blot)[0];

        expect(Number(knock.options.delay)).toBeGreaterThan(300);
        expect(knock.options.fill).toBe('backwards');
        expect(knock.frames[0].translate).toBe(placed(columnOf(8).x + POINT_WIDTH / 2, BOTTOM - RADIUS));
        expect(knock.frames.at(-1)!.translate).toBe(placed(BAR_LEFT + BAR_WIDTH / 2, MIDDLE - BAR_GAP - RADIUS));
        expect(Number(blot.style.zIndex)).toBe(LAYER.airborne);

        await elapse(Number(knock.options.delay) - 10);
        expect(cues).toEqual([]);

        await elapse(WALK_MOST + KNOCK_MS);

        expect(cues.slice(0, 3)).toEqual(['checker-hit', 'checker', 'checker-bar']);
        expect(felt_).toEqual(['capture']);
    });

    it('tells the reader who was hit that they were', async () =>
    {
        const before = felt({ near: row({ 17: 1, 12: 14 }), far: row({ 13: 1, 6: 14 }), dice: [5, 3] });
        const after = sight(felt({ near: row({ 25: 1, 12: 14 }), far: row({ 8: 1, 6: 14 }) }), 6);

        table.reset(sight(before));
        play([act(6, 1, [{ e: 'move', seat: 1, from: 13, to: 8, die: 5, hit: true }])], after);
        await elapse(WALK_MOST + KNOCK_MS + PICK_MS + 200);

        expect(felt_).toEqual(['hit']);
        expect(table.same(after)).toBe(true);
    });

    it('lights the reader\'s checker on the bar when it has landed there, and not on its way', async () =>
    {
        const before = felt({ near: row({ 17: 1, 12: 14 }), far: row({ 20: 1, 13: 1, 6: 13 }), dice: [5, 3] });
        const after = sight(felt({ near: row({ 25: 1, 12: 14 }), far: row({ 17: 1, 8: 1, 6: 13 }), dice: [4, 1], seed: seedOf('m', 6) }), 6);
        const lit = () => [...host.querySelectorAll<HTMLElement>('.man[data-lit]')];

        table.reset(sight(before));
        table.lit(new Set([25]));

        expect(lit()).toEqual([]);

        play([act(6, 1, [
            { e: 'move', seat: 1, from: 20, to: 17, die: 3, hit: false },
            { e: 'move', seat: 1, from: 13, to: 8, die: 5, hit: true },
            { e: 'roll', seat: 0, dice: [4, 1] }
        ])], after);

        for (let passed = 0; passed < WALK_MOST * 2; passed += 40)
        {
            await elapse(40);

            const flying = lit().filter((man) => Number(man.style.zIndex) >= LAYER.moving);

            expect(flying, `a checker in the air wore the ring ${ passed } ms in`).toEqual([]);
        }

        await elapse(KNOCK_MS + PICK_MS + 1400);

        expect(director.busy()).toBe(false);
        expect(lit()).toHaveLength(1);
        expect(lit()[0].dataset.tone).toBe('light');
        expect(lit()[0].style.translate).toBe(placed(BAR_LEFT + BAR_WIDTH / 2, MIDDLE + BAR_GAP + RADIUS));
    });

    it('brings a checker in from the bar in one lift, not by way of the far corner', () =>
    {
        const before = felt({ near: row({ 25: 1, 6: 14 }), far: row({ 12: 15 }), dice: [6, 3] });

        table.reset(sight(before));

        const barred = men('light').filter((man) => man.style.translate.startsWith(cq(BAR_LEFT + BAR_WIDTH / 2 - RADIUS)))[0];

        play([act(6, 0, [{ e: 'move', seat: 0, from: 25, to: 19, die: 6, hit: false }])], sight(felt({ near: row({ 19: 1, 6: 14 }), far: row({ 12: 15 }) }), 6));

        const lift = of(barred)[0];
        const grounded = lift.frames.filter((frame) => frame.scale === '1.000');

        expect(grounded).toHaveLength(2);
        expect(lift.frames.at(-1)!.translate).toBe(placed(columnOf(19).x + POINT_WIDTH / 2, TOP + RADIUS));
    });

    it('bears a checker off into the tray, where it lies as a slab', async () =>
    {
        const before = felt({ near: row({ 3: 2, 0: 13 }), far: row({ 12: 15 }), dice: [3, 1] });
        const after = sight(felt({ near: row({ 3: 1, 0: 14 }), far: row({ 12: 15 }), dice: [3, 1] }), 6);

        table.reset(sight(before));
        play([act(6, 0, [{ e: 'move', seat: 0, from: 3, to: 0, die: 3, hit: false }, { e: 'roll', seat: 1, dice: [3, 1] }])], after);
        await elapse(WALK_MOST);

        expect(cues).toContain('checker-off');
        expect(host.querySelectorAll('.man[data-off]')).toHaveLength(14);
    });

    it('lets a double offered by the reader be heard as the cube, never as the card Hokm names trump with', async () =>
    {
        table.reset(sight(felt()));
        play([act(6, 0, [{ e: 'double', seat: 0, cube: 2 }])], sight(felt({ turn: 'far' }), 6));
        await elapse(CUBE_MS + 400);

        expect(cues).toContain('cube');
        expect(cues).not.toContain('trump');
    });

    it('hands the cube to whoever took it before a die of the same action is on the table', async () =>
    {
        const before = felt({ cube: { on: true, value: 1, owner: null } });
        const after = sight(felt({ cube: { on: true, value: 2, owner: 'far' }, dice: [5, 3], seed: seedOf('m', 6) }), 6);

        table.reset(sight(before));
        play([act(6, 1, [{ e: 'take', seat: 1, cube: 2 }, { e: 'roll', seat: 0, dice: [5, 3] }])], after);

        expect(cube().textContent).toBe('2');
        expect(of(cube())).toHaveLength(1);
        expect(Number(cube().style.zIndex)).toBe(LAYER.airborne);
        expect(dice()).toHaveLength(0);

        await elapse(CUBE_MS - 5);
        expect(dice()).toHaveLength(0);

        await elapse(10);
        expect(dice()).toHaveLength(2);
        expect(cube().style.zIndex).toBe('');

        await elapse(1400);
        expect(table.same(after)).toBe(true);
    });

    it('racks every checker and returns the cube before the next game opens', async () =>
    {
        const before = felt({ near: row({ 1: 1, 0: 14 }), far: row({ 20: 15 }), dice: [1, 4], cube: { on: true, value: 2, owner: 'near' } });
        const after = sight(felt({ dice: [], opening: [0, 0], seed: seedOf('m', 6), score: { near: 4, far: 0 }, round: 2 }), 6);

        table.reset(sight(before));
        play([act(6, 0, [
            { e: 'move', seat: 0, from: 1, to: 0, die: 1, hit: false },
            { e: 'game', seat: 0, how: 'gammon', points: 4, cube: 2 }
        ])], after);

        await elapse(400 + PICK_MS + 60);

        expect(dice()).toHaveLength(0);
        expect(cues).toContain('hand-won');
        expect(felt_).toContain('hand');
        expect(cube().textContent).toBe('64');
        expect(drawn.filter((one) => one.el.classList.contains('man')).length).toBeGreaterThan(20);
        expect(drawn.some((one) => one.el.classList.contains('die3d-body'))).toBe(false);

        await elapse(3200);

        expect(dice(), 'the next game opened with dice nobody threw').toHaveLength(0);
        expect(table.same(after)).toBe(true);
        expect(host.querySelectorAll('.man[data-off]')).toHaveLength(0);
        expect(director.busy()).toBe(false);
    });

    describe('a game that is won', () =>
    {
        const flag = () => host.querySelector<HTMLElement>('.bgt-banner');

        const racking = () => drawn.filter((one) => one.el.classList.contains('man')).length > 20;

        const won = (last = false) =>
        {
            const before = felt({ near: row({ 1: 1, 0: 14 }), far: row({ 20: 15 }), dice: [1, 4], cube: { on: true, value: 2, owner: 'near' } });
            const after = last
                ? sight(felt({ near: row({ 0: 15 }), far: row({ 20: 15 }), cube: { on: true, value: 2, owner: 'near' }, score: { near: 4, far: 0 } }), 6)
                : sight(felt({ dice: [2, 5], seed: seedOf('m', 6), score: { near: 4, far: 0 }, round: 2 }), 6);

            table.reset(sight(before));
            play([act(6, 0, [
                { e: 'move', seat: 0, from: 1, to: 0, die: 1, hit: false },
                { e: 'game', seat: 0, how: 'gammon', points: 4, cube: 2 },
                ...(last ? [{ e: 'finish', seat: 0 }] : [{ e: 'opening', seat: 1, dice: [2, 5] }])
            ])], after);

            return after;
        };

        it('is called on a banner over the board, held there, and only then are the checkers racked', async () =>
        {
            flagged = ['You win the game', 'Gammon · 4 points'];

            const after = won();

            await elapse(400 + PICK_MS + 60);

            expect([...flag()!.children].map((line) => line.textContent)).toEqual(['You win the game', 'Gammon · 4 points']);
            expect(flag()!.dataset.side).toBe('near');
            expect(games).toEqual(['near gammon 4']);
            expect(racking(), 'the checkers were racked under the banner').toBe(false);
            expect(host.querySelectorAll('.man[data-off]')).toHaveLength(15);

            await elapse(GAME_MS - 200);

            expect(flag(), 'the banner came down before its hold was over').not.toBeNull();
            expect(racking()).toBe(false);

            await elapse(200 + FLAG_MS + 200);

            expect(flag()).toBeNull();
            expect(racking()).toBe(true);

            await elapse(3200);

            expect(dice().map((die) => die.dataset.face)).toEqual(['2', '5']);
            expect(table.same(after)).toBe(true);
            expect(director.busy()).toBe(false);
        });

        it('is held a shorter while when something is already waiting behind it', async () =>
        {
            flagged = ['You win the game', 'Gammon · 4 points'];
            won();
            director.enqueue(() => undefined, { cuts: true });

            await elapse(400 + PICK_MS + 60 + GAME_LEAST + FLAG_MS + 120);

            expect(flag()).toBeNull();
            expect(racking()).toBe(true);
        });

        it('is called and held when it ends the match too, and nothing is racked after it', async () =>
        {
            flagged = ['You win the game', 'Gammon · 4 points'];

            const after = won(true);

            await elapse(400 + PICK_MS + 60);

            expect(flag()).not.toBeNull();
            expect(cues).toContain('hand-won');

            await elapse(LAST_MS + FLAG_MS + 200);

            expect(flag()).toBeNull();
            expect(racking()).toBe(false);
            expect(cues).toContain('win');
            expect(table.same(after)).toBe(true);
            expect(director.busy()).toBe(false);
        });

        it('ends the match as it went for whoever reads it, and buzzes the winner\'s phone alone', async () =>
        {
            const ended = async (seat: number | null, winner: 0 | 1) =>
            {
                const theirs = winner === 1 && seat !== null;
                const home = row({ 1: 1, 0: 14 });
                const behind = row({ 20: 15 });
                const before = felt({ near: theirs ? behind : home, far: theirs ? home : behind, cube: { on: true, value: 2, owner: theirs ? 'far' : 'near' } });
                const after = sight(felt({ near: theirs ? behind : row({ 0: 15 }), far: theirs ? row({ 0: 15 }) : behind, cube: before.cube, score: theirs ? { near: 0, far: 4 } : { near: 4, far: 0 } }), 6, seat);

                cues = [];
                felt_ = [];
                table.reset(sight(before, 5, seat));
                play([act(6, winner, [
                    { e: 'move', seat: winner, from: 1, to: 0, die: 1, hit: false },
                    { e: 'game', seat: winner, how: 'gammon', points: 4, cube: 2 },
                    { e: 'finish', seat: winner }
                ])], after);
                await elapse(400 + PICK_MS + 60 + LAST_MS + FLAG_MS + 400);

                return { heard: cues.filter((cue) => cue === 'win' || cue === 'lose' || cue === 'draw'), buzzed: felt_.includes('win') };
            };

            expect(await ended(0, 0)).toEqual({ heard: ['win'], buzzed: true });
            expect(await ended(0, 1)).toEqual({ heard: ['lose'], buzzed: false });
            expect(await ended(null, 0)).toEqual({ heard: ['draw'], buzzed: false });

            owned = 'void';

            expect(await ended(0, 0), 'a match that did not count for its reader was heard as their win').toEqual({ heard: [], buzzed: false });

            owned = 'lost';

            expect(await ended(0, 0), 'the reader\'s own result was passed over for the side that won').toEqual({ heard: ['lose'], buzzed: false });
        });

        it('comes down with everything else when the table is drawn again under it', async () =>
        {
            flagged = ['You win the game', 'Gammon · 4 points'];
            won();
            await elapse(400 + PICK_MS + 60);

            expect(flag()).not.toBeNull();

            director.cancel();
            table.reset(sight(felt({ dice: [3, 1] }), 7));

            expect(flag()).toBeNull();
        });

        it('raises no banner when the page has no words for it, and still says whose game it was', async () =>
        {
            won();
            await elapse(400 + PICK_MS + 60);

            expect(flag()).toBeNull();
            expect(games).toEqual(['near gammon 4']);
            expect(racking()).toBe(true);
        });
    });

    describe('the score, the game and the pips, as the table shows them', () =>
    {
        const last = () => facts[facts.length - 1];

        it('are told at once for a table that is simply drawn', () =>
        {
            table.reset(sight(felt({ near: row({ 6: 15 }), far: row({ 25: 1, 1: 14 }), score: { near: 2, far: 1 }, round: 4 })));

            expect(last()).toEqual({ score: { near: 2, far: 1 }, round: 4, pips: { near: 90, far: 39 }, turn: 'near' });
        });

        it('change when what they count has been shown: the pips when a checker has landed, the points when the game is called, the next game when the checkers are racked', async () =>
        {
            flagged = ['You win the game', 'Gammon · 4 points'];

            const before = felt({ near: row({ 1: 1, 0: 14 }), far: row({ 20: 15 }), dice: [1, 4], cube: { on: true, value: 2, owner: 'near' } });
            const after = sight(felt({ dice: [2, 5], seed: seedOf('m', 6), score: { near: 4, far: 0 }, round: 2, turn: 'far' }), 6);

            table.reset(sight(before));

            expect(last()).toEqual({ score: { near: 0, far: 0 }, round: 1, pips: { near: 1, far: 300 }, turn: 'near' });

            play([act(6, 0, [
                { e: 'move', seat: 0, from: 1, to: 0, die: 1, hit: false },
                { e: 'game', seat: 0, how: 'gammon', points: 4, cube: 2 },
                { e: 'opening', seat: 1, dice: [2, 5] }
            ])], after);
            await elapse(30);

            expect(last().pips.near, 'the pips fell before the checker had landed').toBe(1);

            await elapse(400 + PICK_MS + 60);

            expect(last(), 'a game was called and somebody still wore the turn').toEqual({ score: { near: 4, far: 0 }, round: 1, pips: { near: 0, far: 300 }, turn: null });

            await elapse(GAME_MS + FLAG_MS + 2400);

            expect(last()).toEqual({ score: { near: 4, far: 0 }, round: 2, pips: { near: 167, far: 167 }, turn: 'far' });
        });

        it('give the turn to whoever starts when the die that says so has landed, and not before', async () =>
        {
            const begun = sight(felt({ dice: [1, 2], seed: seedOf('m', 7), turn: 'far' }), 7);

            table.reset(sight(felt({ opening: [0, 2], turn: 'near' }), 6));

            expect(last().turn).toBe('near');

            play([act(7, 0, [{ e: 'throw', seat: 0, die: 1 }, { e: 'opening', seat: 1, dice: [1, 2] }])], begun);
            await elapse(300);

            expect(last().turn, 'who starts was told while the die that says so was in the air').toBe('near');

            await elapse(THROW_MS + ROLL_CAP + PICK_MS);

            expect(last().turn).toBe('far');
            expect(dice().map((die) => die.dataset.face)).toEqual(['1', '2']);
        });

        it('pass the turn as whoever is next throws their dice, after the checkers that ended the last one', async () =>
        {
            const after = sight(felt({ near: row({ 24: 2, 13: 4, 8: 2, 7: 2, 6: 5 }), dice: [3, 4], seed: seedOf('m', 6), turn: 'far' }), 6);

            table.reset(sight(felt({ dice: [6, 1] })));
            play([act(6, 0, [
                { e: 'move', seat: 0, from: 13, to: 7, die: 6, hit: false },
                { e: 'move', seat: 0, from: 8, to: 7, die: 1, hit: false },
                { e: 'roll', seat: 1, dice: [3, 4] }
            ])], after);
            const thrown = () => rolls.some(([seed, down]) => seed === seedOf('m', 6) && !down);
            const landed = () => rolls.some(([seed, down]) => seed === seedOf('m', 6) && down);

            await elapse(300);

            expect([thrown(), last().turn], 'the turn was passed while the move that ends it was still being made').toEqual([false, 'near']);

            for (let waited = 0; waited < 4000 && !thrown(); waited += 50)
            {
                await elapse(50);
            }

            await elapse(200);

            expect([thrown(), landed(), last().turn], 'the next dice were in the air and the turn was still with whoever had moved').toEqual([true, false, 'far']);

            await elapse(THROW_MS);

            expect([landed(), last().turn]).toEqual([true, 'far']);
        });

        it('pass the turn when the last checker has landed, where nobody rolls for whoever is next', async () =>
        {
            const after = sight(felt({ near: row({ 24: 2, 13: 4, 8: 2, 7: 2, 6: 5 }), dice: [], turn: 'far' }), 6);

            table.reset(sight(felt({ dice: [6, 1] })));
            play([act(6, 0, [
                { e: 'move', seat: 0, from: 13, to: 7, die: 6, hit: false },
                { e: 'move', seat: 0, from: 8, to: 7, die: 1, hit: false }
            ])], after);
            await elapse(WALK_MOST + 100);

            expect(last().turn).toBe('near');

            await elapse(WALK_MOST + PICK_MS + 600);

            expect(last().turn).toBe('far');
        });

        it('know a board that differs only in whose turn it is from the one they show', () =>
        {
            table.reset(sight(felt()));

            expect([table.same(sight(felt())), table.same(sight(felt({ turn: 'far' })))]).toEqual([true, false]);
        });

        it('follow the reader\'s own checker when it has been put down, and come back with it', async () =>
        {
            table.reset(sight(felt({ dice: [6, 1] })));

            void table.hop({ side: 'near', from: 13, to: 7, hit: false });
            await elapse(WALK_MOST + 100);

            expect(last().pips).toEqual({ near: 161, far: 167 });

            void table.unhop({ side: 'near', from: 13, to: 7, hit: false });
            await elapse(WALK_MOST + 100);

            expect(last().pips).toEqual({ near: 167, far: 167 });
        });

        it('are told once for each change, not once for each thing that happens', async () =>
        {
            table.reset(sight(felt({ turn: 'far' })));

            const told = facts.length;

            play([act(6, 1, [{ e: 'roll', seat: 1, dice: [6, 5] }, { e: 'pass', seat: 1 }])], sight(felt(), 6));
            await elapse(3000);

            expect(facts.slice(told).map((one) => one.turn), 'a roll and a pass change neither the score nor a pip, and pass the turn once').toEqual(['near']);
        });
    });

    it('dims the dice of a roll nobody could play, holds them a moment and picks them up', async () =>
    {
        const after = sight(felt(), 6);

        table.reset(sight(felt()));
        play([act(6, 0, [{ e: 'roll', seat: 0, dice: [6, 6] }, { e: 'pass', seat: 0 }])], after);
        await elapse(1300);

        expect(dice()).toHaveLength(2);
        expect(dice().every((die) => die.hasAttribute('data-spent'))).toBe(true);
        expect(cues).toContain('pass');

        await elapse(PASS_MS + PICK_MS + 100);

        expect(dice()).toHaveLength(0);
        expect(director.busy()).toBe(false);
    });

    it('writes on those dice that nobody could play them, tells whoever asked whose they were, and takes the words away with the dice', async () =>
    {
        table.reset(sight(felt()));
        play([act(6, 1, [{ e: 'roll', seat: 1, dice: [6, 5] }, { e: 'pass', seat: 1 }])], sight(felt(), 6));
        await elapse(600);

        expect(host.querySelector('.bgt-pass'), 'the dice were called unplayable while they were in the air').toBeNull();
        expect(passes).toEqual([]);

        await elapse(700);

        expect(host.querySelector('.bgt-dice > .bgt-pass')?.textContent).toBe('No move');
        expect(passes).toEqual(['far 6,5']);

        await elapse(PASS_MS + PICK_MS + 100);

        expect(host.querySelector('.bgt-pass')).toBeNull();
        expect(passes).toEqual(['far 6,5']);
    });

    it('writes nothing on them when the page gives it no words, and still tells whoever asked', async () =>
    {
        unplayed = '';
        table.reset(sight(felt()));
        play([act(6, 0, [{ e: 'roll', seat: 0, dice: [6, 6] }, { e: 'pass', seat: 0 }])], sight(felt(), 6));
        await elapse(1300);

        expect(host.querySelector('.bgt-pass')).toBeNull();
        expect(passes).toEqual(['near 6,6']);
    });

    it('takes the words off dice that are drawn again in the middle of the hold', async () =>
    {
        table.reset(sight(felt()));
        play([act(6, 0, [{ e: 'roll', seat: 0, dice: [6, 6] }, { e: 'pass', seat: 0 }])], sight(felt(), 6));
        await elapse(1300);

        expect(host.querySelector('.bgt-pass')).not.toBeNull();

        director.cancel();
        table.reset(sight(felt({ dice: [3, 1] }), 7));

        expect(host.querySelector('.bgt-pass')).toBeNull();
        expect(dice().map((die) => die.dataset.face)).toEqual(['3', '1']);
    });

    it('cuts that hold to its least when the next thing is already waiting', async () =>
    {
        table.reset(sight(felt()));
        play([act(6, 0, [{ e: 'roll', seat: 0, dice: [6, 6] }, { e: 'pass', seat: 0 }])], sight(felt(), 6));
        director.enqueue(() => undefined, { cuts: true });

        await elapse(1300 + PASS_LEAST + PICK_MS + 100);

        expect(director.busy()).toBe(false);
    });

    it('dims the die each of somebody else\'s checkers used', async () =>
    {
        const after = sight(felt({ far: row({ 6: 5, 7: 1, 8: 3, 13: 4, 24: 2 }), dice: [6, 1] }), 6);

        table.reset(sight(felt({ dice: [6, 1], seed: seedOf('m', 5) })));
        table.spend([false, false], seedOf('m', 6));
        play([act(6, 1, [{ e: 'move', seat: 1, from: 13, to: 7, die: 6, hit: false }, { e: 'roll', seat: 0, dice: [6, 1] }])], after);
        await elapse(WALK_MOST + 20);

        expect(dice().map((die) => die.hasAttribute('data-spent'))).toEqual([true, false]);
    });

    it('plays the table\'s own sounds to somebody watching, and none of the reader\'s', async () =>
    {
        const after = sight(felt(), 6, null);

        table.reset(sight(felt(), 5, null));
        play([act(6, 0, [{ e: 'roll', seat: 0, dice: [6, 6] }, { e: 'pass', seat: 0 }])], after);
        await elapse(1300 + PASS_MS + PICK_MS + 100);

        expect(cues).toContain('dice-wood');
        expect(cues).not.toContain('pass');
    });

    it('ends on the board it was sent with, whatever it was told', async () =>
    {
        const after = sight(felt({ near: row({ 6: 5, 8: 3, 13: 4, 9: 1, 24: 2 }), dice: [4, 4], seed: seedOf('m', 6), cube: { on: true, value: 2, owner: 'near' } }), 6);

        table.reset(sight(felt()));
        play([], after);
        await elapse(1200);

        expect(table.same(after)).toBe(true);
        expect(dice().map((die) => die.dataset.face)).toEqual(['4', '4']);
        expect(cube().textContent).toBe('2');
        expect(cues).toEqual([]);
    });

    it('knows about how long a batch will take, a hit and a throw more than a hop', () =>
    {
        table.reset(sight(felt()));

        const hop = table.estimate([act(6, 0, [{ e: 'move', seat: 0, from: 13, to: 7, die: 6, hit: false }])]);
        const hit = table.estimate([act(6, 0, [{ e: 'move', seat: 0, from: 13, to: 7, die: 6, hit: true }])]);
        const turn = table.estimate([act(6, 0, [{ e: 'move', seat: 0, from: 13, to: 7, die: 6, hit: false }, { e: 'roll', seat: 1, dice: [2, 1] }])]);

        expect(hit).toBe(hop + KNOCK_MS);
        expect(turn).toBeGreaterThan(hop + 900);
        expect(turn).toBeLessThan(HISTORY);
    });
});

describe('the table, for somebody who asked for less motion', () =>
{
    const hitting = () =>
    {
        const before = felt({ near: row({ 13: 1, 6: 14 }), far: row({ 17: 1, 12: 14 }), dice: [5, 3] });
        const after = sight(felt({ near: row({ 8: 1, 6: 14 }), far: row({ 25: 1, 12: 14 }), dice: [2, 2], seed: seedOf('m', 6) }), 6);

        table.reset(sight(before));
        play([act(6, 0, [{ e: 'move', seat: 0, from: 13, to: 8, die: 5, hit: true }, { e: 'roll', seat: 1, dice: [2, 2] }])], after);

        return after;
    };

    it('plays every sound of a hit and a roll, and the hit is still felt', async () =>
    {
        hitting();
        await elapse(3000);

        const moving = [...cues];
        const felt = [...felt_];

        director.cancel();
        cues.length = 0;
        felt_.length = 0;
        still = true;

        const after = hitting();

        await elapse(3000);

        expect(cues.filter((cue) => cue !== 'dice-wood')).toEqual(moving.filter((cue) => cue !== 'dice-wood'));
        expect(cues.filter((cue) => cue === 'dice-wood')).toHaveLength(2);
        expect(felt_).toEqual(felt);
        expect(table.same(after)).toBe(true);
    });

    it('moves nothing: every run is a fade', async () =>
    {
        still = true;
        drawn.length = 0;
        hitting();
        await elapse(3000);

        expect(drawn.length).toBeGreaterThan(3);

        for (const one of drawn)
        {
            expect(one.frames.flatMap((frame) => Object.keys(frame)).filter((key) => key !== 'opacity' && key !== 'offset')).toEqual([]);
            expect(one.options.duration).toBe(TIMING.FADE);
        }
    });

    it('fades a thrown die as a whole, so that it is a cube all the way through', async () =>
    {
        still = true;
        table.reset(sight(felt()));
        drawn.length = 0;
        play([act(6, 1, [{ e: 'roll', seat: 1, dice: [5, 2] }])], sight(felt({ dice: [5, 2], seed: seedOf('m', 6) }), 6));
        await elapse(0);

        expect(drawn.filter((one) => one.el.classList.contains('die3d'))).toHaveLength(2);
        expect(drawn.filter((one) => one.el.classList.contains('die3d-body')), 'a face of the cube was faded on its own').toEqual([]);
        expect(drawn.filter((one) => one.el.classList.contains('die3d-shadow'))).toEqual([]);

        await elapse(TIMING.FADE + 20);

        expect(cues.filter((cue) => cue === 'dice-wood')).toHaveLength(2);
        expect(dice().map((die) => die.dataset.face)).toEqual(['5', '2']);
    });

    it('still lands one checker after another, a fade apart', async () =>
    {
        still = true;
        table.reset(sight(felt({ dice: [3, 1] })));
        play([act(6, 0, [
            { e: 'move', seat: 0, from: 8, to: 5, die: 3, hit: false },
            { e: 'move', seat: 0, from: 6, to: 5, die: 1, hit: false }
        ])], sight(felt({ near: row({ 5: 2, 6: 4, 8: 2, 13: 5, 24: 2 }) }), 6));

        await elapse(TIMING.FADE);
        expect(cues.filter((cue) => cue === 'checker')).toHaveLength(1);

        await elapse(TIMING.FADE);
        expect(cues.filter((cue) => cue === 'checker')).toHaveLength(2);
    });
});

describe('what the reader does on the table', () =>
{
    it('moves the checker the reader moved, and takes it back', async () =>
    {
        table.reset(sight(felt({ dice: [6, 1] })));

        void table.hop({ side: 'near', from: 13, to: 7, hit: false });
        await elapse(WALK_MOST + 100);

        expect(table.same(sight(felt({ near: row({ 6: 5, 7: 1, 8: 3, 13: 4, 24: 2 }), dice: [6, 1] })))).toBe(true);

        void table.unhop({ side: 'near', from: 13, to: 7, hit: false });
        await elapse(WALK_MOST + 100);

        expect(table.same(sight(felt({ dice: [6, 1] })))).toBe(true);
    });

    it('says so when there is no checker to move, and moves nothing', async () =>
    {
        table.reset(sight(felt()));
        drawn.length = 0;

        expect(await table.hop({ side: 'near', from: 20, to: 18, hit: false })).toBe(false);
        expect(await table.unhop({ side: 'near', from: 20, to: 18, hit: false })).toBe(false);
        expect(drawn).toEqual([]);
    });

    it('lights the top checker of each point it is told, and not one that is in the air', async () =>
    {
        table.reset(sight(felt({ dice: [6, 1] })));
        table.lit(new Set([13, 8]));

        expect(host.querySelectorAll('.man[data-lit]')).toHaveLength(2);

        void table.hop({ side: 'near', from: 13, to: 7, hit: false });
        table.lit(new Set([7]));

        expect(host.querySelectorAll('.man[data-lit]')).toHaveLength(0);

        await elapse(WALK_MOST + 100);

        expect(host.querySelectorAll('.man[data-lit]')).toHaveLength(1);
    });

    it('dims the dice the reader has used, and only while they are the dice on the table', () =>
    {
        table.reset(sight(felt({ dice: [6, 1], seed: seedOf('m', 5) })));

        table.spend([true, false], seedOf('m', 5));
        expect(dice().map((die) => die.hasAttribute('data-spent'))).toEqual([true, false]);

        table.spend([false, false], seedOf('m', 6));
        expect(dice().map((die) => die.hasAttribute('data-spent'))).toEqual([true, false]);
    });

    it('keeps a die the reader used while its roll was still being thrown dim when the throw is over', async () =>
    {
        const after = sight(felt({ dice: [3, 2], seed: seedOf('m', 6) }), 6);

        table.reset(sight(felt()));
        play([act(6, 0, [{ e: 'roll', seat: 0, dice: [3, 2] }])], after);
        await elapse(300);

        table.spend([true, false], seedOf('m', 6));

        expect(dice().map((die) => die.hasAttribute('data-spent'))).toEqual([true, false]);

        await elapse(1400);

        expect(director.busy()).toBe(false);
        expect(dice().map((die) => die.hasAttribute('data-spent')), 'the scene ended on the dice as they were when it began').toEqual([true, false]);
    });

    it('counts the moves a double has left beside its dice, and keeps both dice lit until the last', () =>
    {
        const left = () => host.querySelector('.bgt-dice > .bgt-left')?.textContent ?? null;
        const seed = seedOf('m', 5);

        table.reset(sight(felt({ dice: [6, 1] })));
        expect(left()).toBeNull();

        table.reset(sight(felt({ dice: [3, 3] })));
        expect(left()).toBe('×4');

        table.spend([true, false, false, false], seed);
        expect(left()).toBe('×3');
        expect(dice().map((die) => die.hasAttribute('data-spent'))).toEqual([false, false]);

        table.spend([true, true, true, false], seed);
        expect(left()).toBe('×1');
        expect(dice().map((die) => die.hasAttribute('data-spent'))).toEqual([false, false]);

        table.spend([true, true, true, true], seed);
        expect(left()).toBeNull();
        expect(dice().map((die) => die.hasAttribute('data-spent'))).toEqual([true, true]);

        table.reset(sight(felt()));
        expect(left()).toBeNull();
    });

    it('does not say a roll is a double before its dice have landed, and counts it down as somebody else plays it', async () =>
    {
        const left = () => host.querySelector('.bgt-dice > .bgt-left')?.textContent ?? null;
        const rolled = sight(felt({ dice: [4, 4], seed: seedOf('m', 6) }), 6);

        table.reset(sight(felt()));
        play([act(6, 1, [{ e: 'roll', seat: 1, dice: [4, 4] }])], rolled);
        await elapse(600);

        expect(dice()).toHaveLength(2);
        expect(left(), 'the count gave the double away while the dice were in the air').toBeNull();

        await elapse(900);

        expect(director.busy()).toBe(false);
        expect(left()).toBe('×4');

        table.spend([false, false], seedOf('m', 7));
        play([act(7, 1, [
            { e: 'move', seat: 1, from: 13, to: 9, die: 4, hit: false },
            { e: 'move', seat: 1, from: 13, to: 9, die: 4, hit: false },
            { e: 'move', seat: 1, from: 24, to: 20, die: 4, hit: false },
            { e: 'move', seat: 1, from: 24, to: 20, die: 4, hit: false },
            { e: 'roll', seat: 0, dice: [6, 1] }
        ])], sight(felt({ far: row({ 6: 5, 8: 3, 9: 2, 13: 3, 20: 2 }), dice: [6, 1], seed: seedOf('m', 7) }), 7));

        await elapse(WALK_MOST + 20);
        expect(left()).toBe('×3');

        await elapse(WALK_MOST * 3 + 60);
        expect(left()).toBeNull();
    });

    it('marks where a picked checker can go, on top of whatever stands there, and takes the marks away', () =>
    {
        const marks = () => [...host.querySelectorAll<HTMLElement>('.bgt-mark')].map((mark) => mark.style.translate);

        table.reset(sight(felt({ near: row({ 13: 2, 6: 13 }), far: row({ 17: 1, 12: 14 }), dice: [5, 2] })));
        table.aim(new Set([8, 11, 6]));

        expect(marks()).toHaveLength(3);
        expect(marks()).toContain(placed(columnOf(8).x + POINT_WIDTH / 2, BOTTOM - RADIUS));
        expect(marks()).toContain(placed(columnOf(11).x + POINT_WIDTH / 2, BOTTOM - RADIUS));
        expect(marks()).toContain(placed(columnOf(6).x + POINT_WIDTH / 2, BOTTOM - RADIUS - 8 * RADIUS));
        expect(host.style.getPropertyValue('--layer-mark')).toBe(String(LAYER.mark));
        expect(LAYER.mark).toBeGreaterThan(LAYER.piece + 9);

        table.aim(new Set([11]));
        expect(marks()).toEqual([placed(columnOf(11).x + POINT_WIDTH / 2, BOTTOM - RADIUS)]);

        table.aim(new Set());
        expect(marks()).toEqual([]);
    });

    it('keeps a mark on the next free place of a point as checkers arrive there, and loses none when it is drawn again', async () =>
    {
        const marks = () => [...host.querySelectorAll<HTMLElement>('.bgt-mark')].map((mark) => mark.style.translate);

        table.reset(sight(felt({ dice: [6, 1] })));
        table.aim(new Set([7]));

        expect(marks()).toEqual([placed(columnOf(7).x + POINT_WIDTH / 2, BOTTOM - RADIUS)]);

        void table.hop({ side: 'near', from: 13, to: 7, hit: false });
        await elapse(WALK_MOST + 100);

        expect(marks()).toEqual([placed(columnOf(7).x + POINT_WIDTH / 2, BOTTOM - RADIUS - 2 * RADIUS)]);

        table.reset(sight(felt({ dice: [6, 1] })));

        expect(marks()).toEqual([placed(columnOf(7).x + POINT_WIDTH / 2, BOTTOM - RADIUS)]);
    });

    it('writes its numbers the way the page writes numbers, and again when that changes', () =>
    {
        digits = (value) => `<${ value }>`;
        table.reset(sight(felt({ near: row({ 6: 8, 5: 7 }), dice: [2, 2], cube: { on: true, value: 4, owner: 'near' } })));

        expect([...host.querySelectorAll('.bgt-count')].map((tag) => tag.textContent).sort()).toEqual(['<7>', '<8>']);
        expect(cube().textContent).toBe('<4>');
        expect(host.querySelector('.bgt-left')?.textContent).toBe('×<4>');

        digits = (value) => `[${ value }]`;
        table.relabel();

        expect([...host.querySelectorAll('.bgt-count')].map((tag) => tag.textContent).sort()).toEqual(['[7]', '[8]']);
        expect(cube().textContent).toBe('[4]');
        expect(host.querySelector('.bgt-left')?.textContent).toBe('×[4]');
    });
});

describe('a board that moved with nothing said about it', () =>
{
    it('is reached by sliding the fewest checkers, without a sound', async () =>
    {
        const after = sight(felt({ near: row({ 6: 5, 7: 1, 8: 3, 13: 4, 24: 2 }) }), 6);

        table.reset(sight(felt()));
        drawn.length = 0;
        director.enqueue((ctx) => table.settle(after, ctx));
        await elapse(600);

        expect(drawn.filter((one) => one.el.classList.contains('man'))).toHaveLength(1);
        expect(cues).toEqual([]);
        expect(felt_).toEqual([]);
        expect(table.same(after)).toBe(true);
    });

    it('is drawn at once when too much of it changed to slide', async () =>
    {
        const after = sight(felt({ near: row({ 0: 15 }), far: row({ 1: 15 }) }), 6);

        table.reset(sight(felt()));
        drawn.length = 0;
        director.enqueue((ctx) => table.settle(after, ctx));
        await elapse(0);

        expect(drawn).toEqual([]);
        expect(table.same(after)).toBe(true);
    });

    it('swaps the dice without throwing them', async () =>
    {
        const after = sight(felt({ dice: [4, 2], seed: seedOf('m', 6) }), 6);

        table.reset(sight(felt({ dice: [6, 6] })));
        director.enqueue((ctx) => table.settle(after, ctx));
        await elapse(PICK_MS + 300);

        expect(dice().map((die) => die.dataset.face)).toEqual(['4', '2']);
        expect(cues).toEqual([]);
        expect(drawn.some((one) => one.el.classList.contains('die3d-body'))).toBe(false);
    });
});

describe('what is pressed on the table itself', () =>
{
    const zone = () => host.querySelector<HTMLElement>('.bgt-dice')!;

    const tapDice = () => host.querySelector<HTMLElement>('.bgt-dice > .bgt-hit')!.click();

    it('puts two blank dice out when the roll is the reader\'s, and a tap on them is the roll', () =>
    {
        table.reset(sight(felt()));

        expect(dice()).toHaveLength(0);

        tapDice();
        expect(pressed, 'dice nobody was offered could be pressed').toEqual([]);

        table.invite('roll');

        expect(dice()).toHaveLength(2);
        expect(dice().every((die) => die.hasAttribute('data-blank'))).toBe(true);
        expect(zone().dataset.live).toBe('roll');
        expect(table.same(sight(felt())), 'dice that are only waiting were taken for a roll').toBe(true);

        tapDice();

        expect(pressed).toEqual(['dice']);
    });

    it('shakes them while the roll is out, then picks them up and throws the dice that were rolled', async () =>
    {
        const after = sight(felt({ dice: [5, 2], seed: seedOf('m', 6) }), 6);

        table.reset(sight(felt()));
        table.invite('roll');
        table.rattle(true);

        const blank = dice();

        expect(zone().hasAttribute('data-shake')).toBe(true);

        play([act(6, 0, [{ e: 'roll', seat: 0, dice: [5, 2] }])], after);
        await elapse(0);

        expect(zone().hasAttribute('data-shake')).toBe(false);
        expect(zone().hasAttribute('data-live')).toBe(false);

        await elapse(PICK_MS + 60);

        expect(blank.every((die) => !die.isConnected)).toBe(true);
        expect(thrown()).toHaveLength(2);
        expect(thrown().map((one) => fromY(one) > 5)).toEqual([true, true]);

        table.invite('done');
        await elapse(400);

        expect(zone().hasAttribute('data-live'), 'the dice could be pressed to end the turn while they were still in the air').toBe(false);

        await elapse(1000);

        expect(dice().map((die) => die.dataset.face)).toEqual(['5', '2']);
        expect(dice().some((die) => die.hasAttribute('data-blank'))).toBe(false);
        expect(zone().dataset.live).toBe('done');

        tapDice();

        expect(pressed).toEqual(['dice']);
    });

    it('puts the reader\'s own blank die out in the opening, beside the other player\'s, and a tap on it is the throw', () =>
    {
        table.reset(sight(felt({ opening: [0, 4], turn: 'near' })));

        expect(dice().map((die) => die.dataset.face), 'a die waited in the reader\'s place before they were offered one').toEqual(['4']);

        table.invite('roll');

        expect(dice().filter((die) => die.hasAttribute('data-blank')), 'an opening offered the two blank dice of a roll').toHaveLength(0);

        table.invite('throw');

        expect(dice()).toHaveLength(2);
        expect(dice().filter((die) => die.hasAttribute('data-blank'))).toHaveLength(1);
        expect(zone().dataset.live).toBe('roll');

        tapDice();

        expect(pressed).toEqual(['dice']);

        table.invite(null);

        expect(dice().map((die) => die.dataset.face)).toEqual(['4']);
        expect(zone().hasAttribute('data-live')).toBe(false);
    });

    it('puts out nothing to throw for a reader who has thrown, nor for somebody watching', () =>
    {
        table.reset(sight(felt({ opening: [5, 0], turn: 'far' })));
        table.invite('throw');

        expect(dice().map((die) => die.dataset.face)).toEqual(['5']);
        expect(dice().some((die) => die.hasAttribute('data-blank'))).toBe(false);

        table.invite(null);
        table.reset(sight(felt({ viewer: 1, opening: [0, 0], turn: 'far' }), 5, null));

        expect(dice()).toHaveLength(0);
    });

    it('takes the blank dice away when the roll is no longer the reader\'s, and has them back after the table is drawn again', async () =>
    {
        table.reset(sight(felt()));
        table.invite('roll');
        table.reset(sight(felt()));

        expect(dice()).toHaveLength(2);
        expect(dice().every((die) => die.hasAttribute('data-blank'))).toBe(true);
        expect(zone().dataset.live).toBe('roll');

        table.invite(null);

        expect(zone().hasAttribute('data-live')).toBe(false);

        await elapse(PICK_MS + 80);

        expect(dice()).toHaveLength(0);
    });

    it('lays no blank dice over dice that are on the table, and brings them out when those are picked up', async () =>
    {
        table.reset(sight(felt({ dice: [3, 2] })));
        table.invite('roll');

        expect(dice().map((die) => die.dataset.face)).toEqual(['3', '2']);
        expect(dice().some((die) => die.hasAttribute('data-blank'))).toBe(false);
        expect(zone().hasAttribute('data-live')).toBe(false);

        play([act(6, 1, [{ e: 'move', seat: 1, from: 13, to: 10, die: 3, hit: false }, { e: 'move', seat: 1, from: 13, to: 11, die: 2, hit: false }])], sight(felt({ far: row({ 6: 5, 8: 3, 10: 1, 11: 1, 13: 3, 24: 2 }) }), 6));
        await elapse(WALK_MOST * 2 + PICK_MS + 200);

        expect(director.busy()).toBe(false);
        expect(dice()).toHaveLength(2);
        expect(dice().every((die) => die.hasAttribute('data-blank'))).toBe(true);
        expect(zone().dataset.live).toBe('roll');
    });

    it('lets the cube be pressed only while a double may be offered', () =>
    {
        table.reset(sight(felt()));
        cube().click();

        expect(pressed).toEqual([]);

        table.cubed(true);
        expect(cube().hasAttribute('data-live')).toBe(true);

        cube().click();
        expect(pressed).toEqual(['cube']);

        table.cubed(false);
        cube().click();

        expect(cube().hasAttribute('data-live')).toBe(false);
        expect(pressed).toEqual(['cube']);
    });

    it('lifts the checker that was pressed at once, and lets go of it when it leaves', async () =>
    {
        const held = () => [...host.querySelectorAll<HTMLElement>('.man[data-held]')];

        table.reset(sight(felt({ dice: [6, 1] })));
        table.hold(13);

        expect(held()).toHaveLength(1);
        expect(held()[0].style.translate).toBe(placed(columnOf(13).x + POINT_WIDTH / 2, TOP + RADIUS + 8 * RADIUS));

        void table.hop({ side: 'near', from: 13, to: 7, hit: false });

        expect(held()).toEqual([]);

        await elapse(WALK_MOST + 100);

        expect(held(), 'the next checker on the point was lifted in its place').toEqual([]);

        table.hold(8);
        expect(held()).toHaveLength(1);

        table.hold(null);
        expect(held()).toEqual([]);
    });

    it('marks the checker a tap would take back, and where it would go back to', async () =>
    {
        const backs = () => [...host.querySelectorAll<HTMLElement>('.bgt-mark[data-back]')].map((mark) => mark.style.translate);

        table.reset(sight(felt({ dice: [6, 1] })));
        void table.hop({ side: 'near', from: 13, to: 7, hit: false });
        await elapse(WALK_MOST + 100);

        table.undoes(7);

        expect(host.querySelectorAll('.man[data-back]')).toHaveLength(1);
        expect(host.querySelector<HTMLElement>('.man[data-back]')!.style.translate).toBe(placed(columnOf(7).x + POINT_WIDTH / 2, BOTTOM - RADIUS));

        table.aim(new Set([6]), 13);

        expect(backs()).toEqual([placed(columnOf(13).x + POINT_WIDTH / 2, TOP + RADIUS + 8 * RADIUS)]);
        expect(host.querySelectorAll('.bgt-mark')).toHaveLength(2);

        table.aim(new Set());
        table.undoes(null);

        expect(host.querySelectorAll('.bgt-mark')).toHaveLength(0);
        expect(host.querySelectorAll('.man[data-back]')).toHaveLength(0);
    });
});

describe('when a roll can be told', () =>
{
    it('says when a throw begins and when its dice have come to rest, by the roll they are', async () =>
    {
        const after = sight(felt({ dice: [5, 2], seed: seedOf('m', 6) }), 6);

        table.reset(sight(felt()));

        expect(rolls, 'a table drawn with no dice on it did not say it was bare').toEqual([[-1, true]]);
        expect(faced).toEqual(['']);

        rolls.length = 0;
        faced.length = 0;
        play([act(6, 0, [{ e: 'roll', seat: 0, dice: [5, 2] }])], after);
        await elapse(0);

        expect(rolls).toEqual([[seedOf('m', 6), false]]);

        await elapse(300);

        expect(rolls, 'dice in the air were called landed').toHaveLength(1);

        await elapse(THROW_MS);

        expect(rolls).toEqual([[seedOf('m', 6), false], [seedOf('m', 6), true]]);
        expect(faced).toEqual(['5,2', '5,2']);
    });

    it('says so at once for dice that are simply laid out, and again when they are laid for a later roll', async () =>
    {
        table.reset(sight(felt({ dice: [6, 1] })));

        expect(rolls).toEqual([[seedOf('m', 5), true]]);

        director.enqueue((ctx) => table.settle(sight(felt({ dice: [6, 1], seed: seedOf('m', 9) }), 9), ctx));
        await elapse(600);

        expect(rolls[rolls.length - 1]).toEqual([seedOf('m', 9), true]);
        expect(rolls).toContainEqual([-1, true]);
        expect(faced[faced.length - 1]).toBe('6,1');
    });

    it('says when an opening die is thrown and when it has landed', async () =>
    {
        table.reset(sight(felt({ opening: [0, 0] })));
        rolls.length = 0;
        play([act(4, 1, [{ e: 'throw', seat: 1, die: 3 }])], sight(felt({ opening: [0, 3], seed: seedOf('m', 4) }), 4));
        await elapse(0);

        expect(rolls).toEqual([[seedOf('m', 4), false]]);

        await elapse(THROW_MS + ROLL_CAP);

        expect(rolls).toContainEqual([seedOf('m', 4), true]);
    });

    it('says the table is bare when the dice are picked up', async () =>
    {
        const after = sight(felt({ near: row({ 6: 5, 7: 1, 8: 3, 12: 1, 13: 3, 24: 2 }) }), 6);

        table.reset(sight(felt({ dice: [6, 1] })));
        play([act(6, 0, [
            { e: 'move', seat: 0, from: 13, to: 7, die: 6, hit: false },
            { e: 'move', seat: 0, from: 13, to: 12, die: 1, hit: false }
        ])], after);
        await elapse(3000);

        expect(dice()).toHaveLength(0);
        expect(rolls[rolls.length - 1]).toEqual([-1, true]);
        expect(faced[faced.length - 1]).toBe('');
    });

    it('throws within the time a reader is asked to wait for their dice', () =>
    {
        expect(PICK_MS + THROW_MS).toBeLessThanOrEqual(ROLL_CAP);
        expect(ROLL_CAP).toBe(1200);
    });
});

describe('a checker carried by hand', () =>
{
    const carried = () => [...host.querySelectorAll<HTMLElement>('.man[data-carried]')];

    const last = (el: Element) => of(el)[of(el).length - 1];

    const top13 = placed(columnOf(13).x + POINT_WIDTH / 2, TOP + RADIUS + 8 * RADIUS);

    const on7 = placed(columnOf(7).x + POINT_WIDTH / 2, BOTTOM - RADIUS);

    it('follows the hand above everything else on the board, and is not counted where it was lifted from', () =>
    {
        table.reset(sight(felt({ near: row({ 6: 8, 5: 7 }), dice: [6, 1] })));

        expect(table.grab(6)).toBe(true);
        expect(carried()).toHaveLength(1);
        expect([...host.querySelectorAll('.bgt-count')].map((tag) => tag.textContent).sort()).toEqual(['7', '7']);

        table.drag(500, 400);

        expect(carried()[0].style.translate).toBe(placed(500, 400));
        expect(Number(carried()[0].style.zIndex)).toBe(LAYER.airborne);

        table.drag(-200, 5000);

        expect(carried()[0].style.translate, 'a carried checker left the board').toBe(placed(RADIUS, HEIGHT - RADIUS));
    });

    it('lifts nothing from a point the reader has no checker on, nor a checker that is in the air', async () =>
    {
        table.reset(sight(felt({ dice: [6, 1] })));

        expect(table.grab(1)).toBe(false);
        expect(table.grab(12), 'the other side\'s checker was lifted').toBe(false);
        expect(carried()).toEqual([]);

        void table.hop({ side: 'near', from: 13, to: 7, hit: false });

        expect(table.grab(7), 'a checker was caught in flight').toBe(false);

        await elapse(WALK_MOST + 100);

        expect(table.grab(7)).toBe(true);
        expect(table.grab(13), 'a second checker was lifted with one already in the hand').toBe(false);
    });

    it('goes back to where it was lifted from when it is let go', async () =>
    {
        table.reset(sight(felt({ dice: [6, 1] })));
        table.grab(13);
        table.drag(500, 400);

        const el = carried()[0];

        table.release();

        expect(last(el).frames[0].translate).toBe(placed(500, 400));
        expect(last(el).frames[last(el).frames.length - 1].translate).toBe(top13);
        expect(Number(last(el).options.duration)).toBeLessThanOrEqual(BACK_MOST);
        expect(el.hasAttribute('data-carried')).toBe(false);
        expect(table.grab(13), 'a checker on its way back was lifted again').toBe(false);

        await elapse(BACK_MOST + 40);

        expect(el.style.translate).toBe(top13);
        expect(Number(el.style.zIndex)).toBeLessThan(LAYER.moving);
        expect(table.grab(13)).toBe(true);
        expect(carried()[0]).toBe(el);
    });

    it('lands from where it was let go when the drop is a move: one short flight and not the walk along the points', async () =>
    {
        const there = { x: columnOf(7).x + POINT_WIDTH / 2 + 12, y: 520 };

        table.reset(sight(felt({ dice: [6, 1] })));
        table.grab(13);
        table.drag(there.x, there.y);

        const el = carried()[0];

        void table.hop({ side: 'near', from: 13, to: 7, hit: false });

        expect(last(el).frames).toHaveLength(2);
        expect(last(el).frames[0].translate).toBe(placed(there.x, there.y));
        expect(last(el).frames[1].translate).toBe(on7);
        expect(Number(last(el).options.duration)).toBeLessThanOrEqual(DROP_MOST);
        expect(el.hasAttribute('data-carried')).toBe(false);
        expect(cues).toEqual([]);

        await elapse(DROP_MOST + 200);

        expect(el.style.translate).toBe(on7);
        expect(cues).toEqual(['checker']);
        expect(table.grab(7)).toBe(true);
    });

    it('knocks a lone checker away when the dropped one lands on it, not when it is let go', async () =>
    {
        const far = row({ 18: 1, 6: 14 });

        table.reset(sight(felt({ far, dice: [6, 1] })));
        table.grab(13);
        table.drag(columnOf(7).x + POINT_WIDTH / 2, 640);
        void table.hop({ side: 'near', from: 13, to: 7, hit: true });

        expect(felt_).toEqual([]);

        await elapse(DROP_MOST + KNOCK_MS + 200);

        expect(felt_).toEqual(['capture']);
        expect(cues).toContain('checker-hit');
        expect(men().filter((man) => man.style.translate === placed(BAR_LEFT + BAR_WIDTH / 2, MIDDLE - BAR_GAP - RADIUS))).toHaveLength(1);
    });

    it('flies home from the hand when the drop takes the move back', async () =>
    {
        table.reset(sight(felt({ dice: [6, 1] })));
        void table.hop({ side: 'near', from: 13, to: 7, hit: false });
        await elapse(WALK_MOST + 100);
        table.grab(7);
        table.drag(300, 300);

        const el = carried()[0];

        void table.unhop({ side: 'near', from: 13, to: 7, hit: false });

        expect(last(el).frames).toHaveLength(2);
        expect(last(el).frames[0].translate).toBe(placed(300, 300));
        expect(last(el).frames[1].translate).toBe(top13);

        await elapse(DROP_MOST + 200);

        expect(el.style.translate).toBe(top13);
    });

    it('is put back where the board says when the board is drawn again under the hand, and follows no hand after that', () =>
    {
        table.reset(sight(felt({ dice: [6, 1] })));
        table.grab(13);
        table.drag(500, 400);
        table.reset(sight(felt({ dice: [6, 1] })));

        expect(carried()).toEqual([]);

        table.drag(300, 300);
        table.release();

        expect(men()).toHaveLength(30);
        expect(men().some((man) => man.style.translate === placed(300, 300))).toBe(false);
        expect(table.grab(13)).toBe(true);
    });

    it('fades to where it is going when motion is reduced, and still says so', async () =>
    {
        still = true;
        table.reset(sight(felt({ dice: [6, 1] })));
        table.grab(13);
        table.drag(500, 400);

        const el = carried()[0];

        void table.hop({ side: 'near', from: 13, to: 7, hit: false });

        expect(last(el).frames.some((frame) => 'translate' in frame || 'transform' in frame)).toBe(false);
        expect(el.style.translate).toBe(on7);

        await elapse(400);

        expect(cues).toEqual(['checker']);
    });
    it('stays in the hand over the first of two hops, and is set down by the second', async () =>
    {
        const over6 = { x: columnOf(6).x + POINT_WIDTH / 2, y: 600 };
        const on6 = placed(columnOf(6).x + POINT_WIDTH / 2, BOTTOM - RADIUS);

        table.reset(sight(felt({ near: row({ 13: 1, 1: 14 }), far: row({ 6: 15 }), dice: [6, 1] })));
        table.grab(13);
        table.drag(over6.x, over6.y);

        const el = carried()[0];
        const flights = of(el).length;

        void table.hop({ side: 'near', from: 13, to: 7, hit: false }, true);
        await elapse(40);

        expect(of(el), 'the checker left the hand for a point it only passed over').toHaveLength(flights);
        expect(carried()).toEqual([el]);
        expect(el.style.translate).toBe(placed(over6.x, over6.y));
        expect(cues).toEqual([]);

        void table.hop({ side: 'near', from: 7, to: 6, hit: false });

        expect(of(el)).toHaveLength(flights + 1);
        expect(last(el).frames[0].translate).toBe(placed(over6.x, over6.y));
        expect(last(el).frames[1].translate).toBe(on6);

        await elapse(DROP_MOST + 200);

        expect(carried()).toEqual([]);
        expect(cues).toEqual(['checker']);
        expect(el.style.translate).toBe(on6);
    });

    it('still knocks away a lone checker the hand passes over', async () =>
    {
        table.reset(sight(felt({ near: row({ 13: 1, 1: 14 }), far: row({ 18: 1, 6: 14 }), dice: [6, 1] })));
        table.grab(13);
        table.drag(columnOf(6).x + POINT_WIDTH / 2, 600);
        void table.hop({ side: 'near', from: 13, to: 7, hit: true }, true);
        await elapse(KNOCK_MS + 100);

        expect(felt_).toEqual(['capture']);
        expect(carried()).toHaveLength(1);
        expect(men().filter((man) => man.style.translate === placed(BAR_LEFT + BAR_WIDTH / 2, MIDDLE - BAR_GAP - RADIUS))).toHaveLength(1);
    });
});
