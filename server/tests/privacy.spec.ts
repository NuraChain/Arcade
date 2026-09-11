import { describe, expect, it } from 'vitest';

import {
    clampPrivacy,
    mayDiscover,
    mayMessage,
    maySeeOnline,
    maySendRequest,
    type Party,
    type Relation
} from '../src/domains/social/policy.ts';

/**
 * The privacy rules, exercised directly.
 *
 * These functions ARE the enforcement: the routes resolve two accounts and a relation from the
 * database and then do nothing but call them. Testing them here rather than through HTTP means
 * the whole matrix - six relations by three flags by two directions - is covered in
 * milliseconds, and a rule that is wrong fails on the rule rather than on a route.
 *
 * The database holds the same policy a second time, in `users_minor_no_strangers`. That is not
 * duplication for its own sake: the constraint makes the unsafe ROW unrepresentable whoever
 * writes it, and these functions make the unsafe ANSWER unrepresentable whoever asks.
 */

const adult = (id: string, overrides: Partial<Party> = {}): Party => ({
    id,
    isMinor: false,
    allowStrangerMessages: true,
    showOnline: true,
    ...overrides
});

const minor = (id: string, overrides: Partial<Party> = {}): Party => adult(id, { isMinor: true, allowStrangerMessages: false, ...overrides });

const STRANGERS: Relation[] = ['none', 'incoming', 'outgoing'];

describe('who may write to whom', () =>
{
    it('lets two ordinary strangers talk, because that is what a lobby is for', () =>
    {
        for (const relation of STRANGERS)
        {
            expect(mayMessage(adult('a'), adult('b'), relation)).toBeNull();
        }
    });

    it('refuses a blocked pair whatever either of them has asked for', () =>
    {
        expect(mayMessage(adult('a'), adult('b'), 'blocked')).toBe('blocked');
        expect(mayMessage(adult('a'), adult('b', { allowStrangerMessages: true }), 'blocked')).toBe('blocked');
        expect(mayMessage(minor('a'), adult('b'), 'blocked')).toBe('blocked');
    });

    it('always lets friends talk, whatever the settings say', () =>
    {
        expect(mayMessage(adult('a'), adult('b', { allowStrangerMessages: false }), 'friend')).toBeNull();
        expect(mayMessage(adult('a'), minor('b'), 'friend')).toBeNull();
        expect(mayMessage(minor('a'), adult('b'), 'friend')).toBeNull();
    });

    it('honours a closed door: strangers off means strangers off', () =>
    {
        const closed = adult('b', { allowStrangerMessages: false });
        for (const relation of STRANGERS)
        {
            expect(mayMessage(adult('a'), closed, relation)).toBe('strangers-off');
        }
    });

    it('keeps strangers away from a minor in BOTH directions', () =>
    {
        for (const relation of STRANGERS)
        {
            expect(mayMessage(adult('a'), minor('b'), relation)).toBe('minor-safety');
            expect(mayMessage(minor('a'), adult('b'), relation)).toBe('minor-safety');
            expect(mayMessage(minor('a'), minor('b'), relation)).toBe('minor-safety');
        }
    });

    it('checks minor safety BEFORE the recipient setting, so a forged flag changes nothing', () =>
    {
        // A minor row that somehow claims to allow strangers - which the CHECK constraint makes
        // unrepresentable - is still refused here. Two locks, one door.
        const impossible = adult('b', { isMinor: true, allowStrangerMessages: true });
        expect(mayMessage(adult('a'), impossible, 'none')).toBe('minor-safety');
    });

    it('refuses talking to yourself before anything else', () =>
    {
        expect(mayMessage(adult('a'), adult('a'), 'me')).toBe('self');
    });
});

describe('who may see somebody online', () =>
{
    it('shows an ordinary account to anyone who is not blocked', () =>
    {
        for (const relation of [...STRANGERS, 'friend'] as Relation[])
        {
            expect(maySeeOnline(adult('a'), adult('b'), relation)).toBe(true);
        }
    });

    it('hides an account that turned itself invisible, except from friends', () =>
    {
        const hidden = adult('b', { showOnline: false });
        expect(maySeeOnline(adult('a'), hidden, 'none')).toBe(false);
        expect(maySeeOnline(adult('a'), hidden, 'outgoing')).toBe(false);
        expect(maySeeOnline(adult('a'), hidden, 'friend')).toBe(true);
    });

    it('hides a minor from strangers however they set it', () =>
    {
        expect(maySeeOnline(adult('a'), minor('b', { showOnline: true }), 'none')).toBe(false);
        expect(maySeeOnline(adult('a'), minor('b', { showOnline: true }), 'friend')).toBe(true);
    });

    it('hides a blocked pair from each other', () =>
    {
        expect(maySeeOnline(adult('a'), adult('b'), 'blocked')).toBe(false);
    });

    it('always shows you your own presence', () =>
    {
        expect(maySeeOnline(adult('a'), adult('a'), 'me')).toBe(true);
    });
});

describe('who may be found at all', () =>
{
    it('hides only a blocked pair - being a stranger is not grounds for invisibility', () =>
    {
        expect(mayDiscover('none')).toBe(true);
        expect(mayDiscover('outgoing')).toBe(true);
        expect(mayDiscover('friend')).toBe(true);
        expect(mayDiscover('blocked')).toBe(false);
    });
});

describe('who may knock', () =>
{
    it('lets a stranger ask a minor to be friends, because that is how a minor makes any', () =>
    {
        expect(maySendRequest(adult('a'), minor('b'), 'none')).toBeNull();
    });

    it('refuses a blocked pair, an existing friendship and a second ask', () =>
    {
        expect(maySendRequest(adult('a'), adult('b'), 'blocked')).toBe('blocked');
        expect(maySendRequest(adult('a'), adult('b'), 'friend')).toBe('already-friends');
        expect(maySendRequest(adult('a'), adult('b'), 'outgoing')).toBe('already-asked');
        expect(maySendRequest(adult('a'), adult('a'), 'me')).toBe('self');
    });

    it('lets a request in the other direction through, because that is the one to accept', () =>
    {
        expect(maySendRequest(adult('a'), adult('b'), 'incoming')).toBeNull();
    });
});

describe('what a minor is allowed to hold', () =>
{
    it('refuses to store the unsafe combination, whatever was asked for', () =>
    {
        expect(clampPrivacy(true, { allowStrangerMessages: true, showOnline: true }))
            .toEqual({ allowStrangerMessages: false, showOnline: true });
    });

    it('leaves what an adult asked for alone', () =>
    {
        expect(clampPrivacy(false, { allowStrangerMessages: true, showOnline: false }))
            .toEqual({ allowStrangerMessages: true, showOnline: false });
    });

    it('lets a minor still choose to be invisible', () =>
    {
        expect(clampPrivacy(true, { allowStrangerMessages: false, showOnline: false }).showOnline).toBe(false);
    });
});
