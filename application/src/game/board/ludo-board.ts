import { CELL, HOME_SCALE, MARGIN, pickNear, stackSpot } from '../layout.ts';
import { createSound, type SoundHandle } from '../sound.ts';
import { FINISHED, YARD, pathBetween, type LudoColour } from './path.ts';
import type { BoardHandle, BoardOptions, BoardToken, BoardView } from '../bridge.ts';

const C = CELL * 100;

const DROP = 0.10;

const STEP_MS = 120;

const FLIGHT_MS = 520;

const TUMBLE_MS = 520;

const DIE_HOLD_MS = 1100;

const CONFETTI = 28;

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
}

interface Piece
{
    token: BoardToken;
    root: HTMLElement;
    lift: HTMLElement;
    pawn: HTMLImageElement;
    shadow: HTMLImageElement;
    walk: number;
    moving: boolean;
    timers: number[];
}

const EMPTY: BoardView = { tokens: [], die: null, turn: null, yours: false, winner: null };

const order = (key: string): [number, number] =>
{
    const [seat, piece] = key.split('-').map(Number);

    return [seat ?? 0, piece ?? 0];
};

const cq = (value: number): string => `${ value.toFixed(3) }cqi`;

const at = (spot: { x: number; y: number }): string => `${ cq(spot.x) } ${ cq(spot.y) }`;

function foot(col: number, row: number): { x: number; y: number }
{
    return {
        x: (MARGIN * 100) + (col + 0.5) * C,
        y: (MARGIN * 100) + (row + 0.5 + DROP) * C
    };
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, name: string, parent?: HTMLElement): HTMLElementTagNameMap[K]
{
    const made = document.createElement(tag);

    made.className = name;
    parent?.append(made);

    return made;
}

const RING = '<svg viewBox="-60 -30 120 60" aria-hidden="true"><ellipse class="lp-ring-edge" rx="56" ry="28"/><ellipse class="lp-ring-dash" rx="56" ry="28" pathLength="120"/></svg>';

