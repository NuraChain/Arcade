export function holdScreen(): () => void
{
    let held: WakeLockSentinel | null = null;
    let released = false;

    const hold = (): void =>
    {
        if (released || document.visibilityState !== 'visible' || navigator.wakeLock === undefined)
        {
            return;
        }

        navigator.wakeLock.request('screen')
            .then((sentinel) =>
            {
                if (released)
                {
                    void sentinel.release().catch(() => undefined);
                    return;
                }

                held = sentinel;
            })
            .catch(() => undefined);
    };

    hold();
    document.addEventListener('visibilitychange', hold);

    return () =>
    {
        released = true;
        document.removeEventListener('visibilitychange', hold);
        void held?.release().catch(() => undefined);
        held = null;
    };
}
