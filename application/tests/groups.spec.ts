import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, fire, renderTest } from '@azerothjs/testing';

import GroupForm from '../src/components/social/group-form.component.azeroth';
import { CRESTS, crestOf } from '../src/data/crests.ts';
import { resetDataset } from '../src/data/mock/index.ts';
import { manualClock } from '../src/lib/clock.ts';
import { isLineKey, LINE_KEYS } from '../src/lib/lines.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import { useGroups } from '../src/stores/groups.store.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { NUDGE_WINDOW_MS, useRealtime } from '../src/stores/realtime.store.ts';
import { useSession } from '../src/stores/session.store.ts';
import { useSocial } from '../src/stores/social.store.ts';
import { server } from './fake-api.ts';
import { socket } from './fake-realtime.ts';
import '../src/locales/app-catalogue.ts';

let clock: ReturnType<typeof manualClock>;

const settle = async (): Promise<void> =>
{
    for (let turn = 0; turn < 12; turn += 1)
    {
        await Promise.resolve();
    }
};

beforeEach(async () =>
{
    cleanup();
    resetRuntime();
    clock = manualClock(1_200_000);
    setRuntime({ clock, seed: 7 });
    resetDataset();
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
    useGroups().reset();
    await settle();
});

afterEach(() =>
{
    cleanup();
    useGroups().reset();
    useRealtime().reset();
});

describe('the crest set', () =>
{
    it('is closed, and a crest it has never heard of still draws something', () =>
    {
        expect(CRESTS.length).toBeGreaterThan(0);
        for (const crest of CRESTS)
        {
            expect(crestOf(crest)).toBe(crest);
        }

        // A row written by a newer server must not leave a blank square where a group's face is.
        expect(crestOf('crest-from-the-future')).toBe(CRESTS[0]);
        expect(crestOf('')).toBe(CRESTS[0]);
    });
});

describe('the group lines', () =>
{
    it('declares exactly the six the group domain writes', () =>
    {
        for (const key of ['created', 'joined', 'left', 'removed', 'renamed', 'owner'])
        {
            expect(isLineKey(`chat.line.group.${ key }`)).toBe(true);
        }
        expect(isLineKey('chat.line.group.exploded')).toBe(false);
        expect(LINE_KEYS.filter((key) => key.startsWith('chat.line.group.')).length).toBe(6);
    });
});

