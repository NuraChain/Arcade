export type Sampled =
    | 'card-slide'
    | 'card-place'
    | 'card-gather'
    | 'card-shuffle'
    | 'card-fan'
    | 'hand-won'
    | 'die-land'
    | 'die-shake'
    | 'token-step'
    | 'token-capture'
    | 'token-yard'
    | 'win';

export const SAMPLED: readonly Sampled[] = [
    'card-slide',
    'card-place',
    'card-gather',
    'card-shuffle',
    'card-fan',
    'hand-won',
    'die-land',
    'die-shake',
    'token-step',
    'token-capture',
    'token-yard',
    'win'
];

export const PACK = new URL('./sound/table.cues', import.meta.url).href;

const MAGIC = 'NCUE';

export function unpack(bytes: ArrayBuffer): Map<Sampled, ArrayBuffer[]>
{
    const found = new Map<Sampled, ArrayBuffer[]>();

    if (bytes.byteLength < 8 || new TextDecoder().decode(bytes.slice(0, 4)) !== MAGIC)
    {
        return found;
    }

    const length = new DataView(bytes).getUint32(4, true);
    const start = 8 + length;
    const index = JSON.parse(new TextDecoder().decode(bytes.slice(8, start))) as Record<string, [number, number][]>;

    for (const cue of SAMPLED)
    {
        const takes = (index[cue] ?? [])
            .filter(([offset, size]) => offset >= 0 && size > 0 && start + offset + size <= bytes.byteLength)
            .map(([offset, size]) => bytes.slice(start + offset, start + offset + size));

        if (takes.length > 0)
        {
            found.set(cue, takes);
        }
    }

    return found;
}
