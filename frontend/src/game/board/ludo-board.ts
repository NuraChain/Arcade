import { BLOCK, CELL, HOME_SCALE, MARGIN, pickNear, stackSpot } from '../layout.ts';
import { HISTORY, beatsOf, placeOf, sameAs, shownOf, step, type Beat, type Felt, type Pawn, type Rolled, type Shown } from '../ludo-felt.ts';
import { celebrate } from '../stage/celebrate.ts';
import { clamp } from '../stage/curves.ts';
import type { Ctx } from '../stage/director.ts';
import { LAYER } from '../stage/layers.ts';
import type { Sight } from '../stage/presenter.ts';
import { arc, walk, type Point } from '../stage/route.ts';
import type { Run } from '../stage/stage.ts';
import { FINISHED, RING_STEPS, YARD, pathBetween } from './path.ts';
import type { BoardHandle, BoardOptions } from '../bridge.ts';

const C = CELL * 100;

const DROP = 0.10;

const BAND = 2000;

const FRONT = 30;

const AHEAD = 50;

const Z_PIECE = LAYER.piece * BAND;

const Z_AIR = LAYER.airborne * BAND;

const Z_DIE = LAYER.dice * BAND;

const Z_GLOW = Z_DIE - 1;

const Z_BURST = LAYER.burst * BAND;

export const STEP_MS = 120;

export const STEP_LEAST = 95;

export const ENTER_MS = 360;

export const KNOCK_MS = 520;

export const HOME_MS = 220;

export const PAIR_MS = 160;

export const SLIDE_MS = 420;

export const TUMBLE_MS = 520;

export const SPENT_MS = 280;

export const PASS_MS = 900;

export const PASS_LEAST = 300;

export const DIE_REST_MS = 1100;

export const DIE_FADE_MS = 260;

export const WIN_MS = 1300;

export const WIN_LEAST = 700;

const SLIDE_MOST = 8;

const SWAPS = 7;

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
    at: Spot;
}

interface Moment
{
    sight: Sight<Felt>;
    ctx: Ctx;
    more: boolean;
}

type Moved = Extract<Beat, { kind: 'move' }>;

type Thrown = Extract<Beat, { kind: 'roll' }>;

const NOBODY: Shown = { pawns: [], out: [], die: null };

const WAITING: Felt = { pawns: [], out: [], die: { roller: 0, face: 6, fate: 'pending' }, winners: [] };

const cq = (value: number) => `${ value.toFixed(3) }cqi`;

const at = (spot: Point) => `${ cq(spot.x) } ${ cq(spot.y) }`;

const pan = (x: number) => clamp((x / 100 - 0.5) * 1.2, -0.6, 0.6);

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
        return beat.fate === 'pending' ? TUMBLE_MS : TUMBLE_MS + PASS_LEAST;
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

const SPRITE = 'absolute max-inline-none select-none [-webkit-user-drag:none]';

const STILL = '[.lb[data-still]_&]:animate-none';

const PAWN_BOX = 'inset-s-[calc(var(--c)*-0.8435)] inset-bs-[calc(var(--c)*-1.3114)] inline-[calc(var(--c)*1.687)] block-[calc(var(--c)*1.687)]';

const ROLLED = 'absolute inset-s-[50%] inset-bs-[50%] hidden [translate:-50%_-50%] [.lb[data-rolled]_&]:block';

