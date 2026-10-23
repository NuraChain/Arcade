import { SIZE, SQUARE, coordinatesOf, spotOf, type Foot } from '../chess-layout.ts';
import { boardOf, checkOf, passedOf, rookOf, step, type Felt, type Man, type Told } from '../chess-felt.ts';
import { colourOf, kindOf, pieceOf, type Colour, type Kind, type Piece } from '../../../../backend/src/domains/match/chess/board.ts';
import { clamp } from '../stage/curves.ts';
import { LAYER, layered } from '../stage/layers.ts';
import type { Table } from '../stage/presenter.ts';
import { arc, type Point } from '../stage/route.ts';
import type { Run, Stage } from '../stage/stage.ts';
import { endCue, type Cue, type SoundHandle } from '../sound.ts';
import type { Haptic } from '../../lib/haptics.ts';

/** What the table is told to show: the felt, whose colour stands at the foot, and a king mated on it. */
export interface Lay extends Felt
{
    foot: Foot;
    mated: Colour | null;
}

/** What the table has shown, for everything beside it that reports an outcome: the trays, the lead, the turn. */
export interface ChessFacts
{
    men: readonly Man[];
    turn: Colour;
    check: number | null;
    played: Told | null;
}

export interface ChessOptions
{
    host: HTMLElement;
    stage: Stage;
    sound: () => SoundHandle | null;
    animals: () => boolean;
    feel: (kind: Haptic) => void;
    onFacts?: (facts: ChessFacts) => void;
}

export interface ChessTable extends Table<Lay, Told>
{
    advance(told: Told): Promise<boolean>;
    hold(square: number | null): void;
    aim(targets: ReadonlyMap<number, boolean>): void;
    hover(square: number | null): void;
    grab(square: number): boolean;
    drag(x: number, y: number): void;
    release(refused: boolean): void;
    dispose(): void;
}

export const HISTORY = 4000;

export const GLIDE_LEAST = 170;

export const GLIDE_MOST = 380;

export const KNIGHT_MS = 300;

export const ROOK_MS = 300;

export const TAKE_MS = 170;

export const PROMOTE_MS = 280;

export const TIP_MS = 560;

export const MEND_MS = 260;

const GLIDE_BASE = 120;

const GLIDE_PACE = 0.3;

const GLIDE_EASE = 'cubic-bezier(0.22, 0.61, 0.36, 1)';

const KNIGHT_ARCH = 0.3;

const ROOK_ARCH = 0.45;

const ROOK_LAG = 0.4;

const CONTACT = 0.82;

/** The two pieces Persian names for animals, the knight a horse (اسب) and the bishop an elephant (فیل): each is set down as one, and calls as it takes. */
const ANIMALS: Partial<Record<Kind, { step: Cue; call: Cue }>> = {
    n: { step: 'horse-step', call: 'horse-call' },
    b: { step: 'elephant-step', call: 'elephant-call' }
};

const DROP_BASE = 70;

const DROP_PACE = 0.4;

const DROP_MOST = 200;

const BACK_MS = 220;

const SET_DOWN = 'cubic-bezier(0.2, 0.7, 0.3, 1)';

const QUIET_MOST = 10;

const cq = (units: number) => `${ (units / SIZE * 100).toFixed(3) }cqw`;

const at = (point: Point) => `${ cq(point.x) } ${ cq(point.y) }`;

const pan = (point: Point) => clamp((point.x / SIZE - 0.5) * 1.2, -0.6, 0.6);

const nameOf = (piece: Piece) => `${ colourOf(piece) }${ kindOf(piece) }`;

const make = (name: string, parent: HTMLElement) =>
{
    const made = document.createElement('span');

    made.className = name;
    parent.append(made);

    return made;
};

