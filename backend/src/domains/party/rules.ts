export const INVITE_MS = 90_000;

export const IDLE_MS = 300_000;

export const ENDED_MS = 30_000;

export const COOLDOWN_MS = 30_000;

export const INVITES_HELD = 5;

export const PARTY_STAGES = ['inviting', 'ready'] as const;

export type PartyStage = typeof PARTY_STAGES[number];

export const PARTY_ENDS = ['declined', 'expired', 'left', 'ended'] as const;

export type PartyEnd = typeof PARTY_ENDS[number];

export const PARTY_REFUSALS = {
    'party-missing': 404,
    'in-party': 409,
    'not-team-game': 422,
    'party-cooldown': 429
} as const satisfies Record<string, 404 | 409 | 422 | 429>;

export type PartyRefusal = keyof typeof PARTY_REFUSALS;

export const isPartyRefusal = (value: string): value is PartyRefusal => Object.hasOwn(PARTY_REFUSALS, value);
