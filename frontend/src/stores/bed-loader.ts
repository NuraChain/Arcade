import type { BedState } from '../game/bed.ts';

/** Plays the background behind a table's page, fetched as a chunk of its own; answers how to stop it. */
export function startBed(table: string, said: (state: BedState) => void)
{
    let stop: (() => void) | null = null;
    let gone = false;

    void import('./bed.store.ts')
        .then((module) =>
        {
            if (!gone)
            {
                stop = module.useBed().hold(table, said);
            }
        })
        .catch(() => undefined);

    return () =>
    {
        gone = true;
        stop?.();
    };
}
