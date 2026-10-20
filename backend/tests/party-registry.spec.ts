import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeEach, describe, expect, it } from 'vitest';

import { createRegistry, type Registry } from '../src/domains/party/registry.ts';
import { COOLDOWN_MS, ENDED_MS, IDLE_MS, INVITE_MS, INVITES_HELD, PARTY_ENDS, PARTY_STAGES } from '../src/domains/party/rules.ts';

const HERE = dirname(fileURLToPath(import.meta.url));

const read = (file: string) => readFileSync(join(HERE, '..', 'src', 'domains', 'party', file), 'utf8');

interface Due
{
    at: number;
    run: () => void;
    off: boolean;
}

let at: number;
let seq: number;
let due: Due[];
let rung: string[][];
let registry: Registry;

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

const waiting = () => due.filter((one) => !one.off).length;

const heard = () =>
{
    const told = rung;

    rung = [];

    return told;
};

const formed = (leader: string, member: string, game = 'hokm', silent = false) =>
{
    const made = registry.invite(leader, member, game, silent);

    if (!made.ok)
    {
        throw new Error(`the invitation was refused: ${ made.why }`);
    }

    return made.party;
};

const begin = () =>
{
    at = 1_700_000_000_000;
    seq = 0;
    due = [];
    rung = [];

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
        ring: (userIds) => rung.push([...userIds].sort()),
        id: () => `party-${ seq += 1 }`
    });
};

beforeEach(begin);

describe('two people forming a team', () =>
{
    it('is an invitation the leader holds and the other is shown, for a minute and a half', () =>
    {
        const party = formed('dana', 'mina');

        expect(party).toEqual({ id: 'party-1', game: 'hokm', leader: 'dana', member: 'mina', stage: 'inviting', until: at + INVITE_MS, silent: false });
        expect(registry.of('dana')).toEqual({ party, invites: [], ended: null });
        expect(registry.of('mina')).toEqual({ party: null, invites: [party], ended: null });
        expect(registry.remaining(party)).toBe(INVITE_MS);

        advance(30_000);

        expect(registry.remaining(party)).toBe(INVITE_MS - 30_000);
    });

    it('is a team once the other says yes, with five minutes to go looking', () =>
    {
        const party = formed('dana', 'mina');

        advance(10_000);

        const joined = registry.accept('mina', party.id);
        const ready = { ...party, stage: 'ready', until: at + IDLE_MS };

        expect(joined).toEqual({ ok: true, party: ready });
        expect(registry.of('dana')).toEqual({ party: ready, invites: [], ended: null });
        expect(registry.of('mina')).toEqual({ party: ready, invites: [], ended: null });

        advance(INVITE_MS);

        expect(registry.of('dana').party, 'the invitation’s clock ran out under a team that had formed').toEqual(ready);
    });

    it('answers the same invitation to a leader who asks for it twice', () =>
    {
        const first = formed('dana', 'mina');

        advance(5_000);
        heard();

        expect(registry.invite('dana', 'mina', 'hokm', false)).toEqual({ ok: true, party: first });
        expect(registry.of('mina').invites).toHaveLength(1);
        expect(heard(), 'asking again rang somebody').toEqual([]);
    });

    it('hands out what it holds as copies, so nobody outside can move a team along', () =>
    {
        const party = formed('dana', 'mina');

        party.stage = 'ready';
        registry.of('mina').invites[0].leader = 'somebody';

        expect(registry.of('dana').party?.stage).toBe('inviting');
        expect(registry.of('mina').invites[0].leader).toBe('dana');
    });
});

