import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, renderTest } from '@azerothjs/testing';

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
import { server } from './fake-api.ts';
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
    await settle();
});

afterEach(() =>
{
    cleanup();
    useLobby().reset();
    useSocial().reset();
    useRealtime().reset();
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
