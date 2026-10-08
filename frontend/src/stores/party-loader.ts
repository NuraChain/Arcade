export function startParty(stops: (() => void)[])
{
    let stop: (() => void) | null = null;
    let gone = false;

    stops.push(() =>
    {
        gone = true;
        stop?.();
    });

    void import('../components/social/party.ts')
        .then((module) =>
        {
            if (!gone)
            {
                stop = module.begin();
            }
        })
        .catch(() => undefined);
}
