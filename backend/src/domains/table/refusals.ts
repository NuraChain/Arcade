export const TABLE_REFUSALS = {
    'seated-max': 409,
    'playing': 409,
    'table-closed': 409,
    'chairs-empty': 409,
    'not-ready': 409,
    'kept-out': 409,
    'no-invitee': 404,
    'quick-game': 422,
    'quick-options': 422,
    'paid-off': 404,
    'paid-wallet': 409,
    'paid-minor': 409,
    'paid-terms': 409,
    'paid-break': 409,
    'paid-amount': 422,
    'paid-paused': 409,
    'paid-stake': 422,
    'paid-pace': 422,
    'paid-consent': 422,
    'paid-funds': 409,
    'paid-locking': 409,
    'paid-early': 409,
    'paid-done': 409,
    'vault-role': 409,
    'vault-fee': 422,
    'vault-fees': 409,
    'vault-paused': 409,
    'vault-running': 409,
    'vault-refused': 409
} as const satisfies Record<string, 404 | 409 | 422>;

export type TableRefusal = keyof typeof TABLE_REFUSALS;

export const isTableRefusal = (value: string): value is TableRefusal => Object.hasOwn(TABLE_REFUSALS, value);
