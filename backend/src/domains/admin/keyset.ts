const CURSOR = /^(\d{1,17})\|([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

export interface Keyed
{
    id: string;
    at_key: string;
}

export const keyOf = (column: string) => `(extract(epoch from ${ column }) * 1000000)::bigint::text`;

export const keysetAfter = (cursor: string | null) =>
{
    const found = cursor === null ? null : CURSOR.exec(cursor);

    return found === null ? null : { micros: found[1], id: found[2] };
};

export const olderThan = (at: string, id: string) =>
    `(${ at }, ${ id }) < (timestamptz 'epoch' + cast(:micros as bigint) * interval '1 microsecond', cast(:id as uuid))`;

export const cursorOf = <T extends Keyed>(rows: readonly T[], page: number) =>
{
    const last = rows.slice(0, page).at(-1);

    return rows.length > page && last !== undefined ? { cursor: `${ last.at_key }|${ last.id }` } : {};
};
