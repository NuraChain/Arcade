export function keyedQueue()
{
    const tails = new Map<string, Promise<void>>();

    return {
        run<T>(key: string, task: () => Promise<T>)
        {
            const turn = (tails.get(key) ?? Promise.resolve()).then(task);
            const tail = turn.then(() => undefined, () => undefined);

            tails.set(key, tail);

            void tail.then(() =>
            {
                if (tails.get(key) === tail)
                {
                    tails.delete(key);
                }
            });

            return turn;
        }
    };
}