describe('one team a person', () =>
{
    it('refuses a leader a second invitation while the first stands, to anybody else or for another game', () =>
    {
        formed('dana', 'mina');

        expect(registry.invite('dana', 'omid', 'hokm', false)).toEqual({ ok: false, why: 'in-party' });
        expect(registry.invite('dana', 'mina', 'ludo', false)).toEqual({ ok: false, why: 'in-party' });
        expect(registry.of('omid').invites).toEqual([]);
    });

    it('refuses somebody already in a team a second one, as the one asking or the one saying yes', () =>
    {
        const first = formed('dana', 'mina');
        const second = formed('omid', 'mina');

        expect(registry.accept('mina', first.id).ok).toBe(true);
        expect(registry.accept('mina', second.id)).toEqual({ ok: false, why: 'in-party' });
        expect(registry.invite('mina', 'sara', 'hokm', false)).toEqual({ ok: false, why: 'in-party' });
        expect(registry.of('mina').invites.map((one) => one.id), 'the invitation it could not take was thrown away').toEqual([second.id]);
    });

    it('never refuses an invitation because whoever it is for is busy', () =>
    {
        const team = formed('dana', 'mina');

        registry.accept('mina', team.id);

        expect(registry.invite('omid', 'mina', 'hokm', false).ok).toBe(true);
        expect(registry.invite('sara', 'dana', 'hokm', false).ok).toBe(true);
    });

    it('lets a leader whose own invitation is out say yes to nobody else’s until it is taken back', () =>
    {
        const mine = formed('dana', 'mina');
        const theirs = formed('omid', 'dana');

        expect(registry.accept('dana', theirs.id)).toEqual({ ok: false, why: 'in-party' });
        expect(registry.leave('dana', mine.id)).toEqual({ ok: true });
        expect(registry.accept('dana', theirs.id).ok).toBe(true);
    });
});

describe('two people who each ask the other', () =>
{
    it('are one team, led by whoever asked first: asking back is a yes', () =>
    {
        const first = formed('dana', 'mina');

        advance(10_000);
        heard();

        const ready = { ...first, stage: 'ready', until: at + IDLE_MS };

        expect(registry.invite('mina', 'dana', 'hokm', false)).toEqual({ ok: true, party: ready });
        expect(registry.of('dana')).toEqual({ party: ready, invites: [], ended: null });
        expect(registry.of('mina')).toEqual({ party: ready, invites: [], ended: null });
        expect(registry.involving('mina'), 'a second team was made beside the one that was asked for').toHaveLength(1);
        expect(heard()).toEqual([['dana', 'mina']]);
    });

    it('are that team though the first ask was never shown, and from then on both of them are told', () =>
    {
        const quiet = formed('dana', 'mina', 'hokm', true);

        expect(registry.invite('mina', 'dana', 'hokm', true)).toEqual({ ok: true, party: { ...quiet, stage: 'ready', until: at + IDLE_MS, silent: false } });
        expect(registry.of('mina').party?.id).toBe(quiet.id);

        heard();
        registry.leave('dana', quiet.id);

        expect(heard(), 'a team that began unheard ended unheard for one of them').toEqual([['dana', 'mina']]);
        expect(registry.of('mina').ended).toEqual({ id: quiet.id, reason: 'left', by: 'dana' });
    });

    it('are that team while the one asking back is still waiting out a no of their own', () =>
    {
        registry.decline('dana', formed('mina', 'dana').id);

        const theirs = formed('dana', 'mina');

        expect(registry.invite('mina', 'dana', 'ludo', false), 'the wait was lifted for an invitation of their own').toEqual({ ok: false, why: 'party-cooldown' });
        expect(registry.invite('mina', 'dana', 'hokm', false)).toMatchObject({ ok: true, party: { id: theirs.id, stage: 'ready', leader: 'dana', member: 'mina' } });
    });

    it('stay two invitations when they asked for different games, and neither can take the other’s until one is taken back', () =>
    {
        const hokm = formed('dana', 'mina');
        const ludo = formed('mina', 'dana', 'ludo');
        const busy = { ok: false, why: 'in-party' };

        expect(registry.of('dana')).toMatchObject({ party: { id: hokm.id, stage: 'inviting' }, invites: [{ id: ludo.id }] });
        expect(registry.of('mina')).toMatchObject({ party: { id: ludo.id, stage: 'inviting' }, invites: [{ id: hokm.id }] });
        expect(registry.invite('mina', 'dana', 'hokm', false), 'somebody with an invitation of their own out joined another').toEqual(busy);
        expect(registry.accept('dana', ludo.id)).toEqual(busy);

        registry.leave('mina', ludo.id);

        expect(registry.invite('mina', 'dana', 'hokm', false)).toMatchObject({ ok: true, party: { id: hokm.id, stage: 'ready' } });
    });
});

