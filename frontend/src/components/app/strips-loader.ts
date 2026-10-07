export interface StripsHand
{
    draw: (() => unknown) | null;
}

export function loadStrips(hand: StripsHand, ready: () => void, stops: (() => void)[])
{
    void import('./strips.ts')
        .then((module) =>
        {
            hand.draw = module.draw;
            stops.push(module.begin());
            ready();
        })
        .catch(() => undefined);
}
