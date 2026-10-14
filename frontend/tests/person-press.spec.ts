import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, fire, renderTest } from '@azerothjs/testing';
import { RouterProvider, Routes, createMemoryHistory, createRouter, type MountNode, type Route } from 'azerothjs';

import SocialPanel from '../src/components/app/social-panel.component.azeroth';
import MessageBubble from '../src/components/chat/message-bubble.component.azeroth';
import DiscoverPage from '../src/pages/app/discover.page.azeroth';
import HomePage from '../src/pages/app/home.page.azeroth';
import { manualClock, type ManualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import '../src/locales/app-catalogue.ts';
import { useCatalogue } from '../src/stores/catalogue.store.ts';
import { useDevice } from '../src/stores/device.store.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { useOverlay } from '../src/stores/overlay.store.ts';
import { usePeople } from '../src/stores/people.store.ts';
import { usePresence } from '../src/stores/presence.store.ts';
import { useRealtime } from '../src/stores/realtime.store.ts';
import { useSession } from '../src/stores/session.store.ts';
import { useSocial } from '../src/stores/social.store.ts';
import { server } from './fake-api.ts';
import { socket } from './fake-realtime.ts';
import { PEOPLE_FIXTURES } from './fixtures.ts';

type Rendered = HTMLElement;

let clock: ManualClock;

const settle = async () =>
{
    for (let step = 0; step < 12; step += 1)
    {
        await Promise.resolve();
    }

    await new Promise((resolve) => setTimeout(resolve, 30));
};

const PAGES: Route[] = [
    { path: '/app', component: (): HTMLElement => HomePage() as HTMLElement },
    { path: '/app/discover', component: (): HTMLElement => DiscoverPage() as HTMLElement },
    { path: '/app/chats/:id', component: (): HTMLElement => document.createElement('div') }
];

const opened = async (at: string, children: () => MountNode = () => Routes({}) as MountNode) =>
{
    const router = createRouter({ routes: PAGES, history: createMemoryHistory(at), scroll: false });
    const { container } = renderTest(() => RouterProvider({ router, children }) as Rendered);

    await settle();

    return container;
};

const online = (who: string) => socket.deliver({ v: 1, t: 'presence', n: 2, full: true, people: [{ who, state: 'online', since: clock.now() }] });

const pressed = async (row: HTMLElement) =>
{
    expect(row.getAttribute('aria-haspopup'), 'a person who opens a sheet does not say so').toBe('dialog');
    expect([row.tagName, row.getAttribute('type'), row.getAttribute('role')], 'a person is not a button').toEqual(['BUTTON', 'button', null]);

    fire(row, 'click');

    await vi.waitFor(() => expect(useOverlay().items()).toHaveLength(1), { timeout: 4000 });

    const about = (useOverlay().items()[0].props as { personId?: string }).personId;

    useOverlay().reset();
    return about;
};

beforeEach(() =>
{
    cleanup();
    resetRuntime();
    clock = manualClock(1_500_000);
    setRuntime({ clock, seed: 23 });
    server.reset();
    useLocale().setLocale('en');
    useSession().reset();
    useSession().establish({ id: 'alex', handle: 'alex', displayName: 'Alex Morgan', bio: '', hue: 210, isMinor: false });
    useRealtime().reset();
    socket.reset();
    useRealtime().start();
    socket.accept();
    usePresence().reset();
    useCatalogue().reset();
    usePeople().reset();
    useSocial().reset();
    useOverlay().reset();
    useDevice().override('phone');
});

afterEach(() =>
{
    useOverlay().reset();
    useDevice().override(null);
    useRealtime().reset();
    cleanup();
});

describe('somebody drawn in a list, pressed', () =>
{
    it('opens what can be done with a friend who is online, from Home', async () =>
    {
        const container = await opened('/app');
        const row = () => container.querySelector<HTMLButtonElement>('section[aria-labelledby="home-friends"] li button');

        await useSocial().refresh();
        online('sara.k');

        await vi.waitFor(() => expect(row()?.textContent).toContain('Sara Kamali'), { timeout: 4000 });

        expect(container.querySelector('section[aria-labelledby="home-friends"] li a'), 'a friend online is still a link to their page').toBeNull();
        expect(await pressed(row()!)).toBe('sara.k');
    });

    it('opens what can be done with a friend who is online, from the side panel', async () =>
    {
        const container = await opened('/app', () => SocialPanel({}) as MountNode);
        const row = () => container.querySelector<HTMLButtonElement>('section[aria-labelledby="panel-friends"] li button');

        await useSocial().refresh();
        online('reza.t');

        await vi.waitFor(() => expect(row()?.textContent).toContain('Reza Tehrani'), { timeout: 4000 });

        expect(container.querySelector('section[aria-labelledby="panel-friends"] li a'), 'a friend online is still a link to their page').toBeNull();
        expect(await pressed(row()!)).toBe('reza.t');
    });

    it('opens what can be done with somebody Discover suggests, from their card', async () =>
    {
        const container = await opened('/app/discover');
        const list = () => container.querySelector(`ul[aria-label="${ useLocale().t('discover.people') }"]`);
        const cards = () => [...(list()?.querySelectorAll<HTMLButtonElement>('li button[aria-haspopup]') ?? [])];

        await vi.waitFor(() => expect(cards().length).toBeGreaterThan(0), { timeout: 4000 });

        const card = cards()[0];
        const shown = PEOPLE_FIXTURES.find((one) => card.textContent?.includes(one.displayName));

        expect(list()!.querySelector('a[href^="/app/people/"]'), 'a suggested person is still a link to their page').toBeNull();
        expect(shown, 'the card names nobody the fixtures know').toBeDefined();
        expect(await pressed(card)).toBe(shown!.handle);
    });

    it('opens what can be done with the person who wrote a message in a crowd, from their picture', async () =>
    {
        const container = await opened('/app/chats/c-1', () => MessageBubble({
            message: { id: 'm-1', conversationId: 'c-1', from: 'mina', kind: 'text', text: 'Who is in?', at: 1_400_000, ref: null },
            me: 'alex',
            avatar: true,
            onActions: () => undefined,
            onReply: () => undefined
        }) as MountNode);
        const picture = () => container.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]');

        await vi.waitFor(() => expect(picture()?.getAttribute('aria-label')).toBe(useLocale().t('actions.about', { name: 'Mina Sadeghi' })), { timeout: 4000 });

        expect(container.querySelector('a[href^="/app/people/"]'), 'the picture is still a link to their page').toBeNull();
        expect(await pressed(picture()!)).toBe('mina');
    });
});
