import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, leakGuard, renderTest } from '@azerothjs/testing';
import { RouterProvider, createMemoryHistory, createRouter } from 'azerothjs';

import BottomNav from '../src/components/app/bottom-nav.component.azeroth';
import Page from '../src/components/app/page.component.azeroth';
import { manualClock, type ManualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import '../src/locales/app-catalogue.ts';
import { useChat } from '../src/stores/chat.store.ts';
import { useDevice } from '../src/stores/device.store.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { useOverlay } from '../src/stores/overlay.store.ts';
import { useToasts } from '../src/stores/toasts.store.ts';

vi.mock('../src/api.ts', async () => await import('./fake-api.ts'));

type Rendered = HTMLElement;

let clock: ManualClock;

const settle = async (): Promise<void> =>
{
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 25));
};

const Stub = (): HTMLElement => document.createElement('div');

const mountOnce = async (): Promise<void> =>
{
    const router = createRouter({
        routes: [{ path: '/x', component: Stub }],
        history: createMemoryHistory('/x'),
        scroll: false
    });

    // Two roots rather than one nested tree, because `children` is an eager value in a `.ts` spec:
    // building `BottomNav` to hand to `Page` would construct it outside any owner, and a component
    // with no owner registers no subscriptions to release.
    renderTest(() => RouterProvider({
        router,
        children: () => Page({ children: 'body', onRefresh: () => undefined })
    }) as Rendered);

    renderTest(() => RouterProvider({
        router,
        children: () => BottomNav({})
    }) as Rendered);

    await settle();
};

beforeEach(() =>
{
    cleanup();
    resetRuntime();
    clock = manualClock(5000);
    setRuntime({ clock, seed: 3 });
});

afterEach(() =>
{
    cleanup();
    useDevice().stop();
    useOverlay().reset();
    useToasts().reset();
    resetRuntime();
});

/**
 * The gate for "the teardown released what the mount took", which nothing here had.
 *
 * `@azerothjs/testing` exports `leakGuard`, which snapshots the subscriber count on a signal getter
 * and throws if any of them grew after a teardown - and this repository called it zero times, while
 * the same class of defect kept being found by reading: four window listeners attached in a store
 * FACTORY with no handle to remove them, a scroll watch armed for every `Tooltip` that ever
 * mounted, a 120ms interval kept for the life of the app. Every one of those was caught by somebody
 * looking, and none of them by a suite.
 *
 * The baseline is taken AFTER one full mount-and-teardown, deliberately. A first render legitimately
 * creates subscriptions that live as long as the store scope - a store reading another store's
 * signal once, a catalogue registering itself - and counting those as growth would make the guard
 * fire on correct code. What a leak looks like is growth that REPEATS, so the measurement is over
 * repetitions.
 */
describe('subscriptions are released with the tree that took them', () =>
{
    it('survives repeated mounting and teardown of a page and its navigation', async () =>
    {
        const device = useDevice();
        const locale = useLocale();
        const chat = useChat();
        const toasts = useToasts();
        const overlay = useOverlay();

        await mountOnce();
        cleanup();
        await settle();

        const guard = leakGuard(
            device.coarse,
            locale.locale,
            chat.totalUnread,
            toasts.items,
            overlay.blocking
        );

        for (let round = 0; round < 3; round += 1)
        {
            await mountOnce();
            cleanup();
            await settle();
        }

        expect(() => guard()).not.toThrow();
    });

    /**
     * The guard has to be able to fail, or the test above is a green light for nothing.
     *
     * A tree that is never torn down is the simplest thing that really does hold its subscriptions,
     * so this asserts the guard NOTICES it. Without this, a `leakGuard` over getters nothing in the
     * render actually reads would pass forever and say nothing at all.
     */
    it('notices a tree that was never torn down', async () =>
    {
        const device = useDevice();
        const locale = useLocale();
        const chat = useChat();

        await mountOnce();
        cleanup();
        await settle();

        const guard = leakGuard(device.coarse, locale.locale, chat.totalUnread);

        await mountOnce();
        await settle();

        expect(() => guard()).toThrow(/subscriptions not released/);
    });
});