/** How long a logged move takes to show, from its first frame to the piece at rest. */
export function costOf(told: Told)
{
    if (told.e === 'finish')
    {
        return told.reason === 'checkmate' ? TIP_MS : 0;
    }

    if (told.e !== 'move')
    {
        return 0;
    }

    const travel = told.piece !== undefined && kindOf(told.piece) === 'n' ? KNIGHT_MS : GLIDE_MOST;
    const rook = told.castle === undefined ? 0 : ROOK_MS * (1 - ROOK_LAG);

    return travel + rook + (told.promotion === undefined ? 0 : PROMOTE_MS);
}

/**
 * The pieces as the board places them, keyed for their lives: what stays on its square stays, a
 * piece that moved slides from where it stood, and only what cannot be explained comes or goes.
 */
function matched(shown: readonly Man[], target: readonly Man[], serial: number)
{
    const free = new Set(shown);
    const kept: Man[] = [];
    const moved: { man: Man; from: number }[] = [];
    const born: Man[] = [];
    const wanted: Man[] = [];
    let made = serial;

    for (const goal of target)
    {
        const there = [...free].find((man) => man.square === goal.square && man.piece === goal.piece);

        if (there === undefined)
        {
            wanted.push(goal);
        }
        else
        {
            free.delete(there);
            kept.push(there);
        }
    }

    for (const goal of wanted)
    {
        const near = [...free]
            .filter((man) => man.piece === goal.piece)
            .sort((one, two) => Math.abs(one.square - goal.square) - Math.abs(two.square - goal.square))[0];

        if (near === undefined)
        {
            made += 1;
            born.push({ key: `${ goal.piece }+${ made }`, piece: goal.piece, square: goal.square });
        }
        else
        {
            free.delete(near);
            moved.push({ man: { ...near, square: goal.square }, from: near.square });
        }
    }

    return { men: [...kept, ...moved.map((one) => one.man), ...born], moved, born, gone: [...free], serial: made };
}

