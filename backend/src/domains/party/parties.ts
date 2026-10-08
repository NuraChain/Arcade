import type { PartyState } from '../../schemas.ts';
import type { Registry } from './registry.ts';
import type { PartyRefusal } from './rules.ts';

export interface PartiesDeps
{
    registry: Registry;
    person(handle: string): Promise<string | null>;
    handles(userIds: readonly string[]): Promise<Map<string, string>>;
    reaches(a: string, b: string): Promise<boolean>;
    muted(userId: string, by: string, game: string): Promise<boolean>;
    teamGame(game: string): Promise<boolean>;
}

export type PartyWhy = PartyRefusal | 'no-invitee';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const refused = <Why extends PartyWhy>(why: Why) => ({ ok: false as const, why });

const DONE = { ok: true as const };

export function createParties(deps: PartiesDeps)
{
    const { registry } = deps;

    return {
        async state(me: string)
        {
            const held = registry.of(me);
            const shown = [...(held.party === null ? [] : [held.party]), ...held.invites];
            const named = await deps.handles([
                ...shown.flatMap((party) => [party.leader, party.member]),
                ...(held.ended === null || held.ended.by === null ? [] : [held.ended.by])
            ]);
            const view: PartyState = { invites: [] };

            if (held.party !== null)
            {
                const leader = named.get(held.party.leader);
                const member = named.get(held.party.member);

                if (leader !== undefined && member !== undefined)
                {
                    view.party = { id: held.party.id, game: held.party.game, leader, member, stage: held.party.stage, remainingMs: registry.remaining(held.party) };
                }
            }

            for (const invite of held.invites)
            {
                const from = named.get(invite.leader);

                if (from !== undefined)
                {
                    view.invites.push({ id: invite.id, game: invite.game, from, remainingMs: registry.remaining(invite) });
                }
            }

            if (held.ended !== null)
            {
                const by = held.ended.by === null ? undefined : named.get(held.ended.by);

                view.ended = { id: held.ended.id, reason: held.ended.reason, ...(by === undefined ? {} : { by }) };
            }

            return view;
        },

        async invite(me: string, handle: string, game: string)
        {
            const other = await deps.person(handle);

            if (other === null || other === me || !await deps.reaches(me, other))
            {
                return refused('no-invitee');
            }

            if (!await deps.teamGame(game))
            {
                return refused('not-team-game');
            }

            const made = registry.invite(me, other, game, await deps.muted(other, me, game));

            return made.ok ? DONE : made;
        },

        async accept(me: string, partyId: string)
        {
            const asked = UUID.test(partyId) ? registry.invitation(me, partyId) : null;

            if (asked === null)
            {
                return refused('party-missing');
            }

            if (!await deps.reaches(me, asked.leader))
            {
                registry.dissolve(asked.id);

                return refused('party-missing');
            }

            const joined = registry.accept(me, asked.id);

            return joined.ok ? DONE : joined;
        },

        decline(me: string, partyId: string)
        {
            return UUID.test(partyId) ? registry.decline(me, partyId) : refused('party-missing');
        },

        leave(me: string, partyId: string)
        {
            return UUID.test(partyId) ? registry.leave(me, partyId) : refused('party-missing');
        },

        async revalidate(userId: string)
        {
            for (const party of registry.involving(userId))
            {
                if (!await deps.reaches(party.leader, party.member))
                {
                    registry.dissolve(party.id);
                }
            }
        }
    };
}

export type Parties = ReturnType<typeof createParties>;
