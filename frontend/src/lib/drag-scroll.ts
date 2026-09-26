const DRAG_FROM = 4;

const SWALLOW_MS = 80;

export function dragScroll(scroller: HTMLElement): () => void
{
    let drag: { id: number; x: number; left: number; moved: boolean } | null = null;
    let swallowUntil = 0;

    const capture = (id: number): boolean =>
    {
        try
        {
            scroller.setPointerCapture?.(id);
            return true;
        }
        catch
        {
            return false;
        }
    };

    const press = (event: PointerEvent): void =>
    {
        if (event.pointerType !== 'mouse' || event.button !== 0 || scroller.scrollWidth - scroller.clientWidth <= 1)
        {
            return;
        }
        drag = { id: event.pointerId, x: event.clientX, left: scroller.scrollLeft, moved: false };
    };

    const slide = (event: PointerEvent): void =>
    {
        if (drag === null || event.pointerId !== drag.id)
        {
            return;
        }

        const dx = event.clientX - drag.x;

        if (!drag.moved)
        {
            if (Math.abs(dx) < DRAG_FROM)
            {
                return;
            }
            drag.moved = true;
            scroller.dataset.dragging = 'true';
            capture(event.pointerId);
        }

        scroller.scrollLeft = drag.left - dx;
    };

    const release = (event: PointerEvent): void =>
    {
        if (drag === null || event.pointerId !== drag.id)
        {
            return;
        }

        if (drag.moved)
        {
            swallowUntil = performance.now() + SWALLOW_MS;
        }

        drag = null;
        delete scroller.dataset.dragging;
    };

    const swallow = (event: Event): void =>
    {
        if (performance.now() < swallowUntil)
        {
            event.preventDefault();
            event.stopPropagation();
        }
    };

    const still = (event: Event): void =>
    {
        if (drag !== null)
        {
            event.preventDefault();
        }
    };

    scroller.addEventListener('pointerdown', press);
    scroller.addEventListener('pointermove', slide);
    scroller.addEventListener('pointerup', release);
    scroller.addEventListener('pointercancel', release);
    scroller.addEventListener('click', swallow, true);
    scroller.addEventListener('dragstart', still);

    return () =>
    {
        scroller.removeEventListener('pointerdown', press);
        scroller.removeEventListener('pointermove', slide);
        scroller.removeEventListener('pointerup', release);
        scroller.removeEventListener('pointercancel', release);
        scroller.removeEventListener('click', swallow, true);
        scroller.removeEventListener('dragstart', still);
        delete scroller.dataset.dragging;
    };
}
