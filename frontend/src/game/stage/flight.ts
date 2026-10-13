import { centreOf, flightFrames, type FlightShape, type Rect } from '../motion.ts';
import type { Quiet, Run, Stage } from './stage.ts';

export const EDGE = 0.04;

export interface Launch extends FlightShape
{
    duration: number;
    easing: string;
    delay?: number;
    quiet?: Quiet;
    landed?: () => void;
}

export interface Turn
{
    duration: number;
    easing: string;
    delay?: number;
    down?: boolean;
    landed?: () => void;
}

const SHOWN_FIRST: Keyframe[] = [{ opacity: 1 }, { opacity: 1, offset: 0.5 }, { opacity: 0, offset: 0.5 }, { opacity: 0 }];

const SHOWN_LAST: Keyframe[] = [{ opacity: 0 }, { opacity: 0, offset: 0.5 }, { opacity: 1, offset: 0.5 }, { opacity: 1 }];

function put(layer: HTMLElement, clone: HTMLElement, at: Rect)
{
    clone.classList.add('flight');
    clone.setAttribute('aria-hidden', 'true');
    clone.style.left = `${ at.x }px`;
    clone.style.top = `${ at.y }px`;
    clone.style.width = `${ at.width }px`;
    clone.style.height = `${ at.height }px`;
    layer.append(clone);
}

export function turn(stage: Stage, layer: HTMLElement, clone: HTMLElement, from: Rect, to: Rect, flight: Turn): Run
{
    if (stage.quiet())
    {
        return stage.animate(clone, [], { duration: 0, quiet: 'skip', landed: flight.landed });
    }

    const start = centreOf(from);
    const end = centreOf(to);
    const scale = to.width > 0 ? from.width / to.width : 1;
    const timing = { duration: flight.duration, delay: flight.delay, easing: flight.easing, fill: 'both' as const };
    const [back, face] = [...clone.children];
    const [first, last] = flight.down === true ? [face, back] : [back, face];

    put(layer, clone, to);

    if (first !== undefined)
    {
        stage.animate(first, SHOWN_FIRST, timing);
    }

    if (last !== undefined)
    {
        stage.animate(last, SHOWN_LAST, timing);
    }

    return stage.animate(clone, [
        { translate: `${ start.x - end.x }px ${ start.y - end.y }px`, scale: `${ scale } ${ scale }` },
        { translate: `${ (start.x - end.x) / 2 }px ${ (start.y - end.y) / 2 }px`, scale: `${ EDGE } ${ (scale + 1) / 2 }`, offset: 0.5 },
        { translate: '0px 0px', scale: '1 1' }
    ], {
        ...timing,
        landed: () =>
        {
            clone.remove();
            flight.landed?.();
        }
    });
}

export function launch(stage: Stage, layer: HTMLElement, clone: HTMLElement, from: Rect, to: Rect, flight: Launch): Run
{
    const mode = flight.quiet ?? 'in';

    if (stage.quiet() && mode === 'skip')
    {
        return stage.animate(clone, [], { duration: 0, quiet: 'skip', landed: flight.landed });
    }

    put(layer, clone, stage.quiet() && mode === 'out' ? from : to);

    return stage.animate(clone, flightFrames(from, to, flight), {
        duration: flight.duration,
        delay: flight.delay,
        easing: flight.easing,
        fill: 'both',
        quiet: mode,
        landed: () =>
        {
            clone.remove();
            flight.landed?.();
        }
    });
}
