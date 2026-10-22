import { createSignal, createStore, type Getter } from 'azerothjs';

import { client } from '../api.ts';

export interface ReportsApi
{
    waiting: Getter<number>;
    told(count: number): void;
    shift(by: number): void;
    read(): Promise<void>;
    start(): () => void;
    reset(): void;
}

export const useReports = createStore((): ReportsApi =>
{
    const [waiting, setWaiting] = createSignal(0);
    let asked = 0;
    let stop: (() => void) | null = null;

    const told = (count: number) =>
    {
        asked += 1;
        setWaiting(count);
    };

    const read = async () =>
    {
        asked += 1;

        const mine = asked;
        const answer = await client.admin.reportsWaiting().catch(() => null);

        if (answer !== null && mine === asked)
        {
            setWaiting(answer.count);
        }
    };

    const seen = () =>
    {
        if (document.visibilityState === 'visible')
        {
            void read();
        }
    };

    return {
        waiting,
        told,
        read,

        shift(by)
        {
            asked += 1;
            setWaiting((count) => Math.max(0, count + by));
        },

        start()
        {
            if (stop === null)
            {
                document.addEventListener('visibilitychange', seen);
                stop = () =>
                {
                    document.removeEventListener('visibilitychange', seen);
                    stop = null;
                };
            }

            return stop;
        },

        reset()
        {
            stop?.();
            asked += 1;
            setWaiting(0);
        }
    };
});
