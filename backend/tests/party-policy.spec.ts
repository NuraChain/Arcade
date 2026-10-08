import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeEach, describe, expect, it } from 'vitest';

import { HttpError, ValidationError, errorResponse } from '@azerothjs/http';

import { REFUSALS } from '../src/domains/match/refusals.ts';
import { createParties, type Parties } from '../src/domains/party/parties.ts';
import { partyRefusal, partyRefused } from '../src/domains/party/refusal.ts';
import { createRegistry, type Registry } from '../src/domains/party/registry.ts';
import { COOLDOWN_MS, ENDED_MS, IDLE_MS, INVITE_MS, PARTY_ENDS, PARTY_REFUSALS, PARTY_STAGES, isPartyRefusal, type PartyRefusal } from '../src/domains/party/rules.ts';
import { mayMessage, type Party as Account, type Relation } from '../src/domains/social/policy.ts';
import { TABLE_REFUSALS } from '../src/domains/table/refusals.ts';
import { noInvitee } from '../src/domains/table/service.ts';
import { partyInput, partyState } from '../src/schemas.ts';

const HERE = dirname(fileURLToPath(import.meta.url));

const sourceOf = (...path: string[]) => readFileSync(join(HERE, '..', 'src', ...path), 'utf8');

const WORDS = Object.keys(PARTY_REFUSALS) as PartyRefusal[];

const FRAMEWORK = [400, 401, 403, 404, 405, 409, 413, 415, 422, 429, 499, 500, 502, 503, 599]
    .map((status) => new HttpError(status, 'x').code)
    .concat(new ValidationError({}).code);

const NOWHERE = '3f0e3c2a-1111-4222-8333-444455556666';

const NOT_IDS = ['not-a-uuid', 'mina', '', '{}', 'null', '-1', `${ NOWHERE }x`, 'GGGGGGGG-GGGG-GGGG-GGGG-GGGGGGGGGGGG', `' or 1=1 --`, 'x'.repeat(300), 'constructor', '__proto__'];

interface Person
{
    id: string;
    handle: string;
    minor: boolean;
    strangers: boolean;
    suspended: boolean;
}

interface Due
{
    at: number;
    run: () => void;
    off: boolean;
}

let at: number;
let seq: number;
let due: Due[];
let rung: string[];
let people: Map<string, Person>;
let friends: Set<string>;
let blocks: Set<string>;
let mutes: Set<string>;
let games: Record<string, boolean>;
let asked: string[];
let registry: Registry;
let parties: Parties;

const advance = (ms: number) =>
{
    const target = at + ms;

    for (;;)
    {
        const next = due.filter((one) => !one.off && one.at <= target).sort((a, b) => a.at - b.at)[0];

        if (next === undefined)
        {
            break;
        }

        next.off = true;
        at = next.at;
        next.run();
    }

    at = target;
};

const pairOf = (a: string, b: string) => [a, b].sort().join('|');

const somebody = (handle: string, extra: Partial<Person> = {}) =>
{
    const person = { id: `u-${ people.size + 1 }`, handle, minor: false, strangers: true, suspended: false, ...extra };

    people.set(person.id, person);

    return person;
};

const befriend = (a: Person, b: Person) => friends.add(pairOf(a.id, b.id));

const block = (who: Person, whom: Person) =>
{
    blocks.add(`${ who.id }>${ whom.id }`);
    friends.delete(pairOf(who.id, whom.id));
};

const accountOf = (person: Person): Account => ({ id: person.id, isMinor: person.minor, allowStrangerMessages: person.strangers && !person.minor, showOnline: true });

const relationOf = (a: string, b: string): Relation =>
{
    if (blocks.has(`${ a }>${ b }`) || blocks.has(`${ b }>${ a }`))
    {
        return 'blocked';
    }

    return friends.has(pairOf(a, b)) ? 'friend' : 'none';
};

const reaches = (a: string, b: string) =>
{
    const one = people.get(a);
    const other = people.get(b);

    if (one === undefined || other === undefined || one.suspended || other.suspended)
    {
        return false;
    }

    return mayMessage(accountOf(one), accountOf(other), relationOf(a, b)) === null
        && mayMessage(accountOf(other), accountOf(one), relationOf(b, a)) === null;
};

