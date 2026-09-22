import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, fire, renderTest } from '@azerothjs/testing';
import { RouterProvider, Routes, createMemoryHistory, createRouter, createSignal, type Route } from 'azerothjs';

import BottomNav from '../src/components/app/bottom-nav.component.azeroth';
import { RAIL } from '../src/components/app/nav-items.ts';
import Sidebar from '../src/components/app/sidebar.component.azeroth';
import SocialPanel from '../src/components/app/social-panel.component.azeroth';
import OverlayHost from '../src/components/app/overlay-host.component.azeroth';
import Page from '../src/components/app/page.component.azeroth';
import ToastHost from '../src/components/app/toast-host.component.azeroth';
import Button from '../src/components/ui/button.component.azeroth';
import Tabs from '../src/components/ui/tabs.component.azeroth';
import { manualClock, type ManualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import { routes } from '../src/routes.ts';
import '../src/locales/app-catalogue.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { useNotifications } from '../src/stores/notifications.store.ts';
import { OVERLAY_SETTLE, useOverlay } from '../src/stores/overlay.store.ts';
import { useAccount } from '../src/stores/account.store.ts';
import { useSession } from '../src/stores/session.store.ts';
import { TOAST_DURATION, useToasts } from '../src/stores/toasts.store.ts';
import { server } from './fake-api.ts';

vi.mock('../src/api.ts', async () => await import('./fake-api.ts'));

type Rendered = HTMLElement;

let clock: ManualClock;

const memory = new Map<string, string>();
const original = Object.getOwnPropertyDescriptor(window, 'localStorage');

const settle = async (): Promise<void> =>
{
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 25));
};

beforeEach(() =>
{
    cleanup();
    resetRuntime();
    clock = manualClock(5000);
    setRuntime({ clock, seed: 2 });
    memory.clear();
    Object.defineProperty(window, 'localStorage', {
        configurable: true,
        value: {
            getItem: (key: string): string | null => memory.get(key) ?? null,
            setItem: (key: string, value: string): void =>
            {
                memory.set(key, value);
            },
            removeItem: (key: string): void =>
            {
                memory.delete(key);
            }
        }
    });
    useLocale().setLocale('en');
    server.reset();
    useSession().reset();
    useOverlay().reset();
    useToasts().reset();
});

afterEach(() =>
{
    cleanup();
    if (original !== undefined)
    {
        Object.defineProperty(window, 'localStorage', original);
    }
});

describe('Button', () =>
{
    it('announces loading, refuses clicks, and keeps its width with a hidden label', () =>
    {
        const onClick = vi.fn();
        const { container } = renderTest(() => Button({ children: 'Join', onClick, loading: true }) as Rendered);
        const button = container.querySelector('button')!;
        expect(button.getAttribute('aria-busy')).toBe('true');
        expect(button.disabled).toBe(true);
        expect(button.querySelector('.invisible')?.textContent).toContain('Join');
        fire(button, 'click');
        expect(onClick).not.toHaveBeenCalled();
    });

    it('submits a form only when asked to', () =>
    {
        const plain = renderTest(() => Button({ children: 'Go' }) as Rendered);
        expect(plain.container.querySelector('button')!.getAttribute('type')).toBe('button');
        plain.unmount();
        const submit = renderTest(() => Button({ children: 'Go', submit: true }) as Rendered);
        expect(submit.container.querySelector('button')!.getAttribute('type')).toBe('submit');
    });
});

