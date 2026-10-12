import { BLOCK, CELL, GRID, HOME_SCALE, MARGIN, aimNear, stackSpot } from '../layout.ts';
import { HISTORY, beatsOf, placeOf, sameAs, shownOf, step, type Beat, type Felt, type Pawn, type Rolled, type Shown } from '../ludo-felt.ts';
import { celebrate } from '../stage/celebrate.ts';
import { clamp, hashOf } from '../stage/curves.ts';
import { createDie } from '../stage/die.ts';
import type { Ctx } from '../stage/director.ts';
import { LAYER } from '../stage/layers.ts';
import type { Sight } from '../stage/presenter.ts';
import { arc, walk, type Point } from '../stage/route.ts';
import type { Run } from '../stage/stage.ts';
import { FINISHED, RING_STEPS, YARD, pathBetween } from './path.ts';
import type { BoardGoal, BoardHandle, BoardOptions } from '../bridge.ts';

const C = CELL * 100;

const DROP = 0.10;

const BAND = 2000;

const FRONT = 30;

const AHEAD = 50;

const Z_PIECE = LAYER.piece * BAND;

const Z_AIR = LAYER.airborne * BAND;

const Z_DIE = LAYER.dice * BAND;

const Z_BURST = LAYER.burst * BAND;

const Z_GOAL = Z_PIECE - 20;

const TRAIL_MOST = 6;

export const STEP_MS = 120;

export const STEP_LEAST = 95;

export const ENTER_MS = 360;

export const KNOCK_MS = 520;

export const HOME_MS = 220;

export const PAIR_MS = 160;

export const SLIDE_MS = 420;

const THROW_MS = 950;

export const SPENT_MS = 280;

export const PASS_MS = 900;

export const PASS_LEAST = 300;

export const DIE_REST_MS = 1100;

export const PICKUP_MS = 260;

export const GONE_MS = 160;

const HAND_MS = 180;

const LIFT_MS = 120;

export const DIE_SIZE = 1.2;

const DIE_INSET = 1.01;

export const HAND = 1.67;

export const LIFTED = 1.85;

const DIE_OUT = 2.6;

const DIE_LEAVE = 2.2;

const HAND_FACE = 5;

const HAND_SEED = 5;

export const WIN_MS = 1300;

export const WIN_LEAST = 700;

const SLIDE_MOST = 8;

const TONE: Record<string, string> = {
    red: '#FF5A4E',
    green: '#2FC262',
    yellow: '#FFC72C',
    blue: '#3F8CFF'
};

interface Spot
{
    x: number;
    y: number;
    scale: number;
    front: boolean;
}

interface Piece
{
    key: string;
    root: HTMLElement;
    lift: HTMLElement;
    pawn: HTMLImageElement;
    shadow: HTMLImageElement;
    hit: HTMLElement;
    at: Spot;
}

interface Mark
{
    root: HTMLElement;
    steps: HTMLElement[];
    col: number;
    row: number;
}

interface Moment
{
    sight: Sight<Felt>;
    ctx: Ctx;
    more: boolean;
    seed: number;
}

type Where = 'none' | 'hand' | 'air' | 'board' | 'leaving' | 'plate';

type Moved = Extract<Beat, { kind: 'move' }>;

type Thrown = Extract<Beat, { kind: 'roll' }>;

const NOBODY: Shown = { pawns: [], out: [], die: null };

const WAITING: Felt = { pawns: [], out: [], die: { roller: 0, face: 6, fate: 'pending' }, winners: [] };

const cq = (value: number) => `${ value.toFixed(3) }cqi`;

const at = (spot: Point) => `${ cq(spot.x) } ${ cq(spot.y) }`;

const pan = (x: number) => clamp((x / 100 - 0.5) * 1.2, -0.6, 0.6);

const INWARD: Readonly<Record<string, readonly [number, number]>> = {
    red: [1, 1],
    green: [-1, 1],
    yellow: [-1, -1],
    blue: [1, -1]
};

const CENTRE: Point = { x: (MARGIN * 100) + (GRID / 2) * C, y: (MARGIN * 100) + (GRID / 2) * C };

export function dieRest(colour: string): Point
{
    const inward = INWARD[colour] ?? INWARD.red;

    return {
        x: (MARGIN * 100) + (inward[0] > 0 ? DIE_INSET : GRID - DIE_INSET) * C,
        y: (MARGIN * 100) + (inward[1] > 0 ? DIE_INSET : GRID - DIE_INSET) * C
    };
}

function foot(col: number, row: number): Point
{
    return {
        x: (MARGIN * 100) + (col + 0.5) * C,
        y: (MARGIN * 100) + (row + 0.5 + DROP) * C
    };
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, name: string, parent?: HTMLElement)
{
    const made = document.createElement(tag);

    made.className = name;
    parent?.append(made);

    return made;
}

const stepOf = (squares: number) => STEP_MS - (STEP_MS - STEP_LEAST) * clamp((squares - 1) / 5);

const costOf = (beat: Beat) =>
{
    if (beat.kind === 'roll')
    {
        return beat.fate === 'pending' ? THROW_MS : THROW_MS + PASS_LEAST;
    }

    if (beat.kind === 'move')
    {
        const squares = Math.max(1, Math.min(beat.to, FINISHED - 1) - beat.from);
        const travel = beat.from === YARD ? ENTER_MS : squares * stepOf(squares);

        return travel + (beat.victims.length > 0 ? KNOCK_MS : 0) + (beat.home ? HOME_MS : 0);
    }

    if (beat.kind === 'forfeit')
    {
        return beat.survives ? SLIDE_MS : 0;
    }

    return WIN_LEAST;
};

const RING = '<svg viewBox="-60 -30 120 60" aria-hidden="true" class="block inline-full block-full overflow-visible"><ellipse class="fill-none stroke-[#0B1220] [stroke-opacity:0.55] stroke-[10]" rx="56" ry="28"/><ellipse class="fill-none stroke-[#FFFFFF] [stroke-opacity:0.95] stroke-[5.5] [stroke-dasharray:7.5_2.5] animate-[lp-dash_2400ms_linear_infinite] [.lp[data-movable]:hover_&]:[stroke-dasharray:none] [.lp[data-movable]:hover_&]:stroke-[7.5] [.lb[data-still]_&]:animate-none [.lb[data-still]_&]:[stroke-dasharray:none]" rx="56" ry="28" pathLength="120"/></svg>';