const sent = async (refusal: HttpError) =>
{
    const response = errorResponse(refusal);

    return { status: response.status, body: await response.text() };
};

const answered = async (answer: { ok: true } | { ok: false; why: PartyRefusal | 'no-invitee' }) =>
    (answer.ok ? 'done' : await sent(partyRefused(answer.why)));

const heard = () =>
{
    const told = rung;

    rung = [];

    return told;
};

const MUTED: [string, (mina: Person, dana: Person) => string][] = [
    ['the person', (mina, dana) => `${ mina.id }:person:${ dana.id }`],
    ['invitations altogether', (mina) => `${ mina.id }:notice:invites`],
    ['the game', (mina) => `${ mina.id }:game:hokm`]
];

beforeEach(() =>
{
    at = 1_700_000_000_000;
    seq = 0;
    due = [];
    rung = [];
    people = new Map();
    friends = new Set();
    blocks = new Set();
    mutes = new Set();
    games = { hokm: true, ludo: true, backgammon: false, poker: false };
    asked = [];

    registry = createRegistry({
        now: () => at,
        after: (ms, run) =>
        {
            const entry = { at: at + ms, run, off: false };

            due.push(entry);

            return () =>
            {
                entry.off = true;
            };
        },
        ring: (userIds) => rung.push(...userIds),
        id: () => `00000000-0000-4000-8000-${ String(seq += 1).padStart(12, '0') }`
    });

    parties = createParties({
        registry,
        person: async (handle) => [...people.values()].find((one) => one.handle === handle && !one.suspended)?.id ?? null,
        handles: async (userIds) => new Map(userIds.flatMap((id) =>
        {
            const person = people.get(id);

            return person === undefined ? [] : [[id, person.handle] as const];
        })),
        reaches: async (a, b) =>
        {
            asked.push(`${ a }~${ b }`);

            return reaches(a, b);
        },
        muted: async (userId, by, game) => mutes.has(`${ userId }:person:${ by }`) || mutes.has(`${ userId }:notice:invites`) || mutes.has(`${ userId }:game:${ game }`),
        teamGame: async (game) => games[game] === true
    });
});

describe('asking somebody to team up', () =>
{
    it('is a team in the making that both of them are shown, by handle', async () =>
    {
        const dana = somebody('dana.w');
        const mina = somebody('mina');

        befriend(dana, mina);

        expect(await parties.invite(dana.id, 'mina', 'hokm')).toEqual({ ok: true });

        const id = '00000000-0000-4000-8000-000000000001';

        expect(await parties.state(dana.id)).toEqual({ party: { id, game: 'hokm', leader: 'dana.w', member: 'mina', stage: 'inviting', remainingMs: INVITE_MS }, invites: [] });
        expect(await parties.state(mina.id)).toEqual({ invites: [{ id, game: 'hokm', from: 'dana.w', remainingMs: INVITE_MS }] });
        expect(heard().sort()).toEqual([dana.id, mina.id].sort());
    });

    it('counts the time left when the answer is made, never when the invitation was', async () =>
    {
        const dana = somebody('dana.w');
        const mina = somebody('mina');

        befriend(dana, mina);
        await parties.invite(dana.id, 'mina', 'hokm');
        advance(12_345);

        expect((await parties.state(dana.id)).party?.remainingMs).toBe(INVITE_MS - 12_345);
        expect((await parties.state(mina.id)).invites[0].remainingMs).toBe(INVITE_MS - 12_345);
    });

    it('names people as they are called now: a new handle shows on the next read', async () =>
    {
        const dana = somebody('dana.w');
        const mina = somebody('mina');

        befriend(dana, mina);
        await parties.invite(dana.id, 'mina', 'hokm');
        dana.handle = 'dana.the.second';

        expect((await parties.state(mina.id)).invites[0].from).toBe('dana.the.second');
        expect((await parties.state(dana.id)).party?.leader).toBe('dana.the.second');
    });

    it('may be between strangers, where neither has shut the door', async () =>
    {
        const dana = somebody('dana.w');

        somebody('omid.k');

        expect(await parties.invite(dana.id, 'omid.k', 'ludo')).toEqual({ ok: true });
    });
});