describe('the groups store', () =>
{
    it('lists the groups this account is in, and nothing else', async () =>
    {
        const groups = useGroups();
        await groups.refresh();

        const mine = groups.mine().map((group) => group.id);
        expect(mine).toContain('friday-night-crew');
        expect(mine).not.toContain('lunch-ludo');
        expect(server.calls).toContain('groups.mine');
    });

    it('does not fetch the discover list until a page asks for it', async () =>
    {
        const groups = useGroups();
        await groups.refresh();
        expect(server.calls).not.toContain('groups.discover');

        groups.want();
        await groups.refresh();

        expect(server.calls).toContain('groups.discover');
        expect(groups.elsewhere().map((group) => group.id)).toContain('lunch-ludo');
    });

    it('makes a group, and the maker owns it', async () =>
    {
        const groups = useGroups();
        await groups.refresh();

        const made = await groups.create({ name: 'Sunday Hokm', blurb: 'Every week.', crest: 'crest-crown', hue: 40, game: 'hokm' });

        expect(made.slug).toBe('sunday-hokm');
        expect(made.role).toBe('owner');
        expect(made.owner).toBe('alex');
        expect(groups.mine().map((group) => group.id)).toContain('sunday-hokm');
    });

    it('keeps the slug when the name changes, because a url is a promise', async () =>
    {
        const groups = useGroups();
        await groups.refresh();

        const made = await groups.create({ name: 'Sunday Hokm', blurb: '', crest: 'crest-crown', hue: 40, game: '' });
        const saved = await groups.edit(made.id, { name: 'Monday Hokm', blurb: 'Moved.', crest: 'crest-moon', game: 'hokm' });

        expect(saved.slug).toBe(made.slug);
        expect(saved.name).toBe('Monday Hokm');
        expect(saved.game).toBe('hokm');
    });

    it('joins and leaves, and gives up the thread on the way out', async () =>
    {
        const groups = useGroups();
        groups.want();
        await groups.refresh();

        await groups.join('lunch-ludo');
        expect(groups.mine().map((group) => group.id)).toContain('lunch-ludo');
        expect(groups.byId('lunch-ludo')?.conversationId).toBeDefined();

        await groups.leave('lunch-ludo');
        expect(groups.mine().map((group) => group.id)).not.toContain('lunch-ludo');
        expect(groups.byId('lunch-ludo')?.conversationId).toBeUndefined();
    });

    it('adds, removes and hands over, naming everybody by handle', async () =>
    {
        const groups = useGroups();
        await groups.refresh();

        const made = await groups.create({ name: 'Small Room', blurb: '', crest: 'crest-cup', hue: 90, game: '' });

        await groups.add(made.id, 'sara.k');
        expect(groups.byId(made.id)?.members).toContain('sara.k');

        await groups.transfer(made.id, 'sara.k');
        expect(groups.byId(made.id)?.owner).toBe('sara.k');
        expect(groups.byId(made.id)?.role).toBe('member');

        await groups.remove(made.id, 'sara.k');
        expect(groups.byId(made.id)?.members).not.toContain('sara.k');
    });

    it('asks for a group by slug, and never by whatever id is on the next route', async () =>
    {
        const groups = useGroups();
        groups.open('friday-night-crew');
        await settle();
        server.calls = [];

        // The page used to track the route parameter, so leaving it re-ran the open with the NEXT
        // route's id - a conversation uuid - and put a 404 in the console on every navigation.
        groups.close();
        await settle();

        expect(server.calls).not.toContain('groups.view');
        expect(groups.viewing()).toBeNull();
    });

    it('calls a slug nobody claimed an answer, not a failure', async () =>
    {
        const groups = useGroups();
        groups.open('no-such-group');
        await settle();

        expect(groups.viewing()).toBeNull();
        expect(groups.viewFailed() ?? null).toBeNull();
    });

    it('forgets the open group when it is closed', async () =>
    {
        const groups = useGroups();
        groups.open('friday-night-crew');
        await settle();

        expect(groups.viewing()?.id).toBe('friday-night-crew');

        groups.close();
        await settle();
        expect(groups.openId()).toBe('');
    });

    it('re-reads itself when the social doorbell rings', async () =>
    {
        const groups = useGroups();
        const stop = groups.start();

        useRealtime().start();
        socket.accept();
        await groups.refresh();
        server.calls = [];

        socket.deliver({ v: 1, t: 'nudge', n: 1, scope: 'social', at: 0 });
        clock.advance(NUDGE_WINDOW_MS);
        await settle();

        expect(server.calls).toContain('groups.mine');
        stop();
    });

    it('ignores a doorbell meant for the chat list', async () =>
    {
        const groups = useGroups();
        const stop = groups.start();

        useRealtime().start();
        socket.accept();
        await groups.refresh();
        server.calls = [];

        socket.deliver({ v: 1, t: 'nudge', n: 1, scope: 'chat', id: 'c-1', at: 0 });
        clock.advance(NUDGE_WINDOW_MS);
        await settle();

        expect(server.calls).not.toContain('groups.mine');
        stop();
    });
});

describe('the group form', () =>
{
    const open = (): { close: ReturnType<typeof vi.fn>; container: HTMLElement } =>
    {
        const close = vi.fn();
        const { container } = renderTest(() =>
            GroupForm({ overlayId: 'test', close }) as HTMLElement);
        return { close, container };
    };

    it('refuses a name that is not a name, and says which field', async () =>
    {
        const { close, container } = open();

        const form = container.querySelector('form')!;
        fire(form, 'submit');
        await settle();

        expect(close).not.toHaveBeenCalled();
        expect(server.calls).not.toContain('groups.create');
        expect(container.textContent).toContain('Give the group a name');
    });

    it('sends exactly what was typed, and hands the group back', async () =>
    {
        const { close, container } = open();

        const input = container.querySelector<HTMLInputElement>('#group-name')!;
        input.value = 'Tuesday Table';
        fire(input, 'input');

        fire(container.querySelector('form')!, 'submit');
        await settle();

        expect(server.calls).toContain('groups.create');
        const made = server.groups.find((group) => group.name === 'Tuesday Table');
        expect(made).toBeDefined();
        expect(made!.slug).toBe('tuesday-table');
        expect(close).toHaveBeenCalled();
    });

    it('offers every crest and no others', () =>
    {
        const { container } = open();
        const buttons = [...container.querySelectorAll('button[aria-pressed]')]
            .filter((button) => button.getAttribute('aria-label')?.startsWith('Crest') === true);

        expect(buttons.length).toBe(CRESTS.length);
    });
});
