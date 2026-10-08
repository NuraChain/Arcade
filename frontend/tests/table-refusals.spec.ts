import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fire, renderTest } from '@azerothjs/testing';

import CreateGameForm from '../src/components/games/create-game-form.component.azeroth';
import InviteSheet from '../src/components/games/invite-sheet.component.azeroth';
import { GAMES } from '../src/data/games.ts';
import { defaultTable } from '../src/data/tables.ts';
import { attempt } from '../src/lib/attempt.ts';
import { manualClock } from '../src/lib/clock.ts';
import { openTable, whyRefused } from '../src/lib/open-table.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import '../src/locales/app-catalogue.ts';
import { en, type Dictionary, type MessageKey } from '../src/locales/en.ts';
import { fa } from '../src/locales/fa.ts';
import { messageText } from '../src/locales/format.ts';
import { useLobby } from '../src/stores/lobby.store.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { useRealtime } from '../src/stores/realtime.store.ts';
import { useSession } from '../src/stores/session.store.ts';
import { useSocial } from '../src/stores/social.store.ts';
import { useToasts } from '../src/stores/toasts.store.ts';
import { TABLE_REFUSALS } from '../../backend/src/domains/table/refusals.ts';
import { ApiError, client, server } from './fake-api.ts';
import { socket } from './fake-realtime.ts';

const WORDS = Object.keys(TABLE_REFUSALS);

const STATUS: Record<string, number> = TABLE_REFUSALS;

const CATALOGUES: readonly (readonly [string, Dictionary])[] = [['en', en], ['fa', fa]];

const PREFIX = 'tables.refused.';

const OTHERWISE: MessageKey = 'common.actionFailed';

const PLAYING: MessageKey = 'play.table.playing';

const refused = (word: string) => new ApiError(STATUS[word] ?? 409, word, 'x', undefined);

const shown = () => useToasts().items().map((toast) => [toast.kind, toast.text]);

const handleOf = (row: HTMLElement) => (row.querySelector('[dir="ltr"]')?.textContent ?? '').trim().slice(1);

const settle = async () =>
{
    for (let turn = 0; turn < 12; turn += 1)
    {
        await Promise.resolve();
    }
};

const swapped = async (verb: string, stand: () => Promise<unknown>, run: () => Promise<void>) =>
{
    const tables = client.tables as unknown as Record<string, unknown>;
    const real = tables[verb];

    tables[verb] = stand;

    try
    {
        await run();
    }
    finally
    {
        tables[verb] = real;
    }
};

beforeEach(async () =>
{
    cleanup();
    resetRuntime();
    setRuntime({ clock: manualClock(3_000_000), seed: 7 });
    server.reset();
    useRealtime().reset();
    socket.reset();
    useLocale().setLocale('en');
    useSession().reset();
    useSession().establish({
        id: 'alex',
        handle: 'alex',
        displayName: 'Alex Morgan',
        bio: '',
        hue: 210,
        kind: 'guest',
        isMinor: false
    });
    useSocial().reset();
    useLobby().reset();
    useToasts().reset();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await settle();
});

afterEach(() =>
{
    vi.restoreAllMocks();
    cleanup();
    useLobby().reset();
    useSocial().reset();
    useRealtime().reset();
});