describe('how a team ends', () =>
{
    it('says the other one cannot play when they say not now, to the leader alone', () =>
    {
        const party = formed('dana', 'mina');

        expect(registry.decline('mina', party.id)).toEqual({ ok: true });
        expect(registry.of('dana')).toEqual({ party: null, invites: [], ended: { id: party.id, reason: 'declined', by: 'mina' } });
        expect(registry.of('mina')).toEqual({ party: null, invites: [], ended: null });
    });

    it('says the leader left when an invitation is taken back, and to nobody but the leader', () =>
    {
        const party = formed('dana', 'mina');

        expect(registry.leave('dana', party.id)).toEqual({ ok: true });
        expect(registry.of('dana').ended).toEqual({ id: party.id, reason: 'left', by: 'dana' });
        expect(registry.of('mina')).toEqual({ party: null, invites: [], ended: null });
    });

    it('says who left a team that had formed, to both of them', () =>
    {
        const party = formed('dana', 'mina');

        registry.accept('mina', party.id);

        expect(registry.leave('mina', party.id)).toEqual({ ok: true });
        expect(registry.of('dana')).toEqual({ party: null, invites: [], ended: { id: party.id, reason: 'left', by: 'mina' } });
        expect(registry.of('mina')).toEqual({ party: null, invites: [], ended: { id: party.id, reason: 'left', by: 'mina' } });
    });

    it('runs an invitation out after a minute and a half with no answer', () =>
    {
        const party = formed('dana', 'mina');

        advance(INVITE_MS - 1);

        expect(registry.of('mina').invites).toHaveLength(1);

        advance(1);

        expect(registry.of('dana')).toEqual({ party: null, invites: [], ended: { id: party.id, reason: 'expired', by: null } });
        expect(registry.of('mina')).toEqual({ party: null, invites: [], ended: null });
    });

    it('runs a team out after five minutes with no search, for both of them', () =>
    {
        const party = formed('dana', 'mina');

        advance(20_000);
        registry.accept('mina', party.id);
        advance(IDLE_MS - 1);

        expect(registry.of('mina').party?.stage).toBe('ready');

        advance(1);

        for (const who of ['dana', 'mina'])
        {
            expect(registry.of(who), who).toEqual({ party: null, invites: [], ended: { id: party.id, reason: 'expired', by: null } });
        }
    });

    it('ends one with no reason and no name when it is dissolved, and does nothing to one that is not there', () =>
    {
        const party = formed('dana', 'mina');

        registry.accept('mina', party.id);
        registry.dissolve(party.id);
        registry.dissolve(party.id);
        registry.dissolve('party-99');

        for (const who of ['dana', 'mina'])
        {
            expect(registry.of(who), who).toEqual({ party: null, invites: [], ended: { id: party.id, reason: 'ended', by: null } });
        }
    });

    it('keeps the reason for half a minute and then forgets it', () =>
    {
        const party = formed('dana', 'mina');

        registry.decline('mina', party.id);
        advance(ENDED_MS - 1);

        expect(registry.of('dana').ended?.reason).toBe('declined');

        advance(1);

        expect(registry.of('dana').ended).toBeNull();
    });

    it('keeps the newest reason when a second team ends inside that half minute, for as long as the second is owed', () =>
    {
        const first = formed('dana', 'mina');

        registry.accept('mina', first.id);
        registry.leave('mina', first.id);
        advance(ENDED_MS - 5_000);

        const second = formed('dana', 'omid');

        registry.accept('omid', second.id);
        registry.leave('omid', second.id);
        advance(5_000);

        expect(registry.of('dana').ended, 'the first reason’s clock took the second reason with it').toEqual({ id: second.id, reason: 'left', by: 'omid' });

        advance(ENDED_MS - 5_000);

        expect(registry.of('dana').ended).toBeNull();
    });

    it('leaves nothing waiting on the clock once everything has ended and been forgotten', () =>
    {
        const one = formed('dana', 'mina');
        const two = formed('omid', 'sara');

        registry.accept('mina', one.id);
        registry.decline('sara', two.id);
        advance(IDLE_MS + ENDED_MS + COOLDOWN_MS);

        expect(waiting()).toBe(0);
        expect(registry.involving('dana')).toEqual([]);
    });

    it('produces every stage and every ending the wire can name', () =>
    {
        const stages = new Set<string>();
        const ends = new Set<string>();
        const seen = () =>
        {
            for (const who of ['dana', 'mina'])
            {
                const held = registry.of(who);

                for (const party of [held.party, ...held.invites])
                {
                    if (party !== null)
                    {
                        stages.add(party.stage);
                    }
                }

                if (held.ended !== null)
                {
                    ends.add(held.ended.reason);
                }
            }
        };

        const declined = formed('dana', 'mina');

        seen();
        registry.decline('mina', declined.id);
        seen();
        advance(COOLDOWN_MS);

        const left = formed('dana', 'mina');

        registry.accept('mina', left.id);
        seen();
        registry.leave('dana', left.id);
        seen();

        const expired = formed('dana', 'mina');

        advance(INVITE_MS);
        seen();
        advance(COOLDOWN_MS);
        registry.dissolve(formed('dana', 'mina').id);
        seen();

        expect(expired.stage).toBe('inviting');
        expect([...stages].sort()).toEqual([...PARTY_STAGES].sort());
        expect([...ends].sort()).toEqual([...PARTY_ENDS].sort());
    });
});

