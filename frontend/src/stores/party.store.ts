import { createResource, createSignal, createStore, untrack, type Getter } from 'azerothjs';

import { ApiError, client, type PartyInvite, type PartyState, type PartyView } from '../api.ts';
import { attempt } from '../lib/attempt.ts';
import { playWith, playingWith } from '../lib/play-with.ts';
import { runtime } from '../lib/runtime.ts';
import type { MessageKey } from '../locales/en.ts';
import { isPartyRefusal } from '../../../backend/src/domains/party/rules.ts';
import { useAccount } from './account.store.ts';
import { useLocale } from './locale.store.ts';
import { usePeople } from './people.store.ts';
import { useRealtime } from './realtime.store.ts';
import { useToasts } from './toasts.store.ts';

export const EXPIRY_SLACK_MS = 250;

export interface PartyApi
{
    party: Getter<PartyView | null>;
    invites: Getter<PartyInvite[]>;
    known: Getter<boolean>;
    failed: Getter<unknown>;
    remaining(remainingMs: number): number;
    working(key: string): boolean;
    invite(handle: string, game: string): Promise<boolean>;
    accept(partyId: string): Promise<boolean>;
    decline(partyId: string): Promise<boolean>;
    leave(partyId: string): Promise<boolean>;
    refresh(): Promise<void>;
    start(): () => void;
    stop(): void;
    reset(): void;
}

export function whyParty(error: unknown): MessageKey
{
    const code = error instanceof ApiError ? error.code : '';

    if (isPartyRefusal(code))
    {
        return `party.refused.${ code }`;
    }

    return code === 'no-invitee' ? 'tables.refused.no-invitee' : 'common.actionFailed';
}

export const useParty = createStore((): PartyApi =>
{
    const account = useAccount();
    const people = usePeople();

    const who = () => account.user()?.id ?? null;

    const [readFor, setReadFor] = createSignal<string | null>(null);
    const [busy, setBusy] = createSignal<Readonly<Record<string, Promise<boolean>>>>({});

    let asked = 0;
    let arrived = 0;
    let held: string | null = null;
    let waited = false;
    let greeted: string | null = null;
    let said = '';
    let running = false;
    let unhold: (() => void) | null = null;
    let undue: (() => void) | null = null;
    let inFlight: Promise<void> = Promise.resolve();

    const remaining = (remainingMs: number) => Math.max(0, remainingMs - (runtime().clock.now() - arrived));

    const say = (key: MessageKey, name?: string) =>
    {
        useToasts().show({ kind: 'warning', text: useLocale().t(key, name === undefined ? undefined : { name }), dedupe: 'party' });
    };

    const greet = (member: string) =>
    {
        greeted = useToasts().show({
            kind: 'success',
            text: useLocale().t('party.ready.leader', { name: people.byHandle(member)?.displayName ?? member }),
            avatar: member,
            action: { label: useLocale().t('cue.view'), run: () => playWith(member, true) },
            dedupe: 'party-in'
        });
    };

    const ungreet = () =>
    {
        if (greeted !== null)
        {
            useToasts().dismiss(greeted);
            greeted = null;
        }
    };

    const tell = (answer: PartyState, me: string) =>
    {
        const party = answer.party;
        const mine = party?.id ?? null;
        const ended = answer.ended;

        if (mine !== held)
        {
            ungreet();
        }

        if (ended !== undefined && ended.id !== said)
        {
            said = ended.id;

            if (ended.by === undefined || (ended.reason !== 'declined' && ended.reason !== 'left'))
            {
                say(ended.reason === 'expired' ? 'party.ended.expired' : 'party.ended.ended');
            }
            else if (ended.by !== me)
            {
                say(`party.ended.${ ended.reason }`, people.byHandle(ended.by)?.displayName ?? ended.by);
            }
        }
        else if (held !== null && mine !== held && ended?.id !== held && said !== held)
        {
            said = held;
            say('party.ended.ended');
        }

        if (party !== undefined && party.id === held && waited && party.stage === 'ready' && !playingWith())
        {
            greet(party.member);
        }

        held = mine;
        waited = party?.stage === 'inviting';
    };

    const revalidate = () =>
    {
        inFlight = inFlight.catch(() => undefined).then(() => read.refetch());

        return inFlight;
    };

    const keep = (standing: PartyState | undefined) =>
    {
        const clocks = standing === undefined || !running
            ? []
            : [...(standing.party === undefined ? [] : [standing.party.remainingMs]), ...standing.invites.map((invite) => invite.remainingMs)].map(remaining);
        const next = clocks.length > 0 ? useRealtime().hold() : null;

        unhold?.();
        unhold = next;
        undue?.();
        undue = clocks.length === 0 ? null : runtime().clock.after(Math.min(...clocks) + EXPIRY_SLACK_MS, () =>
        {
            undue = null;
            void revalidate().catch(() => undefined);
        });
    };

    const took = (answer: PartyState, me: string) =>
    {
        arrived = runtime().clock.now();
        setReadFor(me);
        people.want([
            ...(answer.party === undefined ? [] : [answer.party.leader, answer.party.member]),
            ...answer.invites.map((invite) => invite.from),
            ...(answer.ended?.by === undefined ? [] : [answer.ended.by])
        ].filter((handle) => handle !== me));
        tell(answer, me);
        keep(answer);
    };

    const read = createResource(who, async (me) =>
    {
        const turn = asked += 1;
        const answer = await client.parties.state();

        if (turn === asked)
        {
            took(answer, me);
        }

        return answer;
    }, { name: 'parties.state' });

    const mine = () => (readFor() !== null && readFor() === who() ? read.data() : undefined);

    const act = (key: string, call: () => Promise<unknown>) =>
    {
        const out = untrack(busy)[key];

        if (out !== undefined)
        {
            return out;
        }

        const started = attempt(call(), undefined, whyParty)
            .then(async (went) =>
            {
                await revalidate().catch(() => undefined);

                return went;
            })
            .finally(() =>
            {
                const next = { ...untrack(busy) };

                delete next[key];
                setBusy(next);
            });

        setBusy({ ...untrack(busy), [key]: started });

        return started;
    };

    const halt = () =>
    {
        running = false;
        keep(undefined);
    };

    return {
        party: () => mine()?.party ?? null,
        invites: () => mine()?.invites ?? [],
        known: () => mine() !== undefined,
        failed: () => read.error(),

        remaining,

        working: (key) => busy()[key] !== undefined,

        invite: (handle, game) => act('invite', () => client.parties.invite({ input: { id: handle, game } })),
        accept: (partyId) => act(partyId, () => client.parties.accept({ params: { id: partyId } })),
        decline: (partyId) => act(partyId, () => client.parties.decline({ params: { id: partyId } })),
        leave: (partyId) => act(partyId, () => client.parties.leave({ params: { id: partyId } })),

        refresh: revalidate,

        start()
        {
            const off = useRealtime().onNudge((scope, id) =>
            {
                if (scope === 'me' && (id === undefined || id === 'party'))
                {
                    void revalidate().catch(() => undefined);
                }
            });

            running = true;
            keep(untrack(mine));

            return () =>
            {
                off();
                halt();
            };
        },

        stop: halt,

        reset()
        {
            halt();
            ungreet();
            asked += 1;
            arrived = 0;
            held = null;
            waited = false;
            said = '';
            inFlight = Promise.resolve();
            setReadFor(null);
            setBusy({});
            void read.refetch();
        }
    };
});
