export interface Rect
{
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface Clock
{
    after(ms: number, run: () => void): () => void;
}

export const SNAP_LINEAR = 'linear(0, 0.005 1.3%, 0.022 2.8%, 0.054 4.5%, 0.096 6.3%, 0.19 9.5%, 0.41 16.3%, 0.511 19.5%, 0.609 23%, 0.688 26.3%, 0.756 29.5%, 0.814 32.8%, 0.864 36.3%, 0.903 39.8%, 0.937 43.8%, 0.965 48.3%, 0.984 53.3%, 0.997 58.8%, 1.006 72.3%, 1)';

export const POP_LINEAR = 'linear(0, 0.007 1.3%, 0.033 2.8%, 0.073 4.3%, 0.126 5.8%, 0.244 8.5%, 0.534 14.5%, 0.648 17%, 0.762 19.8%, 0.85 22.3%, 0.924 24.8%, 0.983 27.3%, 1.028 29.8%, 1.062 32.5%, 1.078 34.5%, 1.089 36.5%, 1.094 41%, 1.081 46.3%, 1.02 60.5%, 0.999 68.8%, 0.991 80.3%, 1)';

export function easings(springs: boolean): { fly: string; gather: string; snap: string; pop: string }
{
    return {
        fly: 'cubic-bezier(0.05, 0.7, 0.1, 1)',
        gather: 'cubic-bezier(0.3, 0, 0.8, 0.15)',
        snap: springs ? SNAP_LINEAR : 'cubic-bezier(0.2, 0, 0, 1)',
        pop: springs ? POP_LINEAR : 'cubic-bezier(0.34, 1.56, 0.64, 1)'
    };
}

export const EASE = easings(typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && CSS.supports('transition-timing-function', 'linear(0, 1)'));

export const TIMING = {
    FLY: 340,
    FLY_THEIRS: 360,
    DEAL_FLY: 260,
    DEAL_GAP_MAX: 110,
    DEAL_TOTAL_MAX: 1300,
    HOLD: 900,
    HOLD_MIN: 450,
    GATHER: 420,
    GATHER_GAP: 35,
    SEQ_GAP: 180,
    FADE: 140,
    SETTLE: 120,
    BANNER: 1400
} as const;

export const centreOf = (rect: Rect): { x: number; y: number } => ({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });

export interface FlightShape
{
    fromRotate?: number;
    toRotate?: number;
    fromOpacity?: number;
    toOpacity?: number;
    toScale?: number;
    fadeFrom?: number;
}

export function flightFrames(from: Rect, to: Rect, shape: FlightShape = {}): Keyframe[]
{
    const start = centreOf(from);
    const end = centreOf(to);
    const scale = to.width > 0 ? from.width / to.width : 1;
    const first: Keyframe = {
        translate: `${ start.x - end.x }px ${ start.y - end.y }px`,
        scale: `${ scale }`,
        rotate: `${ shape.fromRotate ?? 0 }deg`,
        opacity: shape.fromOpacity ?? 1
    };
    const last: Keyframe = {
        translate: '0px 0px',
        scale: `${ shape.toScale ?? 1 }`,
        rotate: `${ shape.toRotate ?? 0 }deg`,
        opacity: shape.toOpacity ?? 1
    };

    if (shape.fadeFrom === undefined)
    {
        return [first, last];
    }

    const at = Math.min(0.99, Math.max(0.01, shape.fadeFrom));

    return [
        first,
        {
            offset: at,
            translate: `${ (start.x - end.x) * (1 - at) }px ${ (start.y - end.y) * (1 - at) }px`,
            opacity: shape.fromOpacity ?? 1
        },
        last
    ];
}

export function fadeFrames(): Keyframe[]
{
    return [{ opacity: 0 }, { opacity: 1 }];
}

export function rectIn(layer: Element, element: Element): Rect
{
    const outer = layer.getBoundingClientRect();
    const box = element.getBoundingClientRect();
    const sized = element as HTMLElement;
    const width = sized.offsetWidth || box.width;
    const height = sized.offsetHeight || box.height;

    return {
        x: box.left + box.width / 2 - outer.left - width / 2,
        y: box.top + box.height / 2 - outer.top - height / 2,
        width,
        height
    };
}

export interface Flight extends FlightShape
{
    duration: number;
    easing: string;
    delay?: number;
    reduced?: boolean;
}

export function fly(layer: HTMLElement, clone: HTMLElement, from: Rect, to: Rect, flight: Flight): Animation | null
{
    clone.classList.add('flight');
    clone.setAttribute('aria-hidden', 'true');
    clone.style.left = `${ to.x }px`;
    clone.style.top = `${ to.y }px`;
    clone.style.width = `${ to.width }px`;
    clone.style.height = `${ to.height }px`;
    layer.append(clone);

    if (typeof clone.animate !== 'function')
    {
        clone.remove();
        return null;
    }

    const run = clone.animate(flight.reduced === true ? fadeFrames() : flightFrames(from, to, flight), {
        duration: flight.reduced === true ? TIMING.FADE : flight.duration,
        easing: flight.reduced === true ? 'linear' : flight.easing,
        delay: flight.delay ?? 0,
        fill: 'both'
    });

    run.onfinish = () => clone.remove();
    run.oncancel = () => clone.remove();

    return run;
}

export function land(layer: HTMLElement): void
{
    for (const running of layer.getAnimations?.({ subtree: true }) ?? [])
    {
        running.cancel();
    }

    layer.replaceChildren();
}