export async function createLudoBoard(options: BoardOptions): Promise<BoardHandle>
{
    const { host, stage } = options;
    const root = element('div', 'lb absolute inset-0 overflow-hidden isolate pointer-events-none [&[data-paused]_*]:[animation-play-state:paused]', host);
    const pieces = new Map<string, Piece>();
    const nest = new Map<string, number>();
    const slot = new Map<string, number>();
    const pending = new Set<string>();
    const flying = new Set<string>();
    const transient = new Set<HTMLElement>();

    let shown: Shown = NOBODY;
    let matchId = '';
    let celebrated = '';
    let movable: ReadonlySet<string> = new Set();
    let hints = true;
    let plateDie: Rolled | null = null;
    let told = '';
    let dieRuns: Run[] = [];
    let dieStop: () => void = () => undefined;

    root.style.setProperty('--c', cq(C));
    root.toggleAttribute('data-still', stage.quiet());

    const glow = element('div', `${ ROLLED } inline-[calc(var(--c)*3)] block-[calc(var(--c)*3)] rounded-[50%] [background:radial-gradient(closest-side,color-mix(in_oklab,var(--tone,transparent)_45%,transparent),color-mix(in_oklab,var(--tone,transparent)_22%,transparent)_60%,transparent)]`, root);
    const die = element('div', `lb-die ${ ROLLED } inline-[19.12cqi] block-[19.12cqi] [background:url(/board/ludo-dice.svg)_calc(var(--face,0)*100%/7)_0/800%_100%_no-repeat] data-spent:opacity-[0.55] data-spent:[transition:opacity_200ms_var(--ease-ui)] data-[spent=three-sixes]:[filter:sepia(1)_saturate(4)_hue-rotate(-30deg)_brightness(0.95)]`, root);

    glow.style.zIndex = String(Z_GLOW);
    die.style.zIndex = String(Z_DIE);

    const pawnOf = (state: Shown, key: string) => state.pawns.find((pawn) => pawn.key === key);

    const colourOf = (seat: number) => shown.pawns.find((pawn) => pawn.owner === seat)?.colour;

    const seatOf = (pawn: Pawn) => nest.get(pawn.key) ?? pawn.piece;

    const slotOf = (pawn: Pawn) =>
    {
        const held = slot.get(pawn.key);

        if (held !== undefined)
        {
            return held;
        }

        const taken = new Set(shown.pawns.filter((one) => one.owner === pawn.owner).map((one) => slot.get(one.key)));
        const free = [0, 1, 2, 3].find((one) => !taken.has(one)) ?? 0;

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

    const dress = (piece: Piece, pawn: Pawn) =>
    {
        piece.root.toggleAttribute('data-movable', hints && movable.has(pawn.key) && !flying.has(pawn.key));
        piece.root.toggleAttribute('data-home', pawn.progress >= FINISHED && !pending.has(pawn.key));
    };

    const mint = (pawn: Pawn) =>
    {
        const node = element('div', 'lp absolute inset-s-0 inset-bs-0 inline-0 block-0', root);
        const shadow = element('img', `lp-shadow ${ SPRITE } block [.lp[data-stacked]_&]:hidden inset-s-[calc(var(--c)*-0.753)] inset-bs-[calc(var(--c)*-0.2588)] inline-[calc(var(--c)*1.506)] block-[calc(var(--c)*0.753)] opacity-[0.6] origin-[50%_34.375%] ${ STILL }`, node);
        const ring = element('span', `${ SPRITE } hidden inset-s-[calc(var(--c)*-0.6)] inset-bs-[calc(var(--c)*-0.3)] inline-[calc(var(--c)*1.2)] block-[calc(var(--c)*0.6)] bg-[radial-gradient(closest-side,rgb(255_255_255/0.3),rgb(255_255_255/0.3)_40%,transparent_42%)] [.lp[data-movable]_&]:block`, node);
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

        const piece: Piece = { key: pawn.key, root: node, lift, pawn: body, shadow, at: { x: 0, y: 0, scale: 1, front: false } };

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

        const facts = { home, out, die: plateDie };
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
            const run = stage.animate(piece.root, flight.map((one) => ({ offset: Math.min(1, one.at / ENTER_MS), translate: at(one), scale: String(scale + (1 - scale) * one.progress) })), { duration: ENTER_MS });

            stage.animate(piece.lift, flight.map((one) => ({ offset: Math.min(1, one.at / ENTER_MS), translate: `0 ${ cq(-0.9 * C * one.lift) }` })), { duration: ENTER_MS, quiet: 'skip' });
            stage.animate(piece.shadow, flight.map((one) => ({ offset: Math.min(1, one.at / ENTER_MS), scale: String(1 - 0.3 * one.lift) })), { duration: ENTER_MS, quiet: 'skip' });
            stage.after(run.length, () => sound()?.play('token-step', { pan: pan(end.x) }));

            return run;
        }

        const each = stepOf(stops.length);
        const walked = walk([start, ...stops], { hops: stops.map((_, leg) => each * (leg === stops.length - 1 ? 1.15 : 1)), lifts: stops.map(() => 1) });
        const first = walked.lands[0];
        const run = stage.animate(piece.root, walked.steps.map((one) => ({
            offset: Math.min(1, one.at / walked.length),
            translate: at(one),
            scale: String(scale + (1 - scale) * Math.min(1, one.at / first))
        })), { duration: walked.length });

        stage.animate(piece.lift, walked.steps.map((one) => ({ offset: Math.min(1, one.at / walked.length), translate: `0 ${ cq(-0.22 * C * one.lift) }` })), { duration: walked.length, quiet: 'skip' });
        stage.animate(piece.shadow, walked.steps.map((one) => ({ offset: Math.min(1, one.at / walked.length), scale: String(1 - 0.2 * one.lift) })), { duration: walked.length, quiet: 'skip' });

        if (stage.quiet())
        {
            stage.after(run.length, () => sound()?.play('token-step', { pan: pan(end.x) }));
        }
        else
        {
            for (const [leg, landed] of walked.lands.entries())
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

    const face = (value: number) =>
    {
        die.style.setProperty('--face', String(Math.min(Math.max(value, 1), 6) - 1));
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

    const hideDie = () =>
    {
        stopDie();
        root.removeAttribute('data-rolled');
        die.removeAttribute('data-spent');
    };

    const fadeDie = () =>
    {
        dieStop();
        dieStop = stage.after(DIE_REST_MS, () =>
        {
            dieRuns = [die, glow].map((one) => stage.animate(one, [{ opacity: 1 }, { opacity: 0 }], { duration: DIE_FADE_MS, fill: 'both', quiet: 'out' }));
            dieStop = stage.after(DIE_FADE_MS, hideDie);
        });
    };

    const layDie = (rolled: Rolled | null) =>
    {
        hideDie();

        if (rolled === null)
        {
            return;
        }

        face(rolled.face);
        glow.style.setProperty('--tone', TONE[colourOf(rolled.roller) ?? ''] ?? 'transparent');
        root.setAttribute('data-rolled', '');
        fadeDie();
    };

    const tumble = async (beat: Thrown, moment: Moment) =>
    {
        const reader = moment.sight.seat !== null && moment.sight.seat === beat.seat;
        const sound = options.sound;

        hideDie();
        plateDie = null;
        tell();
        sound()?.play('die-land');
        glow.style.setProperty('--tone', TONE[colourOf(beat.seat) ?? ''] ?? 'transparent');
        root.setAttribute('data-rolled', '');

        if (stage.quiet())
        {
            face(beat.face);
        }
        else
        {
            face((beat.face * 7) % 6 + 1);

            for (let swap = 1; swap <= SWAPS; swap += 1)
            {
                stage.after((TUMBLE_MS / SWAPS) * swap, () => face(swap >= SWAPS ? beat.face : (beat.face * 7 + swap * 3) % 6 + 1));
            }
        }

        const spin = stage.animate(die, [{ rotate: '0deg', scale: '1' }, { scale: '1.3', offset: 0.4 }, { rotate: '360deg', scale: '1' }], { duration: TUMBLE_MS, easing: 'cubic-bezier(0.22, 0.61, 0.36, 1)' });

        dieRuns = [spin, stage.animate(glow, [{ opacity: 0 }, { opacity: 0, offset: 0.7 }, { opacity: 1 }], { duration: TUMBLE_MS, quiet: 'skip' })];
        await spin.done;

        if (!moment.ctx.live())
        {
            return;
        }

        face(beat.face);

        if (beat.fate === 'pending')
        {
            if (beat.face === 6)
            {
                sound()?.play('bonus');
            }

            plateDie = shown.die;
            tell();
            fadeDie();

            return;
        }

        sound()?.play(beat.fate === 'three-sixes' ? 'deny' : (beat.fate === 'wasted' ? 'bonus' : 'pass'));

        if (reader && beat.fate === 'three-sixes')
        {
            options.feel('deny');
        }

        die.setAttribute('data-spent', beat.fate);
        dieRuns.push(stage.animate(die, [{ rotate: '0deg' }, { rotate: '-8deg' }, { rotate: '8deg' }, { rotate: '-8deg' }, { rotate: '8deg' }, { rotate: '0deg' }], { duration: SPENT_MS, quiet: 'skip' }));
        await moment.ctx.linger(moment.more ? PASS_LEAST : PASS_MS, PASS_LEAST);

        if (moment.ctx.live())
        {
            fadeDie();
        }
    };

    const spend = () =>
    {
        if (plateDie !== null || root.hasAttribute('data-rolled'))
        {
            plateDie = null;
            hideDie();
        }
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

    const mend = async (felt: Felt, ctx: Ctx) =>
    {
        const target = shownOf(felt);
        const moved = target.pawns.filter((pawn) => pawnOf(shown, pawn.key)?.progress !== pawn.progress).length;
        const died = (shown.die?.face ?? 0) !== (target.die?.face ?? 0) || (shown.die?.roller ?? -1) !== (target.die?.roller ?? -1);

        pending.clear();
        shown = target;
        forget(shown);

        if (died)
        {
            plateDie = shown.die;
            layDie(shown.die);
        }

        tell();

        if (moved > SLIDE_MOST)
        {
            rest();
        }
        else
        {
            await Promise.all(relayout(SLIDE_MS, 'in').map((run) => run.done));
        }

        if (ctx.live())
        {
            await applaud(felt.winners, ctx);
        }
    };

    const strip = () =>
    {
        hideDie();

        for (const node of transient)
        {
            node.remove();
        }

        transient.clear();
        pending.clear();
        flying.clear();
    };

    const pick = (event: PointerEvent) =>
    {
        const box = host.getBoundingClientRect();
        const key = pickNear(shown.pawns.map((pawn) => ({ key: pawn.key, ...placeFor(pawn), playable: movable.has(pawn.key) && !flying.has(pawn.key) })), event.clientX - box.left, event.clientY - box.top, box.width);

        if (key !== null)
        {
            options.onPick?.(key);
        }
    };

    host.addEventListener('pointerup', pick);

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
            plateDie = shown.die;
            layDie(shown.die);
            tell();
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

                    await perform(beat, { sight, ctx, more: index < beats.length - 1 });
                }
            }

            if (ctx.live() && !(sameAs(shown, sight.view) && pending.size === 0))
            {
                await mend(sight.view, ctx);
            }
        },

        estimate: (acts) => beatsOf(acts, WAITING).flat().reduce((sum, beat) => sum + costOf(beat), 0),

        lit(keys, visible)
        {
            movable = keys;
            hints = visible;
            dressAll();
        },

        async advance(key, to)
        {
            const was = pawnOf(shown, key);
            const piece = pieces.get(key);

            if (was === undefined || piece === undefined || was.progress === to || flying.has(key))
            {
                return false;
            }

            spend();
            shown = { ...shown, die: null, pawns: shown.pawns.map((pawn) => (pawn.key === key ? { ...pawn, progress: to } : pawn)) };
            pending.add(key);
            flying.add(key);
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
            strip();
            pieces.clear();
            root.remove();
        }
    };
}