describe('Tabs', () =>
{
    it('exposes a tablist with exactly one selected tab that moves on click', () =>
    {
        const onChange = vi.fn();
        const items = [{ id: 'all', label: 'All' }, { id: 'online', label: 'Online', count: 3 }];
        const { container } = renderTest(() => Tabs({ items, value: 'all', label: 'Friends', onChange }) as Rendered);
        const tabs = container.querySelectorAll('[role="tab"]');
        expect(tabs.length).toBe(2);
        expect(container.querySelectorAll('[aria-selected="true"]').length).toBe(1);
        fire(tabs[1] as HTMLElement, 'click');
        expect(onChange).toHaveBeenCalledWith('online');
        expect(tabs[1].querySelector('.tally')?.textContent).toBe('3');
    });

    it('moves its highlight with the selection, not only its aria', async () =>
    {
        const [current, setCurrent] = createSignal('all');
        const items = [{ id: 'all', label: 'All' }, { id: 'online', label: 'Online' }];
        const { container } = renderTest(() => Tabs({
            items,
            get value()
            {
                return current();
            },
            label: 'Friends',
            onChange: setCurrent
        }) as Rendered);
        const tabs = container.querySelectorAll<HTMLElement>('[role="tab"]');

        fire(tabs[1], 'click');
        await settle();

        expect(tabs[1].getAttribute('aria-selected')).toBe('true');
        expect(tabs[1].className, 'the painted state has to follow the selection, not only the aria').toContain('text-text');
        expect(tabs[1].querySelector('span[aria-hidden]')!.className).toContain('bg-accent');
        expect(tabs[0].querySelector('span[aria-hidden]')!.className).not.toContain('bg-accent');
    });
});

describe('OverlayHost', () =>
{
    const Probe = (): HTMLElement =>
    {
        const panel = document.createElement('div');
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = 'ok';
        panel.appendChild(button);
        return panel;
    };

    it('renders a dialog into the body, moves focus in, and lets Escape close it', async () =>
    {
        const overlay = useOverlay();
        const { unmount } = renderTest(() => OverlayHost({}) as Rendered);
        const handle = overlay.open(Probe, {}, { label: 'Probe' });
        await settle();

        const layer = document.body.querySelector<HTMLElement>(`[data-overlay-layer='${ handle.id }']`);
        expect(layer).not.toBeNull();
        const dialog = layer!.querySelector('[role="dialog"]')!;
        expect(dialog.getAttribute('aria-modal')).toBe('true');
        expect(dialog.getAttribute('aria-label')).toBe('Probe');
        expect(overlay.top()?.phase).toBe('open');
        expect(document.activeElement?.textContent).toBe('ok');

        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        expect(overlay.items()[0]?.phase).toBe('closing');
        clock.advance(OVERLAY_SETTLE);
        await settle();
        expect(document.body.querySelector('[data-overlay-layer]')).toBeNull();
        expect(overlay.blocking()).toBe(false);
        unmount();
    });

    it('keeps a non-dismissible layer open through Escape and the scrim', async () =>
    {
        const overlay = useOverlay();
        renderTest(() => OverlayHost({}) as Rendered);
        overlay.open(Probe, {}, { label: 'Stay', dismissible: false });
        await settle();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        fire(document.body.querySelector('.overlay-scrim') as HTMLElement, 'click');
        expect(overlay.top()?.phase).toBe('open');
    });
});