describe('somebody who cannot be asked', () =>
{
    it('is answered in one sentence, the same bytes whoever it is and whatever stands in the way', async () =>
    {
        const dana = somebody('dana.w');
        const closed = somebody('closed.door', { strangers: false });
        const child = somebody('kian16', { minor: true });
        const blockedByMe = somebody('blocked.by.me');
        const blockedMe = somebody('blocked.me');
        const friendOfMine = somebody('mina');

        somebody('gone.away', { suspended: true });
        block(dana, blockedByMe);
        block(blockedMe, dana);
        befriend(dana, friendOfMine);

        const missing = await sent(noInvitee());

        expect(missing).toEqual({ status: 404, body: JSON.stringify({ error: { code: 'no-invitee', message: 'No one by that name can be invited.' } }) });

        for (const handle of ['nobody.by.this.name', 'dana.w', 'closed.door', 'kian16', 'blocked.by.me', 'blocked.me', 'gone.away', '', 'x'.repeat(300)])
        {
            expect(await answered(await parties.invite(dana.id, handle, 'hokm')), handle.slice(0, 40)).toEqual(missing);
        }

        expect(await answered(await parties.invite(closed.id, 'dana.w', 'hokm')), 'my own door is shut').toEqual({ status: 404, body: missing.body });
        expect(await answered(await parties.invite(child.id, 'dana.w', 'hokm')), 'I am the minor').toEqual(missing);
        expect(heard(), 'a refused invitation rang somebody').toEqual([]);
        expect(registry.involving(dana.id)).toEqual([]);
        expect(await parties.state(dana.id)).toEqual({ invites: [] });
    });

    it('is refused before the game is looked at, so a game that is not played in teams says nothing about who they are', async () =>
    {
        const dana = somebody('dana.w');
        const stranger = somebody('closed.door', { strangers: false });

        expect(await parties.invite(dana.id, 'closed.door', 'backgammon')).toEqual({ ok: false, why: 'no-invitee' });
        expect(await parties.invite(dana.id, 'nobody.by.this.name', 'no-such-game')).toEqual({ ok: false, why: 'no-invitee' });
        expect(registry.involving(stranger.id)).toEqual([]);
    });

    it('lets a minor team up with a friend, and with nobody else in either direction', async () =>
    {
        const kian = somebody('kian16', { minor: true });
        const friend = somebody('yas');
        const stranger = somebody('dana.w');
        const other = somebody('roya.m', { minor: true });

        befriend(kian, friend);

        expect(await parties.invite(kian.id, 'dana.w', 'hokm')).toEqual({ ok: false, why: 'no-invitee' });
        expect(await parties.invite(stranger.id, 'kian16', 'hokm')).toEqual({ ok: false, why: 'no-invitee' });
        expect(await parties.invite(other.id, 'kian16', 'hokm')).toEqual({ ok: false, why: 'no-invitee' });
        expect(await parties.invite(friend.id, 'kian16', 'hokm')).toEqual({ ok: true });
        expect((await parties.state(kian.id)).invites.map((one) => one.from)).toEqual(['yas']);
    });
});

describe('a game that is not played in teams', () =>
{
    it('is refused as a request that was wrong, in the same words for one nobody has heard of', async () =>
    {
        const dana = somebody('dana.w');
        const mina = somebody('mina');

        befriend(dana, mina);

        const refused = await answered(await parties.invite(dana.id, 'mina', 'backgammon'));

        expect(refused).toMatchObject({ status: 422 });
        expect(JSON.parse((refused as { body: string }).body)).toMatchObject({ error: { code: 'not-team-game' } });
        expect(await answered(await parties.invite(dana.id, 'mina', 'poker'))).toEqual(refused);
        expect(await answered(await parties.invite(dana.id, 'mina', 'no-such-game'))).toEqual(refused);
        expect(await answered(await parties.invite(dana.id, 'mina', ''))).toEqual(refused);
        expect(registry.involving(dana.id)).toEqual([]);
        expect(heard()).toEqual([]);
    });
});

