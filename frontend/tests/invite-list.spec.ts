import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fire, renderTest } from '@azerothjs/testing';

import CreateGameForm from '../src/components/games/create-game-form.component.azeroth';
import InviteSheet from '../src/components/games/invite-sheet.component.azeroth';
import { GAMES } from '../src/data/games.ts';
import { defaultTable } from '../src/data/tables.ts';
import { manualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import '../src/locales/app-catalogue.ts';
import { useLobby } from '../src/stores/lobby.store.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { usePeople } from '../src/stores/people.store.ts';
import { useRealtime } from '../src/stores/realtime.store.ts';
import { useSession } from '../src/stores/session.store.ts';
import { useSocial } from '../src/stores/social.store.ts';
import { useToasts } from '../src/stores/toasts.store.ts';
import { ApiError, client, server } from './fake-api.ts';
import { socket } from './fake-realtime.ts';

const ludo = GAMES.find((game) => game.id === 'ludo')!;

const settle = async () =>
{
    for (let turn = 0; turn < 12; turn += 1)
    {
        await Promise.resolve();
    }
};

const fieldOf = (container: HTMLElement) => container.querySelector('input[type="search"]') as HTMLInputElement;

const type = async (container: HTMLElement, text: string) =>
{
    const field = fieldOf(container);

    field.value = text;
    field.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
};

const befriended = async (friends: string[] | null) =>
{
    if (friends !== null)
    {
        server.friends = friends;
    }

    await useSocial().refresh();
    await settle();
};

const sheet = async (invitees: string[] = []) =>
{
    const lobby = useLobby();
    const id = await lobby.host('ludo', defaultTable('ludo'), invitees);

    lobby.open(id);
    await settle();

    const { container } = renderTest(() => InviteSheet({ overlayId: 'invite', close: () => undefined, tableId: id }) as HTMLElement);

    await settle();

    return container;
};

const rowOf = (container: HTMLElement, handle: string) =>
    [...container.querySelectorAll<HTMLButtonElement>('ul button')].find((row) => row.textContent?.includes(`@${ handle }`) === true) ?? null;

const listOf = (container: HTMLElement, label: string) => container.querySelector<HTMLElement>(`ul[aria-label="${ label }"]`);

const namedIn = (container: HTMLElement, label: string) =>
    [...(listOf(container, label)?.querySelectorAll('button') ?? [])].map((row) => (row.querySelector('[dir="ltr"]')?.textContent ?? '').trim().slice(1));

const headings = (container: HTMLElement) => [...container.querySelectorAll('p')].map((heading) => (heading.textContent ?? '').trim());

const told = () => useToasts().items().map((toast) => [toast.kind, toast.text]);

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
    usePeople().reset();
    useSocial().reset();
    useLobby().reset();
    useToasts().reset();
    await settle();
});

afterEach(() =>
{
    cleanup();
    useLobby().reset();
    useSocial().reset();
    useRealtime().reset();
    useToasts().reset();
});

describe('the sheet that invites a friend to a table', () =>
{
    it('says there is nobody to invite yet to somebody with no friends, and never that no friend matches', async () =>
    {
        await befriended([]);

        const container = await sheet();

        expect(container.textContent).toContain('You have no friends to invite yet.');
        expect(container.textContent).not.toContain('No friends match.');

        await type(container, 'sa');

        expect(container.textContent).toContain('No friends match.');
        expect(container.textContent).not.toContain('You have no friends to invite yet.');

        await type(container, '');

        expect(container.textContent).toContain('You have no friends to invite yet.');
    });

    it('says no friend matches only when a search found nobody', async () =>
    {
        await befriended(null);

        const container = await sheet();
        const friend = useSocial().friends()[0];

        expect(rowOf(container, friend), 'the fixtures give the reader a friend to list').not.toBeNull();
        expect(container.textContent).not.toContain('No friends match.');

        await type(container, 'nobody is called this');

        expect(rowOf(container, friend)).toBeNull();
        expect(container.textContent).toContain('No friends match.');
    });

    it('says every friend is already at the table or invited when that is why the list is empty', async () =>
    {
        await befriended(null);

        const friend = useSocial().friends()[0];

        await befriended([friend]);

        const container = await sheet([friend]);

        expect(rowOf(container, friend)).toBeNull();
        expect(container.textContent).toContain('All your friends are already at this table or invited.');
        expect(container.textContent).not.toContain('No friends match.');
    });

    it('says each of them in Persian', async () =>
    {
        useLocale().setLocale('fa');
        await befriended([]);

        const container = await sheet();

        expect(container.textContent).toContain('هنوز دوستی نداری که دعوتش کنی.');

        await type(container, 'sa');

        expect(container.textContent).toContain('دوستی با این نام نیست.');
    });

    it('keeps a friend\'s row while the search still finds them', async () =>
    {
        await befriended(null);

        const container = await sheet();
        const friend = useSocial().friends()[0];
        const row = rowOf(container, friend);

        expect(row).not.toBeNull();

        await type(container, friend.slice(0, 2));

        expect(rowOf(container, friend), 'the row was drawn again by a keystroke that kept it').toBe(row);
    });

    it('puts no heading over the friends of a host who took nobody out', async () =>
    {
        await befriended(null);

        const container = await sheet();

        expect(rowOf(container, useSocial().friends()[0])).not.toBeNull();
        expect(headings(container)).toEqual([]);
    });
});