describe('ToastHost', () =>
{
    it('announces a toast politely and lets it expire on the runtime clock', async () =>
    {
        renderTest(() => ToastHost({}) as Rendered);
        useToasts().show({ text: 'Invite sent' });
        await settle();
        const region = document.body.querySelector('[role="region"]')!;
        expect(region.getAttribute('aria-live')).toBe('polite');
        expect(document.body.querySelectorAll('[role="status"]').length).toBe(1);
        clock.advance(TOAST_DURATION);
        await settle();
        expect(document.body.querySelectorAll('[role="status"]').length).toBe(0);
    });

    /**
     * The host keeps one drag recogniser per toast in a Map, and that Map was only ever written to -
     * toast ids come from a counter that only goes up, so it grew for as long as the tab was open.
     * It now reconciles against the toasts on screen.
     *
     * What this test proves is NOT that the Map shrinks: the Map is a closure variable with no
     * observable behaviour, and a test that claimed otherwise would be asserting nothing. What it
     * proves is the risk the fix introduces - that reconciling while toasts come and go does not
     * throw, and does not evict a recogniser belonging to a toast that is still on screen.
     */
    /**
     * The host used to arm a 120ms interval in `mount` unconditionally. It was cleared on teardown,
     * so it was never a leak - but the host is mounted by the shell and never unmounts, so in
     * practice it woke the reactive graph roughly eight times a second, forever, to animate nothing.
     *
     * `clock.pending()` counts live timers, which makes "is anything still scheduled" a thing a test
     * can actually assert rather than a thing to reason about.
     */
    it('schedules nothing at all while there is no toast counting down', async () =>
    {
        renderTest(() => ToastHost({}) as Rendered);
        await settle();

        expect(clock.pending(), 'the host armed a timer with nothing to animate').toBe(0);

        useToasts().show({ text: 'Counting' });
        await settle();

        expect(clock.pending(), 'a live toast should be driving the clock').toBeGreaterThan(0);

        clock.advance(TOAST_DURATION);
        await settle();

        expect(clock.pending(), 'the clock kept running after the last toast went').toBe(0);
    });

    it('survives toasts coming and going, and keeps the one still on screen', async () =>
    {
        renderTest(() => ToastHost({}) as Rendered);
        const toasts = useToasts();

        toasts.show({ text: 'One' });
        toasts.show({ text: 'Two' });
        toasts.show({ text: 'Three' });
        await settle();
        expect(document.body.querySelectorAll('[role="status"]').length).toBe(3);

        clock.advance(TOAST_DURATION);
        await settle();
        expect(document.body.querySelectorAll('[role="status"]').length).toBe(0);

        toasts.show({ text: 'Four' });
        await settle();
        const remaining = document.body.querySelectorAll('[role="status"]');
        expect(remaining.length).toBe(1);
        expect(remaining[0].textContent).toContain('Four');
    });
});

describe('BottomNav', () =>
{
    const Stub = (): HTMLElement => document.createElement('div');
    const table: Route[] = [
        { path: '/app', component: Stub, children: [
            { path: '', component: Stub },
            { path: 'games', component: Stub },
            { path: 'friends', component: Stub },
            { path: 'chats', component: Stub },
            { path: 'me', component: Stub }
        ] }
    ];

    it('marks exactly the current tab with aria-current and keeps Home exact', async () =>
    {
        const router = createRouter({ routes: table, history: createMemoryHistory('/app/friends'), scroll: false });
        const { container } = renderTest(() => RouterProvider({ router, children: () => BottomNav({}) }) as Rendered);
        await settle();
        const current = container.querySelectorAll('[aria-current="page"]');
        expect(current.length).toBe(1);
        expect(current[0].getAttribute('href')).toBe('/app/friends');
        expect(container.querySelectorAll('a').length).toBe(5);
        for (const link of container.querySelectorAll('a'))
        {
            expect(link.textContent?.trim().length).toBeGreaterThan(0);
        }

        router.navigate('/app/chats');
        await settle();
        expect(container.querySelector('[aria-current="page"]')?.getAttribute('href')).toBe('/app/chats');
        router.navigate('/app');
        await settle();
        expect(container.querySelector('[aria-current="page"]')?.getAttribute('href')).toBe('/app');
    });
});

describe('the shell’s destinations', () =>
{
    it('lists the design’s seven in the sidebar, Tournaments not among them', () =>
    {
        expect(RAIL.map((item) => item.to)).toEqual(['/app', '/app/games', '/app/friends', '/app/chats', '/app/leaderboard', '/app/discover', '/app/me/settings']);
    });

    it('calls the fifth phone tab Profile', async () =>
    {
        const Stub = (): HTMLElement => document.createElement('div');
        const router = createRouter({ routes: [{ path: '/app', component: Stub, children: [{ path: '', component: Stub }] }], history: createMemoryHistory('/app'), scroll: false });
        const { container } = renderTest(() => RouterProvider({ router, children: () => BottomNav({}) }) as Rendered);
        await settle();

        const labels = [...container.querySelectorAll('a')].map((link) => link.textContent?.trim());
        expect(labels[4]).toBe('Profile');
    });
});