describe('the words for a refused table', () =>
{
    it('has a sentence for every word the table can refuse with, in both languages', () =>
    {
        const unsaid = WORDS.flatMap((word) =>
        {
            const key = whyRefused(refused(word), OTHERWISE, PLAYING);

            return CATALOGUES
                .filter(([, catalogue]) => key === OTHERWISE || !Object.hasOwn(catalogue, key) || messageText(catalogue[key]).trim() === '')
                .map(([language]) => `${ language } ${ word }`);
        });

        expect(WORDS.length).toBeGreaterThan(0);
        expect(unsaid).toEqual([]);
    });

    it('names each sentence after its word, except the two that are said in the words of where they happened', () =>
    {
        expect(whyRefused(refused('seated-max'), OTHERWISE)).toBe('play.seatedMax');
        expect(whyRefused(refused('playing'), OTHERWISE, 'play.close.refused')).toBe('play.close.refused');
        expect(whyRefused(refused('playing'), OTHERWISE, 'play.leave.started')).toBe('play.leave.started');
        expect(whyRefused(refused('playing'), OTHERWISE, PLAYING)).toBe(PLAYING);
        expect(whyRefused(refused('playing'), 'play.openFailed')).toBe('play.openFailed');

        for (const word of WORDS.filter((one) => one !== 'seated-max' && one !== 'playing'))
        {
            expect(whyRefused(refused(word), OTHERWISE, PLAYING), word).toBe(`${ PREFIX }${ word }`);
        }
    });

    it('says nothing for a word the table does not have', () =>
    {
        const spoken = new Set<string>(WORDS.map((word) => whyRefused(refused(word), OTHERWISE, PLAYING)));

        const orphans = CATALOGUES.flatMap(([language, catalogue]) => Object.keys(catalogue)
            .filter((key) => key === 'tables.refused' || key.startsWith(PREFIX))
            .filter((key) => !spoken.has(key))
            .map((key) => `${ language } ${ key }`));

        expect(orphans).toEqual([]);
    });

    it('reads nothing off a code that is not a table word, or off anything that is not a refusal', () =>
    {
        for (const code of ['conflict', 'forbidden', 'not-found', 'validation-failed', 'internal', 'not-your-turn', '', 'constructor', 'toString', '__proto__'])
        {
            expect(whyRefused(new ApiError(409, code, 'x', undefined), OTHERWISE, PLAYING), code).toBe(OTHERWISE);
        }

        expect(whyRefused(new Error('not-ready'), OTHERWISE, PLAYING)).toBe(OTHERWISE);
        expect(whyRefused({ status: 409, code: 'not-ready' }, OTHERWISE, PLAYING)).toBe(OTHERWISE);
        expect(whyRefused('not-ready', OTHERWISE, PLAYING)).toBe(OTHERWISE);
        expect(whyRefused(undefined, OTHERWISE, PLAYING)).toBe(OTHERWISE);
    });
});