export async function createLudoBoard(options: BoardOptions): Promise<BoardHandle>
{
    const host = options.host;
    const root = element('div', 'lb', host);
    const pieces = new Map<string, Piece>();
    const timers = new Set<number>();

    let view: BoardView = EMPTY;
    let motion = !options.reducedMotion;
    let sound: SoundHandle | null = createSound(options.sound);
    let dieFade = 0;
    let heardRev = Math.max(0, ...(options.view.beats ?? []).map((beat) => beat.rev));

    root.style.setProperty('--c', cq(C));
    root.toggleAttribute('data-still', !motion);

    const later = (ms: number, run: () => void): number =>
    {
        const id = window.setTimeout(() =>
        {
            timers.delete(id);
            run();
        }, ms);

        timers.add(id);

        return id;
    };

    const glow = element('div', 'lb-die-glow', root);
    const die = element('div', 'lb-die', root);

    const spotOf = (token: BoardToken): Spot =>
    {
        const base = foot(token.col, token.row);

        if (token.at === FINISHED)
        {
            return { ...base, scale: HOME_SCALE };
        }

        if (token.at === YARD)
        {
            return { ...base, scale: 1 };
        }

        const together = view.tokens
            .filter((one) => one.at !== YARD && one.at !== FINISHED && one.col === token.col && one.row === token.row)
            .map((one) => one.key)
            .sort((a, b) =>
            {
                const [seatA, pieceA] = order(a);
                const [seatB, pieceB] = order(b);

                return seatA - seatB || pieceA - pieceB;
            });

        const place = stackSpot(Math.max(0, together.indexOf(token.key)), together.length);

        return { x: base.x + place.dx * C, y: base.y + place.dy * C, scale: place.scale };
    };

    const place = (piece: Piece, spot: Spot): void =>
    {
        piece.root.style.translate = at(spot);
        piece.root.style.scale = String(spot.scale);
        piece.root.style.zIndex = String(Math.round(spot.y * 10));
    };

    const dress = (piece: Piece): void =>
    {
        const token = piece.token;

        piece.root.toggleAttribute('data-movable', token.playable);
        piece.root.toggleAttribute('data-home', token.at === FINISHED);
        piece.root.style.setProperty('--i', String(order(token.key)[1] % 4));
    };

    const mint = (token: BoardToken): Piece =>
    {
        const node = element('div', 'lp', root);
        const shadow = element('img', 'lp-shadow', node);
        const ring = element('span', 'lp-ring', node);
        const lift = element('span', 'lp-lift', node);
        const pawn = element('img', 'lp-pawn', lift);

        shadow.src = '/board/pawn-shadow.svg';
        shadow.alt = '';
        shadow.decoding = 'async';
        pawn.src = `/board/pawn-${ token.colour }.svg`;
        pawn.alt = '';
        pawn.decoding = 'async';
        pawn.draggable = false;
        ring.innerHTML = RING;
        node.style.setProperty('--tone', TONE[token.colour] ?? '#FFFFFF');
        node.dataset.colour = token.colour;

        const piece: Piece = { token, root: node, lift, pawn, shadow, walk: 0, moving: false, timers: [] };

        dress(piece);
        place(piece, spotOf(token));

        return piece;
    };

    const halt = (piece: Piece): void =>
    {
        piece.walk += 1;
        piece.moving = false;
        piece.root.removeAttribute('data-moving');

        for (const id of piece.timers)
        {
            window.clearTimeout(id);
            timers.delete(id);
        }
        piece.timers = [];

        for (const target of [piece.root, piece.lift, piece.pawn, piece.shadow])
        {
            for (const running of target.getAnimations())
            {
                running.cancel();
            }
        }
    };

    const layout = (): void =>
    {
        for (const piece of pieces.values())
        {
            if (!piece.moving)
            {
                place(piece, spotOf(piece.token));
            }
        }
    };

    const burst = (spot: { x: number; y: number }, colour: string): void =>
    {
        if (!motion)
        {
            return;
        }

        const ring = element('span', 'lb-burst', root);

        ring.style.translate = at(spot);
        ring.style.setProperty('--tone', colour);
        ring.style.zIndex = String(Math.round(spot.y * 10) + 5);
        ring.animate(
            [{ scale: '0.37', opacity: 0.9 }, { scale: '1', opacity: 0 }],
            { duration: 280, easing: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)' }
        ).finished.then(() => ring.remove(), () => ring.remove());
    };

    const land = (piece: Piece): void =>
    {
        piece.pawn.animate(
            [{ scale: '1 1' }, { scale: '1.05 0.93' }, { scale: '1 1' }],
            { duration: 180, easing: 'ease-out' }
        );
    };

    const walk = (piece: Piece, cells: readonly { col: number; row: number }[], from: { x: number; y: number }, done: () => void): void =>
    {
        halt(piece);

        const id = piece.walk;

        if (cells.length === 0)
        {
            done();
            return;
        }

        piece.moving = true;
        piece.root.setAttribute('data-moving', '');

        const stops = [from, ...cells.map((cell) => foot(cell.col, cell.row))];
        const end = stops[stops.length - 1];
        const duration = STEP_MS * cells.length;

        piece.root.style.zIndex = String(Math.round(Math.max(...stops.map((stop) => stop.y)) * 10) + 50);
        piece.root.style.translate = at(end);
        piece.root.style.scale = '1';

        piece.root.animate(
            stops.map((stop) => ({ translate: at(stop), easing: 'ease-in-out' })),
            { duration }
        );

        piece.lift.animate(
            [{ translate: '0 0' }, { translate: `0 ${ cq(-0.22 * C) }`, easing: 'ease-in' }, { translate: '0 0' }],
            { duration: STEP_MS, iterations: cells.length, easing: 'ease-out' }
        );

        piece.shadow.animate(
            [{ scale: '1' }, { scale: '0.8' }, { scale: '1' }],
            { duration: STEP_MS, iterations: cells.length }
        );

        for (let step = 1; step <= cells.length; step += 1)
        {
            piece.timers.push(later(STEP_MS * step, () =>
            {
                if (piece.walk === id)
                {
                    sound?.play('token-step');
                }
            }));
        }

        piece.timers.push(later(duration, () =>
        {
            if (piece.walk !== id)
            {
                return;
            }

            done();
        }));
    };

    const arrive = (piece: Piece): void =>
    {
        piece.moving = false;
        piece.root.removeAttribute('data-moving');
        place(piece, spotOf(piece.token));
        land(piece);
        layout();
    };

    const home = (piece: Piece): void =>
    {
        const spot = spotOf(piece.token);
        const from = piece.root.style.translate;

        piece.moving = false;
        piece.root.removeAttribute('data-moving');
        place(piece, spot);
        sound?.play('home');

        piece.root.animate(
            [{ translate: from, scale: '1' }, { translate: at(spot), scale: String(HOME_SCALE) }],
            { duration: 220, easing: 'cubic-bezier(0.22, 0.61, 0.36, 1)' }
        ).finished.then(() => burst(spot, '#E8C36A'), () => undefined);
    };

    const knock = (piece: Piece, from: { x: number; y: number }): void =>
    {
        halt(piece);

        const id = piece.walk;
        const spot = spotOf(piece.token);

        piece.moving = true;
        piece.root.setAttribute('data-moving', '');
        sound?.play('token-capture');
        burst(from, '#FFFFFF');

        piece.root.style.zIndex = '9000';
        piece.root.style.translate = at(spot);
        piece.root.style.scale = '1';

        piece.pawn.animate(
            [{ filter: 'brightness(0) invert(1)' }, { filter: 'brightness(0) invert(1)', offset: 0.5 }, { filter: 'none' }],
            { duration: 140 }
        );

        piece.root.animate(
            [
                { translate: at(from), rotate: '0deg', scale: '1' },
                { scale: '1.2', offset: 0.5 },
                { translate: at(spot), rotate: '360deg', scale: '1' }
            ],
            { duration: FLIGHT_MS, easing: 'ease-in-out' }
        );

        piece.lift.animate(
            [{ translate: '0 0' }, { translate: `0 ${ cq(-1.1 * C) }`, easing: 'ease-in' }, { translate: '0 0' }],
            { duration: FLIGHT_MS, easing: 'ease-out' }
        );

        piece.shadow.animate(
            [{ opacity: 1 }, { opacity: 0, offset: 0.23 }, { opacity: 0, offset: 0.77 }, { opacity: 1 }],
            { duration: FLIGHT_MS }
        );

        piece.timers.push(later(FLIGHT_MS, () =>
        {
            if (piece.walk !== id)
            {
                return;
            }

            piece.moving = false;
            piece.root.removeAttribute('data-moving');
            place(piece, spotOf(piece.token));
            piece.root.animate(
                [{ scale: '0.9' }, { scale: '1' }],
                { duration: 160, easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)' }
            );
        }));
    };

    const retire = (piece: Piece): void =>
    {
        halt(piece);

        if (!motion)
        {
            piece.root.remove();
            return;
        }

        piece.root.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200 })
            .finished.then(() => piece.root.remove(), () => piece.root.remove());
    };

    const face = (value: number): void =>
    {
        die.style.setProperty('--face', String(Math.min(Math.max(value, 1), 6) - 1));
    };

    const hideDie = (): void =>
    {
        window.clearTimeout(dieFade);
        root.removeAttribute('data-rolled');
        die.removeAttribute('data-spent');

        for (const running of die.getAnimations())
        {
            running.cancel();
        }
    };

    const fadeDie = (): void =>
    {
        window.clearTimeout(dieFade);
        dieFade = later(DIE_HOLD_MS, () =>
        {
            const fading = [die, glow].map((one) => one.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 260, fill: 'forwards' }));

            Promise.all(fading.map((one) => one.finished)).then(() =>
            {
                hideDie();
                fading.forEach((one) => one.cancel());
            }, () => undefined);
        });
    };

    const roll = (was: number | null, now: number | null, turn: string | null): void =>
    {
        if (was === now)
        {
            return;
        }

        for (const running of [...die.getAnimations(), ...glow.getAnimations()])
        {
            running.cancel();
        }

        if (now === null)
        {
            hideDie();
            return;
        }

        sound?.play('die-land');
        root.setAttribute('data-rolled', '');
        glow.style.setProperty('--tone', turn === null ? 'transparent' : (TONE[turn] ?? '#FFFFFF'));

        if (!motion)
        {
            face(now);
            fadeDie();
            return;
        }

        const swaps = 7;

        face((now * 7) % 6 + 1);

        for (let shown = 1; shown <= swaps; shown += 1)
        {
            later((TUMBLE_MS / swaps) * shown, () =>
            {
                face(shown >= swaps ? now : (now * 7 + shown * 3) % 6 + 1);

                if (shown >= swaps)
                {
                    fadeDie();
                }
            });
        }

        die.animate(
            [{ rotate: '0deg', scale: '1' }, { scale: '1.3', offset: 0.4 }, { rotate: '360deg', scale: '1' }],
            { duration: TUMBLE_MS, easing: 'cubic-bezier(0.22, 0.61, 0.36, 1)' }
        );
        glow.animate([{ opacity: 0 }, { opacity: 0, offset: 0.7 }, { opacity: 1 }], { duration: TUMBLE_MS });
    };

    const spent = (value: number, colour: string | null, why: string | undefined): void =>
    {
        for (const running of [...die.getAnimations(), ...glow.getAnimations()])
        {
            running.cancel();
        }

        sound?.play('die-land');
        root.setAttribute('data-rolled', '');
        glow.style.setProperty('--tone', colour === null ? 'transparent' : (TONE[colour] ?? '#FFFFFF'));
        face(value);

        const settle = motion ? TUMBLE_MS : 0;

        if (motion)
        {
            die.animate(
                [{ rotate: '0deg', scale: '1' }, { scale: '1.3', offset: 0.4 }, { rotate: '360deg', scale: '1' }],
                { duration: TUMBLE_MS, easing: 'cubic-bezier(0.22, 0.61, 0.36, 1)' }
            );
        }

        later(settle, () =>
        {
            sound?.play(why === 'three-sixes' ? 'deny' : 'pass');
            die.setAttribute('data-spent', why ?? 'no-move');
            die.animate(
                motion
                    ? [{ rotate: '0deg' }, { rotate: '-8deg' }, { rotate: '8deg' }, { rotate: '-8deg' }, { rotate: '8deg' }, { rotate: '0deg' }]
                    : [{ opacity: 1 }, { opacity: 0.55 }],
                { duration: 280, fill: 'forwards' }
            );
            fadeDie();
        });
    };

    const celebrate = (winner: string): void =>
    {
        sound?.play('win');

        const tone = TONE[winner] ?? '#FFFFFF';

        if (!motion)
        {
            return;
        }

        for (let index = 0; index < CONFETTI; index += 1)
        {
            const angle = (index / CONFETTI) * Math.PI * 2 + (index % 5) * 0.11;
            const reach = 26 + (index % 7) * 3.5;
            const fleck = element('span', 'lb-fleck', root);

            fleck.style.background = index % 3 === 0 ? tone : (index % 3 === 1 ? '#F6F1E6' : '#FFFFFF');
            fleck.animate(
                [
                    { translate: '50cqi 50cqi', rotate: `${ index * 37 }deg`, opacity: 1 },
                    { translate: `${ cq(50 + Math.cos(angle) * reach) } ${ cq(58 + Math.sin(angle) * reach) }`, rotate: `${ index * 37 + 540 }deg`, opacity: 0 }
                ],
                { duration: 1100 + (index % 6) * 90, easing: 'cubic-bezier(0.22, 0.61, 0.36, 1)' }
            ).finished.then(() => fleck.remove(), () => fleck.remove());
        }
    };

    const show = (next: BoardView): void =>
    {
        const previous = view;

        view = next;

        const seen = new Set<string>();
        const journeys: (() => void)[] = [];

        for (const token of next.tokens)
        {
            seen.add(token.key);

            const piece = pieces.get(token.key);

            if (piece === undefined)
            {
                pieces.set(token.key, mint(token));
                continue;
            }

            const was = piece.token;

            piece.token = token;
            dress(piece);

            if (was.col === token.col && was.row === token.row && was.at === token.at)
            {
                continue;
            }

            if (was.at === token.at || !motion)
            {
                halt(piece);
                continue;
            }

            const from = foot(was.col, was.row);

            if (was.at >= 0 && token.at === YARD)
            {
                journeys.push(() => knock(piece, from));
                continue;
            }

            const path = pathBetween(token.colour as LudoColour, was.at, token.at);

            journeys.push(() => walk(piece, path, from, () => token.at === FINISHED ? home(piece) : arrive(piece)));
        }

        for (const [key, piece] of [...pieces])
        {
            if (!seen.has(key))
            {
                pieces.delete(key);
                retire(piece);
            }
        }

        layout();

        for (const journey of journeys)
        {
            journey();
        }

        const fresh = (next.beats ?? []).filter((beat) => beat.rev > heardRev);

        heardRev = Math.max(heardRev, ...fresh.map((beat) => beat.rev));

        const passed = fresh.find((beat) => beat.e === 'pass');
        const rolled = [...fresh].reverse().find((beat) => beat.e === 'roll' && beat.die !== undefined);

        if (passed !== undefined && rolled !== undefined && next.die === null)
        {
            spent(rolled.die!, rolled.colour, passed.why);
        }
        else
        {
            roll(previous.die, next.die, next.turn);
        }

        if (previous.winner === null && next.winner !== null)
        {
            celebrate(next.winner);
        }
        else if (!previous.yours && next.yours && previous.winner === null)
        {
            sound?.play('turn', { urgent: true });
        }
    };

    const pick = (event: PointerEvent): void =>
    {
        const box = host.getBoundingClientRect();
        const key = pickNear(view.tokens, event.clientX - box.left, event.clientY - box.top, box.width);

        if (key !== null)
        {
            options.onPick?.(key);
        }
    };

    host.addEventListener('pointerup', pick);

    show({ ...options.view, die: null });

    if (options.view.die !== null)
    {
        view = options.view;
        face(options.view.die);
        root.setAttribute('data-rolled', '');
        glow.style.setProperty('--tone', options.view.turn === null ? 'transparent' : (TONE[options.view.turn] ?? '#FFFFFF'));
        fadeDie();
    }

    options.onReady?.();

    return {
        show,

        setReducedMotion: (on) =>
        {
            motion = !on;
            root.toggleAttribute('data-still', on);
        },

        setSound: (on) => sound?.setEnabled(on),

        resize: () => undefined,

        pause: () => root.setAttribute('data-paused', ''),

        resume: () => root.removeAttribute('data-paused'),

        dispose: () =>
        {
            host.removeEventListener('pointerup', pick);

            for (const id of timers)
            {
                window.clearTimeout(id);
            }
            timers.clear();

            for (const piece of pieces.values())
            {
                halt(piece);
            }
            pieces.clear();

            sound?.dispose();
            sound = null;
            root.remove();
        }
    };
}
