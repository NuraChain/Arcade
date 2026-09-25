import type { CuesApi } from './cues.store.ts';

export interface CuesHand
{
    current: CuesApi | null;
}

/**
 * The one indirection that keeps the cues module out of the shell chunk.
 *
 * A dynamic import written directly in the shell makes the bundler inline its dependency table
 * there - twenty chunk urls the shell never needed before, and that alone pushed it over budget.
 * Putting the import behind this tiny module moves the table into a lazy chunk of its own; the
 * shell pays a static import of a few dozen bytes and starts the store one promise later.
 */
export function startCues(hand: CuesHand, navigate: (to: string) => void, stops: (() => void)[]): void
{
    void import('./cues.store.ts')
        .then((module) =>
        {
            if (hand.current === null)
            {
                const cues = module.useCues();
                hand.current = cues;
                cues.navigateTo(navigate);
                stops.push(cues.start());
            }
        })
        .catch(() => undefined);
}
