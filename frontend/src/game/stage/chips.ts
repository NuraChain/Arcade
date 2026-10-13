import { centreOf, type Rect } from '../motion.ts';
import { launch } from './flight.ts';
import type { Run, Stage } from './stage.ts';

export interface Pour
{
    discs: number;
    duration: number;
    gap: number;
    easing: string;
    delay?: number;
}

const OVER = [1, 2.5, 6, 15];

const DISC = 0.85;

const SWELL = 1.35;

export function discsFor(amount: number, unit: number)
{
    if (amount <= 0)
    {
        return 0;
    }

    const size = unit > 0 ? amount / unit : amount;

    return 1 + OVER.filter((least) => size > least).length;
}

export function pour(stage: Stage, layer: HTMLElement, from: Rect, to: Rect, flight: Pour): Run
{
    const start = centreOf(from);
    const leaving = { x: start.x - (to.width * SWELL) / 2, y: start.y - (to.height * SWELL) / 2, width: to.width * SWELL, height: to.height * SWELL };
    const runs = Array.from({ length: Math.max(1, flight.discs) }, (_, at) =>
    {
        const disc = document.createElement('span');

        disc.className = 'chip-stack';
        disc.dataset.chips = '1';
        disc.style.fontSize = `${ to.width / DISC }px`;

        return launch(stage, layer, disc, leaving, to, { duration: flight.duration, delay: (flight.delay ?? 0) + at * flight.gap, easing: flight.easing });
    });
    const last = runs[runs.length - 1];

    return {
        done: last.done,
        length: last.length,
        cancel: () => runs.forEach((run) => run.cancel()),
        finish: () => runs.forEach((run) => run.finish())
    };
}
