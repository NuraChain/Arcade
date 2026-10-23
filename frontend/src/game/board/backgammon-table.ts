import {
    BAR_LEFT,
    BAR_WIDTH,
    BOTTOM,
    CUBE,
    DICE_X,
    HEIGHT,
    POINT_WIDTH,
    RADIUS,
    SLAB,
    STACK_SHOWN,
    TOP,
    TRAY,
    WIDTH,
    columnOf,
    cubeY
} from '../backgammon-layout.ts';
import {
    beatsOf,
    pipsOf,
    sameAs,
    UNTHROWN,
    seedOf,
    shownOf,
    spentBy,
    step,
    type Beat,
    type Cube,
    type Felt,
    type Score,
    type Shown,
    type Told
} from '../backgammon-felt.ts';
import {
    BAR,
    OFF,
    opposite,
    same,
    settle as reconcile,
    slotAt,
    slotOf,
    topAt,
    undone,
    type Man,
    type Move,
    type Moved,
    type Side,
    type Slot,
    type Table as Men,
    type Transfer
} from '../backgammon-men.ts';
import { clamp, seeded } from '../stage/curves.ts';
import { restOf } from '../stage/dice.ts';
import { createDie, type Die } from '../stage/die.ts';
import type { Ctx } from '../stage/director.ts';
import { LAYER, layered } from '../stage/layers.ts';
import type { Table } from '../stage/presenter.ts';
import { arc, walk, type Point } from '../stage/route.ts';
import type { Run, Stage } from '../stage/stage.ts';
import { endCue, type SoundHandle } from '../sound.ts';
import type { Haptic } from '../../lib/haptics.ts';

export type Invite = 'throw' | 'roll' | 'done' | null;

export interface TableOptions
{
    host: HTMLElement;
    stage: Stage;
    sound: () => SoundHandle | null;
    feel: (kind: Haptic) => void;
    say: (value: number) => string;
    onDice?: () => void;
    onCube?: () => void;
    onRoll?: (seed: number, faces: readonly number[], landed: boolean) => void;
    noMove?: () => string;
    onPass?: (side: Side, faces: readonly number[]) => void;
    banner?: (side: Side, how: string, points: number) => readonly string[];
    reads?: () => 'ltr' | 'rtl';
    onGame?: (side: Side, how: string, points: number) => void;
    onFacts?: (facts: Facts) => void;

    /** The reader's own result once the board has it: the match's end is heard from it, and from the side that won only before it is in hand. */
    result?: () => Parameters<typeof endCue>[0];
}

export interface Facts
{
    score: Score;
    round: number;
    pips: Score;
    turn: Side | null;
}

export interface BackgammonTable extends Table<Felt, Told>
{
    hop(move: Move, onward?: boolean): Promise<boolean>;
    unhop(move: Move): Promise<boolean>;
    lit(spots: ReadonlySet<number>): void;
    aim(spots: ReadonlySet<number>, back?: number | null): void;
    spend(spent: readonly boolean[], seed: number): void;
    invite(what: Invite): void;
    rattle(on: boolean): void;
    cubed(live: boolean): void;
    hold(spot: number | null): void;
    undoes(spot: number | null): void;
    grab(spot: number): boolean;
    drag(x: number, y: number): void;
    release(): void;
    relabel(): void;
    dispose(): void;
}

interface Moment
{
    id: string;
    rev: number;
    reader: boolean;
    ctx: Ctx;
}

export const HISTORY = 4000;

export const HOP_MS = 520;

export const KNOCK_MS = 420;

export const PICK_MS = 200;

export const CUBE_MS = 420;

export const SLIDE_MS = 440;

export const PASS_MS = 1100;

export const PASS_LEAST = 500;

export const GAME_GAP = 260;

export const GAME_MS = 1800;

export const GAME_LEAST = 900;

export const LAST_MS = 1300;

export const LAST_LEAST = 700;

export const FLAG_MS = 180;

const UNIT = 100 / WIDTH;

const SLAB_WIDTH = TRAY - 18;

const SLAB_HEIGHT = SLAB - 2;

const RACK_MOST = 30;

const QUIET_MOST = 8;

const STAGGER_MS = 26;

export const THROW_MS = 950;

export const ROLL_CAP = 1200;

const REACH = 5.6;

const REACH_OVER = 1.2;

const WAIT_SEED = 7;

const OPENING_SEED = 11;

const WAIT_MS = 180;

const STICK_MS = 160;

const HOP_BASE = 55;

const HOP_PACE = 0.42;

const WALK_LEAST = 320;

export const WALK_MOST = 900;

const ARC_BASE = 240;

const ARC_PACE = 0.5;

const ARC_LEAST = 320;

const ARC_MOST = 700;

const DROP_BASE = 80;

const DROP_PACE = 0.5;

export const DROP_MOST = 240;

const BACK_BASE = 120;

const BACK_PACE = 0.3;

export const BACK_MOST = 320;

const CARRIED = '1.2';

const SET_DOWN = 'cubic-bezier(0.2, 0.7, 0.3, 1)';

const BAR_X = BAR_LEFT + BAR_WIDTH / 2;

const cq = (units: number) => `${ (units * UNIT).toFixed(3) }cqw`;

