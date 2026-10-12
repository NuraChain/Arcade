import { flightFrames, type FlightShape, type Rect } from '../motion.ts';
import type { Quiet, Run, Stage } from './stage.ts';

export interface Launch extends FlightShape
{
    duration: number;
    easing: string;
    delay?: number;
    quiet?: Quiet;
    landed?: () => void;
}

export function launch(stage: Stage, layer: HTMLElement, clone: HTMLElement, from: Rect, to: Rect, flight: Launch): Run
{
    const mode = flight.quiet ?? 'in';

    if (stage.quiet() && mode === 'skip')
    {
        return stage.animate(clone, [], { duration: 0, quiet: 'skip', landed: flight.landed });
    }

    const at = stage.quiet() && mode === 'out' ? from : to;

    clone.classList.add('flight');
    clone.setAttribute('aria-hidden', 'true');
    clone.style.left = `${ at.x }px`;
    clone.style.top = `${ at.y }px`;
    clone.style.width = `${ at.width }px`;
    clone.style.height = `${ at.height }px`;
    layer.append(clone);

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
