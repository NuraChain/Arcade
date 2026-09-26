type Querying = { query: (...args: never[]) => Promise<unknown> };

export function oneAtATime<T extends Querying>(runner: T): T
{
    const query = runner.query.bind(runner) as (...args: unknown[]) => Promise<unknown>;
    let tail: Promise<unknown> = Promise.resolve();

    (runner as unknown as { query: (...args: unknown[]) => Promise<unknown> }).query = (...args: unknown[]): Promise<unknown> =>
    {
        const next = tail.then(() => query(...args));

        tail = next.catch(() => undefined);

        return next;
    };

    return runner;
}
