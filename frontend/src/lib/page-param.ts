import { useNavigate, useQuery, useRoute } from 'azerothjs';

export interface PageParams<K extends string>
{
    page(key: K): number;
    turn(key: K, page: number): void;
    reset(words?: Readonly<Record<string, string>>): void;
}

export interface Address
{
    text(key: string): string;
    write(values: Readonly<Record<string, number | string>>): void;
}

export function pageOf(raw: string | string[] | undefined)
{
    const asked = Number(Array.isArray(raw) ? raw[0] : (raw ?? '1'));

    return Number.isInteger(asked) && asked > 1 ? asked : 1;
}

export function textOf(raw: string | string[] | undefined)
{
    return (Array.isArray(raw) ? raw[0] : raw) ?? '';
}

export function addressWith(path: string, query: Readonly<Record<string, string | string[]>>, values: Readonly<Record<string, number | string>>)
{
    const params = new URLSearchParams();

    for (const [name, value] of Object.entries(query))
    {
        for (const one of Array.isArray(value) ? value : [value])
        {
            params.append(name, one);
        }
    }

    for (const [name, value] of Object.entries(values))
    {
        if (typeof value === 'number' ? value > 1 : value !== '')
        {
            params.set(name, String(value));
        }
        else
        {
            params.delete(name);
        }
    }

    const search = params.toString();

    return search === '' ? path : `${ path }?${ search }`;
}

export function useAddress(): Address
{
    const query = useQuery();
    const route = useRoute();
    const { replace } = useNavigate();

    const holds = (now: Readonly<Record<string, string | string[]>>, key: string, value: number | string) =>
        typeof value === 'number' ? pageOf(now[key]) === value : textOf(now[key]) === value;

    return {
        text: (key) => textOf(query()[key]),
        write: (values) =>
        {
            const now = query();

            if (Object.entries(values).every(([key, value]) => holds(now, key, value)))
            {
                return;
            }

            void replace(addressWith(route().pathname, now, values));
        }
    };
}

export function usePageParams<K extends string>(keys: readonly K[]): PageParams<K>
{
    const query = useQuery();
    const address = useAddress();

    return {
        page: (key) => pageOf(query()[key]),
        turn: (key, page) => address.write({ [key]: page }),
        reset: (words = {}) => address.write({ ...words, ...Object.fromEntries(keys.map((key) => [key, 1])) })
    };
}
