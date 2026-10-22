export const STAFF_ROLES = ['moderator', 'admin', 'owner'] as const;

export type StaffRole = (typeof STAFF_ROLES)[number];

export const GRANTED_ROLES = ['moderator', 'admin'] as const;

export type GrantedRole = (typeof GRANTED_ROLES)[number];

export const ACTION_KINDS = ['grant', 'change', 'revoke'] as const;

export type ActionKind = (typeof ACTION_KINDS)[number];

export const LOG_PAGE = 50;

export const ABILITIES = {
    money: 'admin',
    staff: 'admin',
    log: 'admin',
    wallet: 'owner'
} as const satisfies Record<string, StaffRole>;

export type Ability = keyof typeof ABILITIES;

const rankOf = (role: StaffRole | null) => (role === null ? -1 : STAFF_ROLES.indexOf(role));

export const may = (role: StaffRole | null, ability: Ability) => rankOf(role) >= rankOf(ABILITIES[ability]);

export const outranks = (actor: StaffRole | null, other: StaffRole | null) => actor !== null && rankOf(actor) > rankOf(other);
