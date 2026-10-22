export const STAFF_ROLES = ['moderator', 'admin', 'owner'] as const;

export type StaffRole = (typeof STAFF_ROLES)[number];

export const GRANTED_ROLES = ['moderator', 'admin'] as const;

export type GrantedRole = (typeof GRANTED_ROLES)[number];

export const ACTION_KINDS = ['grant', 'change', 'revoke'] as const;

export type ActionKind = (typeof ACTION_KINDS)[number];
