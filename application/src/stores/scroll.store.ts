import { createStore, createSignal, type Getter } from 'azerothjs';

export type ScrollDirection = 'up' | 'down';

const REVEAL_ABOVE = 120;

const DIRECTION_EPSILON = 4;

export function resolveDirection(previous: ScrollDirection, from: number, to: number): { direction: ScrollDirection; anchor: number }
{
    if (Math.abs(to - from) < DIRECTION_EPSILON)
    {
        return { direction: previous, anchor: from };
    }
    return { direction: to > from ? 'down' : 'up', anchor: to };
}

export function isPast(y: number): boolean
{
    return y > REVEAL_ABOVE;
}

export interface ScrollApi
{
    y: Getter<number>;
    direction: Getter<ScrollDirection>;

    past: Getter<boolean>;
}

export const useScroll = createStore((): ScrollApi =>
{
    const [y, setY] = createSignal(0);
    const [direction, setDirection] = createSignal<ScrollDirection>('up');

    if (typeof window !== 'undefined')
    {
        let last = window.scrollY;
        let queued = false;

        const sample = (): void =>
        {
            queued = false;
            const next = window.scrollY;
            const resolved = resolveDirection(direction(), last, next);

            last = resolved.anchor;
            setDirection(resolved.direction);
            setY(next);
        };

        window.addEventListener('scroll', () =>
        {
            if (!queued)
            {
                queued = true;
                requestAnimationFrame(sample);
            }
        }, { passive: true });

        sample();
    }

    return {
        y,
        direction,
        past: () => isPast(y())
    };
});