const placed = (x: number, y: number, halfX = RADIUS, halfY = RADIUS) => `${ cq(x - halfX) } ${ cq(y - halfY) }`;

const make = (name: string, parent?: HTMLElement) =>
{
    const made = document.createElement('span');

    made.className = name;
    parent?.append(made);

    return made;
};

const cubeAt = (owner: Side | null) => `${ cq(BAR_X - CUBE / 2) } ${ cq(cubeY(owner) - CUBE / 2) }`;

const trackY = (point: number) => (columnOf(point).row === 'top' ? TOP + RADIUS : BOTTOM - RADIUS);

const pan = (x: number) => clamp((x / WIDTH - 0.5) * 1.2, -0.6, 0.6);

const liftOf = (span: number) => clamp(0.12 + span / 1400, 0.14, 0.4);

const costOf = (beat: Beat) =>
{
    if (beat.kind === 'cast')
    {
        return PICK_MS + THROW_MS;
    }

    if (beat.kind === 'throw')
    {
        return THROW_MS;
    }

    if (beat.kind === 'tie' || beat.kind === 'start')
    {
        return PICK_MS;
    }

    if (beat.kind === 'hop')
    {
        return beat.move.hit ? HOP_MS + KNOCK_MS : HOP_MS;
    }

    if (beat.kind === 'pass')
    {
        return PASS_LEAST;
    }

    if (beat.kind === 'clear')
    {
        return PICK_MS;
    }

    if (beat.kind === 'offer' || beat.kind === 'take')
    {
        return CUBE_MS;
    }

    if (beat.kind === 'rack')
    {
        return SLIDE_MS + RACK_MOST * STAGGER_MS;
    }

    if (beat.kind === 'game')
    {
        return (beat.last ? LAST_LEAST : GAME_LEAST) + FLAG_MS;
    }

    return 0;
};

