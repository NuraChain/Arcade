import { haptic } from './haptics.ts';
import { createDrag } from './swipe.ts';
import { runtime } from './runtime.ts';

export const SWIPE_REPLY = 56;

const SWIPE_MAX = 80;

export function swipeReach(offset: number, rtl: boolean): number
{
    const toward = rtl ? offset : -offset;

    return Math.min(Math.max(toward, 0), SWIPE_MAX);
}

export function attachSwipeReply(row: HTMLElement, cue: HTMLElement | null, rtl: () => boolean, run: () => void): () => void
{
    const drag = createDrag({ threshold: SWIPE_REPLY, velocity: 10, axis: 'x', allowNegative: true });
    let reach = 0;
    let armed = false;

    const paint = (distance: number): void =>
    {
        const lead = rtl() ? distance : -distance;
        row.style.transform = distance === 0 ? '' : `translateX(${ lead }px)`;

        if (cue !== null)
        {
            cue.style.opacity = String(Math.min(distance / SWIPE_REPLY, 1));
            cue.style.transform = `translateY(-50%) scale(${ 0.6 + Math.min(distance / SWIPE_REPLY, 1) * 0.4 })`;
        }
    };

    const settle = (): void =>
    {
        row.style.transition = 'transform 180ms ease-out';
        paint(0);
        runtime().clock.after(200, () =>
        {
            row.style.transition = '';
        });
    };

    const down = (event: PointerEvent): void =>
    {
        if (event.pointerType !== 'touch')
        {
            return;
        }
        reach = 0;
        armed = false;
        row.style.transition = '';
        drag.start(event.clientX, event.clientY, event.timeStamp);
    };

    const move = (event: PointerEvent): void =>
    {
        if (!drag.active())
        {
            return;
        }

        const frame = drag.move(event.clientX, event.clientY, event.timeStamp);

        if (frame.axis !== 'x')
        {
            return;
        }

        reach = swipeReach(frame.offset, rtl());
        paint(reach);

        if (!armed && reach >= SWIPE_REPLY)
        {
            armed = true;
            haptic('select');
        }
        else if (armed && reach < SWIPE_REPLY)
        {
            armed = false;
        }
    };

    const up = (event: PointerEvent): void =>
    {
        if (!drag.active())
        {
            return;
        }

        drag.end(event.timeStamp);

        if (reach > 0)
        {
            settle();
        }

        if (armed)
        {
            run();
        }

        reach = 0;
        armed = false;
    };

    row.addEventListener('pointerdown', down);
    row.addEventListener('pointermove', move);
    row.addEventListener('pointerup', up);
    row.addEventListener('pointercancel', up);

    return () =>
    {
        row.removeEventListener('pointerdown', down);
        row.removeEventListener('pointermove', move);
        row.removeEventListener('pointerup', up);
        row.removeEventListener('pointercancel', up);
        row.style.transform = '';
    };
}
