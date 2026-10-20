interface Rejections
{
    on(event: 'unhandledRejection', listener: (reason: unknown) => void): void;
    off(event: 'unhandledRejection', listener: (reason: unknown) => void): void;
}

export async function lostDuring(run: () => Promise<void>)
{
    const node = (globalThis as unknown as { process: Rejections }).process;
    const lost: unknown[] = [];
    const onLost = (reason: unknown) =>
    {
        lost.push(reason);
    };

    node.on('unhandledRejection', onLost);

    try
    {
        await run();
        await new Promise((resolve) => setTimeout(resolve, 0));
    }
    finally
    {
        node.off('unhandledRejection', onLost);
    }

    return lost;
}
