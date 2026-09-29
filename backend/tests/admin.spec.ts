import { describe, expect, it } from 'vitest';

import { isAdminAddress } from '../src/domains/identity/admin.ts';

const ADMIN = '0x9965507d1a55bcc2695c58ba16fb37d819b0a4dc';

describe('who may open /admin', () =>
{
    it('is the configured wallet, whatever case either side is written in', () =>
    {
        expect(isAdminAddress(ADMIN, ADMIN)).toBe(true);
        expect(isAdminAddress(ADMIN.toUpperCase().replace('0X', '0x'), ADMIN)).toBe(true);
        expect(isAdminAddress(ADMIN, ADMIN.toUpperCase().replace('0X', '0x'))).toBe(true);
    });

    it('is nobody else, no guest, and nobody at all when none is configured', () =>
    {
        expect(isAdminAddress('0x1111111111111111111111111111111111111111', ADMIN)).toBe(false);
        expect(isAdminAddress(null, ADMIN)).toBe(false);
        expect(isAdminAddress(ADMIN, '')).toBe(false);
        expect(isAdminAddress('', '')).toBe(false);
    });
});
