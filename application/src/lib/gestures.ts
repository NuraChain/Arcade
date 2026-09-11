import { runtime } from './runtime.ts';

export const PULL_ARM = 72;
export const PULL_MAX = 116;
export const BACK_EDGE = 30;
export const BACK_SHARE = 0.32;

export function resist(raw: number): number
{
    const pull = Math.max(0, raw);
    return pull <= 40 ? pull : Math.min(PULL_MAX, 40 + (pull - 40) * 0.42);
}

export interface GestureHooks
{
    rtl(): boolean;
    refresh?(): void;
    back?(): void;
    onPull?(distance: number, armed: boolean): void;
    onSlide?(distance: number): void;
}

type Mode = 'idle' | 'pull' | 'back' | 'reject';

export function attachGestures(element: HTMLElement, hooks: GestureHooks): () => void
{
    let mode: Mode = 'idle';
    let pointer = -1;
    let startX = 0;
    let startY = 0;
    let lastAt = 0;
    let lastMain = 0;
    let speed = 0;

    const reset = (): void =>
    {
        if (mode === 'pull')
        {
            hooks.onPull?.(0, false);
        }
        if (mode === 'back')
        {
            hooks.onSlide?.(0);
        }
        mode = 'reject';
        pointer = -1;
    };

    const onStart = (event: TouchEvent): void =>
    {
        if (event.touches.length !== 1)
        {
            reset();
            return;
        }
        const touch = event.touches[0];
        pointer = touch.identifier;
        startX = touch.clientX;
        startY = touch.clientY;
        lastAt = runtime().clock.now();
        lastMain = 0;
        speed = 0;
        mode = 'idle';
    };

    const find = (event: TouchEvent): Touch | null =>
    {
        for (let index = 0; index < event.touches.length; index += 1)
        {
            if (event.touches[index].identifier === pointer)
            {
                return event.touches[index];
            }
        }
        return null;
    };

    const onMove = (event: TouchEvent): void =>
    {
        if (mode === 'reject' || pointer === -1)
        {
            return;
        }
        const touch = find(event);
        if (touch === null)
        {
            return;
        }

        const dx = touch.clientX - startX;
        const dy = touch.clientY - startY;
        const lead = hooks.rtl() ? -dx : dx;

        if (mode === 'idle')
        {
            if (Math.max(Math.abs(dx), Math.abs(dy)) < 10)
            {
                return;
            }
            if (Math.abs(dy) > Math.abs(dx))
            {
                mode = hooks.refresh !== undefined && dy > 0 && element.scrollTop <= 0 ? 'pull' : 'reject';
            }
            else
            {
                const fromEdge = hooks.rtl() ? startX >= element.clientWidth - BACK_EDGE : startX <= BACK_EDGE;
                mode = hooks.back !== undefined && lead > 0 && fromEdge ? 'back' : 'reject';
            }
            if (mode === 'reject')
            {
                return;
            }
        }

        const now = runtime().clock.now();
        const main = mode === 'pull' ? dy : lead;
        speed = (main - lastMain) / Math.max(1, now - lastAt);
        lastMain = main;
        lastAt = now;

        if (event.cancelable)
        {
            event.preventDefault();
        }

        if (mode === 'pull')
        {
            const distance = resist(dy);
            hooks.onPull?.(distance, distance >= PULL_ARM);
        }
        else
        {
            hooks.onSlide?.(Math.max(0, lead));
        }
    };

    const onEnd = (): void =>
    {
        const settled = mode;
        const stale = runtime().clock.now() - lastAt > 160;
        const flick = !stale && speed >= 0.5;
        mode = 'idle';
        pointer = -1;

        if (settled === 'pull')
        {
            const armed = resist(lastMain) >= PULL_ARM;
            hooks.onPull?.(0, false);
            if (armed)
            {
                hooks.refresh?.();
            }
        }
        else if (settled === 'back')
        {
            const travelled = lastMain >= element.clientWidth * BACK_SHARE;
            hooks.onSlide?.(0);
            if (travelled || flick)
            {
                hooks.back?.();
            }
        }
    };

    element.addEventListener('touchstart', onStart, { passive: true });
    element.addEventListener('touchmove', onMove, { passive: false });
    element.addEventListener('touchend', onEnd, { passive: true });
    element.addEventListener('touchcancel', reset, { passive: true });

    return () =>
    {
        element.removeEventListener('touchstart', onStart);
        element.removeEventListener('touchmove', onMove);
        element.removeEventListener('touchend', onEnd);
        element.removeEventListener('touchcancel', reset);
    };
}
