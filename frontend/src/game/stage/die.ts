import { FACE_PLACE, matrixOf, planThrow, restTurn, yawOf, type Release } from './dice.ts';
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

const element = (name: string, parent?: HTMLElement) =>
{
    const made = document.createElement('span');

    made.className = name;
    parent?.append(made);

    return made;
};

export function createDie(): Die
{
    const node = element('die3d');
    const shadow = element('die3d-shadow', node);
    const body = element('die3d-body', node);

    for (let face = 1; face <= 6; face += 1)
    {
        const side = element('die3d-face', body);

        side.dataset.n = String(face);
        side.style.transform = FACE_PLACE[face];

        for (const cell of PIPS[face])
        {
            const pip = element('die3d-pip', side);

            pip.style.gridArea = `${ Math.floor(cell / 3) + 1 } / ${ (cell % 3) + 1 }`;
        }
    }

    let shown = 1;

    const rest = (face: number, seed: number) =>
    {
        shown = face;
        node.dataset.face = String(face);
        body.style.transform = `perspective(${ PERSPECTIVE }em) ${ matrixOf(restTurn(face, yawOf(seed))) }`;
    };

    return {
        node,

        face: () => shown,

        show: rest,

        toss(stage, seed, face, release, hooks = {})
        {
            const plan = planThrow(seed, face, release);
            const length = plan.duration;

            const bodyFrames: Keyframe[] = plan.frames.map((frame) => ({
                offset: frame.at / length,
                transform: `perspective(${ PERSPECTIVE }em) translate3d(${ frame.x.toFixed(3) }em, ${ frame.y.toFixed(3) }em, ${ frame.lift.toFixed(3) }em) ${ matrixOf(frame.turn) }`
            }));

            const shadowFrames: Keyframe[] = plan.frames.map((frame) => ({
                offset: frame.at / length,
                translate: `${ (frame.x + frame.lift * 0.35).toFixed(3) }em ${ (frame.y + frame.lift * 0.55).toFixed(3) }em`,
                scale: String((1 + frame.lift * 0.22).toFixed(3)),
                opacity: String((0.5 / (1 + frame.lift * 1.1)).toFixed(3))
            }));

            rest(face, seed);

            const fall = stage.animate(stage.quiet() ? node : body, bodyFrames, { duration: length });

            stage.animate(shadow, shadowFrames, { duration: length, quiet: 'skip' });

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
