export interface Clock
{
    now(): number;
    after(ms: number, fn: () => void): () => void;
    every(ms: number, fn: () => void): () => void;
}

export interface ManualClock extends Clock
{
    advance(ms: number): void;
    pending(): number;
}

export function realClock(): Clock
{
    return {
        now: () => Date.now(),
        after(ms, fn)
        {
            const handle = setTimeout(fn, ms);
            return () => clearTimeout(handle);
        },
        every(ms, fn)
        {
            const handle = setInterval(fn, ms);
            return () => clearInterval(handle);
        }
    };
}

interface Due
{
    at: number;
    seq: number;
    fn: () => void;
    cancelled: boolean;
}

export function manualClock(start = 0): ManualClock
{
    let current = start;
    let seq = 0;
    let queue: Due[] = [];

    const schedule = (ms: number, fn: () => void): Due =>
    {
        seq += 1;
        const entry: Due = { at: current + Math.max(0, ms), seq, fn, cancelled: false };
        queue.push(entry);
        return entry;
    };

    const nextDue = (limit: number): Due | undefined =>
    {
        let best: Due | undefined;
        for (const entry of queue)
        {
            if (entry.cancelled || entry.at > limit)
            {
                continue;
            }
            if (best === undefined || entry.at < best.at || (entry.at === best.at && entry.seq < best.seq))
            {
                best = entry;
            }
        }
        return best;
    };

    return {
        now: () => current,

        after(ms, fn)
        {
            const entry = schedule(ms, fn);
            return () =>
            {
                entry.cancelled = true;
            };
        },

        every(ms, fn)
        {
            let stopped = false;
            let entry: Due | null = null;
            const tick = (): void =>
            {
                if (stopped)
                {
                    return;
                }
                entry = schedule(ms, tick);
                fn();
            };
            entry = schedule(ms, tick);
            return () =>
            {
                stopped = true;
                if (entry !== null)
                {
                    entry.cancelled = true;
                }
            };
        },

        advance(ms)
        {
            const target = current + Math.max(0, ms);
            for (;;)
            {
                const next = nextDue(target);
                if (next === undefined)
                {
                    break;
                }
                queue = queue.filter((entry) => entry !== next);
                current = Math.max(current, next.at);
                next.fn();
            }
            current = target;
            queue = queue.filter((entry) => !entry.cancelled);
        },

        pending: () => queue.filter((entry) => !entry.cancelled).length
    };
}
