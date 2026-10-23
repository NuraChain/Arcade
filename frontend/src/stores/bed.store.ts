import { createEffect, createRoot, createSignal, createStore, untrack } from 'azerothjs';

import { BEDS } from '../game/bed-files.ts';
import { createBed, type BedState, type BedWant } from '../game/bed.ts';
import { useSettings } from './settings.store.ts';
import { useVoice } from './voice.store.ts';

export interface BedApi
{
    hold(table: string, said: (state: BedState) => void): () => void;
}

const same = (a: BedWant | null, b: BedWant | null) =>
    a === b || (a !== null && b !== null && a.url === b.url && a.volume === b.volume && a.ducked === b.ducked && a.hidden === b.hidden);

/**
 * The background behind a table's page. `hold` plays it for that table until its answer is called, and a
 * later hold takes over from an earlier one, because a page that is leaving lets go after the next one has
 * opened. It follows the reader's switch and volume, sits under the call at that table and is held while
 * the tab is hidden; `said` hears what it is doing.
 */
export const useBed = createStore((): BedApi =>
{
    const settings = useSettings();
    const voice = useVoice();
    const [hidden, setHidden] = createSignal(false);
    let said: (state: BedState) => void = () => undefined;
    let holder = 0;
    let wanted: BedWant | null = null;
    let end: (() => void) | null = null;
    const bed = createBed((state) => said(state));

    const seen = () => setHidden(document.visibilityState === 'hidden');

    return {
        hold: (table, tell) =>
        {
            holder += 1;

            const mine = holder;

            end?.();
            said = tell;
            tell(bed.state());
            seen();
            document.addEventListener('visibilitychange', seen);

            const dispose = createRoot((stop) =>
            {
                createEffect(() =>
                {
                    const current = settings.settings();
                    const next: BedWant | null = current.background
                        ? { url: BEDS.rain, volume: current.backgroundVolume, ducked: voice.table() === table, hidden: hidden() }
                        : null;

                    if (!same(next, wanted))
                    {
                        wanted = next;
                        untrack(() => bed.set(next));
                    }
                });

                return stop;
            });

            end = () =>
            {
                dispose();
                document.removeEventListener('visibilitychange', seen);
            };

            return () =>
            {
                if (mine !== holder)
                {
                    return;
                }

                end?.();
                end = null;
                wanted = null;
                bed.set(null);
                said = () => undefined;
            };
        }
    };
});