describe('somebody who muted the one asking', () =>
{
    it.each(MUTED)('is asked as anybody is when they muted %s, hears nothing, and lets it run out', async (_what, mute) =>
    {
        const dana = somebody('dana.w');
        const mina = somebody('mina');
        const omid = somebody('omid.k');

        befriend(dana, mina);
        befriend(omid, mina);

        expect(await parties.invite(omid.id, 'mina', 'hokm')).toEqual({ ok: true });

        const heardOf = await parties.state(omid.id);

        advance(INVITE_MS + COOLDOWN_MS);
        heard();
        mutes.add(mute(mina, dana));

        expect(await parties.invite(dana.id, 'mina', 'hokm')).toEqual({ ok: true });

        const quiet = await parties.state(dana.id);

        expect({ ...quiet.party, id: '', leader: '' }, 'a muted invitation reads differently to whoever sent it').toEqual({ ...heardOf.party, id: '', leader: '' });
        expect(await parties.state(mina.id)).toEqual({ invites: [] });
        expect(heard()).toEqual([dana.id]);
        expect(await parties.accept(mina.id, quiet.party!.id)).toEqual({ ok: false, why: 'party-missing' });

        advance(INVITE_MS);

        expect(await parties.state(dana.id)).toEqual({ invites: [], ended: { id: quiet.party!.id, reason: 'expired' } });
        expect(await parties.state(mina.id)).toEqual({ invites: [] });
        expect(heard()).toEqual([dana.id]);
    });

    it('is not silenced by a mute of something else', async () =>
    {
        const dana = somebody('dana.w');
        const mina = somebody('mina');

        befriend(dana, mina);
        mutes.add(`${ mina.id }:game:ludo`);
        mutes.add(`${ mina.id }:notice:messages`);
        mutes.add(`${ dana.id }:person:${ mina.id }`);
        await parties.invite(dana.id, 'mina', 'hokm');

        expect((await parties.state(mina.id)).invites).toHaveLength(1);
    });

    it.each(MUTED)('has the invitation run out by five later ones in the bytes of one that was seen, when they muted %s', async (_what, mute) =>
    {
        const dana = somebody('dana.w');
        const mina = somebody('mina');
        const others = ['a.one', 'b.two', 'c.three', 'd.four', 'e.five'].map((handle) => somebody(handle));
        const readings = async () =>
        {
            const bodies: string[] = [];

            expect(await parties.invite(dana.id, 'mina', 'hokm')).toEqual({ ok: true });

            const id = (await parties.state(dana.id)).party!.id;

            for (const other of others)
            {
                advance(1_000);
                expect(await parties.invite(other.id, 'mina', 'ludo'), other.handle).toEqual({ ok: true });
                bodies.push(JSON.stringify(await parties.state(dana.id)).replaceAll(id, 'mine'));
            }

            bodies.push(JSON.stringify(await answered(await parties.invite(dana.id, 'mina', 'hokm'))));
            advance(INVITE_MS + COOLDOWN_MS + ENDED_MS);

            return bodies;
        };

        const seen = await readings();

        mutes.add(mute(mina, dana));

        const unseen = await readings();

        expect(seen.at(-2)).toBe(JSON.stringify({ invites: [], ended: { id: 'mine', reason: 'expired' } }));
        expect(JSON.parse(seen.at(-1)!)).toMatchObject({ status: 429 });
        expect(unseen, 'whoever asked could tell they had been muted').toEqual(seen);
    });
});

