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

    if (hasWindow())
    {
        const measure = (): void =>
        {
            setWidth(window.innerWidth);
            setHeight(window.innerHeight);
            const viewport = window.visualViewport;
            setKeyboardOpen(viewport !== null && viewport !== undefined && window.innerHeight - viewport.height > 150);
        };
        window.addEventListener('resize', measure, { passive: true });
        window.visualViewport?.addEventListener('resize', measure, { passive: true });
        if (typeof window.matchMedia === 'function')
        {
            window.matchMedia('(pointer: coarse)').addEventListener('change', (event) => setCoarse(event.matches));
            window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', (event) => setReducedMotion(event.matches));
        }
        measure();
    }

    return {
        width,
        height,
        posture: () => forced() ?? postureFor(width()),
        social: () => (forced() ?? postureFor(width())) === 'sidebar' && width() >= SOCIAL_MIN,
        landscape: () => width() > height(),
        coarse,
        reducedMotion,
        standalone,
        keyboardOpen,
        override: (posture) => setForced(posture)
    };
});
