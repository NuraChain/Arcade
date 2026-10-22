export type Mac = (key: Uint8Array, message: Uint8Array) => Uint8Array;

export type Hash = (data: Uint8Array) => Uint8Array;

export const OPENING = 1;

const SPAN = 2 ** 32;

const text = new TextEncoder();

export function bytesOf(hex: string)
{
    const body = hex.startsWith('0x') ? hex.slice(2) : hex;
    const bytes = new Uint8Array(body.length >> 1);

    for (let at = 0; at < bytes.length; at += 1)
    {
        bytes[at] = Number.parseInt(body.slice(at * 2, at * 2 + 2), 16);
    }

    return bytes;
}

export function hexOf(bytes: Uint8Array)
{
    return `0x${ Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('') }`;
}

export function seedOf(hash: Hash, secrets: readonly string[], signatures: readonly string[])
{
    const parts = [...secrets, ...signatures].map(bytesOf);
    const joined = new Uint8Array(parts.reduce((length, part) => length + part.length, 0));
    let at = 0;

    for (const part of parts)
    {
        joined.set(part, at);
        at += part.length;
    }

    return hash(joined);
}

export function drawOf(mac: Mac, seed: Uint8Array, rev: number, index: number, sides: number)
{
    if (sides <= 1)
    {
        return 1;
    }

    const ceiling = SPAN - (SPAN % sides);

    for (let round = 0; ; round += 1)
    {
        const out = mac(seed, text.encode(`${ rev }.${ index }.${ round }`));
        const value = new DataView(out.buffer, out.byteOffset, out.byteLength).getUint32(0);

        if (value < ceiling)
        {
            return (value % sides) + 1;
        }
    }
}

export function drawsOf(mac: Mac, seed: Uint8Array, rev: number)
{
    let index = 0;

    return {
        die: (sides: number) =>
        {
            const drawn = drawOf(mac, seed, rev, index, sides);

            index += 1;

            return drawn;
        }
    };
}