describe('the server a spec talks to', () =>
{
    const answered = async (work: () => Promise<unknown>) =>
        await work().then(() => null, (error: unknown) => error instanceof ApiError ? { status: error.status, code: error.code } : error);

    const word = (one: keyof typeof TABLE_REFUSALS) => ({ status: TABLE_REFUSALS[one], code: one });

    it('refuses a table the way the real one does: a listed word, at the status the list gives it', async () =>
    {
        const lobby = useLobby();
        const id = await lobby.host('backgammon', defaultTable('backgammon'), []);
        const held = server.tables.find((one) => one.id === id)!;
        const params = { id };

        expect(await answered(() => client.tables.start({ params }))).toEqual(word('chairs-empty'));

        held.chairs[1].who = 'sara.k';

        expect(await answered(() => client.tables.start({ params }))).toEqual(word('not-ready'));

        server.blocks.push('reza.t');

        expect(await answered(() => client.tables.invite({ params, input: { id: 'reza.t' } }))).toEqual(word('no-invitee'));
        expect(await answered(() => client.tables.invite({ params, input: { id: 'nobody-by-this-name' } }))).toEqual(word('no-invitee'));
        expect(await answered(() => client.tables.invite({ params, input: { id: 'alex' } }))).toEqual(word('no-invitee'));
        expect(await answered(() => lobby.host('ludo', defaultTable('ludo'), ['reza.t']))).toEqual(word('no-invitee'));

        held.matchId = 'live-1';

        expect(await answered(() => client.tables.close({ params }))).toEqual(word('playing'));
        expect(await answered(() => client.tables.leave({ params, input: { forfeit: false } }))).toEqual(word('playing'));
        expect(held.chairs[0].who).toBe('alex');

        delete held.chairs[0].who;

        expect(await answered(() => client.tables.claim({ params }))).toEqual(word('playing'));

        held.status = 'closed';

        expect(await answered(() => client.tables.claim({ params }))).toEqual(word('table-closed'));
    });

    it('takes somebody out of a chair by the real one’s rules, and keeps them out until the host invites them', async () =>
    {
        const id = await useLobby().host('ludo', { ...defaultTable('ludo'), privacy: 'public' }, []);
        const held = server.tables.find((one) => one.id === id)!;
        const params = { id };
        const signedInAs = async <Answer>(who: string, work: () => Promise<Answer>) =>
        {
            server.me = who;

            try
            {
                return await work();
            }
            finally
            {
                server.me = 'alex';
            }
        };
        const removing = (who: string, from = params) => () => client.tables.remove({ params: from, input: { id: who } });
        const missing = await answered(removing('sara.k', { id: 'no-such-table' }));

        held.chairs[1].who = 'sara.k';
        held.chairs[1].invited = 'sara.k';
        held.chairs[1].ready = true;
        held.chairs[2].who = 'reza.t';

        expect(missing).toEqual({ status: 404, code: 'not-found' });
        expect(await answered(removing('alex')), 'the host named themselves').toEqual(missing);
        expect(await answered(removing('mina')), 'a name with no chair there').toEqual(missing);
        expect(await signedInAs('reza.t', () => answered(removing('sara.k'))), 'somebody sitting who is not the host').toEqual(missing);
        expect(await signedInAs('mina', () => answered(removing('sara.k'))), 'a stranger').toEqual(missing);

        delete held.chairs[0].who;

        expect(await answered(removing('sara.k')), 'a host who has left the chair').toEqual(missing);

        held.chairs[0].who = 'alex';
        held.matchId = 'live-1';

        expect(await answered(removing('sara.k'))).toEqual(word('playing'));

        delete held.matchId;
        held.status = 'closed';

        expect(await answered(removing('sara.k'))).toEqual(word('table-closed'));
        expect(held.chairs.map((chair) => chair.who)).toEqual(['alex', 'sara.k', 'reza.t', undefined]);

        held.status = 'open';

        const after = await client.tables.remove({ params, input: { id: 'sara.k' } });

        expect(after.chairs).toEqual([
            { seat: 0, who: 'alex', ready: false, host: true },
            { seat: 1, ready: false, host: false },
            { seat: 2, who: 'reza.t', ready: false, host: false },
            { seat: 3, ready: false, host: false }
        ]);
        expect(after, 'the table answered is the row the server keeps, not a copy of it').not.toBe(held);
        expect(Object.hasOwn(after, 'removed')).toBe(false);
        expect(after.keptOut).toEqual(['sara.k']);

        expect(await signedInAs('sara.k', () => answered(() => client.tables.claim({ params })))).toEqual(word('kept-out'));
        expect((await signedInAs('sara.k', () => client.tables.view({ params }))).removed).toBe(true);
        expect(Object.hasOwn(await signedInAs('reza.t', () => client.tables.view({ params })), 'removed')).toBe(false);
        expect((await signedInAs('sara.k', () => client.tables.quick({ input: { game: 'ludo', voice: 'off' } }))).id).not.toBe(id);
        expect(await signedInAs('reza.t', () => answered(() => client.tables.invite({ params, input: { id: 'sara.k' } })))).toEqual(word('no-invitee'));
        expect(held.chairs.some((chair) => chair.invited !== undefined)).toBe(false);

        for (const reader of ['sara.k', 'reza.t', 'mina'])
        {
            expect(Object.hasOwn(await signedInAs(reader, () => client.tables.view({ params })), 'keptOut'), reader).toBe(false);
        }

        held.chairs[3].who = 'mina';
        await client.tables.remove({ params, input: { id: 'mina' } });

        expect((await client.tables.view({ params })).keptOut, 'the latest first').toEqual(['mina', 'sara.k']);

        server.blocks.push('mina');

        expect((await client.tables.view({ params })).keptOut, 'nobody the host has blocked').toEqual(['sara.k']);

        delete held.chairs[0].who;

        expect(Object.hasOwn(await client.tables.view({ params }), 'keptOut'), 'a host who has left the chair').toBe(false);

        held.chairs[0].who = 'alex';

        expect(Object.hasOwn(await client.tables.invite({ params, input: { id: 'sara.k' } }), 'keptOut')).toBe(false);
        expect(Object.hasOwn(await signedInAs('sara.k', () => client.tables.view({ params })), 'removed')).toBe(false);
        expect((await signedInAs('sara.k', () => client.tables.claim({ params }))).seat).toBe(1);
    });

    it('hides a table by invitation from whoever was taken out of it, as the real one does', async () =>
    {
        const id = await useLobby().host('ludo', defaultTable('ludo'), ['sara.k']);
        const held = server.tables.find((one) => one.id === id)!;
        const params = { id };
        const seat = held.chairs.find((chair) => chair.invited === 'sara.k')!;

        seat.who = 'sara.k';
        await client.tables.remove({ params, input: { id: 'sara.k' } });
        server.me = 'sara.k';

        try
        {
            expect(await answered(() => client.tables.view({ params }))).toEqual({ status: 404, code: 'not-found' });
            expect(await answered(() => client.tables.claim({ params }))).toEqual({ status: 404, code: 'not-found' });
        }
        finally
        {
            server.me = 'alex';
        }

        await client.tables.invite({ params, input: { id: 'sara.k' } });
        server.me = 'sara.k';

        try
        {
            expect((await client.tables.view({ params })).id).toBe(id);
        }
        finally
        {
            server.me = 'alex';
        }
    });

    it('lets a seat that is already out of the game leave without agreeing to forfeit, and nobody else', async () =>
    {
        const id = await useLobby().host('ludo', defaultTable('ludo'), []);
        const held = server.tables.find((one) => one.id === id)!;
        const leaving = () => client.tables.leave({ params: { id }, input: { forfeit: false } });

        held.chairs[1].who = 'sara.k';
        held.chairs[2].who = 'reza.t';
        held.matchId = 'live-2';
        server.outOfGame['live-1'] = ['alex'];
        server.outOfGame['live-2'] = ['sara.k'];

        expect(await answered(leaving)).toEqual(word('playing'));
        expect(held.chairs[0].who).toBe('alex');

        server.outOfGame['live-2'] = ['sara.k', 'alex'];

        expect(await answered(leaving)).toBeNull();
        expect(held.chairs.map((chair) => chair.who)).toEqual([undefined, 'sara.k', 'reza.t', undefined]);
    });
});

