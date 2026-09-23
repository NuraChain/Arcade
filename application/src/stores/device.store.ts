import { createStore, createSignal, type Getter } from 'azerothjs';

export type Posture = 'phone' | 'rail' | 'sidebar';

export const RAIL_MIN = 768;
export const SIDEBAR_MIN = 1024;
export const SOCIAL_MIN = 1280;

export function postureFor(width: number): Posture
{
    if (width < RAIL_MIN)
    {
        return 'phone';
    }
    return width < SIDEBAR_MIN ? 'rail' : 'sidebar';
}

export const SHORT_MAX = 540;

export function bareFor(immersive: boolean, posture: Posture, height: number): boolean
{
    return immersive && (posture === 'phone' || height <= SHORT_MAX);
}

export interface DeviceApi
{
    width: Getter<number>;
    height: Getter<number>;
    posture: Getter<Posture>;
    social: Getter<boolean>;
    landscape: Getter<boolean>;
    coarse: Getter<boolean>;
    reducedMotion: Getter<boolean>;
    standalone: Getter<boolean>;
    keyboardOpen: Getter<boolean>;
    override(posture: Posture | null): void;
    overrideCoarse(coarse: boolean | null): void;

    /**
     * Begins watching the window, and hands back the way to stop.
     *
     * The four listeners this opens used to be attached in the store's FACTORY, which broke the rule
     * every other store follows and made two of them unremovable outright - the `matchMedia` objects
     * were constructed inline, so there was no handle left to pass to `removeEventListener`. One
     * document only ever built one store, so nothing accumulated in a browser; a test file that
     * builds a fresh store scope per render accumulated four listeners a time.
     *
     * It is started from `App.azeroth` rather than the app shell, because the landing page reads this
     * store too - through `Tooltip` and the theme controls - and a store started only behind the
     * sign-in would leave the public half of the site deaf to a resize.
     *
     * Idempotent: calling it twice watches once.
     */
    start(): () => void;
    stop(): void;
}

const hasWindow = (): boolean => typeof window !== 'undefined';

function media(query: string): boolean
{
    return hasWindow() && typeof window.matchMedia === 'function' ? window.matchMedia(query).matches : false;
}

export const useDevice = createStore((): DeviceApi =>
{
    const [width, setWidth] = createSignal(hasWindow() ? window.innerWidth : 390);
    const [height, setHeight] = createSignal(hasWindow() ? window.innerHeight : 844);
    const [coarse, setCoarse] = createSignal(media('(pointer: coarse)'));
    const [reducedMotion, setReducedMotion] = createSignal(media('(prefers-reduced-motion: reduce)'));
    const [standalone] = createSignal(media('(display-mode: standalone)'));
    const [keyboardOpen, setKeyboardOpen] = createSignal(false);
    const [forced, setForced] = createSignal<Posture | null>(null);
    const [forcedCoarse, setForcedCoarse] = createSignal<boolean | null>(null);

    const measure = (): void =>
    {
        if (!hasWindow())
        {
            return;
        }
        setWidth(window.innerWidth);
        setHeight(window.innerHeight);
        const viewport = window.visualViewport;
        setKeyboardOpen(viewport !== null && viewport !== undefined && window.innerHeight - viewport.height > 150);
    };

    let watching: (() => void) | null = null;

    const stop = (): void =>
    {
        watching?.();
        watching = null;
    };

    const start = (): (() => void) =>
    {
        if (watching !== null)
        {
            return stop;
        }
        if (!hasWindow())
        {
            return stop;
        }

        const onCoarse = (event: MediaQueryListEvent): void => setCoarse(event.matches);
        const onMotion = (event: MediaQueryListEvent): void => setReducedMotion(event.matches);
        const pointer = typeof window.matchMedia === 'function' ? window.matchMedia('(pointer: coarse)') : null;
        const motion = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
        const viewport = window.visualViewport ?? null;

        window.addEventListener('resize', measure, { passive: true });
        viewport?.addEventListener('resize', measure, { passive: true });
        pointer?.addEventListener('change', onCoarse);
        motion?.addEventListener('change', onMotion);

        watching = (): void =>
        {
            window.removeEventListener('resize', measure);
            viewport?.removeEventListener('resize', measure);
            pointer?.removeEventListener('change', onCoarse);
            motion?.removeEventListener('change', onMotion);
        };

        measure();
        return stop;
    };

    measure();

    return {
        width,
        height,
        posture: () => forced() ?? postureFor(width()),
        social: () => (forced() ?? postureFor(width())) === 'sidebar' && width() >= SOCIAL_MIN,
        landscape: () => width() * 3 >= height() * 4,
        coarse: () => forcedCoarse() ?? coarse(),
        reducedMotion,
        standalone,
        keyboardOpen,
        override: (posture) => setForced(posture),
        overrideCoarse: (value) => setForcedCoarse(value),
        start,
        stop
    };
});
