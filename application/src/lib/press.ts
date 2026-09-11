import { runtime } from './runtime.ts';

export interface PressOptions
{
    delay?: number;
    slop?: number;
    onPress: () => void;
}

export interface Press
{
    start(x: number, y: number): void;
    move(x: number, y: number): void;
    cancel(): void;
    end(): boolean;
    fired(): boolean;
}

export function createLongPress(options: PressOptions): Press
{
    const delay = options.delay ?? 480;
    const slop = options.slop ?? 10;

    let cancel: (() => void) | null = null;
    let originX = 0;
    let originY = 0;
    let done = false;

    const stop = (): void =>
    {
        cancel?.();
        cancel = null;
    };

    return {
        start(x, y)
        {
            stop();
            originX = x;
            originY = y;
            done = false;
            cancel = runtime().clock.after(delay, () =>
            {
                cancel = null;
                done = true;
                options.onPress();
            });
        },

        move(x, y)
        {
            if (cancel !== null && Math.max(Math.abs(x - originX), Math.abs(y - originY)) > slop)
            {
                stop();
            }
        },

        cancel()
        {
            stop();
            done = false;
        },

        end()
        {
            stop();
            const fired = done;
            done = false;
            return fired;
        },

        fired: () => done
    };
}
