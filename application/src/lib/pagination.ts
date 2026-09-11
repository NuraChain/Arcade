export type PageItem = number | 'gap';

export interface PageWindow
{
    page: number;
    pages: number;
    items: PageItem[];
    from: number;
    to: number;
    total: number;
}

export function pageCount(total: number, size: number): number
{
    return Math.max(1, Math.ceil(total / Math.max(1, size)));
}

export function clampPage(page: number, pages: number): number
{
    return Math.min(Math.max(1, Math.round(page)), Math.max(1, pages));
}

export function windowOf(total: number, size: number, page: number, span = 1): PageWindow
{
    const pages = pageCount(total, size);
    const current = clampPage(page, pages);
    const from = total === 0 ? 0 : (current - 1) * size + 1;
    const to = Math.min(total, current * size);

    const wanted = new Set<number>([1, pages, current]);
    for (let step = 1; step <= span; step += 1)
    {
        wanted.add(current - step);
        wanted.add(current + step);
    }
    if (current <= span + 2)
    {
        for (let index = 2; index <= Math.min(pages, span * 2 + 3); index += 1)
        {
            wanted.add(index);
        }
    }
    if (current >= pages - span - 1)
    {
        for (let index = Math.max(1, pages - span * 2 - 2); index < pages; index += 1)
        {
            wanted.add(index);
        }
    }

    const ordered = [...wanted].filter((entry) => entry >= 1 && entry <= pages).sort((a, b) => a - b);
    const items: PageItem[] = [];
    let previous = 0;
    for (const entry of ordered)
    {
        if (previous !== 0 && entry - previous > 1)
        {
            items.push('gap');
        }
        items.push(entry);
        previous = entry;
    }

    return { page: current, pages, items, from, to, total };
}

export function slice<T>(items: readonly T[], size: number, page: number): T[]
{
    const pages = pageCount(items.length, size);
    const current = clampPage(page, pages);
    return items.slice((current - 1) * size, current * size);
}