describe('somebody who is not part of it', () =>
{
    it('is answered as for a team that is not there, whatever they ask of it', () =>
    {
        const party = formed('dana', 'mina');
        const missing = { ok: false, why: 'party-missing' };

        expect(registry.accept('omid', party.id)).toEqual(missing);
        expect(registry.decline('omid', party.id)).toEqual(missing);
        expect(registry.leave('omid', party.id)).toEqual(missing);
        expect(registry.accept('dana', party.id), 'a leader said yes to their own invitation').toEqual(missing);
        expect(registry.decline('dana', party.id)).toEqual(missing);
        expect(registry.accept('mina', 'party-99')).toEqual(missing);
        expect(registry.decline('mina', 'party-99')).toEqual(missing);
        expect(registry.leave('mina', 'party-99')).toEqual(missing);
        expect(registry.of('dana').party?.stage).toBe('inviting');
    });

    it('cannot leave an invitation they have not said yes to, or answer one twice', () =>
    {
        const party = formed('dana', 'mina');
        const missing = { ok: false, why: 'party-missing' };

        expect(registry.leave('mina', party.id)).toEqual(missing);
        expect(registry.accept('mina', party.id).ok).toBe(true);
        expect(registry.accept('mina', party.id)).toEqual(missing);
        expect(registry.decline('mina', party.id)).toEqual(missing);
        expect(registry.of('mina').party?.stage).toBe('ready');
    });

    it('is told who may still say yes to an invitation, and nobody else', () =>
    {
        const party = formed('dana', 'mina');

        expect(registry.invitation('mina', party.id)).toEqual(party);
        expect(registry.invitation('omid', party.id)).toBeNull();
        expect(registry.invitation('dana', party.id)).toBeNull();
        expect(registry.invitation('mina', 'party-99')).toBeNull();

        registry.accept('mina', party.id);

        expect(registry.invitation('mina', party.id)).toBeNull();
    });
});

describe('invitations somebody is holding', () =>
{
    it('holds several at once, oldest first', () =>
    {
        const first = formed('dana', 'mina');

        advance(1_000);

        const second = formed('omid', 'mina', 'ludo');

        expect(registry.of('mina').invites.map((one) => one.id)).toEqual([first.id, second.id]);
    });

    it('runs the oldest out when a sixth arrives, as an invitation nobody answered', () =>
    {
        const leaders = ['a', 'b', 'c', 'd', 'e', 'f'];
        const made = leaders.map((leader) =>
        {
            advance(1_000);

            return formed(leader, 'mina');
        });

        expect(leaders).toHaveLength(INVITES_HELD + 1);
        expect(registry.of('mina').invites.map((one) => one.id)).toEqual(made.slice(1).map((one) => one.id));
        expect(registry.of('a')).toEqual({ party: null, invites: [], ended: { id: made[0].id, reason: 'expired', by: null } });
        expect(registry.of('mina').ended).toBeNull();
    });
});