export function createChessTable(options: ChessOptions): ChessTable
{
    const { host, stage } = options;
    const els = new Map<string, HTMLElement>();
    const aims = new Map<number, HTMLElement>();
    const flying = new Set<string>();
    const lastMarks = [make('cmk', host), make('cmk', host)];
    const checkMark = make('cmk', host);
    const heldMark = make('cmk', host);
    const overMark = make('cmk', host);
    const labels: HTMLElement[] = [];
    let shown: Lay = { men: [], last: null, turn: 'w', foot: 'w', mated: null };
    let toMove: Colour = 'w';
    let played: Told | null = null;
    let serial = 0;
    let held: number | null = null;
    let carried: { key: string; x: number; y: number } | null = null;
    let returning: Run | null = null;
    let labelled: Foot | null = null;

    for (const mark of lastMarks)
    {
        mark.dataset.kind = 'last';
    }

    checkMark.dataset.kind = 'check';
    heldMark.dataset.kind = 'held';
    overMark.dataset.kind = 'over';
    layered(host);
    host.style.setProperty('--sq', cq(SQUARE));

    const spot = (square: number) => spotOf(square, shown.foot);

    const place = (el: HTMLElement, square: number | null) =>
    {
        el.hidden = square === null;

        if (square !== null)
        {
            el.style.translate = at(spot(square));
        }
    };

    const ensure = (man: Man, piece = man.piece) =>
    {
        let el = els.get(man.key);

        if (el === undefined)
        {
            el = make('cp', host);
            el.dataset.key = man.key;
            els.set(man.key, el);
        }

        el.dataset.piece = nameOf(piece);

        return el;
    };

    const tipped = (man: Man) => shown.mated !== null && man.piece === pieceOf(shown.mated, 'k');

    const rest = (man: Man) =>
    {
        const el = ensure(man);

        el.removeAttribute('data-gone');
        el.style.translate = at(spot(man.square));
        el.toggleAttribute('data-tipped', tipped(man));

        if (!flying.has(man.key))
        {
            el.style.zIndex = String(LAYER.piece);
        }

        return el;
    };

    const tell = () =>
    {
        options.onFacts?.({ men: shown.men, turn: toMove, check: checkOf({ men: shown.men, turn: toMove }), played });
    };

    const marks = () =>
    {
        const last = shown.last;

        place(lastMarks[0], last?.from ?? null);
        place(lastMarks[1], last?.to ?? null);
        place(checkMark, checkOf(shown));
        place(heldMark, held);
    };

    const label = () =>
    {
        if (labelled === shown.foot)
        {
            return;
        }

        for (const old of labels)
        {
            old.remove();
        }

        labels.length = 0;

        const { files, ranks } = coordinatesOf(shown.foot);

        for (const mark of [...files, ...ranks])
        {
            const el = make('cco', host);

            el.textContent = mark.label;
            el.style.left = cq(mark.x);
            el.style.top = cq(mark.y);
            labels.push(el);
        }

        labelled = shown.foot;
    };

    const prune = () =>
    {
        const alive = new Set(shown.men.map((man) => man.key));

        for (const [key, el] of els)
        {
            if (!alive.has(key) && !el.hasAttribute('data-gone'))
            {
                el.remove();
                els.delete(key);
            }
        }
    };

    const redraw = () =>
    {
        flying.clear();
        prune();

        for (const man of shown.men)
        {
            rest(man);
        }

        label();
        marks();
        tell();
    };

    const glide = (el: HTMLElement, from: Point, to: Point, knight: boolean, delay = 0, landed?: () => void) =>
    {
        const span = Math.hypot(to.x - from.x, to.y - from.y);

        el.style.zIndex = String(LAYER.moving);

        if (knight)
        {
            return stage.animate(el, arc(from, to, { duration: KNIGHT_MS, arch: KNIGHT_ARCH }).map((one) => ({
                offset: one.at / KNIGHT_MS,
                translate: at(one),
                scale: (1 + one.lift * 0.6).toFixed(3)
            })), { duration: KNIGHT_MS, delay, landed });
        }

        const duration = clamp(GLIDE_BASE + span * GLIDE_PACE, GLIDE_LEAST, GLIDE_MOST);

        return stage.animate(el, [
            { offset: 0, translate: at(from), scale: '1' },
            { offset: 0.5, scale: '1.05' },
            { offset: 1, translate: at(to), scale: '1' }
        ], { duration, delay, easing: GLIDE_EASE, landed });
    };

    const hop = (el: HTMLElement, from: Point, to: Point, delay: number, landed?: () => void) =>
    {
        el.style.zIndex = String(LAYER.airborne);

        return stage.animate(el, arc(from, to, { duration: ROOK_MS, arch: ROOK_ARCH }).map((one) => ({
            offset: one.at / ROOK_MS,
            translate: at(one),
            scale: (1 + one.lift * 0.5).toFixed(3)
        })), { duration: ROOK_MS, delay, landed });
    };

    const setDown = (el: HTMLElement, from: Point, to: Point, base: number, pace: number, most: number, landed?: () => void) =>
    {
        el.style.zIndex = String(LAYER.moving);

        return stage.animate(el, [
            { offset: 0, translate: at(from), scale: '1.18' },
            { offset: 1, translate: at(to), scale: '1' }
        ], { duration: clamp(base + Math.hypot(to.x - from.x, to.y - from.y) * pace, base, most), easing: SET_DOWN, landed });
    };

    const take = (man: Man, delay: number) =>
    {
        const el = els.get(man.key);

        if (el === undefined)
        {
            return;
        }

        el.dataset.gone = '';
        el.style.zIndex = String(LAYER.piece);

        const run = stage.animate(el, [
            { offset: 0, opacity: 1, scale: '1' },
            { offset: 0.35, opacity: 1, scale: '1.08' },
            { offset: 1, opacity: 0, scale: '0.55' }
        ], { duration: TAKE_MS, delay, quiet: 'out' });

        void run.done.then(() =>
        {
            if (els.get(man.key) === el && !shown.men.some((one) => one.key === man.key))
            {
                el.remove();
                els.delete(man.key);
            }
        });
    };

    const letGo = (key: string): Point | null =>
    {
        returning?.cancel();
        returning = null;

        if (carried === null || carried.key !== key)
        {
            return null;
        }

        const from = { x: carried.x - SQUARE / 2, y: carried.y - SQUARE / 2 };

        carried = null;
        els.get(key)?.removeAttribute('data-carried');

        return from;
    };

    const promote = async (man: Man) =>
    {
        const el = ensure(man, pieceOf(colourOf(man.piece), 'p'));
        const run = stage.animate(el, [
            { offset: 0, scale: '1' },
            { offset: 0.42, scale: '1.28' },
            { offset: 1, scale: '1' }
        ], { duration: PROMOTE_MS, easing: 'cubic-bezier(0.3, 1.4, 0.5, 1)', quiet: 'skip' });

        stage.after(stage.quiet() ? 0 : PROMOTE_MS * 0.42, () =>
        {
            ensure(man);
            options.sound()?.play('promote');
        });

        await run.done;
        ensure(man);
    };

    const tip = async (colour: Colour) =>
    {
        const king = shown.men.find((man) => man.piece === pieceOf(colour, 'k'));
        const el = king === undefined ? undefined : els.get(king.key);

        shown = { ...shown, mated: colour };

        if (king === undefined || el === undefined)
        {
            return;
        }

        el.dataset.tipped = '';

        await stage.animate(el, [
            { offset: 0, rotate: '0deg' },
            { offset: 0.7, rotate: '-84deg' },
            { offset: 1, rotate: '-76deg' }
        ], { duration: TIP_MS, easing: 'cubic-bezier(0.45, 0, 0.55, 1)' }).done;

        options.sound()?.play('king-fall', { gain: 0.8 });
    };

    /** One logged move, played from where the table shows it: the piece travels, and whatever it takes goes as it arrives. */
    const perform = async (move: Told, seat: number | null = null) =>
    {
        if (move.e === 'finish')
        {
            if (move.reason === 'checkmate')
            {
                await tip(toMove);
            }

            const sting = endCue(move.reason === 'abort' ? 'void' : seat === null ? undefined : move.winner === undefined ? 'drawn' : move.winner === seat ? 'won' : 'lost');

            if (sting !== null)
            {
                options.sound()?.play(sting);
            }

            return true;
        }

        if (move.e !== 'move' || move.from === undefined || move.to === undefined)
        {
            return true;
        }

        const before = shown;
        const mover = before.men.find((man) => man.square === move.from);

        if (mover === undefined)
        {
            return false;
        }

        const colour = colourOf(mover.piece);
        const takenAt = move.enPassant === true ? passedOf(move.to, colour) : (move.captured === undefined ? null : move.to);
        const victim = takenAt === null ? undefined : before.men.find((man) => man.square === takenAt && man !== mover);
        const rook = move.castle === undefined ? null : rookOf(move.to, move.castle);
        const rookMan = rook === null ? undefined : before.men.find((man) => man.square === rook.from);
        const next = step(before, move);
        const arrived = next.men.find((man) => man.key === mover.key) ?? mover;
        const landing = spot(move.to);
        const promoted = move.promotion !== undefined;
        const animal = options.animals() ? ANIMALS[kindOf(mover.piece)] : undefined;

        shown = { ...shown, men: next.men, last: next.last, turn: next.turn };
        held = null;
        flying.add(mover.key);

        const el = ensure(arrived, promoted ? mover.piece : arrived.piece);
        const from = letGo(mover.key);
        const click = () => options.sound()?.play(animal?.step ?? 'piece-move', { pan: pan(landing), rate: victim === undefined || animal !== undefined ? 1 : 0.9 });
        const run = from === null
            ? glide(el, spot(move.from), landing, kindOf(mover.piece) === 'n', 0, click)
            : setDown(el, from, landing, DROP_BASE, DROP_PACE, DROP_MOST, click);

        el.removeAttribute('data-held');
        el.style.translate = at(landing);
        place(lastMarks[0], move.from);
        place(lastMarks[1], move.to);
        place(heldMark, null);
        place(checkMark, null);
        clearAims();

        if (victim !== undefined)
        {
            const contact = run.length * CONTACT;

            take(victim, contact);
            stage.after(contact, () =>
            {
                options.sound()?.play('piece-capture', { pan: pan(landing) });

                if (animal !== undefined)
                {
                    options.sound()?.play(animal.call, { pan: pan(landing) });
                }

                options.feel(colour === shown.foot ? 'capture' : 'hit');
            });
        }

        let rookRun: Run | null = null;

        if (rook !== null && rookMan !== undefined)
        {
            const moved = next.men.find((man) => man.key === rookMan.key) ?? { ...rookMan, square: rook.to };
            const rookEl = ensure(moved);

            flying.add(rookMan.key);
            rookRun = hop(rookEl, spot(rook.from), spot(rook.to), run.length * ROOK_LAG, () => options.sound()?.play('piece-move', { pan: pan(spot(rook.to)), rate: 0.92 }));
            rookEl.style.translate = at(spot(rook.to));
        }

        await run.done;
        flying.delete(mover.key);

        if (promoted)
        {
            await promote(arrived);
        }

        if (rookRun !== null && rookMan !== undefined)
        {
            await rookRun.done;
            flying.delete(rookMan.key);
        }

        toMove = shown.turn;
        played = move;
        prune();

        for (const man of shown.men)
        {
            rest(man);
        }

        const check = checkOf(shown);

        place(checkMark, check);

        if (check !== null)
        {
            options.sound()?.play('check');
        }

        tell();

        return true;
    };

    /** The table slid to a board it was told nothing about: no sound, and nothing taken. */
    const mend = async (lay: Lay) =>
    {
        const plan = matched(lay.foot === shown.foot ? shown.men : [], lay.men, serial);

        serial = plan.serial;
        shown = { ...lay, men: plan.men };
        toMove = lay.turn;
        held = null;
        returning?.cancel();
        returning = null;
        carried = null;

        if (lay.foot !== labelled || plan.moved.length + plan.born.length + plan.gone.length > QUIET_MOST)
        {
            redraw();

            return;
        }

        for (const gone of plan.gone)
        {
            take(gone, 0);
        }

        for (const man of plan.born)
        {
            rest(man);
            stage.animate(ensure(man), [{ offset: 0, opacity: 0 }], { duration: MEND_MS });
        }

        await Promise.all(plan.moved.map(async ({ man, from }) =>
        {
            const el = ensure(man);

            flying.add(man.key);
            el.style.translate = at(spot(man.square));
            el.style.zIndex = String(LAYER.moving);

            await stage.animate(el, [
                { offset: 0, translate: at(spot(from)) },
                { offset: 1, translate: at(spot(man.square)) }
            ], { duration: MEND_MS, easing: GLIDE_EASE }).done;

            flying.delete(man.key);
        }));

        for (const man of shown.men)
        {
            rest(man);
        }

        marks();
        tell();
    };

    const clearAims = () =>
    {
        for (const mark of aims.values())
        {
            mark.remove();
        }

        aims.clear();
        place(overMark, null);
    };

    const strip = () =>
    {
        for (const el of els.values())
        {
            el.remove();
        }

        els.clear();
        flying.clear();
        clearAims();
        returning?.cancel();
        returning = null;
        carried = null;
        held = null;
    };

    return {
        kind: 'chess',

        history: HISTORY,

        reset(sight)
        {
            strip();
            shown = { ...sight.view, men: [...sight.view.men] };
            toMove = shown.turn;
            played = null;
            redraw();
        },

        same: (sight) =>
            sight.view.foot === shown.foot
            && boardOf(sight.view.men) === boardOf(shown.men)
            && sight.view.turn === shown.turn
            && sight.view.mated === shown.mated
            && sight.view.last?.from === shown.last?.from
            && sight.view.last?.to === shown.last?.to,

        settle: (sight) => mend(sight.view),

        async play(acts, sight, ctx)
        {
            for (const act of acts)
            {
                for (const move of act.moves)
                {
                    if (!ctx.live())
                    {
                        return;
                    }

                    if (!(await perform(move, sight.seat)))
                    {
                        await mend(sight.view);

                        return;
                    }
                }
            }

            if (ctx.live())
            {
                await mend(sight.view);
            }
        },

        estimate: (acts) => acts.reduce((total, act) => act.moves.reduce((sum, move) => sum + costOf(move), total), 0),

        advance: (move) => perform(move),

        hold(square)
        {
            const before = held === null ? undefined : shown.men.find((man) => man.square === held);

            if (before !== undefined)
            {
                els.get(before.key)?.removeAttribute('data-held');
            }

            held = square;

            const now = square === null ? undefined : shown.men.find((man) => man.square === square);

            if (now !== undefined && !flying.has(now.key))
            {
                els.get(now.key)?.setAttribute('data-held', '');
            }

            place(heldMark, square);
        },

        aim(targets)
        {
            clearAims();

            for (const [square, takes] of targets)
            {
                const mark = make('cmk', host);

                mark.dataset.kind = takes ? 'take' : 'aim';
                place(mark, square);
                aims.set(square, mark);
            }
        },

        hover(square)
        {
            place(overMark, square !== null && aims.has(square) ? square : null);
        },

        grab(square)
        {
            const man = carried === null ? shown.men.find((one) => one.square === square) : undefined;

            if (man === undefined || flying.has(man.key))
            {
                return false;
            }

            const el = ensure(man);
            const corner = spot(square);

            returning?.cancel();
            returning = null;
            carried = { key: man.key, x: corner.x + SQUARE / 2, y: corner.y + SQUARE / 2 };
            el.dataset.carried = '';
            el.style.zIndex = String(LAYER.airborne);

            return true;
        },

        drag(x, y)
        {
            const el = carried === null ? undefined : els.get(carried.key);

            if (carried === null || el === undefined)
            {
                return;
            }

            carried.x = clamp(x, SQUARE / 2, SIZE - SQUARE / 2);
            carried.y = clamp(y, SQUARE / 2, SIZE - SQUARE / 2);
            el.style.translate = at({ x: carried.x - SQUARE / 2, y: carried.y - SQUARE / 2 });
        },

        release(refused)
        {
            const lifted = carried;
            const man = lifted === null ? undefined : shown.men.find((one) => one.key === lifted.key);

            place(overMark, null);

            if (lifted === null || man === undefined)
            {
                return;
            }

            if (refused)
            {
                options.sound()?.play('deny', { gain: 0.5 });
                options.feel('deny');
            }

            carried = null;

            const el = ensure(man);
            const from = { x: lifted.x - SQUARE / 2, y: lifted.y - SQUARE / 2 };

            el.removeAttribute('data-carried');
            el.style.translate = at(spot(man.square));

            const run = stage.animate(el, [
                { offset: 0, translate: at(from), scale: '1.18' },
                { offset: 1, translate: at(spot(man.square)), scale: '1' }
            ], { duration: BACK_MS, easing: SET_DOWN });

            returning = run;
            void run.done.then(() =>
            {
                if (returning === run)
                {
                    returning = null;
                    rest(man);
                }
            });
        },

        dispose()
        {
            strip();

            for (const el of [...lastMarks, checkMark, heldMark, overMark, ...labels])
            {
                el.remove();
            }
        }
    };
}