describe('a table that would not open', () =>
{
    const answered = async (made: Promise<string>) =>
    {
        useToasts().reset();

        const go = vi.fn();
        const settled = vi.fn();

        openTable(made, go, settled);

        await vi.waitFor(() => expect(settled).toHaveBeenCalledTimes(1));

        expect(go).not.toHaveBeenCalled();

        return shown();
    };

    const told = async (error: unknown) => await answered(Promise.reject(error));

    const SAID: Record<string, MessageKey> = {
        'seated-max': 'play.seatedMax',
        'no-invitee': 'tables.refused.no-invitee',
        'quick-game': 'tables.refused.quick-game',
        'quick-options': 'tables.refused.quick-options'
    };

    it('says the reader holds too many chairs, that nobody by that name can be invited, or what was wrong with a quick search', async () =>
    {
        const locale = useLocale();

        for (const [word, key] of Object.entries(SAID))
        {
            expect(await told(refused(word)), word).toEqual([['warning', locale.t(key)]]);
        }
    });

    it('says only that it would not open for every other word, a setting, or a request that never arrived', async () =>
    {
        const failed = [['warning', useLocale().t('play.openFailed')]];
        const others = WORDS.filter((word) => !Object.hasOwn(SAID, word));

        expect(others).toEqual(expect.arrayContaining(['playing', 'table-closed']));

        for (const word of others)
        {
            expect(await told(refused(word)), word).toEqual(failed);
        }

        expect(await told(new ApiError(422, 'validation-failed', 'x', undefined))).toEqual(failed);
        expect(await told(new TypeError('Failed to fetch'))).toEqual(failed);
    });

    it.each(['en', 'fa'] as const)('says why the server would not run a quick search, in %s, and goes nowhere', async (language) =>
    {
        useLocale().setLocale(language);

        const lobby = useLobby();
        const catalogue = language === 'en' ? en : fa;

        try
        {
            for (const word of ['quick-game', 'quick-options', 'seated-max'])
            {
                await swapped('quick', async () =>
                {
                    throw refused(word);
                }, async () =>
                {
                    expect(await answered(lobby.quick('ludo')), word).toEqual([['warning', messageText(catalogue[SAID[word]])]]);
                });

                expect([...lobby.finding()], word).toEqual([]);
            }
        }
        finally
        {
            useLocale().setLocale('en');
        }

        expect(server.tables).toEqual([]);
    });

    it('opens the table quick play was seated at with one request, and no list of tables to walk', async () =>
    {
        const go = vi.fn();
        const settled = vi.fn();

        server.calls = [];
        openTable(useLobby().quick('ludo'), go, settled);

        await vi.waitFor(() => expect(settled).toHaveBeenCalledTimes(1));

        expect(go).toHaveBeenCalledWith(`/app/play/${ server.tables[0].id }`);
        expect(shown()).toEqual([]);
        expect(server.calls.filter((call) => call.startsWith('tables.') && call !== 'tables.mine')).toEqual(['tables.quick']);
        expect(Object.keys(client.tables)).not.toContain('open');
    });
});

describe('an action that says why it was refused', () =>
{
    it('says the sentence its caller reads off the refusal, and never that it worked', async () =>
    {
        const why = vi.fn((error: unknown) => whyRefused(error, OTHERWISE));

        expect(await attempt(Promise.reject(refused('no-invitee')), 'Invited.', why)).toBe(false);
        expect(shown()).toEqual([['warning', useLocale().t('tables.refused.no-invitee')]]);
        expect(why).toHaveBeenCalledTimes(1);
    });

    it('asks nobody why when it went through', async () =>
    {
        const why = vi.fn((error: unknown) => whyRefused(error, OTHERWISE));

        expect(await attempt(Promise.resolve(), 'Invited.', why)).toBe(true);
        expect(shown()).toEqual([['success', 'Invited.']]);
        expect(why).not.toHaveBeenCalled();
    });
});

