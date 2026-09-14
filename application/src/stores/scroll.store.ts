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

    /**
     * Begins watching the document scroll, and hands back the way to stop.
     *
     * The listener used to be attached in the factory as an anonymous function, so it was not held
     * anywhere and could never be removed. `SiteHeader` is its only reader - this store is a
     * landing-page concern, not an app one - so that is where it is started.
     *
     * Idempotent: calling it twice watches once.
     */
    start(): () => void;
    stop(): void;
}

export const useScroll = createStore((): ScrollApi =>
{
    const [y, setY] = createSignal(0);
    const [direction, setDirection] = createSignal<ScrollDirection>('up');

    let last = typeof window === 'undefined' ? 0 : window.scrollY;
    let queued = false;
    let frame: number | null = null;

    const sample = (): void =>
    {
        queued = false;
        frame = null;
        if (typeof window === 'undefined')
        {
            return;
        }
        const next = window.scrollY;
        const resolved = resolveDirection(direction(), last, next);

        last = resolved.anchor;
        setDirection(resolved.direction);
        setY(next);
    };

    const onScroll = (): void =>
    {
        if (!queued)
        {
            queued = true;
            frame = requestAnimationFrame(sample);
        }
    };

    let watching = false;

    const stop = (): void =>
    {
        if (!watching)
        {
            return;
        }
        watching = false;
        window.removeEventListener('scroll', onScroll);
        if (frame !== null)
        {
            cancelAnimationFrame(frame);
            frame = null;
        }
        queued = false;
    };

    const start = (): (() => void) =>
    {
        if (watching || typeof window === 'undefined')
        {
            return stop;
        }
        watching = true;
        window.addEventListener('scroll', onScroll, { passive: true });
        sample();
        return stop;
    };

    sample();

    return {
        y,
        direction,
        past: () => isPast(y()),
        start,
        stop
    };
});