describe('somebody who asks whoever has just asked them', () =>
{
    const crossing = () =>
    {
        const dana = somebody('dana.w');
        const mina = somebody('mina');

        befriend(dana, mina);

        return { dana, mina };
    };

    it('is saying yes: one team, led by whoever asked first', async () =>
    {
        const { dana, mina } = crossing();

        await parties.invite(dana.id, 'mina', 'hokm');

        const id = (await parties.state(dana.id)).party!.id;

        heard();

        expect(await parties.invite(mina.id, 'dana.w', 'hokm')).toEqual({ ok: true });

        for (const who of [dana, mina])
        {
            expect(await parties.state(who.id), who.handle).toEqual({ party: { id, game: 'hokm', leader: 'dana.w', member: 'mina', stage: 'ready', remainingMs: IDLE_MS }, invites: [] });
        }

        expect(heard().sort()).toEqual([dana.id, mina.id].sort());
    });

    it.each(MUTED)('is saying yes in the same bytes though they muted %s and never saw the first ask', async (_what, mute) =>
    {
        const { dana, mina } = crossing();
        const crossed = async () =>
        {
            expect(await parties.invite(dana.id, 'mina', 'hokm')).toEqual({ ok: true });

            const id = (await parties.state(dana.id)).party!.id;

            advance(5_000);

            const answer = await parties.invite(mina.id, 'dana.w', 'hokm');
            const read = JSON.stringify([answer, await parties.state(dana.id), await parties.state(mina.id)]).replaceAll(id, 'theirs');

            parties.leave(dana.id, id);
            advance(ENDED_MS);

            return read;
        };

        const seen = await crossed();

        mutes.add(mute(mina, dana));

        expect(await crossed(), 'asking back told whoever asked first that they had been muted').toBe(seen);
        expect(JSON.parse(seen)).toMatchObject([{ ok: true }, { party: { id: 'theirs', stage: 'ready', leader: 'dana.w' } }, { party: { id: 'theirs', stage: 'ready', member: 'mina' } }]);
    });

    it('is asking for a team of their own when the game is another one', async () =>
    {
        const { dana, mina } = crossing();

        await parties.invite(dana.id, 'mina', 'hokm');

        expect(await parties.invite(mina.id, 'dana.w', 'ludo')).toEqual({ ok: true });
        expect(await parties.state(dana.id)).toMatchObject({ party: { game: 'hokm', leader: 'dana.w', stage: 'inviting' }, invites: [{ game: 'ludo', from: 'mina' }] });
        expect(await parties.state(mina.id)).toMatchObject({ party: { game: 'ludo', leader: 'mina', stage: 'inviting' }, invites: [{ game: 'hokm', from: 'dana.w' }] });
    });

    it('joins nothing once the two can no longer reach each other', async () =>
    {
        const { dana, mina } = crossing();

        await parties.invite(dana.id, 'mina', 'hokm');
        block(mina, dana);

        expect(await parties.invite(mina.id, 'dana.w', 'hokm')).toEqual({ ok: false, why: 'no-invitee' });
        expect((await parties.state(dana.id)).party?.stage).toBe('inviting');
        expect(registry.involving(mina.id).map((one) => one.stage)).toEqual(['inviting']);
    });
});

