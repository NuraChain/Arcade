import { useNavigate, useQuery, useRoute } from 'azerothjs';

export interface PageParams<K extends string>
{
    page(key: K): number;
    turn(key: K, page: number): void;
    reset(): void;
}

export function pageOf(raw: string | string[] | undefined)
{
    const asked = Number(Array.isArray(raw) ? raw[0] : (raw ?? '1'));

    return Number.isInteger(asked) && asked > 1 ? asked : 1;
}

export function addressWith(path: string, query: Readonly<Record<string, string | string[]>>, pages: Readonly<Record<string, number>>)
{
    const params = new URLSearchParams();

    for (const [name, value] of Object.entries(query))
    {
        if (name in pages)
        {
            continue;
        }

        for (const one of Array.isArray(value) ? value : [value])
        {
            params.append(name, one);
        }
    }

    for (const [name, page] of Object.entries(pages))
    {
        if (page > 1)
        {
            params.set(name, String(page));
        }
    }

    const search = params.toString();

    return search === '' ? path : `${ path }?${ search }`;
}

export function usePageParams<K extends string>(keys: readonly K[]): PageParams<K>
{
    const query = useQuery();
    const route = useRoute();
    const { replace } = useNavigate();

    const go = (pages: Readonly<Record<string, number>>) =>
    {
        const now = query();

        if (Object.entries(pages).every(([key, page]) => pageOf(now[key]) === page))
        {
            return;
        }

        void replace(addressWith(route().pathname, now, pages));
    };

    return {
        page: (key) => pageOf(query()[key]),
        turn: (key, page) => go({ [key]: page }),
        reset: () => go(Object.fromEntries(keys.map((key) => [key, 1])))
    };
}
