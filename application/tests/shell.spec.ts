import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, fire, renderTest } from '@azerothjs/testing';
import { RouterProvider, createMemoryHistory, createRouter, type Route } from 'azerothjs';

import BottomNav from '../src/components/app/bottom-nav.component.azeroth';
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
        await useAccount().signInAsDemo('alex');
        const router = createRouter({ routes, history: createMemoryHistory('/sign-in?next=/app/chats'), scroll: false });
        await settle();
        expect(router.location().pathname).toBe('/app/chats');
    });

    it('prerenders only the landing and keeps the app client-side', () =>
    {
        expect(routes.find((route) => route.path === '/')?.render).toBe('static');
        expect(routes.find((route) => route.path === '/app')?.render).toBe('client');
        expect(routes.find((route) => route.path === '/app')?.children?.length).toBe(16);
    });
});