describe('saying yes, not now, or leaving', () =>
{
    const invited = async () =>
    {
        const dana = somebody('dana.w');
        const mina = somebody('mina');

        befriend(dana, mina);
        await parties.invite(dana.id, 'mina', 'hokm');

        return { dana, mina, id: (await parties.state(dana.id)).party!.id };
    };

    it('makes the team when the other says yes', async () =>
    {
        const { dana, mina, id } = await invited();

        expect(await parties.accept(mina.id, id)).toEqual({ ok: true });
        expect((await parties.state(dana.id)).party).toMatchObject({ id, stage: 'ready', leader: 'dana.w', member: 'mina' });
        expect((await parties.state(mina.id))).toMatchObject({ party: { id, stage: 'ready' }, invites: [] });
    });

    it('tells the leader who said not now, by handle', async () =>
    {
        const { dana, mina, id } = await invited();

        expect(parties.decline(mina.id, id)).toEqual({ ok: true });
        expect(await parties.state(dana.id)).toEqual({ invites: [], ended: { id, reason: 'declined', by: 'mina' } });
        expect(await parties.state(mina.id)).toEqual({ invites: [] });
    });

    it('tells whoever is left who went', async () =>
    {
        const { dana, mina, id } = await invited();

        await parties.accept(mina.id, id);

        expect(parties.leave(dana.id, id)).toEqual({ ok: true });
        expect((await parties.state(mina.id)).ended).toEqual({ id, reason: 'left', by: 'dana.w' });
    });

    it('answers an id that is no id in the bytes of a team that is not there, and asks nobody anything', async () =>
    {
        const { dana, mina } = await invited();
        const missing = await sent(partyRefusal('party-missing'));

        expect(missing).toMatchObject({ status: 404 });
        expect(JSON.parse(missing.body)).toMatchObject({ error: { code: 'party-missing' } });
        expect(await answered(await parties.accept(mina.id, NOWHERE))).toEqual(missing);
        expect(await answered(parties.decline(mina.id, NOWHERE))).toEqual(missing);
        expect(await answered(parties.leave(mina.id, NOWHERE))).toEqual(missing);

        asked = [];

        for (const id of NOT_IDS)
        {
            expect(await answered(await parties.accept(mina.id, id)), `accepting ${ id.slice(0, 40) }`).toEqual(missing);
            expect(await answered(parties.decline(mina.id, id)), `declining ${ id.slice(0, 40) }`).toEqual(missing);
            expect(await answered(parties.leave(dana.id, id)), `leaving ${ id.slice(0, 40) }`).toEqual(missing);
        }

        expect(asked).toEqual([]);
        expect((await parties.state(mina.id)).invites).toHaveLength(1);
    });

    it('answers somebody else’s invitation as one that is not there', async () =>
    {
        const { dana, id } = await invited();
        const omid = somebody('omid.k');
        const missing = { ok: false, why: 'party-missing' };

        expect(await parties.accept(omid.id, id)).toEqual(missing);
        expect(parties.decline(omid.id, id)).toEqual(missing);
        expect(parties.leave(omid.id, id)).toEqual(missing);
        expect(await parties.accept(dana.id, id)).toEqual(missing);
        expect((await parties.state(dana.id)).party?.stage).toBe('inviting');
    });

    it('tells somebody already in a team that they are, and keeps the invitation', async () =>
    {
        const { mina, id } = await invited();
        const omid = somebody('omid.k');

        befriend(omid, mina);
        await parties.invite(omid.id, 'mina', 'ludo');

        const second = (await parties.state(omid.id)).party!.id;

        await parties.accept(mina.id, id);

        const refused = await answered(await parties.accept(mina.id, second));

        expect(refused).toMatchObject({ status: 409 });
        expect(JSON.parse((refused as { body: string }).body)).toMatchObject({ error: { code: 'in-party' } });
        expect(await answered(await parties.invite(mina.id, 'omid.k', 'hokm'))).toEqual(refused);
        expect((await parties.state(mina.id)).invites.map((one) => one.id)).toEqual([second]);
    });

    it('asks a leader to wait before asking the same person again, as too many requests', async () =>
    {
        const { dana, mina, id } = await invited();

        parties.decline(mina.id, id);

        const refused = await answered(await parties.invite(dana.id, 'mina', 'hokm'));

        expect(refused).toMatchObject({ status: 429 });
        expect(JSON.parse((refused as { body: string }).body)).toMatchObject({ error: { code: 'party-cooldown' } });

        advance(COOLDOWN_MS);

        expect(await parties.invite(dana.id, 'mina', 'hokm')).toEqual({ ok: true });
    });
});

