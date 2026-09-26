export type MotionKit = typeof import('./motion-kit.ts');

let loading: Promise<MotionKit> | null = null;

export function motion(): Promise<MotionKit>
{
    loading ??= import('./motion-kit.ts');
    return loading;
}

export function flip(list: HTMLElement, tops: Map<string, number>, kit: MotionKit | null, still: boolean): void
{
    const seen = new Set<string>();

    for (const row of list.querySelectorAll<HTMLElement>('[data-flip]'))
    {
        const id = row.dataset.flip ?? '';
        const top = row.offsetTop;
        const was = tops.get(id);

        seen.add(id);
        tops.set(id, top);

        if (kit !== null && !still && was !== undefined && Math.abs(was - top) > 1)
        {
            void kit.glide(row, was - top);
        }
    }

    for (const id of [...tops.keys()])
    {
        if (!seen.has(id))
        {
            tops.delete(id);
        }
    }
}