describe('inviting somebody to a table', () =>
{
    const rows = (container: HTMLElement) => [...container.querySelectorAll<HTMLButtonElement>('ul button')];

    const sheetAt = async () =>
    {
        const lobby = useLobby();
        const id = await lobby.host('ludo', defaultTable('ludo'), []);

        lobby.open(id);
        await settle();
        useToasts().reset();

        const close = vi.fn();
        const { container } = renderTest(() => InviteSheet({ overlayId: 'invite', close, tableId: id }) as HTMLElement);

        await vi.waitFor(() => expect(rows(container).length).toBeGreaterThan(0), { timeout: 4000 });

        return { container, close, held: server.tables.find((one) => one.id === id)! };
    };

    it('says who was invited once the server has held a chair for them', async () =>
    {
        const { container, close, held } = await sheetAt();
        const row = rows(container)[0];
        const handle = handleOf(row);

        fire(row, 'click');

        await vi.waitFor(() => expect(shown().map(([kind]) => kind)).toEqual(['success']), { timeout: 4000 });

        expect(close).toHaveBeenCalledWith(handle);
        expect(held.chairs.map((chair) => chair.invited)).toContain(handle);
    });

    it('says nobody by that name can be invited when the server refuses, in English and in Persian', async () =>
    {
        for (const language of ['en', 'fa'] as const)
        {
            useLocale().setLocale(language);

            const { container, held } = await sheetAt();
            const row = rows(container)[0];
            const handle = handleOf(row);

            server.blocks.push(handle);
            fire(row, 'click');

            await vi.waitFor(() => expect(shown()).toEqual([['warning', messageText((language === 'en' ? en : fa)['tables.refused.no-invitee'])]]), { timeout: 4000 });

            expect(held.chairs.some((chair) => chair.invited !== undefined)).toBe(false);

            cleanup();
            server.reset();
            useSocial().reset();
            useLobby().reset();
            await settle();
        }
    });

    it('says only that it did not go through when the request never arrived', async () =>
    {
        const { container } = await sheetAt();

        await swapped('invite', async () =>
        {
            throw new TypeError('Failed to fetch');
        }, async () =>
        {
            fire(rows(container)[0], 'click');

            await vi.waitFor(() => expect(shown()).toEqual([['warning', useLocale().t('common.actionFailed')]]), { timeout: 4000 });
        });
    });
});

describe('opening a table from the create form', () =>
{
    const ludo = GAMES.find((game) => game.id === 'ludo')!;

    const friends = (container: HTMLElement) =>
        [...container.querySelectorAll<HTMLButtonElement>(`ul[aria-label="${ useLocale().t('create.invite') }"] button`)];

    const submitOf = (container: HTMLElement) => container.querySelector<HTMLButtonElement>('button[type="submit"]')!;

    const formWith = async () =>
    {
        const created = vi.fn();
        const { container } = renderTest(() => CreateGameForm({ game: ludo, onCreated: created }) as HTMLElement);

        await vi.waitFor(() => expect(friends(container).length).toBeGreaterThan(0), { timeout: 4000 });

        return { container, created };
    };

    const sent = async (container: HTMLElement) =>
    {
        fire(container.querySelector('form')!, 'submit');

        await vi.waitFor(() => expect(shown()).toHaveLength(1), { timeout: 4000 });
        await vi.waitFor(() => expect(submitOf(container).getAttribute('aria-busy')).not.toBe('true'), { timeout: 4000 });

        return shown();
    };

    it('says nobody by that name can be invited when a guest cannot be, and lets the form be sent again', async () =>
    {
        const { container, created } = await formWith();
        const guest = friends(container)[0];

        fire(guest, 'click');
        server.blocks.push(handleOf(guest));

        expect(await sent(container)).toEqual([['warning', useLocale().t('tables.refused.no-invitee')]]);
        expect(created).not.toHaveBeenCalled();
        expect(submitOf(container).disabled).toBe(false);
        expect(server.tables).toHaveLength(0);
    });

    it('says the reader holds too many chairs, a setting the game does not make, or to check the connection', async () =>
    {
        const locale = useLocale();
        const { container, created } = await formWith();

        const answers: [unknown, MessageKey][] = [
            [refused('seated-max'), 'play.seatedMax'],
            [new ApiError(422, 'validation-failed', 'x', undefined), 'create.refused'],
            [new TypeError('Failed to fetch'), 'state.errorLead']
        ];

        for (const [error, key] of answers)
        {
            useToasts().reset();

            await swapped('create', async () =>
            {
                throw error;
            }, async () =>
            {
                expect(await sent(container), key).toEqual([['warning', locale.t(key)]]);
            });
        }

        expect(created).not.toHaveBeenCalled();
    });
});