describe('a block that comes in between', () =>
{
    const invited = async () =>
    {
        const dana = somebody('dana.w');
        const mina = somebody('mina');

        befriend(dana, mina);
        await parties.invite(dana.id, 'mina', 'hokm');

        return { dana, mina, id: (await parties.state(dana.id)).party!.id };
    };

    const BLOCKS: [string, (dana: Person, mina: Person) => void][] = [
        ['the leader blocked them', (dana, mina) => block(dana, mina)],
        ['they blocked the leader', (dana, mina) => block(mina, dana)]
    ];

    it.each(BLOCKS)('answers a yes as a team that is not there when %s, and ends it for the leader with no reason given', async (_what, come) =>
    {
        const { dana, mina, id } = await invited();

        come(dana, mina);

        expect(await answered(await parties.accept(mina.id, id))).toEqual(await sent(partyRefusal('party-missing')));
        expect(await parties.state(dana.id)).toEqual({ invites: [], ended: { id, reason: 'ended' } });
        expect(await parties.state(mina.id)).toEqual({ invites: [] });
    });

    it('ends a team that had formed for both of them when it is looked at again, and says only that it ended', async () =>
    {
        const { dana, mina, id } = await invited();

        await parties.accept(mina.id, id);
        block(mina, dana);
        heard();
        await parties.revalidate(mina.id);

        for (const who of [dana, mina])
        {
            const state = await parties.state(who.id);

            expect(state, who.handle).toEqual({ invites: [], ended: { id, reason: 'ended' } });
            expect(JSON.stringify(state)).not.toMatch(/block|by/);
        }

        expect(heard().sort()).toEqual([dana.id, mina.id].sort());
    });

    it('takes an invitation off the screen of whoever it was for, whichever of the two is looked at', async () =>
    {
        const { dana, mina, id } = await invited();

        block(dana, mina);
        await parties.revalidate(dana.id);

        expect(await parties.state(mina.id)).toEqual({ invites: [] });
        expect(await parties.state(dana.id)).toEqual({ invites: [], ended: { id, reason: 'ended' } });
    });

    it('ends one when a friendship goes and the door to strangers is shut, and not while the door is open', async () =>
    {
        const { dana, mina, id } = await invited();

        await parties.accept(mina.id, id);
        friends.delete(pairOf(dana.id, mina.id));
        await parties.revalidate(dana.id);

        expect((await parties.state(mina.id)).party?.stage, 'two strangers with open doors were parted').toBe('ready');

        mina.strangers = false;
        await parties.revalidate(mina.id);

        expect((await parties.state(dana.id)).ended).toEqual({ id, reason: 'ended' });
    });

    it('leaves alone everything that still holds, and whatever somebody else is part of', async () =>
    {
        const { dana, mina, id } = await invited();
        const omid = somebody('omid.k');
        const sara = somebody('sara.k');

        await parties.invite(omid.id, 'sara.k', 'hokm');
        block(omid, sara);
        heard();
        await parties.revalidate(dana.id);
        await parties.revalidate(mina.id);

        expect((await parties.state(dana.id)).party?.id).toBe(id);
        expect((await parties.state(sara.id)).invites, 'a team nobody asked about was looked at').toHaveLength(1);
        expect(heard()).toEqual([]);

        await parties.revalidate(sara.id);

        expect((await parties.state(sara.id)).invites).toEqual([]);
    });
});

describe('what is sent about a team', () =>
{
    it('is everything the wire declares and nothing it does not', async () =>
    {
        const dana = somebody('dana.w');
        const mina = somebody('mina');
        const omid = somebody('omid.k');

        befriend(dana, mina);
        await parties.invite(dana.id, 'mina', 'hokm');
        await parties.invite(omid.id, 'dana.w', 'ludo');

        const inviting = await parties.state(dana.id);

        expect(Object.keys(inviting).sort()).toEqual(['invites', 'party']);
        expect(partyState.parse(inviting)).toEqual(inviting);

        parties.decline(mina.id, inviting.party!.id);

        const ended = await parties.state(dana.id);

        expect(ended.ended).toEqual({ id: inviting.party!.id, reason: 'declined', by: 'mina' });
        expect(partyState.parse(ended)).toEqual(ended);
        expect(JSON.stringify([inviting, ended])).not.toMatch(/u-\d|silent|until/);
    });

    it('names no stage and no ending that nothing here produces', async () =>
    {
        const party = { id: NOWHERE, game: 'hokm', leader: 'dana.w', member: 'mina', remainingMs: 1 };

        for (const stage of PARTY_STAGES)
        {
            expect(partyState.safeParse({ party: { ...party, stage }, invites: [] }).ok, stage).toBe(true);
        }

        for (const stage of ['searching', 'seated', 'started', '', 'READY'])
        {
            expect(partyState.safeParse({ party: { ...party, stage }, invites: [] }).ok, stage).toBe(false);
        }

        for (const reason of PARTY_ENDS)
        {
            expect(partyState.safeParse({ invites: [], ended: { id: NOWHERE, reason } }).ok, reason).toBe(true);
        }

        for (const reason of ['started', 'blocked', 'muted', ''])
        {
            expect(partyState.safeParse({ invites: [], ended: { id: NOWHERE, reason } }).ok, reason).toBe(false);
        }
    });

    it('takes a handle and a game to ask with, and nothing shaped otherwise', () =>
    {
        expect(partyInput.safeParse({ id: 'mina', game: 'hokm' }).ok).toBe(true);

        for (const body of [{}, { id: 'mina' }, { game: 'hokm' }, { id: 7, game: 'hokm' }, { id: 'mina', game: null }, { id: 'x'.repeat(33), game: 'hokm' }, { id: 'mina', game: 'x'.repeat(33) }, { id: `mi${ String.fromCharCode(0) }na`, game: 'hokm' }])
        {
            expect(partyInput.safeParse(body).ok, JSON.stringify(body).slice(0, 60)).toBe(false);
        }
    });
});

