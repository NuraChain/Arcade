export const STAFF_REFUSALS = {
    'staff-nobody': 404,
    'staff-owner': 409,
    'staff-self': 409,
    'staff-rank': 409,
    'staff-not-suspended': 409,
    'staff-match-over': 409,
    'staff-in-game': 409
} as const satisfies Record<string, 404 | 409 | 422>;

export type StaffRefusal = keyof typeof STAFF_REFUSALS;

export const isStaffRefusal = (value: string): value is StaffRefusal => Object.hasOwn(STAFF_REFUSALS, value);
