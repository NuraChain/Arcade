import { haptic } from './haptics.ts';
import { createLongPress } from './press.ts';
import { runtime } from './runtime.ts';

export function attachHold(element: HTMLElement, run: () => void): () => void
{
    let release: (() => void) | null = null;
    let touching = false;

    const swallow = (event: Event): void =>
    {
        event.preventDefault();
        event.stopPropagation();
    };

    const disarm = (): void =>
    {
        release?.();
        release = null;
    };

    const arm = (): void =>
    {
        disarm();
        document.addEventListener('click', swallow, true);
        const expire = runtime().clock.after(600, disarm);
        release = () =>
        {
            document.removeEventListener('click', swallow, true);
            expire();
        };
    };

    const press = createLongPress({
        onPress: () =>
        {
            haptic('select');
            arm();
            run();
        }
    });

    const down = (event: PointerEvent): void =>
    {
        touching = event.pointerType !== 'mouse';
        if (!touching || !event.isPrimary)
        {
            return;
        }
        press.start(event.clientX, event.clientY);
    };

    const move = (event: PointerEvent): void => press.move(event.clientX, event.clientY);
    const up = (): void => void press.end();
    const cancel = (): void => press.cancel();

    const menu = (event: Event): void =>
    {
        if (touching)
        {
            event.preventDefault();
        }
    };

    element.addEventListener('pointerdown', down, { passive: true });
    element.addEventListener('pointermove', move, { passive: true });
    element.addEventListener('pointerup', up, { passive: true });
    element.addEventListener('pointercancel', cancel, { passive: true });
    element.addEventListener('contextmenu', menu);

    return () =>
    {
        disarm();
        press.cancel();
        element.removeEventListener('pointerdown', down);
        element.removeEventListener('pointermove', move);
        element.removeEventListener('pointerup', up);
        element.removeEventListener('pointercancel', cancel);
        element.removeEventListener('contextmenu', menu);
    };
}