describe('asking the same person again', () =>
{
    it('waits half a minute after a no, and after an invitation that ran out or was pushed out', () =>
    {
        const cooling = { ok: false, why: 'party-cooldown' };

        registry.decline('mina', formed('dana', 'mina').id);

        expect(registry.invite('dana', 'mina', 'hokm', false)).toEqual(cooling);

        advance(COOLDOWN_MS - 1);

        expect(registry.invite('dana', 'mina', 'ludo', false)).toEqual(cooling);

        advance(1);
        formed('dana', 'mina');
        advance(INVITE_MS);

        expect(registry.invite('dana', 'mina', 'hokm', false)).toEqual(cooling);

        advance(COOLDOWN_MS);
        formed('dana', 'mina');

        for (const leader of ['a', 'b', 'c', 'd', 'e'])
        {
            formed(leader, 'mina');
        }

        expect(registry.invite('dana', 'mina', 'hokm', false)).toEqual(cooling);
    });

    it('does not wait after an invitation the asker took back, so leaving and asking again changes the game', () =>
    {
        registry.leave('dana', formed('dana', 'mina', 'ludo').id);

        const again = formed('dana', 'mina');

        expect(registry.of('mina').invites.map((one) => [one.id, one.game])).toEqual([[again.id, 'hokm']]);

        registry.leave('dana', again.id);

        expect(registry.invite('dana', 'mina', 'hokm', false).ok, 'the same game could not be asked for again').toBe(true);
    });

    it('does not wait after one that was dissolved: whether they may still be asked is not the registry’s to say', () =>
    {
        registry.dissolve(formed('dana', 'mina').id);

        expect(registry.invite('dana', 'mina', 'hokm', false).ok).toBe(true);
    });

    it('is about who asked whom: anybody else may ask at once, and so may the one who said no', () =>
    {
        registry.decline('mina', formed('dana', 'mina').id);

        expect(registry.invite('dana', 'omid', 'hokm', false).ok).toBe(true);
        expect(registry.invite('mina', 'dana', 'hokm', false).ok).toBe(true);
        expect(registry.invite('sara', 'mina', 'hokm', false).ok).toBe(true);
    });

    it('does not wait after a team that had formed', () =>
    {
        const party = formed('dana', 'mina');

        registry.accept('mina', party.id);
        registry.leave('mina', party.id);

        expect(registry.invite('dana', 'mina', 'hokm', false).ok).toBe(true);
    });
});

describe('an invitation nobody is to hear of', () =>
{
    it('is the leader’s to wait on and nothing at all to whoever it was for', () =>
    {
        const party = formed('dana', 'mina', 'hokm', true);
        const missing = { ok: false, why: 'party-missing' };

        expect(party.silent).toBe(true);
        expect(registry.of('dana').party).toEqual(party);
        expect(registry.of('mina')).toEqual({ party: null, invites: [], ended: null });
        expect(heard()).toEqual([['dana']]);
        expect(registry.invitation('mina', party.id)).toBeNull();
        expect(registry.accept('mina', party.id)).toEqual(missing);
        expect(registry.decline('mina', party.id)).toEqual(missing);
        expect(registry.of('dana').party?.stage).toBe('inviting');
    });

    it('runs out like one that was ignored, with nobody but the leader told', () =>
    {
        const quiet = formed('dana', 'mina', 'hokm', true);

        heard();
        advance(INVITE_MS - 1);

        expect(registry.of('dana').party?.id).toBe(quiet.id);

        advance(1);

        expect(registry.of('dana')).toEqual({ party: null, invites: [], ended: { id: quiet.id, reason: 'expired', by: null } });
        expect(registry.of('mina')).toEqual({ party: null, invites: [], ended: null });
        expect(heard()).toEqual([['dana']]);
    });

    it('is pushed out by five later ones exactly as one that was seen is, so whoever asked reads the same either way', () =>
    {
        const asking = (silent: boolean) =>
        {
            begin();

            const mine = formed('dana', 'mina', 'hokm', silent);
            const readings: unknown[] = [];

            for (const leader of ['a', 'b', 'c', 'd', 'e'])
            {
                advance(1_000);
                formed(leader, 'mina');

                const held = registry.of('dana');

                readings.push({ ...held, party: held.party === null ? null : { ...held.party, silent: false } }, registry.remaining(mine));
            }

            readings.push(registry.invite('dana', 'mina', 'hokm', silent));

            return { mine, readings, told: heard().filter((one) => one.includes('dana')), shown: registry.of('mina').invites.map((one) => one.leader) };
        };

        const seen = asking(false);
        const unseen = asking(true);

        expect(seen.readings.at(-3)).toEqual({ party: null, invites: [], ended: { id: seen.mine.id, reason: 'expired', by: null } });
        expect(seen.readings.at(-1)).toEqual({ ok: false, why: 'party-cooldown' });
        expect(unseen.readings, 'whoever asked could tell they had been muted').toEqual(seen.readings);
        expect(seen.told).toEqual([['dana', 'mina'], ['dana', 'mina']]);
        expect(unseen.told, 'somebody was rung about an invitation they were never to hear of').toEqual([['dana'], ['dana']]);
        expect(seen.shown).toEqual(['a', 'b', 'c', 'd', 'e']);
        expect(unseen.shown, 'an invitation nobody was to hear of was listed').toEqual(seen.shown);
    });

    it('takes one of the five places whoever it is from, and gives the place back when it ends', () =>
    {
        const made = ['a', 'b', 'c', 'd', 'e'].map((leader) => formed(leader, 'mina'));
        const quiet = formed('dana', 'mina', 'hokm', true);

        expect(registry.of('a'), 'a sixth nobody hears of pushed nothing out').toEqual({ party: null, invites: [], ended: { id: made[0].id, reason: 'expired', by: null } });
        expect(registry.of('mina').invites.map((one) => one.id)).toEqual(made.slice(1).map((one) => one.id));
        expect(made).toHaveLength(INVITES_HELD);

        registry.leave('dana', quiet.id);
        formed('f', 'mina');

        expect(registry.of('b').party?.id, 'a place was kept for an invitation that had gone').toBe(made[1].id);

        formed('g', 'mina');

        expect(registry.of('b').party).toBeNull();
    });
});