describe('the right panel', () =>
{
    const mount = async (): Promise<HTMLElement> =>
    {
        const Stub = (): HTMLElement => document.createElement('div');
        const router = createRouter({ routes: [{ path: '/app', component: Stub }], history: createMemoryHistory('/app'), scroll: false });
        const { container } = renderTest(() => RouterProvider({ router, children: () => SocialPanel({}) }) as Rendered);
        await settle();
        await settle();
        return container;
    };

    it('says what lands there, and who is not online, rather than drawing two empty boxes', async () =>
    {
        server.friends = [];
        await useAccount().signIn('Alex');
        const container = await mount();

        expect(container.textContent).toContain('Friend requests, invitations and messages land here.');
        expect(container.textContent).toContain('None of your friends are online right now.');
    });

    it('lists the notifications the server holds, as sentences, each one a way in', async () =>
    {
        await useAccount().signIn('Alex');
        server.notify({ kind: 'friend-request', actor: 'sara.k', dedupeKey: 'friend:sara.k' });
        useNotifications().reset();
        const container = await mount();

        const rows = container.querySelectorAll('section[aria-labelledby="panel-activity"] li button');
        expect(rows.length).toBe(1);
        expect(rows[0].textContent).toContain('ago');
    });
});

describe('the sidebar’s account card', () =>
{
    it('keeps a long name inside the card and lets it run in its own direction', async () =>
    {
        await useAccount().signIn('Aleksandra Konstantinopolskaya-Wright');
        const Stub = (): HTMLElement => document.createElement('div');
        const router = createRouter({ routes: [{ path: '/app', component: Stub }], history: createMemoryHistory('/app'), scroll: false });
        const { container } = renderTest(() => RouterProvider({ router, children: () => Sidebar({}) }) as Rendered);
        await settle();

        const card = container.querySelector('a[href="/app/me"]')!;
        const name = card.querySelector('[dir="auto"]')!;
        expect(name.className).toContain('truncate');
        expect(name.parentElement!.className).toContain('min-w-0');
        expect(card.textContent).not.toContain('Sign out');
    });
});

