export type Side = 'top' | 'bottom' | 'start' | 'end';

export type Align = 'start' | 'center' | 'end';

export interface Box
{
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface Size
{
    width: number;
    height: number;
}

export interface Viewport
{
    width: number;
    height: number;
}

export interface PlaceOptions
{
    side?: Side;
    align?: Align;
    gap?: number;
    padding?: number;
    rtl?: boolean;
    flip?: boolean;
}

export interface Placed
{
    x: number;
    y: number;
    side: 'top' | 'bottom' | 'left' | 'right';
    align: Align;
    arrow: number;
}

export function physicalSide(side: Side, rtl: boolean): 'top' | 'bottom' | 'left' | 'right'
{
    if (side === 'start')
    {
        return rtl ? 'right' : 'left';
    }
    if (side === 'end')
    {
        return rtl ? 'left' : 'right';
    }
    return side;
}

function opposite(side: 'top' | 'bottom' | 'left' | 'right'): 'top' | 'bottom' | 'left' | 'right'
{
    if (side === 'top')
    {
        return 'bottom';
    }
    if (side === 'bottom')
    {
        return 'top';
    }
    return side === 'left' ? 'right' : 'left';
}

function fits(side: 'top' | 'bottom' | 'left' | 'right', anchor: Box, floating: Size, viewport: Viewport, gap: number, padding: number): boolean
{
    if (side === 'top')
    {
        return anchor.y - gap - floating.height >= padding;
    }
    if (side === 'bottom')
    {
        return anchor.y + anchor.height + gap + floating.height <= viewport.height - padding;
    }
    if (side === 'left')
    {
        return anchor.x - gap - floating.width >= padding;
    }
    return anchor.x + anchor.width + gap + floating.width <= viewport.width - padding;
}

function clamp(value: number, low: number, high: number): number
{
    return Math.min(Math.max(value, low), Math.min(high, Math.max(low, high)));
}

export function place(anchor: Box, floating: Size, viewport: Viewport, options: PlaceOptions = {}): Placed
{
    const gap = options.gap ?? 8;
    const padding = options.padding ?? 8;
    const rtl = options.rtl === true;
    const align = options.align ?? 'center';

    let side = physicalSide(options.side ?? 'top', rtl);
    if (options.flip !== false && !fits(side, anchor, floating, viewport, gap, padding) && fits(opposite(side), anchor, floating, viewport, gap, padding))
    {
        side = opposite(side);
    }

    const vertical = side === 'top' || side === 'bottom';

    const main = side === 'top'
        ? anchor.y - gap - floating.height
        : (side === 'bottom'
            ? anchor.y + anchor.height + gap
            : (side === 'left' ? anchor.x - gap - floating.width : anchor.x + anchor.width + gap));

    const anchorStart = vertical ? anchor.x : anchor.y;
    const anchorSize = vertical ? anchor.width : anchor.height;
    const floatingSize = vertical ? floating.width : floating.height;
    const limit = vertical ? viewport.width : viewport.height;

    const leading = align === 'start' ? anchorStart : (align === 'end' ? anchorStart + anchorSize - floatingSize : anchorStart + (anchorSize - floatingSize) / 2);
    const cross = clamp(leading, padding, limit - padding - floatingSize);

    const centre = anchorStart + anchorSize / 2;
    const arrow = clamp(centre - cross, 10, Math.max(10, floatingSize - 10));

    return {
        x: Math.round(vertical ? cross : main),
        y: Math.round(vertical ? main : cross),
        side,
        align,
        arrow: Math.round(arrow)
    };
}

export function boxOf(element: Element): Box
{
    const rect = element.getBoundingClientRect();
    return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
}

export function viewportOf(): Viewport
{
    if (typeof window === 'undefined')
    {
        return { width: 0, height: 0 };
    }
    return { width: window.innerWidth, height: window.innerHeight };
}
