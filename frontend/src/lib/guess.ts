import { createSignal } from 'azerothjs';

export type Guess<T> = (held: T) => T;

export interface Guesses<T>
{
    over(held: T): T;
    during<R>(guess: Guess<T>, send: () => Promise<R>, read: () => Promise<unknown>): Promise<R>;
    landed(): void;
    standing(): boolean;
    clear(): void;
}

interface Made<T>
{
    guess: Guess<T>;
    owed: boolean;
}

const started = async <R>(work: () => Promise<R>) => work();

export function createGuesses<T>(): Guesses<T>
{
    const [made, setMade] = createSignal<readonly Made<T>[]>([]);

    const without = (gone: (one: Made<T>) => boolean) =>
        setMade((current) => (current.some(gone) ? current.filter((one) => !gone(one)) : current));

    return {
        over: (held) => made().reduce((shown, one) => one.guess(shown), held),

        async during(guess, send, read)
        {
            const mine: Made<T> = { guess, owed: false };
            const back = () => without((one) => one === mine);

            setMade((current) => [...current, mine]);

            const answer = await started(send).catch((error: unknown) =>
            {
                back();
                throw error;
            });

            await started(read).then(back, () =>
            {
                mine.owed = true;
            });

            return answer;
        },

        landed: () => without((one) => one.owed),

        standing: () => made().length > 0,

        clear: () => without(() => true)
    };
}
