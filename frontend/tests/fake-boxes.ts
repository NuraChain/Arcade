import { vi } from 'vitest';

interface Watch
{
    told: ResizeObserverCallback;
    on: Element[];
    off: boolean;
}

/**
 * A ResizeObserver a spec can speak for.
 *
 * happy-dom lays nothing out, so no box ever changes size by itself. This stands in for the
 * browser's observer, keeps every one that is made, and lets a spec say what size a box has
 * become to whoever is watching it. `vi.unstubAllGlobals()` takes it away again.
 */
export function watchedBoxes()
{
    const all: Watch[] = [];

    vi.stubGlobal('ResizeObserver', class
    {
        readonly #watch: Watch;

        constructor(told: ResizeObserverCallback)
        {
            this.#watch = { told, on: [], off: false };
            all.push(this.#watch);
        }

        public observe(element: Element)
        {
            this.#watch.on.push(element);
        }

        public unobserve(element: Element)
        {
            this.#watch.on = this.#watch.on.filter((one) => one !== element);
        }

        public disconnect()
        {
            this.#watch.off = true;
            this.#watch.on = [];
        }
    });

    return {
        all,

        watching: (element: Element) => all.filter((one) => !one.off && one.on.includes(element)).length,

        size(element: Element, width: number, height: number)
        {
            for (const one of all.filter((each) => !each.off && each.on.includes(element)))
            {
                one.told([{ target: element, contentRect: { width, height } } as unknown as ResizeObserverEntry], {} as ResizeObserver);
            }
        }
    };
}
