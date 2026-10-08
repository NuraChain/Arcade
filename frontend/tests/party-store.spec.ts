import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup } from '@azerothjs/testing';

import { manualClock, type ManualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import '../src/locales/app-catalogue.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { useOverlay } from '../src/stores/overlay.store.ts';
import { EXPIRY_SLACK_MS, useParty, whyParty } from '../src/stores/party.store.ts';
import { usePeople } from '../src/stores/people.store.ts';
import { IDLE_MS, NUDGE_WINDOW_MS, useRealtime } from '../src/stores/realtime.store.ts';
import { useSession } from '../src/stores/session.store.ts';
import { useSocial } from '../src/stores/social.store.ts';
import { useToasts } from '../src/stores/toasts.store.ts';
import { COOLDOWN_MS, INVITE_MS, PARTY_REFUSALS } from '../../backend/src/domains/party/rules.ts';
import { ApiError, client, server } from './fake-api.ts';
import { socket } from './fake-realtime.ts';

const NOWHERE = '3f0e3c2a-1111-4222-8333-444455556666';

let clock: ManualClock;

const settle = async () =>
{
    for (let turn = 0; turn < 16; turn += 1)
    {
        await Promise.resolve();
    }
};

const told = () => useToasts().items().map((toast) => [toast.kind, toast.text, toast.dedupe]);

const heardAndForgotten = () =>
{
    const said = told();

    useToasts().dismissAll();

    return said;
};

const reads = () => server.calls.filter((call) => call === 'parties.state').length;

const askedBy = async (leader: string, game = 'hokm') =>
{
    const answer = await server.parties.invite(leader, 'alex', game);

    if (!answer.ok)
    {
        throw new Error(`the invitation was refused: ${ answer.why }`);
    }

    return (await server.parties.state(leader)).party!.id;
};

const swapped = async (verb: string, stand: () => Promise<unknown>, run: () => Promise<void>) =>
{
    const parties = client.parties as unknown as Record<string, unknown>;
    const real = parties[verb];

    parties[verb] = stand;

    try
    {
        await run();
    }
    finally
    {
        parties[verb] = real;
    }
};

beforeEach(async () =>
{
    cleanup();
    resetRuntime();
    clock = manualClock(4_000_000);
    setRuntime({ clock, seed: 19 });
    server.reset();
    useRealtime().reset();
    socket.reset();
    useLocale().setLocale('en');
    useSession().reset();
    useSession().establish({ id: 'alex', handle: 'alex', displayName: 'Alex Morgan', bio: '', hue: 210, kind: 'guest', isMinor: false });
    usePeople().reset();
    useSocial().reset();
    useOverlay().reset();
    useToasts().reset();
    useParty().reset();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await useSocial().refresh();
    await settle();
    server.calls = [];
});

afterEach(() =>
{
    vi.restoreAllMocks();
    useParty().reset();
    useOverlay().reset();
    useToasts().reset();
    useSocial().reset();
    useRealtime().reset();
    cleanup();
});

describe('the reader’s team', () =>
{
    it('is nothing until somebody asks, and then the invitation they hold', async () =>
    {
        const party = useParty();

        await party.refresh();

        expect(party.party()).toBeNull();
        expect(party.invites()).toEqual([]);
        expect(party.known()).toBe(true);

        const id = await askedBy('sara.k');

        await party.refresh();

        expect(party.invites()).toEqual([{ id, game: 'hokm', from: 'sara.k', remainingMs: INVITE_MS }]);
        expect(party.party()).toBeNull();
    });

    it('is the team they asked for, and then the team they are in', async () =>
    {
        const party = useParty();

        expect(await party.invite('sara.k', 'hokm')).toBe(true);
        expect(party.party()).toMatchObject({ game: 'hokm', leader: 'alex', member: 'sara.k', stage: 'inviting' });
        expect(told(), 'asking was announced as though something had happened').toEqual([]);

        await server.parties.accept('sara.k', party.party()!.id);
        await party.refresh();

        expect(party.party()?.stage).toBe('ready');
    });

    it('asks who somebody is when it has not been told', async () =>
    {
        const party = useParty();

        expect(usePeople().byHandle('shirin')).toBeNull();

        await askedBy('shirin');
        await party.refresh();
        await settle();

        expect(usePeople().byHandle('shirin')?.displayName).toBe('Shirin Rahimi');
        expect(server.calls.filter((call) => call === 'social.names'), 'the reader’s own name was asked for, or a name was asked for twice').toHaveLength(1);
    });

    it('is another account’s to read once another account is signed in', async () =>
    {
        const party = useParty();

        await askedBy('sara.k');
        await party.refresh();

        expect(party.invites()).toHaveLength(1);

        server.me = 'reza.t';
        useSession().establish({ id: 'reza.t', handle: 'reza.t', displayName: 'Reza Tehrani', bio: '', hue: 18, kind: 'guest', isMinor: false });
        await settle();

        expect(party.invites()).toEqual([]);
    });
});

describe('the doorbell for a team', () =>
{
    it('is answered by reading again, on its own ring and when everything is rung, and on no other', async () =>
    {
        const party = useParty();
        const stop = party.start();

        useRealtime().start();
        socket.accept();
        clock.advance(NUDGE_WINDOW_MS);
        await settle();

        expect(reads(), 'the ring a connection opens with read nothing').toBeGreaterThan(0);

        server.calls = [];

        for (const frame of [{ scope: 'chat', id: 'c-1' }, { scope: 'social' }, { scope: 'table', id: 't-1' }, { scope: 'game', id: 'm-1' }, { scope: 'me', id: 'notifications' }, { scope: 'me', id: 'devices' }, { scope: 'me', id: 'profile' }] as const)
        {
            socket.deliver({ v: 1, t: 'nudge', n: 1, at: 0, ...frame });
            clock.advance(NUDGE_WINDOW_MS);
            await settle();
        }

        expect(reads(), 'a doorbell about something else read the team').toBe(0);

        const id = await askedBy('sara.k');

        socket.deliver({ v: 1, t: 'nudge', n: 2, scope: 'me', id: 'party', at: 0 });
        clock.advance(NUDGE_WINDOW_MS);
        await settle();

        expect(reads()).toBe(1);
        expect(party.invites().map((one) => one.id)).toEqual([id]);

        socket.deliver({ v: 1, t: 'nudge', n: 3, scope: 'me', at: 0 });
        clock.advance(NUDGE_WINDOW_MS);
        await settle();

        expect(reads()).toBe(2);

        stop();
        socket.deliver({ v: 1, t: 'nudge', n: 4, scope: 'me', id: 'party', at: 0 });
        clock.advance(NUDGE_WINDOW_MS);
        await settle();

        expect(reads(), 'a store that was stopped went on answering').toBe(2);
    });
});

describe('the time an invitation has left', () =>
{
    it('is counted from when the answer arrived, on the product’s clock and never the machine’s', async () =>
    {
        const party = useParty();

        await askedBy('sara.k');
        clock.advance(10_000);
        await party.refresh();

        const [invite] = party.invites();

        expect(invite.remainingMs).toBe(INVITE_MS - 10_000);
        expect(party.remaining(invite.remainingMs)).toBe(INVITE_MS - 10_000);

        vi.spyOn(Date, 'now').mockReturnValue(0);
        clock.advance(25_000);

        expect(party.remaining(invite.remainingMs)).toBe(INVITE_MS - 35_000);

        clock.advance(INVITE_MS);

        expect(party.remaining(invite.remainingMs)).toBe(0);
    });

    it('is read again by itself when it runs out, with no doorbell and no socket', async () =>
    {
        const party = useParty();
        const stop = party.start();

        await askedBy('sara.k');
        await party.refresh();
        server.calls = [];
        clock.advance(INVITE_MS + EXPIRY_SLACK_MS - 1);
        await settle();

        expect(reads()).toBe(0);
        expect(party.invites()).toHaveLength(1);

        clock.advance(1);
        await settle();

        expect(reads()).toBe(1);
        expect(party.invites()).toEqual([]);

        clock.advance(INVITE_MS * 4);
        await settle();

        expect(reads(), 'a clock went on being watched with nothing left to run out').toBe(1);
        stop();
    });

    it('waits on whichever clock runs out first, and stops waiting when the store is reset', async () =>
    {
        const party = useParty();

        party.start();

        await askedBy('sara.k');
        clock.advance(40_000);
        await askedBy('reza.t', 'ludo');
        await party.refresh();
        server.calls = [];
        clock.advance(INVITE_MS - 40_000 + EXPIRY_SLACK_MS);
        await settle();

        expect(reads()).toBe(1);
        expect(party.invites().map((one) => one.from)).toEqual(['reza.t']);

        server.restartParties();
        party.reset();
        await settle();
        server.calls = [];
        clock.advance(INVITE_MS * 2);
        await settle();

        expect(reads(), 'a clock that was being watched outlived the reset').toBe(0);
    });
});

describe('a yes to the reader’s invitation', () =>
{
    const asked = async () =>
    {
        const party = useParty();

        await party.invite('sara.k', 'hokm');

        return { party, id: party.party()!.id };
    };

    const shown = () => useToasts().items().map((toast) => ({ kind: toast.kind, text: toast.text, avatar: toast.avatar, action: toast.action?.label ?? null }));

    it('is said once to whoever asked, with their face and the way to the team', async () =>
    {
        const { party, id } = await asked();

        await server.parties.accept('sara.k', id);
        await party.refresh();

        expect(shown()).toEqual([{ kind: 'success', text: 'Sara Kamali is in. Ready when you are.', avatar: 'sara.k', action: 'View' }]);

        useToasts().items()[0].action!.run();
        await vi.waitFor(() => expect(useOverlay().items().map((entry) => [entry.id, entry.props.personId])).toEqual([['play-with', 'sara.k']]), { timeout: 4000 });

        useToasts().dismissAll();
        useOverlay().reset();
        await party.refresh();
        await party.refresh();

        expect(shown(), 'the same yes was said again on a later read').toEqual([]);
    });

    it('is not said over the sheet that already shows the team', async () =>
    {
        const { party, id } = await asked();

        useOverlay().open(() => document.createElement('div'), {}, { label: 'Play with Sara Kamali', id: 'play-with' });
        await server.parties.accept('sara.k', id);
        await party.refresh();

        expect(shown()).toEqual([]);

        useOverlay().reset();
        await party.refresh();

        expect(shown(), 'a yes the sheet had shown was said once the sheet had gone').toEqual([]);
    });

    it('is said when the sheet that was open is on its way out', async () =>
    {
        const { party, id } = await asked();
        const sheet = useOverlay().open(() => document.createElement('div'), {}, { label: 'Play with Sara Kamali', id: 'play-with' });

        sheet.close();
        await server.parties.accept('sara.k', id);
        await party.refresh();

        expect(shown()).toHaveLength(1);
    });

    it('is said over a sheet that is about something else', async () =>
    {
        const { party, id } = await asked();

        useOverlay().open(() => document.createElement('div'), {}, { label: 'Invite a friend' });
        await server.parties.accept('sara.k', id);
        await party.refresh();

        expect(shown()).toHaveLength(1);
    });

    it('is not said to whoever said it, nor about a team that was ready before this browser looked', async () =>
    {
        const party = useParty();
        const theirs = await askedBy('sara.k');

        await party.refresh();
        await party.accept(theirs);

        expect(shown()).toEqual([]);

        server.parties.leave('sara.k', theirs);
        await party.refresh();
        useToasts().dismissAll();
        clock.advance(COOLDOWN_MS);

        const { id } = await asked();

        await server.parties.accept('sara.k', id);
        party.reset();
        await settle();
        await party.refresh();

        expect(party.party()?.stage).toBe('ready');
        expect(shown()).toEqual([]);
    });

    it('is taken back when the team ends, so the ending is not said beside a way to a team that is gone', async () =>
    {
        const { party, id } = await asked();

        await server.parties.accept('sara.k', id);
        await party.refresh();
        server.parties.leave('sara.k', id);
        await party.refresh();

        expect(shown()).toEqual([{ kind: 'warning', text: 'Sara Kamali left the team', avatar: null, action: null }]);
    });

    it('is taken back when the reader leaves the team themselves', async () =>
    {
        const { party, id } = await asked();

        await server.parties.accept('sara.k', id);
        await party.refresh();

        expect(shown()).toHaveLength(1);
        expect(await party.leave(id)).toBe(true);
        expect(shown()).toEqual([]);
    });

    it('is said in Persian to a Persian reader', async () =>
    {
        useLocale().setLocale('fa');

        const { party, id } = await asked();

        await server.parties.accept('sara.k', id);
        await party.refresh();

        expect(shown()).toEqual([{ kind: 'success', text: useLocale().t('party.ready.leader', { name: 'Sara Kamali' }), avatar: 'sara.k', action: useLocale().t('cue.view') }]);
        expect(shown()[0].text).not.toContain('Ready when you are');
    });
});

describe('why a team ended', () =>
{
    const formed = async () =>
    {
        const party = useParty();

        await party.invite('sara.k', 'hokm');

        return { party, id: party.party()!.id };
    };

    it('says the other one cannot play when they said not now, once', async () =>
    {
        const { party, id } = await formed();

        server.parties.decline('sara.k', id);
        await party.refresh();

        expect(heardAndForgotten()).toEqual([['warning', 'Sara Kamali can’t play right now', 'party']]);
        expect(party.party()).toBeNull();

        await party.refresh();
        await party.refresh();

        expect(told(), 'a reason was said again on a later read').toEqual([]);
    });

    it('says an invitation nobody answered ran out', async () =>
    {
        useParty().start();
        await formed();
        clock.advance(INVITE_MS + EXPIRY_SLACK_MS);
        await settle();

        expect(told()).toEqual([['warning', 'The team-up ran out of time', 'party']]);
    });

    it('says who left a team that had formed', async () =>
    {
        const { party, id } = await formed();

        await server.parties.accept('sara.k', id);
        await party.refresh();
        server.parties.leave('sara.k', id);
        await party.refresh();

        expect(told()).toEqual([['warning', 'Sara Kamali left the team', 'party']]);
    });

    it('says only that it ended when the two can no longer reach each other, and names nobody', async () =>
    {
        const { party, id } = await formed();

        await server.parties.accept('sara.k', id);
        server.refusals['sara.k'] = 'blocked';
        await server.parties.revalidate('alex');
        await party.refresh();

        expect(told()).toEqual([['warning', 'This team-up ended', 'party']]);
    });

    it('says nothing about what the reader did themselves', async () =>
    {
        const { party, id } = await formed();

        expect(await party.leave(id)).toBe(true);
        expect(party.party()).toBeNull();

        const theirs = await askedBy('reza.t');

        await party.refresh();

        expect(await party.decline(theirs)).toBe(true);
        expect(party.invites()).toEqual([]);
        expect(told()).toEqual([]);
    });

    it('says a team ended, once, when the server no longer knows of it and has no reason to give', async () =>
    {
        const { party, id } = await formed();

        await server.parties.accept('sara.k', id);
        await party.refresh();
        server.restartParties();
        await party.refresh();

        expect(heardAndForgotten()).toEqual([['warning', 'This team-up ended', 'party']]);

        await party.refresh();

        expect(told()).toEqual([]);
    });

    it('says each ending when two follow each other inside the half minute a reason is kept', async () =>
    {
        const { party, id } = await formed();

        await server.parties.accept('sara.k', id);
        server.parties.leave('sara.k', id);
        await party.refresh();

        expect(heardAndForgotten()).toHaveLength(1);

        await party.invite('reza.t', 'hokm');

        const second = party.party()!.id;

        await server.parties.accept('reza.t', second);
        server.parties.leave('reza.t', second);
        await party.refresh();

        expect(told()).toEqual([['warning', 'Reza Tehrani left the team', 'party']]);
    });

    it('says it in Persian to a Persian reader', async () =>
    {
        useLocale().setLocale('fa');

        const { party, id } = await formed();

        server.parties.decline('sara.k', id);
        await party.refresh();

        expect(told()).toEqual([['warning', useLocale().t('party.ended.declined', { name: 'Sara Kamali' }), 'party']]);
        expect(told()[0][1]).not.toContain('play right now');
    });
});

describe('a team that cannot be read', () =>
{
    it('keeps what it last read and says the read failed, and never reads as no team', async () =>
    {
        const party = useParty();
        const id = await askedBy('sara.k');

        await party.refresh();

        await swapped('state', () => Promise.reject(new ApiError(503, 'unavailable', 'The server is not answering.', undefined)), async () =>
        {
            await party.refresh();

            expect(party.failed()).not.toBeNull();
            expect(party.known()).toBe(true);
            expect(party.invites().map((one) => one.id)).toEqual([id]);
            expect(told(), 'a read that failed was taken for a team that ended').toEqual([]);
        });

        await party.refresh();

        expect(party.failed()).toBeNull();
    });

    it('knows nothing, and says so, when it has never been answered', async () =>
    {
        const party = useParty();

        await askedBy('sara.k');
        await party.refresh();

        await swapped('state', () => Promise.reject(new ApiError(503, 'unavailable', 'The server is not answering.', undefined)), async () =>
        {
            server.me = 'reza.t';
            useSession().establish({ id: 'reza.t', handle: 'reza.t', displayName: 'Reza Tehrani', bio: '', hue: 18, kind: 'guest', isMinor: false });
            await settle();
            await party.refresh();

            expect(party.known()).toBe(false);
            expect(party.invites(), 'somebody else’s invitation was shown to whoever signed in next').toEqual([]);
            expect(party.failed()).not.toBeNull();
            expect(party.party()).toBeNull();
        });
    });
});

describe('what the reader does about a team', () =>
{
    it('says yes, and is in the team', async () =>
    {
        const party = useParty();
        const id = await askedBy('sara.k');

        await party.refresh();

        expect(await party.accept(id)).toBe(true);
        expect(party.party()).toMatchObject({ id, stage: 'ready', leader: 'sara.k', member: 'alex' });
        expect(party.invites()).toEqual([]);
        expect(told()).toEqual([]);
    });

    it('is one request however many times it is pressed, and says it is working', async () =>
    {
        const party = useParty();
        const id = await askedBy('sara.k');

        await party.refresh();
        server.calls = [];

        const first = party.accept(id);
        const second = party.accept(id);

        expect(second).toBe(first);
        expect(party.working(id)).toBe(true);
        expect(party.working('another')).toBe(false);

        await first;

        expect(party.working(id)).toBe(false);
        expect(server.calls.filter((call) => call === 'parties.accept')).toHaveLength(1);
    });

    it('says each refusal in its own sentence, as a warning, and never as though it had gone through', async () =>
    {
        const party = useParty();
        const said = async (run: () => Promise<boolean>) =>
        {
            const went = await run();

            return [went, ...heardAndForgotten()];
        };

        expect(await said(() => party.invite('nobody-by-this-name', 'hokm'))).toEqual([false, ['warning', 'No one by that name can be invited.', 'attempt']]);
        expect(await said(() => party.invite('sara.k', 'backgammon'))).toEqual([false, ['warning', 'That game is not played in teams.', 'attempt']]);
        expect(await said(() => party.accept(NOWHERE))).toEqual([false, ['warning', 'That team-up is no longer there.', 'attempt']]);
        expect(await said(() => party.decline('not-an-id'))).toEqual([false, ['warning', 'That team-up is no longer there.', 'attempt']]);
        expect(await said(() => party.leave(NOWHERE))).toEqual([false, ['warning', 'That team-up is no longer there.', 'attempt']]);

        expect(await party.invite('sara.k', 'hokm')).toBe(true);
        expect(await said(() => party.invite('reza.t', 'hokm'))).toEqual([false, ['warning', 'You are already in a team. Leave it first.', 'attempt']]);

        server.parties.decline('sara.k', party.party()!.id);
        await party.refresh();
        heardAndForgotten();

        expect(await said(() => party.invite('sara.k', 'hokm'))).toEqual([false, ['warning', 'Try again in a moment.', 'attempt']]);

        clock.advance(COOLDOWN_MS);

        expect(await party.invite('sara.k', 'hokm')).toBe(true);
    });

    it('says only that it did not go through when the server never answered, or answered something it has no word for', async () =>
    {
        const party = useParty();

        for (const failure of [new ApiError(500, 'internal', 'Something went wrong.', undefined), new ApiError(409, 'a-word-from-a-newer-server', 'x', undefined), new Error('the network is away')])
        {
            await swapped('invite', () => Promise.reject(failure), async () =>
            {
                expect(await party.invite('sara.k', 'hokm')).toBe(false);
                expect(heardAndForgotten()).toEqual([['warning', 'That did not go through. Try again.', 'attempt']]);
            });
        }
    });

    it('reads the team again after a refusal, because what it was shown was no longer true', async () =>
    {
        const party = useParty();
        const id = await askedBy('sara.k');

        await party.refresh();
        server.parties.leave('sara.k', id);
        server.calls = [];

        expect(await party.accept(id)).toBe(false);
        expect(reads()).toBe(1);
        expect(party.invites()).toEqual([]);
    });
});

describe('the socket of somebody in a team', () =>
{
    it('is kept through a hidden tab while a team or an invitation stands, and let go once there is neither', async () =>
    {
        let visibility: DocumentVisibilityState = 'visible';

        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });

        try
        {
            const party = useParty();
            const stop = party.start();

            useRealtime().start();
            socket.accept();

            const id = await askedBy('sara.k');

            await party.refresh();
            await party.accept(id);

            visibility = 'hidden';
            document.dispatchEvent(new Event('visibilitychange'));
            clock.advance(IDLE_MS * 2);

            expect(socket.closed, 'a hidden tab let go of the socket of somebody in a team').toEqual([]);

            server.parties.leave('sara.k', id);
            await party.refresh();
            clock.advance(IDLE_MS + 1000);

            expect(socket.closed).toHaveLength(1);
            stop();
        }
        finally
        {
            delete (document as { visibilityState?: unknown }).visibilityState;
        }
    });

    it('is let go when the store is stopped with a team still standing', async () =>
    {
        let visibility: DocumentVisibilityState = 'visible';

        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });

        try
        {
            const party = useParty();
            const stop = party.start();

            useRealtime().start();
            socket.accept();
            await party.invite('sara.k', 'hokm');
            stop();

            visibility = 'hidden';
            document.dispatchEvent(new Event('visibilitychange'));
            clock.advance(IDLE_MS + 1000);

            expect(socket.closed).toHaveLength(1);
        }
        finally
        {
            delete (document as { visibilityState?: unknown }).visibilityState;
        }
    });
});

describe('the words for a refused team-up', () =>
{
    const refused = (code: string, status = 409) => new ApiError(status, code, 'x', undefined);

    it('are named after the word, for every word the server has', () =>
    {
        for (const [word, status] of Object.entries(PARTY_REFUSALS))
        {
            expect(whyParty(refused(word, status)), word).toBe(`party.refused.${ word }`);
        }
    });

    it('are the table’s own sentence for somebody who cannot be asked', () =>
    {
        expect(whyParty(refused('no-invitee', 404))).toBe('tables.refused.no-invitee');
    });

    it('are that it did not go through for anything else, a name an object merely inherits included', () =>
    {
        for (const code of ['conflict', 'not-found', 'internal', 'validation-failed', 'playing', 'seated-max', 'not-your-turn', '', 'constructor', 'toString', '__proto__'])
        {
            expect(whyParty(refused(code)), code).toBe('common.actionFailed');
        }

        expect(whyParty(new Error('party-missing'))).toBe('common.actionFailed');
        expect(whyParty({ status: 404, code: 'party-missing' })).toBe('common.actionFailed');
        expect(whyParty(undefined)).toBe('common.actionFailed');
    });
});
