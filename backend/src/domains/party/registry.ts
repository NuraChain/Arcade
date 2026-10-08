import { COOLDOWN_MS, ENDED_MS, IDLE_MS, INVITE_MS, INVITES_HELD, type PartyEnd, type PartyRefusal, type PartyStage } from './rules.ts';

export interface Party
{
    id: string;
    game: string;
    leader: string;
    member: string;
    stage: PartyStage;
    until: number;
    silent: boolean;
}

export interface Tombstone
{
    id: string;
    reason: PartyEnd;
    by: string | null;
}

export interface RegistryDeps
{
    now(): number;
    after(ms: number, run: () => void): () => void;
    ring(userIds: readonly string[]): void;
    id(): string;
}

const refused = <Why extends PartyRefusal>(why: Why) => ({ ok: false as const, why });

const formed = (party: Party) => ({ ok: true as const, party: { ...party } });

const DONE = { ok: true as const };

export function createRegistry(deps: RegistryDeps)
{
    const byId = new Map<string, Party>();
    const inParty = new Map<string, string>();
    const invitesTo = new Map<string, string[]>();
    const clocks = new Map<string, () => void>();
    const ended = new Map<string, Tombstone>();
    const fading = new Map<string, () => void>();
    const cooling = new Map<string, number>();

    const askedOf = (leader: string, member: string) => `${ leader }>${ member }`;

    const heldBy = (userId: string) => byId.get(inParty.get(userId) ?? '');

    const unlist = (party: Party) =>
    {
        const left = (invitesTo.get(party.member) ?? []).filter((id) => id !== party.id);

        if (left.length === 0)
        {
            invitesTo.delete(party.member);
        }
        else
        {
            invitesTo.set(party.member, left);
        }
    };

    const cool = (party: Party) =>
    {
        const at = deps.now();

        for (const [asked, until] of [...cooling])
        {
            if (until <= at)
            {
                cooling.delete(asked);
            }
        }

        cooling.set(askedOf(party.leader, party.member), at + COOLDOWN_MS);
    };

    const bury = (userId: string, tombstone: Tombstone) =>
    {
        fading.get(userId)?.();
        ended.set(userId, tombstone);
        fading.set(userId, deps.after(ENDED_MS, () =>
        {
            fading.delete(userId);
            ended.delete(userId);
        }));
    };

    const end = (party: Party, reason: PartyEnd, by: string | null) =>
    {
        const teamed = party.stage === 'ready';
        const tombstone = { id: party.id, reason, by };

        clocks.get(party.id)?.();
        clocks.delete(party.id);
        byId.delete(party.id);
        inParty.delete(party.leader);
        bury(party.leader, tombstone);

        if (teamed)
        {
            inParty.delete(party.member);
            bury(party.member, tombstone);
        }
        else
        {
            unlist(party);

            if (reason === 'declined' || reason === 'expired')
            {
                cool(party);
            }
        }

        deps.ring(party.silent ? [party.leader] : [party.leader, party.member]);
    };

    const arm = (party: Party, ms: number) =>
    {
        clocks.get(party.id)?.();
        party.until = deps.now() + ms;
        clocks.set(party.id, deps.after(ms, () =>
        {
            clocks.delete(party.id);

            if (byId.get(party.id) === party)
            {
                end(party, 'expired', null);
            }
        }));
    };

    const invited = (member: string, partyId: string) =>
    {
        const party = byId.get(partyId);

        return party !== undefined && party.stage === 'inviting' && party.member === member && !party.silent ? party : null;
    };

    const team = (party: Party) =>
    {
        unlist(party);
        party.stage = 'ready';
        party.silent = false;
        inParty.set(party.member, party.id);
        arm(party, IDLE_MS);
        deps.ring([party.leader, party.member]);

        return formed(party);
    };

    return {
        invite(leader: string, member: string, game: string, silent: boolean)
        {
            const held = heldBy(leader);

            if (held !== undefined)
            {
                return held.leader === leader && held.stage === 'inviting' && held.member === member && held.game === game
                    ? formed(held)
                    : refused('in-party');
            }

            const theirs = heldBy(member);

            if (theirs !== undefined && theirs.stage === 'inviting' && theirs.member === leader && theirs.game === game)
            {
                return team(theirs);
            }

            if ((cooling.get(askedOf(leader, member)) ?? 0) > deps.now())
            {
                return refused('party-cooldown');
            }

            const party: Party = { id: deps.id(), game, leader, member, stage: 'inviting', until: 0, silent };
            const queue = [...(invitesTo.get(member) ?? []), party.id];

            byId.set(party.id, party);
            inParty.set(leader, party.id);
            invitesTo.set(member, queue);
            arm(party, INVITE_MS);
            deps.ring(silent ? [leader] : [leader, member]);

            const oldest = queue.length > INVITES_HELD ? byId.get(queue[0]) : undefined;

            if (oldest !== undefined)
            {
                end(oldest, 'expired', null);
            }

            return formed(party);
        },

        accept(member: string, partyId: string)
        {
            const party = invited(member, partyId);

            if (party === null)
            {
                return refused('party-missing');
            }

            if (inParty.has(member))
            {
                return refused('in-party');
            }

            return team(party);
        },

        decline(member: string, partyId: string)
        {
            const party = invited(member, partyId);

            if (party === null)
            {
                return refused('party-missing');
            }

            end(party, 'declined', member);

            return DONE;
        },

        leave(userId: string, partyId: string)
        {
            const party = byId.get(partyId);

            if (party === undefined || (party.leader !== userId && !(party.member === userId && party.stage === 'ready')))
            {
                return refused('party-missing');
            }

            end(party, 'left', userId);

            return DONE;
        },

        dissolve(partyId: string)
        {
            const party = byId.get(partyId);

            if (party !== undefined)
            {
                end(party, 'ended', null);
            }
        },

        invitation(member: string, partyId: string)
        {
            const party = invited(member, partyId);

            return party === null ? null : { ...party };
        },

        of(userId: string)
        {
            const held = heldBy(userId);
            const tombstone = ended.get(userId);

            return {
                party: held === undefined ? null : { ...held },
                invites: (invitesTo.get(userId) ?? []).flatMap((id) =>
                {
                    const party = byId.get(id);

                    return party === undefined || party.silent ? [] : [{ ...party }];
                }),
                ended: tombstone === undefined ? null : { ...tombstone }
            };
        },

        involving(userId: string)
        {
            return [...byId.values()].filter((party) => party.leader === userId || party.member === userId).map((party) => ({ ...party }));
        },

        remaining(party: Pick<Party, 'until'>)
        {
            return Math.max(0, party.until - deps.now());
        }
    };
}

export type Registry = ReturnType<typeof createRegistry>;