describe('Page', () =>
{
    it('is the focus target after a route change and scrolls on its own', async () =>
    {
        const Stub = (): HTMLElement => document.createElement('div');
        const router = createRouter({ routes: [{ path: '/x', component: Stub }], history: createMemoryHistory('/x'), scroll: false });
        const { container } = renderTest(() => RouterProvider({ router, children: () => Page({ children: 'body' }) }) as Rendered);
        await settle();
        const root = container.querySelector('.page')!;
        expect(root.hasAttribute('data-route-focus')).toBe(true);
        expect(root.getAttribute('tabindex')).toBe('-1');
        expect(root.classList.contains('page')).toBe(true);
    });

    /**
     * The page fills the column the shell gives it, and only says otherwise for a reading width.
     *
     * The shell is already a three-column grid, so the column is bounded by the rail and the social
     * panel either side of it. A second cap inside it is the same job done twice by two numbers that
     * know nothing about each other, and the wider number won on a wide monitor: at 2560 the column
     * is 2016px and the content used the middle 1536, leaving 240px of dead ground on each side.
     *
     * This is pinned rather than left to the default, because "no cap" was once an implicit side
     * effect of `padded={ false }` and lost the chat thread its full bleed the moment those two
     * decisions were correctly separated. It is the default now; a spec is what keeps it one.
     */
    it('fills its column by default, and takes a reading width only when asked', async () =>
    {
        const Stub = (): HTMLElement => document.createElement('div');
        const router = createRouter({ routes: [{ path: '/x', component: Stub }], history: createMemoryHistory('/x'), scroll: false });

        const wide = renderTest(() => RouterProvider({ router, children: () => Page({ children: 'body' }) }) as Rendered);
        await settle();
        const filled = wide.container.querySelector('.page > div')!;
        expect([...filled.classList].some((name) => name.startsWith('max-w-'))).toBe(false);

        const narrow = renderTest(() => RouterProvider({ router, children: () => Page({ children: 'body', width: 'narrow' }) }) as Rendered);
        await settle();
        expect(narrow.container.querySelector('.page > div')!.classList.contains('max-w-[44rem]')).toBe(true);
    });

    /**
     * A page has to read its scroll position while it still HAS one.
     *
     * `<Routes>` plays a leave transition - this app always has one, `transitionFor` never returns
     * null - and the animated path is `removeChild`, then `destroyComponent`, then dispose. The
     * component teardown runs last, on an element that is no longer in the document, and CSSOM View
     * says an element with no box reports `scrollTop` as zero. So reading it there recorded 0 for
     * every page on every navigation, and back landed at the top of every list in the product.
     *
     * `jsdom` has no layout, so its `scrollTop` is an ordinary property that keeps its value after
     * detachment and cannot show the bug. This test installs the real rule on the element first -
     * connected, the position; detached, zero - which is the only way a spec can hold this fix down.
     * Without the fix the saved value is 0 and the restore below puts the page back at the top.
     */
    it('remembers how far down a page was, and puts it back on the way in', async () =>
    {
        const table: Route[] = [
            { path: '/a', component: (): HTMLElement => Page({ children: 'list' }) as HTMLElement },
            { path: '/b', component: (): HTMLElement => Page({ children: 'other' }) as HTMLElement }
        ];
        const router = createRouter({ routes: table, history: createMemoryHistory('/a'), scroll: false });
        const { container } = renderTest(() =>
            RouterProvider({
                router,
                children: () => Routes({ transition: () => 'page-forward', transitionDuration: 400 })
            }) as Rendered);
        await settle();

        const asInABrowser = (element: HTMLElement, start: number): void =>
        {
            let position = start;
            Object.defineProperty(element, 'scrollTop', {
                configurable: true,
                get: () => (element.isConnected ? position : 0),
                set: (value: number) =>
                {
                    position = value;
                }
            });
        };

        const first = container.querySelector<HTMLElement>('.page')!;
        asInABrowser(first, 250);
        first.dispatchEvent(new Event('scroll'));

        router.navigate('/b');
        await settle();
        await new Promise((resolve) => setTimeout(resolve, 500));
        await settle();
        expect(first.isConnected).toBe(false);

        router.back();
        await settle();
        await new Promise((resolve) => setTimeout(resolve, 500));
        await settle();

        expect(router.location().pathname).toBe('/a');
        expect(container.querySelector<HTMLElement>('.page')!.scrollTop).toBe(250);
    });
});

describe('routes', () =>
{
    it('sends a stranger from the app to sign-in with a way back', async () =>
    {
        const router = createRouter({ routes, history: createMemoryHistory('/app/friends'), scroll: false });
        await settle();
        expect(router.location().pathname).toBe('/sign-in');
        expect(router.location().query.next).toBe('/app/friends');
    });

    it('keeps a signed-in person in the app and bounces them off sign-in', async () =>
    {
        await useAccount().signIn('Alex');
        const router = createRouter({ routes, history: createMemoryHistory('/sign-in?next=/app/chats'), scroll: false });
        await settle();
        expect(router.location().pathname).toBe('/app/chats');
    });

    it('prerenders only the landing and keeps the app client-side', () =>
    {
        expect(routes.find((route) => route.path === '/')?.render).toBe('static');
        expect(routes.find((route) => route.path === '/app')?.render).toBe('client');
        expect(routes.find((route) => route.path === '/app')?.children?.length).toBe(17);
    });
});
