import { describe, it, expect } from 'vitest';

import { levelOf, xpFor, xpToReach, XP_CAPTURE, XP_FINISH, XP_HOME, XP_WIN } from '../src/domains/match/levels.ts';

describe('what a game is worth', () =>
{
    it('pays for finishing, and more for winning', () =>
    {
        expect(xpFor({ walked: false, won: false, captures: 0, home: 0 })).toBe(XP_FINISH);
        expect(xpFor({ walked: false, won: true, captures: 0, home: 0 })).toBe(XP_FINISH + XP_WIN);
    });

    it('pays for what happened on the board', () =>
    {
        expect(xpFor({ walked: false, won: false, captures: 3, home: 2 })).toBe(XP_FINISH + 3 * XP_CAPTURE + 2 * XP_HOME);
    });

    /**
     * The hole this closes is the one `outcomeOf` closes for the rating. If a walkout banked the
     * captures it had already made, leaving a game you are losing would be the profitable move -
     * you would keep the good half of it and skip the loss.
     */
    it('pays a walkout nothing at all, however well it was going', () =>
    {
        expect(xpFor({ walked: true, won: false, captures: 9, home: 3 })).toBe(0);
    });

    it('cannot be won and walked at once, and the walkout wins that argument', () =>
    {
        expect(xpFor({ walked: true, won: true, captures: 0, home: 4 })).toBe(0);
    });
});

describe('what a pile of it is called', () =>
{
    it('starts everybody at level one with nothing', () =>
    {
        expect(levelOf(0)).toEqual({ xp: 0, level: 1, into: 0, span: 100 });
    });

    it('costs more for each level than the one before it', () =>
    {
        const steps = [1, 2, 3, 4, 5].map((level) => xpToReach(level + 1) - xpToReach(level));

        expect(steps).toEqual([100, 150, 200, 250, 300]);
    });

    /**
     * The closed form has to agree with the definition it was derived from at the BOUNDARIES, which
     * is where an off-by-one in the root would show: one short of a level must still be the level
     * below, and the exact total must be the level itself.
     */
    it('lands exactly on each threshold and not a point early', () =>
    {
        for (let level = 1; level <= 60; level += 1)
        {
            const at = xpToReach(level);

            expect(levelOf(at).level, `${ at } xp should be level ${ level }`).toBe(level);
            expect(levelOf(at - 1).level, `${ at - 1 } xp should still be level ${ level - 1 }`).toBe(Math.max(1, level - 1));
        }
    });

    it('reports how far into the level it is, and how wide the level is', () =>
    {
        const at = levelOf(xpToReach(4) + 30);

        expect(at.level).toBe(4);
        expect(at.into).toBe(30);
        expect(at.span).toBe(xpToReach(5) - xpToReach(4));
    });

    it('never reports being further into a level than the level is wide', () =>
    {
        for (let xp = 0; xp < 4000; xp += 7)
        {
            const at = levelOf(xp);

            expect(at.into, `${ xp } xp`).toBeGreaterThanOrEqual(0);
            expect(at.into, `${ xp } xp`).toBeLessThan(at.span);
        }
    });

    it('treats a negative or fractional total as the whole number below it', () =>
    {
        expect(levelOf(-50).level).toBe(1);
        expect(levelOf(99.9).level).toBe(1);
        expect(levelOf(100.1).level).toBe(2);
    });
});
