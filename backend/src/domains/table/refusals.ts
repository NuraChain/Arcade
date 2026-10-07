export const TABLE_REFUSALS = {
    'seated-max': 409,
    'playing': 409,
    'table-closed': 409,
    'chairs-empty': 409,
    'not-ready': 409,
    'no-invitee': 404
} as const satisfies Record<string, 404 | 409>;

export type TableRefusal = keyof typeof TABLE_REFUSALS;

export const isTableRefusal = (value: string): value is TableRefusal => Object.hasOwn(TABLE_REFUSALS, value);
