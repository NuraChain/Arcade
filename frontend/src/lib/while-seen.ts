import { runtime } from './runtime.ts';

export const READ_EVERY_MS = 15_000;

export const whileSeen = (read: () => void) =>
{
    const seen = () =>
    {
        if (document.visibilityState === 'visible')
        {
            read();
        }
    };
    const stop = runtime().clock.every(READ_EVERY_MS, seen);

    document.addEventListener('visibilitychange', seen);

    return () =>
    {
        stop();
        document.removeEventListener('visibilitychange', seen);
    };
};