describe('who is rung', () =>
{
    it('is the leader and the other one at every step, and nobody else', () =>
    {
        const both = [['dana', 'mina']];
        const party = formed('dana', 'mina');

        expect(heard(), 'an invitation').toEqual(both);

        registry.accept('mina', party.id);

        expect(heard(), 'a yes').toEqual(both);

        registry.leave('dana', party.id);

        expect(heard(), 'a leave').toEqual(both);

        advance(COOLDOWN_MS);

        const second = formed('dana', 'mina');

        heard();
        registry.decline('mina', second.id);

        expect(heard(), 'a no').toEqual(both);

        advance(COOLDOWN_MS);
        formed('dana', 'mina');
        heard();
        advance(INVITE_MS);

        expect(heard(), 'an invitation running out').toEqual(both);

        advance(COOLDOWN_MS);
        registry.dissolve(formed('dana', 'mina').id);

        expect(heard().at(-1), 'a team dissolved').toEqual(both[0]);
    });

    it('is nobody when nothing changed', () =>
    {
        const party = formed('dana', 'mina');

        heard();
        registry.accept('omid', party.id);
        registry.decline('dana', party.id);
        registry.leave('mina', party.id);
        registry.dissolve('party-99');
        registry.invite('dana', 'omid', 'hokm', false);
        registry.of('dana');
        registry.involving('mina');

        expect(heard()).toEqual([]);
    });

    it('is nobody when a reason is forgotten: whoever was owed it has read it or never will', () =>
    {
        registry.decline('mina', formed('dana', 'mina').id);
        heard();
        advance(ENDED_MS);

        expect(heard()).toEqual([]);
    });
});

describe('everything somebody is part of', () =>
{
    it('is the team they lead or belong to and every invitation to or from them, silent ones included', () =>
    {
        const mine = formed('dana', 'mina');
        const theirs = formed('omid', 'dana');
        const quiet = formed('sara', 'dana', 'hokm', true);

        formed('reza', 'leila');

        expect(registry.involving('dana').map((one) => one.id).sort()).toEqual([mine.id, theirs.id, quiet.id].sort());
        expect(registry.involving('nobody')).toEqual([]);
    });
});

describe('the registry', () =>
{
    it('is worked out by two modules that reach for nothing: no clock, no dice and no import but the rules', () =>
    {
        const rules = read('rules.ts');
        const source = read('registry.ts');

        expect(rules).not.toMatch(/^\s*import\s/m);
        expect(rules).not.toMatch(/\bfrom\s+['"]/);
        expect([...source.matchAll(/\bfrom\s+'([^']+)'/g)].map((found) => found[1])).toEqual(['./rules.ts']);

        for (const text of [rules, source])
        {
            expect(text).not.toMatch(/\b(require|import)\s*\(/);
            expect(text).not.toMatch(/\bDate\b|setTimeout|setInterval|Math\.random|randomUUID|\bcrypto\b|process\./);
        }
    });

    it('keeps the numbers the owner was asked about', () =>
    {
        expect({ INVITE_MS, IDLE_MS, ENDED_MS, COOLDOWN_MS, INVITES_HELD }).toEqual({
            INVITE_MS: 90_000,
            IDLE_MS: 300_000,
            ENDED_MS: 30_000,
            COOLDOWN_MS: 30_000,
            INVITES_HELD: 5
        });
    });

    it('names two stages and four endings, and no stage a search would need before there is a search', () =>
    {
        expect([...PARTY_STAGES]).toEqual(['inviting', 'ready']);
        expect([...PARTY_ENDS]).toEqual(['declined', 'expired', 'left', 'ended']);
    });
});