const SPIKES = Array.from({ length: 16 }, (_, index) =>
{
    const reach = index % 2 === 0 ? 70 : 47;
    const turn = index / 16 * Math.PI * 2;

    return `${ index === 0 ? 'M' : 'L' }${ (Math.cos(turn) * reach).toFixed(1) } ${ (Math.sin(turn) * reach / 2).toFixed(1) }`;
}).join(' ');

const SPOT = '<svg viewBox="-60 -30 120 60" aria-hidden="true" class="lg-art"><ellipse class="lg-pad" rx="48" ry="24"/><ellipse class="lg-eye" rx="26" ry="13"/></svg>';

const BURST = `<svg viewBox="-60 -30 120 60" aria-hidden="true" class="lg-art"><path class="lg-pad lg-burst" d="${ SPIKES } Z"/><ellipse class="lg-eye" rx="26" ry="13"/></svg>`;

const SPRITE = 'absolute max-inline-none select-none [-webkit-user-drag:none]';

const STILL = '[.lb[data-still]_&]:animate-none';

const PAWN_BOX = 'inset-s-[calc(var(--c)*-0.8435)] inset-bs-[calc(var(--c)*-1.3114)] inline-[calc(var(--c)*1.687)] block-[calc(var(--c)*1.687)]';

export async function createLudoBoard(options: BoardOptions): Promise<BoardHandle>
{
    const { host, stage } = options;
    const root = element('div', 'lb absolute inset-0 overflow-hidden isolate pointer-events-none [&[data-paused]_*]:[animation-play-state:paused]', host);
    const pieces = new Map<string, Piece>();
    const nest = new Map<string, number>();
    const slot = new Map<string, number>();
    const pending = new Set<string>();
    const pressed = new Map<string, number>();
    const flying = new Set<string>();
    const transient = new Set<HTMLElement>();
    const marks = new Map<string, Mark>();
    const threatened = new Set<string>();

    let shown: Shown = NOBODY;
    let matchId = '';
    let celebrated = '';
    let movable: ReadonlySet<string> = new Set();
    let hints = true;
    let goals: readonly BoardGoal[] = [];
    let marked = '';
    let aimed: string | null = null;
    let roving: string | null = null;
    let plateDie: Rolled | null = null;
    let where: Where = 'none';
    let offered: number | null = null;
    let rattling = false;
    let resting: Point = CENTRE;
    let outward: readonly [number, number] = [0, 0];
    let told = '';
    let dieRuns: Run[] = [];
    let dieStop: () => void = () => undefined;

    root.style.setProperty('--c', cq(C));
    root.toggleAttribute('data-still', stage.quiet());

    const holder = element('div', 'lb-die absolute inset-s-0 inset-bs-0 inline-0 block-0', root);
    const die = createDie({ flat: true });

    holder.hidden = true;
    holder.setAttribute('aria-hidden', 'true');
    holder.style.zIndex = String(Z_DIE);
    die.node.style.setProperty('--die', `calc(var(--c) * ${ DIE_SIZE })`);
    holder.append(die.node);

    const pawnOf = (state: Shown, key: string) => state.pawns.find((pawn) => pawn.key === key);

    const colourOf = (seat: number) => shown.pawns.find((pawn) => pawn.owner === seat)?.colour;

    const seatOf = (pawn: Pawn) => nest.get(pawn.key) ?? pawn.piece;

    const freeSlot = (pawn: Pawn) =>
    {
        const held = slot.get(pawn.key);

        if (held !== undefined)
        {
            return held;
        }

        const taken = new Set(shown.pawns.filter((one) => one.owner === pawn.owner).map((one) => slot.get(one.key)));

        return [0, 1, 2, 3].find((one) => !taken.has(one)) ?? 0;
    };

    const slotOf = (pawn: Pawn) =>
    {
        const free = freeSlot(pawn);

        slot.set(pawn.key, free);

        return free;
    };

    const cellOf = (pawn: Pawn) => placeOf(pawn.colour, Math.min(pawn.progress, FINISHED - 1), 0, 0);

    const placeFor = (pawn: Pawn) =>
    {
        if (pawn.progress === YARD)
        {
            return placeOf(pawn.colour, YARD, seatOf(pawn), 0);
        }

        return pawn.progress >= FINISHED && !pending.has(pawn.key) ? placeOf(pawn.colour, FINISHED, 0, slotOf(pawn)) : cellOf(pawn);
    };

    const spotOf = (state: Shown, pawn: Pawn): Spot =>
    {
        const place = placeFor(pawn);
        const base = foot(place.col, place.row);

        if (pawn.progress === YARD)
        {
            return { ...base, scale: 1, front: false };
        }

        if (pending.has(pawn.key))
        {
            return { ...base, scale: 1, front: true };
        }

        if (pawn.progress >= FINISHED)
        {
            return { ...base, scale: HOME_SCALE, front: false };
        }

        const around = state.pawns
            .filter((one) => one.progress !== YARD && one.progress < FINISHED && !pending.has(one.key))
            .filter((one) =>
            {
                const cell = cellOf(one);

                return cell.col === place.col && cell.row === place.row;
            })
            .sort((one, other) => one.owner - other.owner || one.piece - other.piece);
        const index = Math.max(0, around.findIndex((one) => one.key === pawn.key));
        const block = around.length === BLOCK.length && around.every((one) => one.side === pawn.side && one.progress < RING_STEPS);
        const stood = block ? BLOCK[index] : stackSpot(index, around.length);

        return { x: base.x + stood.dx * C, y: base.y + stood.dy * C, scale: stood.scale, front: block && stood.front === true };
    };

    const depthOf = (spot: Spot) => Z_PIECE + Math.round(spot.y * 10) + (spot.front ? FRONT : 0);

    const place = (piece: Piece, spot: Spot) =>
    {
        piece.at = spot;
        piece.root.style.translate = at(spot);
        piece.root.style.scale = String(spot.scale);
        piece.root.style.zIndex = String(depthOf(spot));
        piece.root.toggleAttribute('data-stacked', spot.front && !pending.has(piece.key));
    };

    const usable = (key: string) => movable.has(key) && !flying.has(key);

    const rover = () =>
    {
        if (roving === null || !usable(roving))
        {
            roving = shown.pawns.find((pawn) => usable(pawn.key))?.key ?? null;
        }

        return roving;
    };

    const goalFor = (key: string) =>
    {
        const own = goals.find((goal) => goal.key === key);
        const pawn = pawnOf(shown, key);

        if (own !== undefined || pawn === undefined || pawn.progress !== YARD || !movable.has(key))
        {
            return own;
        }

        return goals.find((goal) =>
        {
            const one = pawnOf(shown, goal.key);

            return one !== undefined && one.owner === pawn.owner && one.progress === YARD;
        });
    };

    const dress = (piece: Piece, pawn: Pawn) =>
    {
        const pressable = usable(pawn.key);

        piece.root.toggleAttribute('data-movable', hints && pressable);
        piece.root.toggleAttribute('data-home', pawn.progress >= FINISHED && !pending.has(pawn.key));

        if (pressable)
        {
            piece.hit.setAttribute('role', 'button');
            piece.hit.setAttribute('aria-label', goalFor(pawn.key)?.says ?? '');
            piece.hit.tabIndex = rover() === pawn.key ? 0 : -1;
        }
        else
        {
            piece.hit.removeAttribute('role');
            piece.hit.removeAttribute('aria-label');
            piece.hit.removeAttribute('tabindex');
        }
    };

    const mint = (pawn: Pawn) =>
    {
        const node = element('div', 'lp absolute inset-s-0 inset-bs-0 inline-0 block-0', root);
        const shadow = element('img', `lp-shadow ${ SPRITE } block [.lp[data-stacked]_&]:hidden inset-s-[calc(var(--c)*-0.753)] inset-bs-[calc(var(--c)*-0.2588)] inline-[calc(var(--c)*1.506)] block-[calc(var(--c)*0.753)] opacity-[0.6] origin-[50%_34.375%] ${ STILL }`, node);
        const ring = element('span', `lp-ring ${ SPRITE } hidden inset-s-[calc(var(--c)*-0.6)] inset-bs-[calc(var(--c)*-0.3)] inline-[calc(var(--c)*1.2)] block-[calc(var(--c)*0.6)] bg-[radial-gradient(closest-side,rgb(255_255_255/0.3),rgb(255_255_255/0.3)_40%,transparent_42%)] [.lp[data-movable]_&]:block`, node);
        const lift = element('span', `lp-lift absolute inset-s-0 inset-bs-0 ${ STILL } [.lb[data-still]_.lp[data-movable]_&]:[translate:0_calc(var(--c)*-0.06)]`, node);
        const body = element('img', `lp-pawn ${ SPRITE } block ${ PAWN_BOX } origin-[50%_77.73%] [.lp[data-movable]_&]:pointer-events-auto [.lp[data-movable]_&]:cursor-pointer [.lp[data-movable]:hover_&]:[filter:brightness(1.08)] ${ STILL }`, lift);

        shadow.src = '/board/pawn-shadow.svg';
        shadow.alt = '';
        shadow.decoding = 'async';
        body.src = `/board/pawn-${ pawn.colour }.svg`;
        body.alt = '';
        body.decoding = 'async';
        body.draggable = false;
        ring.innerHTML = RING;
        node.style.setProperty('--tone', TONE[pawn.colour] ?? '#FFFFFF');
        node.style.setProperty('--i', String(pawn.piece % 4));
        node.dataset.colour = pawn.colour;
        node.dataset.key = pawn.key;

        const piece: Piece = { key: pawn.key, root: node, lift, pawn: body, shadow, hit: element('span', 'lp-hit absolute', node), at: { x: 0, y: 0, scale: 1, front: false } };

        pieces.set(pawn.key, piece);

        return piece;
    };

    const tell = (out: readonly number[] = shown.out) =>
    {
        const home: Record<number, number> = {};

        for (const pawn of shown.pawns)
        {
            home[pawn.owner] = (home[pawn.owner] ?? 0) + (pawn.progress >= FINISHED && !pending.has(pawn.key) ? 1 : 0);
        }

        const facts = { home, out, die: plateDie, plate: where === 'plate' };
        const said = JSON.stringify(facts);

        if (said !== told)
        {
            told = said;
            options.onFacts?.(facts);
        }
    };

    const dressAll = () =>
    {
        for (const pawn of shown.pawns)
        {
            const piece = pieces.get(pawn.key);

            if (piece !== undefined)
            {
                dress(piece, pawn);
            }
        }
    };

    const markFor = (key: string) => marks.get(goalFor(key)?.key ?? '');

    const aimAt = (key: string | null) =>
    {
        if (key === aimed)
        {
            return;
        }

        for (const node of root.querySelectorAll('[data-aim]'))
        {
            node.removeAttribute('data-aim');
        }

        aimed = key;

        const drawn = key === null ? undefined : markFor(key);

        root.toggleAttribute('data-aiming', drawn !== undefined);

        if (key !== null)
        {
            pieces.get(key)?.root.setAttribute('data-aim', '');
        }

        if (drawn !== undefined)
        {
            drawn.root.setAttribute('data-aim', '');

            for (const step of drawn.steps)
            {
                step.setAttribute('data-aim', '');
            }
        }
    };

    const unmark = () =>
    {
        aimAt(null);

        for (const drawn of marks.values())
        {
            drawn.root.remove();

            for (const step of drawn.steps)
            {
                step.remove();
            }
        }

        for (const key of threatened)
        {
            pieces.get(key)?.root.removeAttribute('data-threat');
        }

        marks.clear();
        threatened.clear();
        marked = '';
    };

    const mark = () =>
    {
        const wanted = hints ? goals.flatMap((goal) =>
        {
            const pawn = pawnOf(shown, goal.key);

            return pawn !== undefined && movable.has(goal.key) && goal.to > pawn.progress ? [{ goal, pawn }] : [];
        }) : [];
        const said = wanted.map(({ goal, pawn }) => `${ goal.key }:${ pawn.progress }:${ goal.to }:${ goal.takes }`).join();

        if (said === marked)
        {
            return;
        }

        unmark();
        marked = said;

        for (const { goal, pawn } of wanted)
        {
            const home = goal.to >= FINISHED;
            const place = home ? placeOf(pawn.colour, FINISHED, 0, freeSlot(pawn)) : placeOf(pawn.colour, goal.to, 0, 0);
            const walked = goal.to - pawn.progress > TRAIL_MOST ? [] : pathBetween(pawn.colour, pawn.progress, goal.to);
            const steps = (home ? walked : walked.slice(0, -1)).map((cell) =>
            {
                const step = element('span', 'lg-step absolute inset-s-0 inset-bs-0', root);

                step.dataset.goal = goal.key;
                step.style.setProperty('--tone', TONE[pawn.colour] ?? '#FFFFFF');
                step.style.translate = at(foot(cell.col, cell.row));
                step.style.zIndex = String(Z_GOAL);

                return step;
            });
            const node = element('div', 'lg absolute inset-s-0 inset-bs-0 inline-0 block-0', root);

            node.dataset.goal = goal.key;
            node.dataset.colour = pawn.colour;
            node.toggleAttribute('data-takes', goal.takes > 0);
            node.toggleAttribute('data-home', home);
            node.style.setProperty('--tone', TONE[pawn.colour] ?? '#FFFFFF');
            node.style.setProperty('--s', String(home ? HOME_SCALE : 1));
            node.style.translate = at(foot(place.col, place.row));
            node.style.zIndex = String(Z_GOAL + 1);
            node.innerHTML = goal.takes > 0 ? BURST : SPOT;
            marks.set(goal.key, { root: node, steps, col: place.col, row: place.row });

            for (const other of goal.takes > 0 ? shown.pawns : [])
            {
                const stood = cellOf(other);

                if (other.side !== pawn.side && stood.col === place.col && stood.row === place.row)
                {
                    threatened.add(other.key);
                    pieces.get(other.key)?.root.setAttribute('data-threat', '');
                }
            }
        }
    };

    const rest = () =>
    {
        for (const pawn of shown.pawns)
        {
            const piece = pieces.get(pawn.key) ?? mint(pawn);

            if (!flying.has(pawn.key))
            {
                piece.root.removeAttribute('data-moving');
                place(piece, spotOf(shown, pawn));
            }

            dress(piece, pawn);
        }
    };

    const relayout = (ms: number, quiet: 'in' | 'skip') =>
    {
        const runs: Run[] = [];

        for (const pawn of shown.pawns)
        {
            const piece = pieces.get(pawn.key);

            if (piece === undefined || flying.has(pawn.key))
            {
                continue;
            }

            const from = piece.at;
            const to = spotOf(shown, pawn);

            dress(piece, pawn);

            if (Math.abs(from.x - to.x) < 0.01 && Math.abs(from.y - to.y) < 0.01 && from.scale === to.scale)
            {
                place(piece, to);
                continue;
            }

            place(piece, to);
            piece.root.style.zIndex = String(Math.max(depthOf(from), depthOf(to)) + 1);
            runs.push(stage.animate(piece.root, [
                { translate: at(from), scale: String(from.scale) },
                { translate: at(to), scale: String(to.scale) }
            ], { duration: ms, easing: 'cubic-bezier(0.2, 0.7, 0.3, 1)', quiet }));
            void runs[runs.length - 1].done.then(() =>
            {
                if (!flying.has(pawn.key))
                {
                    piece.root.style.zIndex = String(depthOf(piece.at));
                }
            });
        }

        return runs;
    };

    const fleeting = (node: HTMLElement, run: Run) =>
    {
        transient.add(node);
        void run.done.then(() =>
        {
            transient.delete(node);
            node.remove();
        });
    };

    const burst = (spot: Point, colour: string) =>
    {
        if (stage.quiet())
        {
            return;
        }

        const ring = element('span', 'absolute inset-s-0 inset-bs-0 inline-[calc(var(--c)*0.95)] block-[calc(var(--c)*0.475)] mbs-[calc(var(--c)*-0.2375)] ms-[calc(var(--c)*-0.475)] [border:calc(var(--c)*0.06)_solid_var(--tone)] rounded-[50%]', root);

        ring.style.translate = at(spot);
        ring.style.setProperty('--tone', colour);
        ring.style.zIndex = String(Z_PIECE + Math.round(spot.y * 10) + 5);
        fleeting(ring, stage.animate(ring, [{ scale: '0.37', opacity: 0.9 }, { scale: '1', opacity: 0 }], { duration: 280, easing: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)', fill: 'both' }));
    };

    const flash = (piece: Piece, colour: string) =>
    {
        if (stage.quiet())
        {
            return;
        }

        const white = element('img', `${ SPRITE } block ${ PAWN_BOX } [filter:brightness(0)_invert(1)]`, piece.lift);

        white.src = `/board/pawn-${ colour }.svg`;
        white.alt = '';
        fleeting(white, stage.animate(white, [{ opacity: 1 }, { opacity: 1, offset: 0.5 }, { opacity: 0 }], { duration: 140, fill: 'both' }));
    };

    const land = (piece: Piece) =>
    {
        stage.animate(piece.pawn, [{ scale: '1 1' }, { scale: '1.05 0.93' }, { scale: '1 1' }], { duration: 180, easing: 'ease-out', quiet: 'skip' });
    };

    const travel = (piece: Piece, pawn: Pawn, from: number, to: number) =>
    {
        const start: Point = { x: piece.at.x, y: piece.at.y };
        const scale = piece.at.scale;
        const stops = pathBetween(pawn.colour, from, to).map((cell) => foot(cell.col, cell.row));
        const end = stops[stops.length - 1];
        const sound = options.sound;

        if (end === undefined)
        {
            return null;
        }

        piece.root.setAttribute('data-moving', '');
        piece.root.removeAttribute('data-movable');
        piece.root.removeAttribute('data-stacked');
        piece.root.style.zIndex = String(Z_PIECE + Math.round(Math.max(start.y, ...stops.map((stop) => stop.y)) * 10) + AHEAD);
        piece.at = { ...end, scale: 1, front: true };
        piece.root.style.translate = at(end);
        piece.root.style.scale = '1';

        if (from === YARD)
        {
            const flight = arc(start, end, { duration: ENTER_MS, arch: 1 });
            const run = stage.animate(piece.root, flight.map((one) => ({ offset: Math.min(1, one.at / ENTER_MS), translate: at(one), scale: String(scale + (1 - scale) * one.progress) })), {
                duration: ENTER_MS,
                landed: () => sound()?.play('token-step', { pan: pan(end.x) })
            });

            stage.animate(piece.lift, flight.map((one) => ({ offset: Math.min(1, one.at / ENTER_MS), translate: `0 ${ cq(-0.9 * C * one.lift) }` })), { duration: ENTER_MS, quiet: 'skip' });
            stage.animate(piece.shadow, flight.map((one) => ({ offset: Math.min(1, one.at / ENTER_MS), scale: String(1 - 0.3 * one.lift) })), { duration: ENTER_MS, quiet: 'skip' });

            return run;
        }

        const each = stepOf(stops.length);
        const walked = walk([start, ...stops], { hops: stops.map((_, leg) => each * (leg === stops.length - 1 ? 1.15 : 1)), lifts: stops.map(() => 1) });
        const first = walked.lands[0];
        const last = stops.length - 1;
        const hopping = !stage.quiet();
        const run = stage.animate(piece.root, walked.steps.map((one) => ({
            offset: Math.min(1, one.at / walked.length),
            translate: at(one),
            scale: String(scale + (1 - scale) * Math.min(1, one.at / first))
        })), {
            duration: walked.length,
            landed: () => sound()?.play('token-step', hopping ? { pan: pan(end.x), rate: 0.92 + last * 0.03 } : { pan: pan(end.x) })
        });

        stage.animate(piece.lift, walked.steps.map((one) => ({ offset: Math.min(1, one.at / walked.length), translate: `0 ${ cq(-0.22 * C * one.lift) }` })), { duration: walked.length, quiet: 'skip' });
        stage.animate(piece.shadow, walked.steps.map((one) => ({ offset: Math.min(1, one.at / walked.length), scale: String(1 - 0.2 * one.lift) })), { duration: walked.length, quiet: 'skip' });

        if (hopping)
        {
            for (const [leg, landed] of walked.lands.slice(0, last).entries())
            {
                stage.after(landed, () => sound()?.play('token-step', { pan: pan(stops[leg].x), rate: 0.92 + leg * 0.03 }));
            }
        }

        return run;
    };

    const knock = (key: string, colour: string) =>
    {
        const pawn = pawnOf(shown, key);
        const piece = pieces.get(key);

        if (pawn === undefined || piece === undefined)
        {
            return null;
        }

        const from: Point = { x: piece.at.x, y: piece.at.y };
        const fromScale = piece.at.scale;
        const home = spotOf(shown, pawn);

        flying.add(key);
        burst(from, '#FFFFFF');
        flash(piece, colour);
        piece.root.setAttribute('data-moving', '');
        piece.root.removeAttribute('data-movable');
        piece.root.removeAttribute('data-stacked');
        piece.at = home;
        piece.root.style.translate = at(home);
        piece.root.style.scale = '1';
        piece.root.style.zIndex = String(Z_AIR);

        const flight = arc(from, home, { duration: KNOCK_MS, arch: 1 });
        const run = stage.animate(piece.root, flight.map((one) => ({
            offset: Math.min(1, one.at / KNOCK_MS),
            translate: at(one),
            rotate: `${ (one.progress * 360).toFixed(1) }deg`,
            scale: String(fromScale + (1 - fromScale) * one.progress + 0.2 * one.lift)
        })), { duration: KNOCK_MS });

        stage.animate(piece.lift, flight.map((one) => ({ offset: Math.min(1, one.at / KNOCK_MS), translate: `0 ${ cq(-1.1 * C * one.lift) }` })), { duration: KNOCK_MS, quiet: 'skip' });
        stage.animate(piece.shadow, [{ opacity: 0.6 }, { opacity: 0, offset: 0.23 }, { opacity: 0, offset: 0.77 }, { opacity: 0.6 }], { duration: KNOCK_MS, quiet: 'skip' });
        void run.done.then(() =>
        {
            flying.delete(key);
            piece.root.removeAttribute('data-moving');
            place(piece, home);
            stage.animate(piece.root, [{ scale: '0.9' }, { scale: '1' }], { duration: 160, easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)', quiet: 'skip' });
        });

        return run;
    };

    const stopDie = () =>
    {
        dieStop();
        dieStop = () => undefined;

        for (const run of dieRuns)
        {
            run.cancel();
        }

        dieRuns = [];
    };

    const clearDie = () =>
    {
        stopDie();
        holder.hidden = true;
        holder.removeAttribute('data-hand');
        holder.removeAttribute('data-rattle');
        die.node.removeAttribute('data-spent');
    };

    const putDie = (spot: Point, scale: number) =>
    {
        holder.style.translate = at(spot);
        holder.style.scale = String(scale);
        holder.hidden = false;
    };

    const shake = () =>
    {
        holder.setAttribute('data-rattle', '');
        holder.style.scale = String(LIFTED);
        dieRuns.push(stage.animate(holder, [{ scale: String(HAND) }, { scale: String(LIFTED) }], { duration: LIFT_MS, easing: 'ease-out', quiet: 'skip' }));
        options.sound()?.play('die-shake');
    };

    const toHand = () =>
    {
        clearDie();
        where = 'hand';
        die.show(HAND_FACE, HAND_SEED);
        putDie(CENTRE, HAND);
        holder.setAttribute('data-hand', '');
        dieRuns = [stage.animate(holder, [{ opacity: 0, scale: String(HAND * 0.8), offset: 0 }], { duration: HAND_MS, easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)' })];

        if (rattling)
        {
            shake();
        }
    };

    const rehome = () =>
    {
        if (where === 'none' && (offered !== null || rattling))
        {
            toHand();
        }
    };

    const seatDie = () =>
    {
        clearDie();
        plateDie = shown.die;
        where = plateDie === null ? 'none' : 'plate';

        if (plateDie !== null)
        {
            rattling = false;
        }

        rehome();
    };

    const pickUp = () =>
    {
        if (where !== 'board')
        {
            return;
        }

        const gone = { x: resting.x + outward[0] * DIE_LEAVE * C, y: resting.y + outward[1] * DIE_LEAVE * C };
        const run = stage.animate(holder, [
            { translate: at(resting), scale: '1', opacity: 1 },
            { translate: at(gone), scale: '0.7', opacity: 0 }
        ], { duration: PICKUP_MS, easing: 'cubic-bezier(0.5, 0, 0.9, 0.5)', fill: 'both', quiet: 'out' });

        where = 'leaving';
        dieRuns = [run];
        dieStop = stage.after(run.length, () =>
        {
            clearDie();
            where = plateDie === null ? 'none' : 'plate';
            tell();
            rehome();
        });
    };

    const dropDie = () =>
    {
        if (where === 'leaving')
        {
            return;
        }

        const lying = where === 'board';

        stopDie();

        if (!lying)
        {
            clearDie();
            where = 'none';
            rehome();

            return;
        }

        const run = stage.animate(holder, [{ opacity: 1, scale: '1' }, { opacity: 0, scale: '0.8' }], { duration: GONE_MS, fill: 'both', quiet: 'out' });

        where = 'leaving';
        dieRuns = [run];
        dieStop = stage.after(run.length, () =>
        {
            clearDie();
            where = 'none';
            rehome();
        });
    };

    const tumble = async (beat: Thrown, moment: Moment) =>
    {
        const reader = moment.sight.seat !== null && moment.sight.seat === beat.seat;
        const sound = options.sound;
        const colour = colourOf(beat.seat) ?? 'red';
        const inward = INWARD[colour] ?? INWARD.red;
        const spot = dieRest(colour);
        const held = reader && where === 'hand' ? (rattling ? LIFTED : HAND) : undefined;
        const release = held === undefined
            ? { x: -inward[0] * DIE_OUT / DIE_SIZE, y: -inward[1] * DIE_OUT / DIE_SIZE }
            : { x: (CENTRE.x - spot.x) / (DIE_SIZE * C), y: (CENTRE.y - spot.y) / (DIE_SIZE * C) };

        clearDie();

        if (reader)
        {
            rattling = false;
        }

        plateDie = null;
        where = 'air';
        resting = spot;
        outward = [-inward[0], -inward[1]];
        putDie(spot, 1);
        tell();

        const toss = die.toss(stage, moment.seed, beat.face, release, {
            held,
            impact: (power) => sound()?.play('die-land', { gain: 0.35 + 0.65 * power, pan: pan(spot.x) })
        });

        dieRuns = [toss];
        await toss.done;

        if (!moment.ctx.live())
        {
            return;
        }

        where = 'board';

        if (beat.fate === 'pending')
        {
            if (beat.face === 6)
            {
                sound()?.play('bonus');
            }

            plateDie = shown.die;
            tell();
            dieStop = stage.after(DIE_REST_MS, pickUp);

            return;
        }

        sound()?.play(beat.fate === 'three-sixes' ? 'deny' : (beat.fate === 'wasted' ? 'bonus' : 'pass'));

        if (reader && beat.fate === 'three-sixes')
        {
            options.feel('deny');
        }

        die.node.dataset.spent = beat.fate;
        dieRuns = [stage.animate(holder, [{ rotate: '0deg' }, { rotate: '-8deg' }, { rotate: '8deg' }, { rotate: '-8deg' }, { rotate: '8deg' }, { rotate: '0deg' }], { duration: SPENT_MS, quiet: 'skip' })];
        tell();
        options.onPass?.(beat.seat, beat.face, beat.fate);
        await moment.ctx.linger(moment.more ? PASS_LEAST : PASS_MS, PASS_LEAST);

        if (moment.ctx.live())
        {
            dropDie();
        }
    };

    const spend = () =>
    {
        if (plateDie === null && where !== 'board' && where !== 'plate')
        {
            return;
        }

        plateDie = null;
        dropDie();
    };

    const homeIn = async (pawn: Pawn, piece: Piece, reader: boolean) =>
    {
        const from = piece.at;

        pending.delete(pawn.key);

        const to = spotOf(shown, pawn);

        options.sound()?.play('home', { pan: pan(to.x) });

        if (reader)
        {
            options.feel('select');
        }

        flying.add(pawn.key);
        place(piece, to);
        piece.root.style.zIndex = String(Math.max(depthOf(from), depthOf(to)) + AHEAD);

        await stage.animate(piece.root, [
            { translate: at(from), scale: String(from.scale) },
            { translate: at(to), scale: String(to.scale) }
        ], { duration: HOME_MS, easing: 'cubic-bezier(0.22, 0.61, 0.36, 1)' }).done;

        flying.delete(pawn.key);
        place(piece, to);
        dress(piece, pawn);
        burst(to, '#E8C36A');
    };

    const journey = async (before: Shown, beat: Moved, moment: Moment) =>
    {
        const was = pawnOf(before, beat.key);
        const piece = pieces.get(beat.key);
        const after = step(before, beat);
        const pawn = pawnOf(after, beat.key);
        const seat = moment.sight.seat;
        const reader = seat !== null && seat === beat.seat;

        pressed.delete(beat.key);
        spend();

        if (was === undefined || piece === undefined || pawn === undefined)
        {
            shown = after;
            rest();
            tell();

            return;
        }

        shown = { ...before, die: null, pawns: before.pawns.map((one) => (one.key === beat.key ? pawn : one)) };

        if (was.progress !== beat.to)
        {
            pending.add(beat.key);
            flying.add(beat.key);
            relayout(PAIR_MS, 'skip');
            tell();

            const walked = travel(piece, was, was.progress, beat.to);

            if (walked !== null)
            {
                await walked.done;

                if (!moment.ctx.live())
                {
                    return;
                }

                land(piece);

                if (reader)
                {
                    options.feel('tick');
                }
            }

            flying.delete(beat.key);
            piece.root.removeAttribute('data-moving');
        }

        shown = after;

        if (beat.victims.length > 0)
        {
            options.sound()?.play('token-capture', { pan: pan(piece.at.x) });

            if (reader)
            {
                options.feel('capture');
            }
            else if (seat !== null && beat.victims.some((key) => pawnOf(after, key)?.owner === seat))
            {
                options.feel('hit');
            }
        }

        const flights = beat.victims.map((key) => knock(key, pawnOf(after, key)?.colour ?? 'red')).filter((run) => run !== null);

        if (beat.home)
        {
            await homeIn(pawn, piece, reader);
        }
        else
        {
            pending.delete(beat.key);
            relayout(PAIR_MS, 'skip');
        }

        tell();

        if (flights.length > 0)
        {
            await Promise.all(flights.map((run) => run.done));

            if (moment.ctx.live())
            {
                options.sound()?.play('token-yard', { pan: pan(pieces.get(beat.victims[0])?.at.x ?? 50) });
            }
        }
    };

    const applaud = async (winners: readonly string[], ctx: Ctx) =>
    {
        const said = winners.join();

        if (said === celebrated)
        {
            return;
        }

        celebrated = said;

        if (winners.length === 0)
        {
            return;
        }

        options.sound()?.play('win');

        const flecks = celebrate(stage, { host: root, tones: winners.map((winner) => TONE[winner] ?? '#FFFFFF'), layer: Z_BURST });

        for (const fleck of flecks)
        {
            transient.add(fleck);
        }

        if (flecks.length > 0)
        {
            await ctx.linger(WIN_MS, WIN_LEAST);
        }
    };

    const forget = (state: Shown) =>
    {
        for (const pawn of state.pawns)
        {
            if (pawn.progress < FINISHED)
            {
                slot.delete(pawn.key);
            }
        }
    };

    const perform = async (beat: Beat, moment: Moment) =>
    {
        const before = shown;

        if (beat.kind === 'roll')
        {
            shown = step(before, beat);
            await tumble(beat, moment);

            return;
        }

        if (beat.kind === 'move')
        {
            await journey(before, beat, moment);

            return;
        }

        shown = step(before, beat);

        if (before.die !== null && shown.die === null)
        {
            spend();
        }

        if (beat.kind === 'forfeit')
        {
            forget(shown);
            tell(before.out);

            if (beat.survives)
            {
                await Promise.all(relayout(SLIDE_MS, 'in').map((run) => run.done));
            }

            tell();

            return;
        }

        tell();
        await applaud(moment.sight.view.winners, moment.ctx);
    };

    const retreat = (key: string, stood: number) =>
    {
        const pawn = pawnOf(shown, key);
        const piece = pieces.get(key);

        if (pawn === undefined || piece === undefined)
        {
            return null;
        }

        const start: Point = { x: piece.at.x, y: piece.at.y };
        const scale = piece.at.scale;
        const home = spotOf(shown, pawn);
        const way = pawn.progress === YARD ? [] : pathBetween(pawn.colour, pawn.progress, stood).map((cell) => foot(cell.col, cell.row)).slice(0, -1).reverse();
        const stops: Point[] = [...way, home];

        flying.add(key);
        piece.root.setAttribute('data-moving', '');
        piece.root.removeAttribute('data-movable');
        piece.root.removeAttribute('data-stacked');
        piece.root.style.zIndex = String(Z_PIECE + Math.round(Math.max(start.y, ...stops.map((stop) => stop.y)) * 10) + AHEAD);
        piece.at = home;
        piece.root.style.translate = at(home);
        piece.root.style.scale = String(home.scale);

        let run: Run;

        if (pawn.progress === YARD)
        {
            const flight = arc(start, home, { duration: ENTER_MS, arch: 1 });

            stage.animate(piece.lift, flight.map((one) => ({ offset: Math.min(1, one.at / ENTER_MS), translate: `0 ${ cq(-0.9 * C * one.lift) }` })), { duration: ENTER_MS, quiet: 'skip' });
            run = stage.animate(piece.root, flight.map((one) => ({ offset: Math.min(1, one.at / ENTER_MS), translate: at(one), scale: String(scale + (home.scale - scale) * one.progress) })), { duration: ENTER_MS });
        }
        else
        {
            const walked = walk([start, ...stops], { hops: stops.map(() => STEP_LEAST), lifts: stops.map(() => 1) });

            stage.animate(piece.lift, walked.steps.map((one) => ({ offset: Math.min(1, one.at / walked.length), translate: `0 ${ cq(-0.22 * C * one.lift) }` })), { duration: walked.length, quiet: 'skip' });
            run = stage.animate(piece.root, walked.steps.map((one) => ({ offset: Math.min(1, one.at / walked.length), translate: at(one), scale: String(scale + (home.scale - scale) * Math.min(1, one.at / walked.length)) })), { duration: walked.length });
        }

        stage.after(run.length, () =>
        {
            flying.delete(key);
            piece.root.removeAttribute('data-moving');
            place(piece, spotOf(shown, pawn));
            dress(piece, pawn);
        });

        return run;
    };

    const mend = async (felt: Felt, ctx: Ctx) =>
    {
        const target = shownOf(felt);
        const moved = target.pawns.filter((pawn) => pawnOf(shown, pawn.key)?.progress !== pawn.progress).length;
        const died = (shown.die?.face ?? 0) !== (target.die?.face ?? 0) || (shown.die?.roller ?? -1) !== (target.die?.roller ?? -1);
        const refused = [...pressed].flatMap(([key, from]) =>
        {
            const stood = pawnOf(shown, key)?.progress;

            return stood !== undefined && stood !== from && pawnOf(target, key)?.progress === from && !flying.has(key) ? [[key, stood] as const] : [];
        });

        pressed.clear();
        pending.clear();
        shown = target;
        forget(shown);

        if (died)
        {
            seatDie();
        }

        tell();

        if (moved > SLIDE_MOST)
        {
            rest();
        }
        else
        {
            const back = refused.map(([key, stood]) => retreat(key, stood)).filter((run) => run !== null);

            if (back.length > 0)
            {
                options.sound()?.play('deny');
                options.feel('deny');
            }

            await Promise.all([...relayout(SLIDE_MS, 'in'), ...back].map((run) => run.done));
        }

        mark();

        if (ctx.live())
        {
            await applaud(felt.winners, ctx);
        }
    };

    const strip = () =>
    {
        clearDie();
        unmark();
        where = 'none';
        rattling = false;
        pressed.clear();

        for (const node of transient)
        {
            node.remove();
        }

        transient.clear();
        pending.clear();
        flying.clear();
    };

    const under = (event: PointerEvent) =>
    {
        const box = host.getBoundingClientRect();

        return aimNear(
            shown.pawns.map((pawn) => ({ key: pawn.key, ...placeFor(pawn), playable: movable.has(pawn.key) && !flying.has(pawn.key) })),
            [...marks].map(([key, one]) => ({ key, col: one.col, row: one.row })),
            event.clientX - box.left,
            event.clientY - box.top,
            box.width
        );
    };

    const pick = (event: PointerEvent) =>
    {
        const key = under(event);

        if (key !== null)
        {
            options.onPick?.(key, false);
        }
    };

    const hover = (event: PointerEvent) =>
    {
        aimAt(hints && event.pointerType === 'mouse' ? under(event) : null);
    };

    const leave = () => aimAt(null);

    const keyAt = (target: EventTarget | null) => (target instanceof HTMLElement && target.classList.contains('lp-hit') ? target.parentElement?.dataset.key ?? null : null);

    const hop = (from: string, pressed: string) =>
    {
        const keys = shown.pawns.filter((pawn) => usable(pawn.key)).map((pawn) => pawn.key);
        const at = keys.indexOf(from);

        if (pressed === 'Home')
        {
            return keys[0];
        }

        if (pressed === 'End')
        {
            return keys[keys.length - 1];
        }

        if (pressed === 'ArrowRight' || pressed === 'ArrowDown')
        {
            return keys[(at + 1) % keys.length];
        }

        return pressed === 'ArrowLeft' || pressed === 'ArrowUp' ? keys[(at - 1 + keys.length) % keys.length] : undefined;
    };

    root.addEventListener('focusin', (event) =>
    {
        const key = keyAt(event.target);

        if (key !== null)
        {
            roving = key;
            dressAll();
            aimAt(key);
        }
    });

    root.addEventListener('focusout', (event) =>
    {
        if (keyAt(event.target) !== null)
        {
            aimAt(null);
        }
    });

    root.addEventListener('keydown', (event) =>
    {
        const key = keyAt(event.target);

        if (key === null)
        {
            return;
        }

        if (event.key === 'Enter' || event.key === ' ')
        {
            event.preventDefault();
            options.onPick?.(key, true);

            return;
        }

        const next = hop(key, event.key);

        if (next !== undefined)
        {
            event.preventDefault();
            pieces.get(next)?.hit.focus({ preventScroll: true });
        }
    });

    root.addEventListener('click', (event) =>
    {
        const key = keyAt(event.target);

        if (key !== null && event.detail === 0)
        {
            options.onPick?.(key, true);
        }
    });

    host.addEventListener('pointerup', pick);
    host.addEventListener('pointermove', hover);
    host.addEventListener('pointerleave', leave);

    return {
        kind: 'ludo',

        history: HISTORY,

        reset(sight)
        {
            strip();

            if (sight.id !== matchId)
            {
                matchId = sight.id;
                nest.clear();
                slot.clear();
            }

            shown = shownOf(sight.view);
            forget(shown);
            celebrated = sight.view.winners.join();

            const keys = new Set(shown.pawns.map((pawn) => pawn.key));

            for (const [key, piece] of [...pieces])
            {
                if (!keys.has(key))
                {
                    piece.root.remove();
                    pieces.delete(key);
                }
            }

            rest();
            seatDie();
            tell();
            mark();
        },

        same: (sight) => sameAs(shown, sight.view) && pending.size === 0 && celebrated === sight.view.winners.join(),

        settle: (sight, ctx) => mend(sight.view, ctx),

        async play(acts, sight, ctx)
        {
            const beats = beatsOf(acts, sight.view);

            for (const [index, act] of beats.entries())
            {
                for (const beat of act)
                {
                    if (!ctx.live())
                    {
                        return;
                    }

                    await perform(beat, { sight, ctx, more: index < beats.length - 1, seed: hashOf(sight.id, acts[index].rev) });
                }
            }

            if (ctx.live() && !(sameAs(shown, sight.view) && pending.size === 0))
            {
                await mend(sight.view, ctx);
            }
        },

        estimate: (acts) => beatsOf(acts, WAITING).flat().reduce((sum, beat) => sum + costOf(beat), 0),

        offer(seat)
        {
            offered = seat;

            if (seat !== null)
            {
                rehome();
            }
            else if (where === 'hand' && !rattling)
            {
                clearDie();
                where = 'none';
            }
        },

        focus()
        {
            const key = rover();

            pieces.get(key ?? '')?.hit.focus({ preventScroll: true });

            return key !== null;
        },

        rattle(on)
        {
            if (rattling === on)
            {
                return;
            }

            rattling = on;

            if (where !== 'hand')
            {
                rehome();
            }
            else if (on)
            {
                shake();
            }
            else if (offered === null)
            {
                clearDie();
                where = 'none';
            }
            else
            {
                holder.removeAttribute('data-rattle');
                holder.style.scale = String(HAND);
            }
        },

        lit(keys, visible, wanted)
        {
            movable = keys;
            hints = visible;
            goals = wanted;
            dressAll();

            if (aimed !== null && !movable.has(aimed))
            {
                aimAt(null);
            }

            mark();
        },

        async advance(key, to)
        {
            const was = pawnOf(shown, key);
            const piece = pieces.get(key);

            if (was === undefined || piece === undefined || was.progress === to || flying.has(key))
            {
                return false;
            }

            unmark();
            spend();
            pressed.set(key, was.progress);
            shown = { ...shown, die: null, pawns: shown.pawns.map((pawn) => (pawn.key === key ? { ...pawn, progress: to } : pawn)) };
            pending.add(key);
            flying.add(key);
            dress(piece, was);
            relayout(PAIR_MS, 'skip');
            tell();

            const walked = travel(piece, was, was.progress, to);

            if (walked !== null)
            {
                await walked.done;
                land(piece);
                options.feel('tick');
            }

            flying.delete(key);
            piece.root.removeAttribute('data-moving');

            return true;
        },

        swap(tapped, moving)
        {
            const one = pawnOf(shown, tapped);
            const other = pawnOf(shown, moving);

            if (one === undefined || other === undefined || one.key === other.key || one.progress !== YARD || other.progress !== YARD || one.owner !== other.owner)
            {
                return;
            }

            const seat = seatOf(one);

            nest.set(one.key, seatOf(other));
            nest.set(other.key, seat);
            rest();
        },

        still(on)
        {
            root.toggleAttribute('data-still', on);
        },

        pause: () => root.setAttribute('data-paused', ''),

        resume: () => root.removeAttribute('data-paused'),

        dispose()
        {
            host.removeEventListener('pointerup', pick);
            host.removeEventListener('pointermove', hover);
            host.removeEventListener('pointerleave', leave);
            strip();
            pieces.clear();
            root.remove();
        }
    };
}
