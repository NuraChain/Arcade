export const SHEET_SHARE = 0.48;

export const SHEET_LINE_REM = 2.5;

export interface SheetSize
{
    pad: number;
    height: number;
}

export const sheetRoom = (sheet: number, fit: number, floor: number, least: number, most: number) =>
    Math.round(Math.max(0, Math.min(Math.max(most, least), sheet + fit - floor)));

export const sheetNext = (sheet: number, room: number, steady: boolean) => (steady ? Math.min(sheet, room) : room);

export const sheetReach = (pad: number, least: number, bare: number, below: number) =>
    Math.round(Math.max(pad, Math.min(least, Math.max(bare, below))));

export interface ChatNeeds
{
    least: number;
    bare: number;
}

export function chatNeeds(sheet: HTMLElement, line: number): ChatNeeds
{
    let thread: HTMLElement | null = null;
    let hidden = 0;
    let given = 0;
    let kept = 0;

    for (const element of sheet.querySelectorAll<HTMLElement>('*'))
    {
        const style = getComputedStyle(element);

        if (element.hasAttribute('data-yield'))
        {
            hidden += element.scrollHeight - element.clientHeight;
            given += element.offsetHeight;
            kept += parseFloat(style.minHeight) || 0;
        }
        else if (thread === null && (style.overflowY === 'auto' || style.overflowY === 'scroll') && parseFloat(style.flexGrow) > 0)
        {
            thread = element;
        }
    }

    const rigid = sheet.scrollHeight - (thread?.clientHeight ?? 0);
    const inset = thread === null ? 0 : (parseFloat(getComputedStyle(thread).paddingTop) || 0) + (parseFloat(getComputedStyle(thread).paddingBottom) || 0);

    return { least: Math.round(rigid + hidden + line), bare: Math.round(rigid - given + kept + inset) };
}

const fitOf = (arena: HTMLElement) => arena.querySelector<HTMLElement>('.table-stage .table-fit');

const floorOf = (fit: HTMLElement | null) => (fit === null ? Number.NaN : parseFloat(getComputedStyle(fit).getPropertyValue('--fit-min')));

function watchFit(arena: HTMLElement, chat: HTMLElement | null, measure: () => void): () => void
{
    let frame = 0;

    const run = () =>
    {
        frame = 0;
        measure();
    };

    const soon = () =>
    {
        if (frame === 0)
        {
            frame = requestAnimationFrame(run);
        }
    };

    if (typeof ResizeObserver === 'undefined' || typeof MutationObserver === 'undefined')
    {
        measure();
        return () => undefined;
    }

    let watched: Element | null = null;
    const sizes = new ResizeObserver(soon);

    const bind = () =>
    {
        const fit = fitOf(arena);

        if (fit !== watched)
        {
            if (watched !== null)
            {
                sizes.unobserve(watched);
            }

            if (fit !== null)
            {
                sizes.observe(fit);
            }

            watched = fit;
            soon();
        }
    };

    const tree = new MutationObserver(bind);
    const talk = new MutationObserver(soon);

    sizes.observe(arena);
    tree.observe(arena, { childList: true, subtree: true });

    if (chat !== null)
    {
        talk.observe(chat, { childList: true, subtree: true });
    }

    bind();
    soon();

    return () =>
    {
        sizes.disconnect();
        tree.disconnect();
        talk.disconnect();

        if (frame !== 0)
        {
            cancelAnimationFrame(frame);
        }
    };
}

export function watchSheet(arena: HTMLElement, sheet: HTMLElement, settle: (size: SheetSize | null) => void)
{
    let sized = 0;
    let last: SheetSize | null | undefined;

    const put = (size: SheetSize | null) =>
    {
        if (last === undefined || size?.pad !== last?.pad || size?.height !== last?.height)
        {
            last = size;
            settle(size);
        }
    };

    return watchFit(arena, sheet, () =>
    {
        const fit = fitOf(arena);
        const floor = floorOf(fit);

        if (fit === null || !(floor > 0))
        {
            sized = 0;
            put(null);
            return;
        }

        const most = window.innerHeight * SHEET_SHARE;
        const steady = Math.abs(most - sized) < 1;
        const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
        const padding = parseFloat(getComputedStyle(arena).paddingBottom);
        const current = Number.isFinite(padding) ? padding : most;
        const box = fit.getBoundingClientRect();
        const { least, bare } = chatNeeds(sheet, Math.round(SHEET_LINE_REM * rem));
        const pad = sheetNext(current, sheetRoom(current, box.height, floor, least, most), steady);

        sized = most;
        put({ pad, height: sheetReach(pad, least, bare, window.innerHeight - (box.bottom + current - pad)) });
    });
}

export function watchFold(arena: HTMLElement, settle: (fold: boolean) => void)
{
    let folded = false;
    let height = window.innerHeight;

    return watchFit(arena, null, () =>
    {
        if (Math.abs(window.innerHeight - height) >= 1)
        {
            height = window.innerHeight;

            if (folded)
            {
                folded = false;
                settle(false);
                return;
            }
        }

        const fit = fitOf(arena);
        const floor = floorOf(fit);

        if (folded || fit === null || !(floor > 0) || fit.getBoundingClientRect().height >= floor - 0.5)
        {
            return;
        }

        folded = true;
        settle(true);
    });
}

export function watchEdge(element: HTMLElement, settle: (bottom: number) => void): () => void
{
    let last = Number.NaN;

    const measure = () =>
    {
        const bottom = Math.round(element.getBoundingClientRect().bottom);

        if (bottom !== last)
        {
            last = bottom;
            settle(bottom);
        }
    };

    measure();
    window.addEventListener('resize', measure);

    const sizes = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);

    sizes?.observe(element);

    return () =>
    {
        sizes?.disconnect();
        window.removeEventListener('resize', measure);
    };
}