describe('a party refusal', () =>
{
    it.each(Object.entries(PARTY_REFUSALS) as [PartyRefusal, number][])('answers %s with that word as its code, at the status the list gives it', (word, status) =>
    {
        const refusal = partyRefusal(word);

        expect(refusal).toBeInstanceOf(HttpError);
        expect(refusal).toMatchObject({ status, code: word, expose: true });
        expect(refusal.message.trim()).not.toBe('');
        expect(partyRefused(word)).toMatchObject({ status, code: word, message: refusal.message });
    });

    it('says a missing team as a missing thing, and somebody who cannot be asked in the table’s own sentence', () =>
    {
        expect(PARTY_REFUSALS['party-missing']).toBe(404);
        expect(partyRefused('no-invitee')).toMatchObject({ status: TABLE_REFUSALS['no-invitee'], code: 'no-invitee', message: noInvitee().message });
    });

    it('spells every word in kebab case, which is what the wire calls a code', () =>
    {
        expect(WORDS.length).toBeGreaterThan(0);

        for (const word of WORDS)
        {
            expect(word).toMatch(/^[a-z]+(-[a-z]+)*$/);
        }
    });

    it('shares no word with a refused play, a refused table, or a code the framework answers on its own', () =>
    {
        expect(FRAMEWORK).toEqual(expect.arrayContaining(['forbidden', 'conflict', 'not-found', 'validation-failed', 'internal']));
        expect(WORDS.filter((word) => FRAMEWORK.includes(word))).toEqual([]);
        expect(WORDS.filter((word) => Object.hasOwn(REFUSALS, word))).toEqual([]);
        expect(WORDS.filter((word) => Object.hasOwn(TABLE_REFUSALS, word))).toEqual([]);
        expect(Object.keys(TABLE_REFUSALS).filter((word) => Object.hasOwn(REFUSALS, word))).toEqual([]);
    });

    it('knows its own words and nothing an object merely inherits', () =>
    {
        for (const word of WORDS)
        {
            expect(isPartyRefusal(word), word).toBe(true);
        }

        for (const other of ['', 'conflict', 'not-found', 'no-invitee', 'not-your-turn', 'seated-max', 'toString', 'constructor', 'valueOf', 'hasOwnProperty', '__proto__'])
        {
            expect(isPartyRefusal(other), other).toBe(false);
        }
    });

    it('has somebody who answers every word on the list, and is never spelled by hand where it is thrown', () =>
    {
        const answering = [sourceOf('domains', 'party', 'registry.ts'), sourceOf('domains', 'party', 'parties.ts')].join('\n');

        expect(WORDS.filter((word) => !answering.includes(`refused('${ word }')`))).toEqual([]);

        for (const path of [['domains', 'party', 'refusal.ts'], ['services.ts'], ['api.ts']])
        {
            expect(sourceOf(...path).match(/\bcode:\s*['"`][^'"`]*['"`]/g) ?? [], path.join('/')).toEqual([]);
        }
    });
});

describe('the rules about who may team up', () =>
{
    it('are asked through what they are handed, so the browser specs’ server runs the same ones', () =>
    {
        const source = sourceOf('domains', 'party', 'parties.ts');
        const imports = [...source.matchAll(/^import\s+(type\s+)?[^;]*?\bfrom\s+'([^']+)';/gm)].map((found) => `${ found[1] === undefined ? '' : 'type ' }${ found[2] }`);

        expect(imports.sort()).toEqual(['type ../../schemas.ts', 'type ./registry.ts', 'type ./rules.ts']);
        expect(source).not.toMatch(/\b(require|import)\s*\(/);
        expect(source).not.toMatch(/\bDate\b|setTimeout|setInterval|Math\.random|randomUUID|process\./);
    });
});
