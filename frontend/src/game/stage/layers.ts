export const LAYER = {
    piece: 10,
    count: 20,
    mark: 22,
    cube: 25,
    moving: 40,
    airborne: 41,
    dice: 60,
    burst: 70,
    banner: 80
} as const;

export function layered(host: HTMLElement)
{
    for (const [name, value] of Object.entries(LAYER))
    {
        host.style.setProperty(`--layer-${ name }`, String(value));
    }
}