export function createBackgammonTable(options: TableOptions): BackgammonTable
{
    const { host, stage } = options;
    const els = new Map<string, HTMLElement>();
    const tags = new Map<string, HTMLElement>();
    const marks = new Map<number, HTMLElement>();
    const flying = new Set<string>();
    const alive = new Set<Die>();
    const zone = make('bgt-dice', host);
    const cubeEl = make('bgt-cube', host);
    let shown: Shown = { viewer: 0, men: { men: [], serial: 0 }, dice: [], opening: [], cube: { on: false, value: 1, owner: null }, score: { near: 0, far: 0 }, round: 1, turn: null };
    let dice: Die[] = [];
    const openers = new Map<number, { die: Die; face: number }>();
    let diceSeed = -1;
    let used: number[] = [];
    let wanted: { spent: readonly boolean[]; seed: number } = { spent: [], seed: -2 };
    let rested = true;
    let badge: HTMLElement | null = null;
    let stuck: HTMLElement | null = null;
    let flag: HTMLElement | null = null;
    let said = '';
    let laid = 0;
    let spots: ReadonlySet<number> = new Set();
    let aims: ReadonlySet<number> = new Set();
    let home: number | null = null;
    let held: string | null = null;
    let taken: number | null = null;
    let invited: Invite = null;
    let waiting = false;
    let carried: { key: string; x: number; y: number } | null = null;
    const returning = new Map<string, Run>();

    const hit = make('bgt-hit', zone);

    const pressDice = () =>
    {
        if (zone.hasAttribute('data-live'))
        {
            options.onDice?.();
        }
    };

    const pressCube = () =>
    {
        if (cubeEl.hasAttribute('data-live'))
        {
            options.onCube?.();
        }
    };

    hit.addEventListener('click', pressDice);
    cubeEl.addEventListener('click', pressCube);

    layered(host);
    host.style.setProperty('--man', cq(RADIUS * 2));
    host.style.setProperty('--carried', CARRIED);
    zone.style.left = `${ (DICE_X / WIDTH * 100).toFixed(3) }%`;
    zone.style.top = '50%';
    cubeEl.style.display = 'none';
    cubeEl.style.fontSize = cq(26);
    cubeEl.style.inlineSize = cq(CUBE);
    cubeEl.style.blockSize = cq(CUBE);
    cubeEl.style.borderWidth = cq(3);
    cubeEl.style.borderRadius = cq(8);

    const toneOf = (side: Side) => ((side === 'near') === (shown.viewer === 0) ? 'light' : 'dark');

    const ensure = (man: Man) =>
    {
        let el = els.get(man.key);

        if (el === undefined)
        {
            el = make('man', host);
            el.dataset.tone = toneOf(man.side);
            el.dataset.key = man.key;
            els.set(man.key, el);
        }

        return el;
    };

    const rest = (man: Man, state: Men, final: boolean) =>
    {
        const slot = slotOf(state, man);
        const el = ensure(man);

        if (slot.off && final)
        {
            el.dataset.off = '';
            el.style.inlineSize = cq(SLAB_WIDTH);
            el.style.blockSize = cq(SLAB_HEIGHT);
            el.style.borderRadius = cq(3);
            el.style.translate = placed(slot.x, slot.y, SLAB_WIDTH / 2, SLAB_HEIGHT / 2);
        }
        else
        {
            el.removeAttribute('data-off');
            el.style.inlineSize = '';
            el.style.blockSize = '';
            el.style.borderRadius = '';
            el.style.translate = placed(slot.x, slot.y);
        }

        if (!flying.has(man.key))
        {
            el.style.zIndex = String(LAYER.piece + Math.min(slot.index, 9));
        }
    };

    const tally = (state: Men) =>
    {
        const held = new Map<string, number>();

        for (const man of state.men)
        {
            if (!flying.has(man.key) && man.spot !== OFF)
            {
                const key = `${ man.side }:${ man.spot }`;

                held.set(key, (held.get(key) ?? 0) + 1);
            }
        }

        for (const [key, tag] of tags)
        {
            if ((held.get(key) ?? 0) <= STACK_SHOWN)
            {
                tag.remove();
                tags.delete(key);
            }
        }

        for (const [key, count] of held)
        {
            if (count <= STACK_SHOWN)
            {
                continue;
            }

            const [side, spot] = key.split(':');
            const slot = slotAt(side as Side, Number(spot), STACK_SHOWN - 1);
            let tag = tags.get(key);

            if (tag === undefined)
            {
                tag = make('bgt-count', host);
                tags.set(key, tag);
            }

            tag.dataset.count = String(count);
            tag.textContent = options.say(count);
            tag.dataset.tone = toneOf(side as Side);
            tag.style.translate = placed(slot.x, slot.y);
        }
    };

    const resting = (spot: number | null) =>
    {
        const top = spot === null ? null : topAt(shown.men, 'near', spot);

        return top === null || flying.has(top.key) ? null : els.get(top.key) ?? null;
    };

    const dropAll = () =>
    {
        if (carried !== null)
        {
            els.get(carried.key)?.removeAttribute('data-carried');
            carried = null;
        }

        for (const run of returning.values())
        {
            run.cancel();
        }

        returning.clear();
    };

    const lights = () =>
    {
        const marked = new Set(aims);

        if (home !== null)
        {
            marked.add(home);
        }

        for (const el of els.values())
        {
            el.removeAttribute('data-lit');
            el.removeAttribute('data-held');
            el.removeAttribute('data-back');
        }

        for (const spot of spots)
        {
            resting(spot)?.setAttribute('data-lit', '');
        }

        if (held !== null && !flying.has(held))
        {
            els.get(held)?.setAttribute('data-held', '');
        }

        resting(taken)?.setAttribute('data-back', '');

        for (const [spot, mark] of marks)
        {
            if (!marked.has(spot))
            {
                mark.remove();
                marks.delete(spot);
            }
        }

        for (const spot of marked)
        {
            const here = shown.men.men.filter((man) => man.side === 'near' && man.spot === spot && !flying.has(man.key)).length;
            const slot = slotAt('near', spot, Math.min(here, STACK_SHOWN - 1));
            let mark = marks.get(spot);

            if (mark === undefined)
            {
                mark = make('bgt-mark', host);
                marks.set(spot, mark);
            }

            mark.style.translate = placed(slot.x, slot.y);
            mark.toggleAttribute('data-back', spot === home && !aims.has(spot));
        }
    };

    const redraw = () =>
    {
        const keep = new Set(shown.men.men.map((man) => man.key));

        dropAll();
        flying.clear();

        for (const [key, el] of els)
        {
            if (!keep.has(key))
            {
                el.remove();
                els.delete(key);
            }
        }

        for (const man of shown.men.men)
        {
            rest(man, shown.men, true);
        }

        tally(shown.men);
        lights();
    };

    const routeOf = (move: Move, from: Slot, to: Slot) =>
    {
        const route: Point[] = [{ x: from.x, y: from.y }];

        if (move.from !== BAR)
        {
            for (let spot = move.from - 1; spot > Math.max(move.to, 0); spot -= 1)
            {
                const point = move.side === 'near' ? spot : opposite(spot);

                route.push({ x: columnOf(point).x + POINT_WIDTH / 2, y: trackY(point) });
            }
        }

        route.push({ x: to.x, y: to.y });

        return route;
    };

    const carry = (man: Man, route: readonly Point[]) =>
    {
        const el = ensure(man);
        const spans = route.slice(1).map((to, leg) => Math.hypot(to.x - route[leg].x, to.y - route[leg].y));
        const legs = spans.length;

        el.style.zIndex = String(LAYER.moving);

        if (legs <= 1)
        {
            const total = clamp(ARC_BASE + (spans[0] ?? 0) * ARC_PACE, ARC_LEAST, ARC_MOST);

            return stage.animate(el, arc(route[0], route[route.length - 1], { duration: total, arch: liftOf(spans[0] ?? 0) }).map((one) => ({
                offset: one.at / total,
                translate: placed(one.x, one.y),
                scale: (1 + one.lift * 0.9).toFixed(3)
            })), { duration: total });
        }

        const raw = spans.map((span, leg) => (HOP_BASE + span * HOP_PACE) * (leg === 0 ? 1.2 : 1) * (leg === legs - 1 ? 1.3 : 1));
        const sum = raw.reduce((all, one) => all + one, 0);
        const fit = clamp(sum, WALK_LEAST, WALK_MOST) / sum;
        const walked = walk(route, { hops: raw.map((one) => one * fit), lifts: spans.map(liftOf) });

        return stage.animate(el, walked.steps.map((one) => ({
            offset: one.at / walked.length,
            translate: placed(one.x, one.y),
            scale: (1 + one.lift * 0.9).toFixed(3)
        })), { duration: walked.length });
    };

    const letGo = (man: Man): Point | null =>
    {
        returning.get(man.key)?.cancel();
        returning.delete(man.key);

        if (carried === null || carried.key !== man.key)
        {
            return null;
        }

        const at = { x: carried.x, y: carried.y };

        carried = null;
        ensure(man).removeAttribute('data-carried');

        return at;
    };

    const setDown = (man: Man, from: Point, to: Point, base: number, pace: number, most: number) =>
    {
        const el = ensure(man);

        el.style.zIndex = String(LAYER.moving);

        return stage.animate(el, [
            { offset: 0, translate: placed(from.x, from.y), scale: CARRIED },
            { offset: 1, translate: placed(to.x, to.y), scale: '1' }
        ], { duration: clamp(base + Math.hypot(to.x - from.x, to.y - from.y) * pace, base, most), easing: SET_DOWN });
    };

    const settled = (man: Man, state: Men, squash: boolean) =>
    {
        flying.delete(man.key);
        rest(man, state, true);

        if (squash)
        {
            stage.animate(ensure(man), [{ scale: '1.12 0.88' }, { scale: '1 1' }], { duration: 120, easing: 'ease-out', quiet: 'skip' });
        }
    };

    const knocked = (man: Man, from: Slot, to: Slot, delay: number) =>
    {
        const el = ensure(man);

        el.style.zIndex = String(LAYER.airborne);

        return stage.animate(el, arc(from, to, { duration: KNOCK_MS, arch: 0.55 }).map((one) => ({
            offset: one.at / KNOCK_MS,
            translate: placed(one.x, one.y),
            scale: (1 + one.lift * 0.9).toFixed(3),
            rotate: `${ (one.progress * 200).toFixed(1) }deg`
        })), { duration: KNOCK_MS, delay });
    };

    const manIn = (state: Men, man: Man) => state.men.find((one) => one.key === man.key) as Man;

    const fly = async (origin: Men, target: Men, move: Move, result: Moved, reverse: boolean, onward = false) =>
    {
        const mover = result.mover;
        const hurt = result.knocked;
        const from = slotOf(origin, manIn(origin, mover));
        const to = slotOf(target, mover);
        const pips = Math.max(1, move.from === BAR ? BAR - move.to : move.from - move.to);
        const route = routeOf(move, reverse ? to : from, reverse ? from : to);
        const kept = onward && carried?.key === mover.key;
        const dropped = kept ? null : letGo(mover);
        const swing = kept ? null : (dropped === null
            ? carry(mover, reverse ? [...route].reverse() : route)
            : setDown(mover, dropped, to, DROP_BASE, DROP_PACE, DROP_MOST));
        const length = swing?.length ?? 0;
        const impact = reverse ? 0 : length * 0.94;
        let thrown = 0;

        flying.add(mover.key);

        if (held === mover.key)
        {
            held = null;
        }

        if (hurt !== null)
        {
            flying.add(hurt.key);
        }

        if (swing !== null)
        {
            rest(mover, target, stage.quiet());
            stage.after(length, () => options.sound()?.play(to.off ? 'checker-off' : 'checker', { pan: pan(to.x), rate: 0.96 + (pips % 3) * 0.04 }));
        }

        tally(target);
        lights();

        if (hurt !== null)
        {
            const hurtFrom = slotOf(origin, manIn(origin, hurt));
            const hurtTo = slotOf(target, hurt);
            const flight = knocked(hurt, hurtFrom, hurtTo, impact);

            thrown = flight.length;
            rest(hurt, target, false);
            void flight.done.then(() =>
            {
                settled(hurt, target, false);
                tally(target);
                lights();
            });

            if (!reverse)
            {
                stage.after(impact, () =>
                {
                    options.sound()?.play('checker-hit', { pan: pan(hurtFrom.x) });
                    options.feel(move.side === 'near' ? 'capture' : 'hit');
                });
            }

            stage.after(thrown, () => options.sound()?.play(reverse ? 'checker' : 'checker-bar', { pan: pan(hurtTo.x) }));
        }

        if (swing !== null)
        {
            await swing.done;
            settled(mover, target, true);
            tally(target);
            lights();
        }

        if (thrown > length)
        {
            await stage.wait(thrown - length);
        }
    };

    const slide = async (before: Men, after: Men, transfers: readonly Transfer[], most: number) =>
    {
        const known = new Set(before.men.map((man) => man.key));

        if (transfers.length > most)
        {
            redraw();

            return;
        }

        for (const man of after.men)
        {
            if (!known.has(man.key))
            {
                rest(man, after, true);
                stage.animate(ensure(man), [{ opacity: 0, offset: 0 }], { duration: 160 });
            }
        }

        await Promise.all(transfers.map(async (transfer, index) =>
        {
            const from = slotOf(before, manIn(before, transfer.man));
            const to = slotOf(after, transfer.man);
            const el = ensure(transfer.man);

            el.style.zIndex = String(LAYER.moving);
            flying.add(transfer.man.key);
            rest(transfer.man, after, stage.quiet());

            await stage.animate(el, arc(from, to, { duration: SLIDE_MS, arch: 0.22 }).map((one) => ({
                offset: one.at / SLIDE_MS,
                translate: placed(one.x, one.y),
                scale: (1 + one.lift * 0.9).toFixed(3)
            })), { duration: SLIDE_MS, delay: Math.min(index * STAGGER_MS, RACK_MOST * STAGGER_MS) }).done;

            settled(transfer.man, after, false);
        }));

        redraw();
    };

    const count = (left: number) =>
    {
        if (left <= 0)
        {
            badge?.remove();
            badge = null;

            return;
        }

        badge ??= make('bgt-left', zone);
        badge.dataset.left = String(left);
        badge.textContent = `×${ options.say(left) }`;
    };

    const dim = () =>
    {
        const flags = diceSeed === wanted.seed ? wanted.spent : spentBy(shown.dice, used);
        const twice = flags.length === 4;
        const left = flags.filter((flag) => !flag).length;

        dice.forEach((die, index) => die.dim(twice ? left === 0 : flags[index] === true));
        count(twice && rested && dice.length > 0 ? left : 0);
    };

    const lay = (face: number, index: number, count: number, seed: number) =>
    {
        const die = createDie();
        const spot = restOf(seed, index, count);

        laid += 1;
        alive.add(die);
        zone.append(die.node);
        die.node.dataset.key = `die-${ laid }`;
        die.node.style.left = `${ spot.x }em`;
        die.node.style.top = `${ spot.y }em`;
        die.show(face, seed + index * 977);

        return die;
    };

    const drop = (die: Die) =>
    {
        die.dispose();
        alive.delete(die);
    };

    const tell = () =>
    {
        const now: Facts = { score: shown.score, round: shown.round, pips: pipsOf(shown.men), turn: shown.turn };
        const key = JSON.stringify(now);

        if (key !== said)
        {
            said = key;
            options.onFacts?.(now);
        }
    };

    const unflag = () =>
    {
        flag?.remove();
        flag = null;
    };

    const raise = (lines: readonly string[], side: Side) =>
    {
        unflag();
        flag = make('bgt-banner', host);
        flag.dataset.side = side;
        flag.dir = options.reads?.() ?? 'ltr';

        for (const line of lines)
        {
            make('bgt-banner-line', flag).textContent = line;
        }

        stage.animate(flag, [{ opacity: 0, scale: '0.86', offset: 0 }], { duration: FLAG_MS });
    };

    const lower = async () =>
    {
        const up = flag;

        if (up === null)
        {
            return;
        }

        await stage.animate(up, [{ offset: 1, opacity: 0, scale: '0.94' }], { duration: FLAG_MS, fill: 'both', quiet: 'out' }).done;

        if (flag === up)
        {
            unflag();
        }
    };

    const stick = () =>
    {
        const words = options.noMove?.() ?? '';

        if (words === '' || stuck !== null)
        {
            return;
        }

        stuck = make('bgt-pass', zone);
        stuck.textContent = words;
        stage.animate(stuck, [{ opacity: 0, scale: '0.8', offset: 0 }], { duration: STICK_MS });
    };

    const unstick = () =>
    {
        stuck?.remove();
        stuck = null;
    };

    const pick = async () =>
    {
        const old = dice;

        dice = [];
        waiting = false;
        unstick();
        count(0);
        live();

        if (old.length > 0)
        {
            options.onRoll?.(-1, [], true);
        }

        await Promise.all(old.map((die, index) =>
            stage.animate(die.node, [{ offset: 0, scale: '1' }, { offset: 1, opacity: 0, scale: '0.6' }], { duration: PICK_MS, delay: index * 40, fill: 'both', quiet: 'out' }).done.then(() => drop(die))));
    };

    const live = () =>
    {
        const mode = invited === 'roll' || invited === 'throw'
            ? (waiting ? 'roll' : null)
            : (invited === 'done' && rested && dice.length > 0 ? 'done' : null);

        if (mode === null)
        {
            zone.removeAttribute('data-live');
            zone.removeAttribute('data-shake');
        }
        else
        {
            zone.dataset.live = mode;
        }
    };

    const dropOpener = (seat: number) =>
    {
        const held = openers.get(seat);

        if (held !== undefined)
        {
            drop(held.die);
            openers.delete(seat);
        }
    };

    const layOpener = (seat: number, face: number) =>
    {
        const die = lay(face === UNTHROWN ? 1 : face, seat, 2, OPENING_SEED);

        if (face === UNTHROWN)
        {
            die.node.setAttribute('data-blank', '');
            stage.animate(die.node, [{ opacity: 0, scale: '0.8', offset: 0 }], { duration: WAIT_MS });
        }

        openers.set(seat, { die, face });

        return die;
    };

    const drawOpeners = () =>
    {
        if (shown.opening.length !== 2)
        {
            for (const seat of [...openers.keys()])
            {
                dropOpener(seat);
            }

            return;
        }

        for (const seat of [0, 1])
        {
            const face = shown.opening[seat];
            const offered = face === UNTHROWN && seat === shown.viewer && invited === 'throw';
            const held = openers.get(seat);

            if (face === UNTHROWN && !offered)
            {
                dropOpener(seat);
            }
            else if (held === undefined || held.face !== face)
            {
                dropOpener(seat);
                layOpener(seat, face);
            }
        }

        waiting = [...openers.values()].some((one) => one.face === UNTHROWN);
    };

    const pickOpeners = async () =>
    {
        const old = [...openers.values()].map((one) => one.die);

        openers.clear();
        waiting = false;
        live();

        await Promise.all(old.map((die, index) =>
            stage.animate(die.node, [{ offset: 0, scale: '1' }, { offset: 1, opacity: 0, scale: '0.6' }], { duration: PICK_MS, delay: index * 40, fill: 'both', quiet: 'out' }).done.then(() => drop(die))));
    };

    const wait = () =>
    {
        if (shown.opening.length > 0)
        {
            drawOpeners();
            live();

            return;
        }

        if (waiting && invited !== 'roll')
        {
            void pick();
        }

        if (invited === 'roll' && rested && dice.length === 0)
        {
            dice = [0, 1].map((index) => lay(1, index, 2, WAIT_SEED));
            diceSeed = -1;
            waiting = true;

            for (const die of dice)
            {
                die.node.setAttribute('data-blank', '');
                stage.animate(die.node, [{ opacity: 0, scale: '0.8', offset: 0 }], { duration: WAIT_MS });
            }
        }

        live();
    };

    const show = (faces: readonly number[], seed: number) =>
    {
        for (const die of dice)
        {
            drop(die);
        }

        unstick();
        dice = faces.map((face, index) => lay(face, index, faces.length, seed));
        diceSeed = seed;
        used = [];
        rested = true;
        waiting = false;
        dim();
        wait();

        options.onRoll?.(faces.length > 0 ? seed : -1, faces, true);
    };

    const reach = () =>
    {
        const em = Number.parseFloat(getComputedStyle(zone).fontSize);

        return em > 0 ? Math.max(REACH, host.clientHeight / 2 / em + REACH_OVER) : REACH;
    };

    const cast = async (faces: readonly number[], sides: readonly Side[], seed: number) =>
    {
        rested = false;
        await pick();
        options.onRoll?.(seed, faces, false);

        const random = seeded(seed);
        const far = reach();

        dice = faces.map((face, index) => lay(face, index, faces.length, seed));
        diceSeed = seed;
        used = [];
        waiting = false;
        dim();

        await Promise.all(dice.map((die, index) =>
        {
            const near = sides[index] === 'near';
            const spot = restOf(seed, index, faces.length);
            const from = { x: (near ? 1 : -1) * (0.6 + random() * 2.4), y: (near ? 1 : -1) * (far + random() * 1.1) };

            return die.toss(stage, seed + index * 977, faces[index], from, {
                impact: (power) => options.sound()?.play('dice-wood', { gain: 0.35 + 0.65 * power, pan: pan(DICE_X + spot.x * 24) })
            }).done;
        }));

        if (diceSeed !== seed)
        {
            return;
        }

        rested = true;
        dim();
        wait();
        options.onRoll?.(seed, faces, true);
    };

    const throwOpener = async (seat: number, face: number, side: Side, seed: number) =>
    {
        options.onRoll?.(seed, [face], false);
        dropOpener(seat);

        const die = lay(face, seat, 2, OPENING_SEED);
        const random = seeded(seed);
        const far = reach();
        const near = side === 'near';
        const from = { x: (near ? 1 : -1) * (0.6 + random() * 2.4), y: (near ? 1 : -1) * (far + random() * 1.1) };

        openers.set(seat, { die, face });
        waiting = [...openers.values()].some((one) => one.face === UNTHROWN);
        live();

        await die.toss(stage, seed, face, from, {
            impact: (power) => options.sound()?.play('dice-wood', { gain: 0.35 + 0.65 * power, pan: pan(DICE_X) })
        }).done;

        options.onRoll?.(seed, [face], true);
    };

    const swap = async (faces: readonly number[], seed: number) =>
    {
        await pick();
        show(faces, seed);
        await Promise.all(dice.map((die) => stage.animate(die.node, [{ opacity: 0, offset: 0 }], { duration: 160 }).done));
    };

    const drawCube = (state: Cube) =>
    {
        cubeEl.style.display = state.on ? '' : 'none';
        cubeEl.textContent = options.say(state.value === 1 ? 64 : state.value);
        cubeEl.style.translate = cubeAt(state.owner);
    };

    const moveCube = async (before: Cube, state: Cube) =>
    {
        drawCube(state);

        if (!before.on || !state.on || (before.owner === state.owner && before.value === state.value))
        {
            return;
        }

        const from = cubeAt(before.owner);
        const to = cubeAt(state.owner);
        const turn = before.value !== state.value;

        cubeEl.style.zIndex = String(LAYER.airborne);

        await stage.animate(cubeEl, [
            { offset: 0, translate: from, scale: '1', rotate: '0deg' },
            { offset: 0.18, translate: from, scale: '1.15', rotate: turn ? '90deg' : '0deg' },
            { offset: 0.7, translate: to, scale: '1.2', rotate: turn ? '270deg' : '0deg' },
            { offset: 1, translate: to, scale: '1', rotate: turn ? '360deg' : '0deg' }
        ], { duration: CUBE_MS, easing: 'cubic-bezier(0.3, 0.6, 0.3, 1)' }).done;

        cubeEl.style.zIndex = '';
    };

    const offer = async () =>
    {
        if (!shown.cube.on)
        {
            return;
        }

        const at = cubeEl.style.translate;

        await stage.animate(cubeEl, [
            { offset: 0, translate: at, scale: '1', rotate: '0deg' },
            { offset: 0.35, translate: at, scale: '1.35', rotate: '-14deg' },
            { offset: 0.7, translate: at, scale: '1.2', rotate: '10deg' },
            { offset: 1, translate: at, scale: '1', rotate: '0deg' }
        ], { duration: CUBE_MS, easing: 'ease-in-out', quiet: 'skip' }).done;
    };

    const mend = async (felt: Felt) =>
    {
        const counts = { near: felt.near, far: felt.far };

        if (!same(shown.men, counts))
        {
            const before = shown.men;
            const next = reconcile(before, counts);

            shown = { ...shown, men: next.table };
            await slide(before, next.table, next.transfers, QUIET_MOST);
        }

        if (shown.cube.on !== felt.cube.on || shown.cube.value !== felt.cube.value || shown.cube.owner !== felt.cube.owner)
        {
            shown = { ...shown, cube: felt.cube };
            drawCube(felt.cube);
        }

        if (wanted.seed !== felt.seed)
        {
            wanted = { spent: felt.spent, seed: felt.seed };
        }

        if (shown.dice.join() !== felt.dice.join() || (felt.dice.length > 0 && diceSeed !== felt.seed))
        {
            shown = { ...shown, dice: [...felt.dice] };
            await swap(felt.dice, felt.seed);
        }

        if (shown.opening.join() !== felt.opening.join())
        {
            shown = { ...shown, opening: [...felt.opening] };
            drawOpeners();
        }

        shown = { ...shown, score: { ...felt.score }, round: felt.round, turn: felt.turn };
        dim();
        wait();
        tell();
    };

    const perform = async (beat: Beat, at: Moment) =>
    {
        const before = shown;
        const next = step(before, beat);

        shown = next.shown;

        if (beat.kind === 'throw')
        {
            tell();
            await throwOpener(beat.seat, beat.face, beat.side, seedOf(at.id, at.rev, beat.nth));
        }
        else if (beat.kind === 'tie')
        {
            await pickOpeners();
            wait();
        }
        else if (beat.kind === 'start')
        {
            tell();
            await Promise.all([pickOpeners(), swap(beat.faces, seedOf(at.id, at.rev))]);
        }
        else if (beat.kind === 'cast')
        {
            if (beat.sides[0] === beat.sides[1])
            {
                tell();
            }

            await cast(beat.faces, beat.sides, seedOf(at.id, at.rev, beat.nth));
        }
        else if (beat.kind === 'hop')
        {
            if (next.moved !== null)
            {
                await fly(before.men, shown.men, beat.move, next.moved, false);
                used.push(beat.die);
                dim();
            }
        }
        else if (beat.kind === 'pass')
        {
            dice.forEach((die) => die.dim(true));
            stick();
            options.onPass?.(beat.side, shown.dice);

            if (at.reader)
            {
                options.sound()?.play('pass');
            }

            await at.ctx.linger(PASS_MS, PASS_LEAST);
        }
        else if (beat.kind === 'clear')
        {
            await pick();
            wait();
        }
        else if (beat.kind === 'offer')
        {
            if (at.reader)
            {
                options.sound()?.play('cube');

                if (beat.side === 'far')
                {
                    options.feel('ready');
                }
            }

            await offer();
        }
        else if (beat.kind === 'take')
        {
            if (at.reader)
            {
                options.sound()?.play('bonus');
            }

            await moveCube(before.cube, shown.cube);
        }
        else if (beat.kind === 'drop')
        {
            if (at.reader)
            {
                options.sound()?.play('pass');
            }
        }
        else if (beat.kind === 'game')
        {
            const lines = options.banner?.(beat.side, beat.how, beat.points) ?? [];

            if (at.reader && beat.side === 'near')
            {
                options.sound()?.play('hand-won');
                options.feel('hand');
            }

            options.onGame?.(beat.side, beat.how, beat.points);
            tell();

            if (lines.length > 0)
            {
                raise(lines, beat.side);
                await at.ctx.linger(beat.last ? LAST_MS : GAME_MS, beat.last ? LAST_LEAST : GAME_LEAST);
                await lower();
            }
            else if (beat.last)
            {
                await at.ctx.stage.wait(GAME_GAP);
            }
        }
        else if (beat.kind === 'rack')
        {
            await Promise.all([slide(before.men, shown.men, next.transfers, RACK_MOST), moveCube(before.cube, shown.cube)]);
        }
        else
        {
            const sting = endCue(options.result?.() ?? (at.reader ? (beat.side === 'near' ? 'won' : 'lost') : undefined));

            if (sting !== null)
            {
                options.sound()?.play(sting);
            }

            if (at.reader && sting === 'win')
            {
                options.feel('win');
            }
        }

        tell();
    };

    const strip = () =>
    {
        for (const die of alive)
        {
            die.dispose();
        }

        for (const el of [...els.values(), ...tags.values(), ...marks.values()])
        {
            el.remove();
        }

        dropAll();
        unstick();
        unflag();
        alive.clear();
        openers.clear();
        els.clear();
        tags.clear();
        marks.clear();
        flying.clear();
        dice = [];
        waiting = false;
        rested = true;
        count(0);
        live();
    };

    return {
        kind: 'backgammon',

        history: HISTORY,

        before: (sight) => ({ ...sight, view: { ...sight.view, dice: [], opening: [], spent: [], turn: null } }),

        reset(sight)
        {
            const felt = sight.view;

            strip();

            if (!zone.isConnected)
            {
                host.append(zone);
            }

            if (!cubeEl.isConnected)
            {
                host.append(cubeEl);
            }

            cubeEl.style.zIndex = '';
            shown = shownOf(felt, shown.men.serial);
            redraw();
            drawCube(shown.cube);
            wanted = { spent: felt.spent, seed: felt.seed };
            show(felt.dice, felt.seed);
            drawOpeners();
            live();
            tell();
        },

        same: (sight) => sameAs(shown, sight.view) && shown.turn === sight.view.turn,

        settle: (sight) => mend(sight.view),

        async play(acts, sight, ctx)
        {
            const reader = sight.seat !== null;

            for (const act of acts)
            {
                for (const beat of beatsOf(act.moves, sight.view.viewer))
                {
                    if (!ctx.live())
                    {
                        return;
                    }

                    await perform(beat, { id: sight.id, rev: act.rev, reader, ctx });
                }
            }

            if (ctx.live())
            {
                await mend(sight.view);
            }
        },

        estimate: (acts) => acts.reduce((total, act) => beatsOf(act.moves, shown.viewer).reduce((sum, beat) => sum + costOf(beat), total), 0),

        async hop(move, onward = false)
        {
            const before = shown;
            const next = step(before, { kind: 'hop', move, die: 0 });

            if (next.moved === null)
            {
                return false;
            }

            shown = next.shown;
            await fly(before.men, shown.men, move, next.moved, false, onward);
            tell();

            return true;
        },

        async unhop(move)
        {
            const before = shown.men;
            const result = undone(before, move);

            if (result === null)
            {
                return false;
            }

            shown = { ...shown, men: result.table };
            await fly(before, shown.men, move, result, true);
            tell();

            return true;
        },

        lit(next)
        {
            spots = next;
            lights();
        },

        aim(next, back = null)
        {
            aims = next;
            home = back;
            lights();
        },

        spend(spent, seed)
        {
            wanted = { spent, seed };

            if (seed === diceSeed)
            {
                dim();
            }
        },

        invite(what)
        {
            invited = what;
            wait();
        },

        rattle(on)
        {
            zone.toggleAttribute('data-shake', on && waiting);
        },

        cubed(on)
        {
            cubeEl.toggleAttribute('data-live', on);
        },

        hold(spot)
        {
            held = spot === null ? null : topAt(shown.men, 'near', spot)?.key ?? null;
            lights();
        },

        undoes(spot)
        {
            taken = spot;
            lights();
        },

        grab(spot)
        {
            const top = carried === null ? topAt(shown.men, 'near', spot) : null;

            if (top === null || flying.has(top.key))
            {
                return false;
            }

            const slot = slotOf(shown.men, top);
            const el = ensure(top);

            rest(top, shown.men, false);
            carried = { key: top.key, x: slot.x, y: slot.y };
            flying.add(top.key);
            el.dataset.carried = '';
            el.style.zIndex = String(LAYER.airborne);
            tally(shown.men);
            lights();

            return true;
        },

        drag(x, y)
        {
            const el = carried === null ? undefined : els.get(carried.key);

            if (carried === null || el === undefined)
            {
                return;
            }

            carried.x = clamp(x, RADIUS, WIDTH - RADIUS);
            carried.y = clamp(y, RADIUS, HEIGHT - RADIUS);
            el.style.translate = placed(carried.x, carried.y);
        },

        release()
        {
            const lifted = carried;
            const man = lifted === null ? undefined : shown.men.men.find((one) => one.key === lifted.key);

            if (lifted === null || man === undefined)
            {
                return;
            }

            const key = man.key;

            carried = null;
            ensure(man).removeAttribute('data-carried');
            rest(man, shown.men, false);

            const run = setDown(man, lifted, slotOf(shown.men, man), BACK_BASE, BACK_PACE, BACK_MOST);

            returning.set(key, run);
            void run.done.then(() =>
            {
                const back = shown.men.men.find((one) => one.key === key);

                if (returning.get(key) !== run)
                {
                    return;
                }

                returning.delete(key);

                if (back !== undefined)
                {
                    settled(back, shown.men, false);
                    tally(shown.men);
                    lights();
                }
            });
        },

        relabel()
        {
            for (const tag of tags.values())
            {
                tag.textContent = options.say(Number(tag.dataset.count));
            }

            drawCube(shown.cube);
            dim();
        },

        dispose()
        {
            strip();
            hit.removeEventListener('click', pressDice);
            cubeEl.removeEventListener('click', pressCube);
            zone.remove();
            cubeEl.remove();
        }
    };
}