describe('somebody the host took out of the table, in the sheet that invites', () =>
{
    const TOOK_OUT = 'People you took out';

    const tableAfter = async (...gone: string[]) =>
    {
        const lobby = useLobby();
        const id = await lobby.host('ludo', { ...defaultTable('ludo'), privacy: 'public' }, []);
        const held = server.tables.find((one) => one.id === id)!;

        lobby.open(id);
        await settle();

        for (const handle of gone)
        {
            held.chairs[1].who = handle;
            await lobby.remove(id, handle);
        }

        await settle();

        return { id, held };
    };

    const drawn = async (id: string) =>
    {
        const close = vi.fn();
        const { container } = renderTest(() => InviteSheet({ overlayId: 'invite', close, tableId: id }) as HTMLElement);

        await settle();

        return { container, close };
    };

    const sheetAfter = async (...gone: string[]) =>
    {
        const { id, held } = await tableAfter(...gone);

        return { id, held, ...await drawn(id) };
    };

    it('is listed ahead of the host’s friends under a heading of their own, though they are no friend of the host', async () =>
    {
        await befriended(null);

        const { container } = await sheetAfter('mina');
        const friend = useSocial().friends()[0];
        const rows = [...container.querySelectorAll<HTMLButtonElement>('ul button')];

        expect(useSocial().friends()).not.toContain('mina');
        expect(rowOf(container, 'mina')).not.toBeNull();
        expect(rows[0]).toBe(rowOf(container, 'mina'));
        expect(headings(container)).toEqual([TOOK_OUT, 'Friends']);
        expect(namedIn(container, TOOK_OUT)).toEqual(['mina']);
        expect(namedIn(container, 'Friends')).toContain(friend);
        expect(namedIn(container, 'Friends')).not.toContain('mina');
        expect(namedIn(container, 'Friends').sort()).toEqual([...useSocial().friends()].sort());
    });

    it('is the latest first when there are several', async () =>
    {
        const { container } = await sheetAfter('mina', 'arash');

        expect(namedIn(container, TOOK_OUT)).toEqual(['arash', 'mina']);
    });

    it('is offered to a host with no friends at all, who is not told there is nobody to invite', async () =>
    {
        await befriended([]);

        const { container } = await sheetAfter('mina');

        expect(rowOf(container, 'mina')).not.toBeNull();
        expect(headings(container)).toEqual([TOOK_OUT]);
        expect(container.textContent).not.toContain('You have no friends to invite yet.');
    });

    it('is asked about by name when nothing has said who they are, and is drawn by the handle when nothing can', async () =>
    {
        const { id } = await tableAfter('mina', 'somebody.new');

        expect(usePeople().byHandle('mina')).toBeNull();
        server.calls = [];

        const { container } = await drawn(id);

        expect(server.calls).toContain('social.names');
        expect(rowOf(container, 'mina')!.querySelector('[dir="auto"]')!.textContent).toBe('Mina Sadeghi');
        expect(rowOf(container, 'somebody.new')!.querySelector('[dir="auto"]')!.textContent).toBe('somebody.new');
    });

    it('is invited back with the request any invitation is, which the host is told went through, and is listed no longer', async () =>
    {
        const { container, close, held, id } = await sheetAfter('mina');

        server.calls = [];
        fire(rowOf(container, 'mina')!, 'click');

        await vi.waitFor(() => expect(told()).toEqual([['success', 'Invited Mina Sadeghi.']]), { timeout: 4000 });

        expect(server.calls.filter((call) => call === 'tables.invite')).toHaveLength(1);
        expect(close).toHaveBeenCalledWith('mina');
        expect(held.chairs.map((chair) => chair.invited)).toContain('mina');
        expect(server.keptOut[id]).toEqual([]);

        await vi.waitFor(() => expect(rowOf(container, 'mina')).toBeNull(), { timeout: 4000 });

        expect(headings(container)).toEqual([]);
    });

    it('is refused in the one sentence for a name that cannot be invited when the server will not have it, and stays listed', async () =>
    {
        const { container, held } = await sheetAfter('mina');
        const tables = client.tables as unknown as Record<string, unknown>;
        const real = tables.invite;

        tables.invite = async () =>
        {
            throw new ApiError(404, 'no-invitee', 'No one by that name can be invited.', undefined);
        };

        try
        {
            fire(rowOf(container, 'mina')!, 'click');

            await vi.waitFor(() => expect(told()).toEqual([['warning', 'No one by that name can be invited.']]), { timeout: 4000 });
        }
        finally
        {
            tables.invite = real;
        }

        await useLobby().refresh();
        await settle();

        expect(held.chairs.some((chair) => chair.invited !== undefined)).toBe(false);
        expect(rowOf(container, 'mina')).not.toBeNull();
    });

    it('is listed once when they are a friend as well, with the people taken out', async () =>
    {
        await befriended(null);

        const { container } = await sheetAfter('sara.k');
        const rows = [...container.querySelectorAll<HTMLButtonElement>('ul button')].filter((row) => row.textContent?.includes('@sara.k') === true);

        expect(useSocial().friends()).toContain('sara.k');
        expect(rows).toHaveLength(1);
        expect(listOf(container, TOOK_OUT)!.contains(rows[0])).toBe(true);
    });

    it('is found by the search box as a friend is, and a search that finds nobody says so', async () =>
    {
        await befriended(null);

        const { container } = await sheetAfter('mina');
        const friend = useSocial().friends()[0];

        await type(container, 'mina');

        expect(rowOf(container, 'mina')).not.toBeNull();
        expect(rowOf(container, friend)).toBeNull();
        expect(headings(container)).toEqual([TOOK_OUT]);

        await type(container, friend);

        expect(rowOf(container, 'mina')).toBeNull();
        expect(rowOf(container, friend)).not.toBeNull();
        expect(headings(container)).toEqual([]);

        await type(container, 'nobody is called this');

        expect(container.textContent).toContain('No friends match.');
    });

    it('keeps the row it drew when the table is read again', async () =>
    {
        await befriended(null);

        const { container } = await sheetAfter('mina');
        const friend = useSocial().friends()[0];
        const [theirs, friends] = [rowOf(container, 'mina'), rowOf(container, friend)];

        server.calls = [];
        await useLobby().refresh();
        await settle();

        expect(server.calls).toContain('tables.view');
        expect(theirs).not.toBeNull();
        expect(friends).not.toBeNull();
        expect(rowOf(container, 'mina'), 'the row of somebody taken out was drawn again by a read that kept it').toBe(theirs);
        expect(rowOf(container, friend), 'a friend’s row was drawn again by a read that kept it').toBe(friends);
    });

    it('is headed in Persian', async () =>
    {
        useLocale().setLocale('fa');
        await befriended(null);

        const { container } = await sheetAfter('mina');

        expect(headings(container)).toEqual(['کسانی که از این میز بلند کردی', 'دوستان']);
        expect(listOf(container, 'کسانی که از این میز بلند کردی')!.contains(rowOf(container, 'mina'))).toBe(true);
    });
});

describe('the friends a new table can invite', () =>
{
    const form = async () =>
    {
        const { container } = renderTest(() => CreateGameForm({ game: ludo, onCreated: () => undefined }) as HTMLElement);

        await settle();

        return container;
    };

    it('says there is nobody to invite yet to somebody with no friends, and that no friend matches only to a search', async () =>
    {
        await befriended([]);

        const container = await form();

        expect(container.textContent).toContain('You have no friends to invite yet.');
        expect(container.textContent).not.toContain('No friends match.');

        await type(container, 'sa');

        expect(container.textContent).toContain('No friends match.');
        expect(container.textContent).not.toContain('You have no friends to invite yet.');
    });

    it('says neither while a friend is listed', async () =>
    {
        await befriended(null);

        const container = await form();

        expect(container.querySelectorAll('ul[aria-label="Invite friends"] button').length).toBeGreaterThan(0);
        expect(container.textContent).not.toContain('No friends match.');
        expect(container.textContent).not.toContain('You have no friends to invite yet.');
    });
});
