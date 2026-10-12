import { clamp } from './curves.ts';
import { FACE_PLACE, NORMALS, matrixOf, planThrow, restTurn, times, turnX, yawOf, type Release, type Turn } from './dice.ts';
import type { Run, Stage } from './stage.ts';

export interface Die
{
    readonly node: HTMLElement;
    face(): number;
    show(face: number, seed: number): void;
    toss(stage: Stage, seed: number, face: number, release: Release, hooks?: TossHooks): Run;
    dim(on: boolean): void;
    dispose(): void;
}

export interface TossHooks
{
    impact?: (power: number) => void;
    held?: number;
}

export interface DieOptions
{
    flat?: boolean;
}

const PIPS: Record<number, readonly number[]> = {
    1: [4],
    2: [0, 8],
    3: [0, 4, 8],
    4: [0, 2, 6, 8],
    5: [0, 2, 4, 6, 8],
    6: [0, 2, 3, 5, 6, 8]
};

const PERSPECTIVE = 7;

const PITCH = 0.1;

const LIT = 0.93;

const SHADED = 0.55;

const READ = 0.3;

const EDGE = 0.12;

const element = (name: string, parent?: HTMLElement) =>
{
    const made = document.createElement('span');

    made.className = name;
    parent?.append(made);

    return made;
};

export const nearness = (lift: number) => PERSPECTIVE / (PERSPECTIVE - clamp(lift, 0, PERSPECTIVE - 1));

const seenFlat = (turn: Turn) => times(turnX(PITCH), turn);

const facing = (seen: Turn, face: number) =>
{
    const [x, y, z] = NORMALS[face];

    return seen[6] * x + seen[7] * y + seen[8] * z;
};

const shadeOf = (seen: Turn, face: number) => clamp((LIT - facing(seen, face)) / (LIT - SHADED));

const veilOf = (seen: Turn, face: number) => clamp((READ - facing(seen, face)) / (READ - EDGE));

export function createDie(options: DieOptions = {}): Die
{
    const flat = options.flat === true;
    const node = element('die3d');
    const shadow = element('die3d-shadow', node);
    const body = element('die3d-body', node);
    const tones: HTMLElement[] = [];
    const veils: HTMLElement[] = [];

    node.toggleAttribute('data-flat', flat);

    for (let face = 1; face <= 6; face += 1)
    {
        const side = element('die3d-face', body);

        side.dataset.n = String(face);
        side.style.transform = FACE_PLACE[face];

        if (flat)
        {
            tones.push(element('die3d-tone', side));
        }

        for (const cell of PIPS[face])
        {
            const pip = element('die3d-pip', side);

            pip.style.gridArea = `${ Math.floor(cell / 3) + 1 } / ${ (cell % 3) + 1 }`;
        }

        if (flat)
        {
            veils.push(element('die3d-veil', side));
        }
    }

    let shown = 1;

    const pose = (turn: Turn, x: number, y: number, lift: number, grown: number) => (flat
        ? `translate(${ x.toFixed(3) }em, ${ y.toFixed(3) }em) scale(${ (nearness(lift) * grown).toFixed(4) }) ${ matrixOf(seenFlat(turn)) }`
        : `perspective(${ PERSPECTIVE }em) translate3d(${ x.toFixed(3) }em, ${ y.toFixed(3) }em, ${ lift.toFixed(3) }em) ${ matrixOf(turn) }`);

    const cast = (x: number, y: number, lift: number): Keyframe => (flat
        ? {
            translate: `${ (x + lift * 0.16).toFixed(3) }em ${ (y + lift * 0.3).toFixed(3) }em`,
            scale: (1 / (1 + lift * 0.25)).toFixed(3),
            opacity: (0.22 / (1 + lift * 0.5)).toFixed(3)
        }
        : {
            translate: `${ (x + lift * 0.35).toFixed(3) }em ${ (y + lift * 0.55).toFixed(3) }em`,
            scale: String((1 + lift * 0.22).toFixed(3)),
            opacity: String((0.5 / (1 + lift * 1.1)).toFixed(3))
        });

    const rest = (face: number, seed: number) =>
    {
        const turn = restTurn(face, yawOf(seed));
        const seen = seenFlat(turn);

        shown = face;
        node.dataset.face = String(face);
        body.style.transform = flat ? matrixOf(seen) : `perspective(${ PERSPECTIVE }em) ${ matrixOf(turn) }`;

        for (const [index, tone] of tones.entries())
        {
            tone.style.opacity = shadeOf(seen, index + 1).toFixed(3);
            veils[index].style.opacity = veilOf(seen, index + 1).toFixed(3);
        }
    };

    return {
        node,

        face: () => shown,

        show: rest,

        toss(stage, seed, face, release, hooks = {})
        {
            const plan = planThrow(seed, face, release);
            const length = plan.duration;
            const reach = Math.hypot(release.x, release.y);
            const held = flat && hooks.held !== undefined ? hooks.held / nearness(plan.frames[0].lift) : 1;
            const grown = (x: number, y: number) => 1 + (held - 1) * clamp(reach === 0 ? 0 : Math.hypot(x, y) / reach) ** 2;

            const bodyFrames: Keyframe[] = plan.frames.map((frame) => ({
                offset: frame.at / length,
                transform: pose(frame.turn, frame.x, frame.y, frame.lift, grown(frame.x, frame.y))
            }));

            const shadowFrames: Keyframe[] = plan.frames.map((frame) => ({ offset: frame.at / length, ...cast(frame.x, frame.y, frame.lift) }));

            rest(face, seed);

            const fall = stage.animate(stage.quiet() ? node : body, bodyFrames, { duration: length });

            stage.animate(shadow, shadowFrames, { duration: length, quiet: 'skip' });

            for (const [index, tone] of tones.entries())
            {
                const seen = plan.frames.map((frame) => ({ offset: frame.at / length, turn: seenFlat(frame.turn) }));

                stage.animate(tone, seen.map((one) => ({ offset: one.offset, opacity: shadeOf(one.turn, index + 1).toFixed(3) })), { duration: length, quiet: 'skip' });
                stage.animate(veils[index], seen.map((one) => ({ offset: one.offset, opacity: veilOf(one.turn, index + 1).toFixed(3) })), { duration: length, quiet: 'skip' });
            }

            if (stage.quiet())
            {
                stage.after(fall.length, () => hooks.impact?.(1));
            }
            else
            {
                for (const impact of plan.impacts)
                {
                    stage.after(impact.at, () => hooks.impact?.(impact.power));
                }
            }

            return fall;
        },

        dim(on)
        {
            node.toggleAttribute('data-spent', on);
        },

        dispose()
        {
            node.remove();
        }
    };
}
