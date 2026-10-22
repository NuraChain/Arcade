import { describe, expect, it } from 'vitest';

import { ABILITIES, GRANTED_ROLES, STAFF_ROLES, may, outranks, type Ability, type StaffRole } from '../src/domains/admin/roles.ts';
import { STAFF_REFUSALS, isStaffRefusal } from '../src/domains/admin/refusals.ts';

const ROLES: (StaffRole | null)[] = [null, ...STAFF_ROLES];

describe('who on the staff may do what', () =>
{
    it('lets each role reach exactly the sections its rank opens', () =>
    {
        const reach = (role: StaffRole | null) => (Object.keys(ABILITIES) as Ability[]).filter((ability) => may(role, ability)).sort();

        expect(reach(null)).toEqual([]);
        expect(reach('moderator')).toEqual(['people', 'reports']);
        expect(reach('admin')).toEqual(['log', 'money', 'people', 'play', 'reports', 'staff']);
        expect(reach('owner')).toEqual(['log', 'money', 'people', 'play', 'reports', 'staff', 'wallet']);
    });

    it('puts the owner above an admin, an admin above a moderator, and every role above somebody who is none', () =>
    {
        const above = ROLES.map((actor) => ROLES.filter((other) => outranks(actor, other)));

        expect(above).toEqual([
            [],
            [null],
            [null, 'moderator'],
            [null, 'moderator', 'admin']
        ]);
    });

    it('never puts a role above itself', () =>
    {
        for (const role of ROLES)
        {
            expect(outranks(role, role), String(role)).toBe(false);
        }
    });

    it('grants in the page only the roles below the owner, whom the server\'s .env names', () =>
    {
        expect([...GRANTED_ROLES]).toEqual(['moderator', 'admin']);
        expect(GRANTED_ROLES.every((role) => outranks('owner', role))).toBe(true);
    });
});

describe('what the staff are refused in words', () =>
{
    it('lists each word once with its status, and answers a word it does not have as none', () =>
    {
        expect(STAFF_REFUSALS).toEqual({ 'staff-nobody': 404, 'staff-owner': 409, 'staff-self': 409, 'staff-rank': 409, 'staff-not-suspended': 409, 'staff-match-over': 409, 'staff-in-game': 409, 'staff-seated': 409, 'staff-table-closed': 409, 'staff-table-playing': 409 });
        expect(isStaffRefusal('staff-rank')).toBe(true);
        expect(isStaffRefusal('toString')).toBe(false);
        expect(isStaffRefusal('not-found')).toBe(false);
    });
});
