import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, fire, renderTest } from '@azerothjs/testing';
import { RouterProvider, Routes, createMemoryHistory, createRouter, type Route } from 'azerothjs';

import PersonActions from '../src/components/social/person-actions.component.azeroth';
import { manualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import '../src/locales/app-catalogue.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { useOverlay } from '../src/stores/overlay.store.ts';
import { usePeople } from '../src/stores/people.store.ts';
import { useSession } from '../src/stores/session.store.ts';
import { useSocial } from '../src/stores/social.store.ts';
import { useToasts } from '../src/stores/toasts.store.ts';
import { ApiError, client, server } from './fake-api.ts';

type Rendered = HTMLElement;

let closed: unknown[] = [];

const settle = async () =>
{
    for (let step = 0; step < 12; step += 1)
    {
        await Promise.resolve();
    }

    await new Promise((resolve) => setTimeout(resolve, 20));
};

const sheet = async (personId: string) =>
{
    const routes: Route[] = [{ path: '/app/friends', component: (): HTMLElement => PersonActions({ overlayId: 'actions', close: (result) => closed.push(result), personId }) as HTMLElement }];
    const router = createRouter({ routes, history: createMemoryHistory('/app/friends'), scroll: false });
    const { container } = renderTest(() => RouterProvider({ router, children: () => Routes({}) }) as Rendered);

    await settle();

    return container;
};

const offered = (container: HTMLElement) => [...container.querySelectorAll('ul button')].map((one) => one.textContent?.trim() ?? '');

const action = (container: HTMLElement, label: string) => [...container.querySelectorAll<HTMLButtonElement>('ul button')].find((one) => one.textContent?.trim() === label);

const said = () => useToasts().items().map((toast) => [toast.kind, toast.text]);

const answered = async (yes: boolean) =>
{
    await vi.waitFor(() => expect(useOverlay().top()).not.toBeNull());

    const asked = useOverlay().top()!;

    useOverlay().close(asked.id, yes);
    await settle();

    return asked;
};

beforeEach(async () =>
{
    cleanup();
    closed = [];
    resetRuntime();
    setRuntime({ clock: manualClock(1_700_000_000_000), seed: 3 });
    server.reset();
    useLocale().setLocale('en');
    useSession().reset();
    useSession().establish({ id: 'alex', handle: 'alex', displayName: 'Alex Morgan', bio: '', hue: 210, kind: 'guest', isMinor: false });
    usePeople().reset();
    useSocial().reset();
    useToasts().reset();
    useOverlay().reset();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await settle();
});

afterEach(() =>
{
    cleanup();
    vi.restoreAllMocks();
    useOverlay().reset();
    useToasts().reset();
    useSocial().reset();
    usePeople().reset();
});

describe('what can be done about a person', () =>
{
    it('offers to take a friend out of the friends list, and nobody else', async () =>
    {
        expect(offered(await sheet('sara.k'))).toContain('Remove Sara from friends');

        cleanup();

        expect(offered(await sheet('mina')).some((label) => label.includes('from friends'))).toBe(false);
    });

    it('asks first, says what it does and does not do, and sends nothing when the answer is no', async () =>
    {
        const container = await sheet('sara.k');

        server.calls = [];
        fire(action(container, 'Remove Sara from friends')!, 'click');

        const asked = await answered(false);

        expect(asked.props).toMatchObject({
            title: 'Remove Sara from your friends?',
            lead: 'You leave each other’s friends list. Nobody is sent a message about it, and either of you can ask again.',
            confirm: 'Remove Sara from friends',
            destructive: true
        });
        expect(server.calls).not.toContain('social.unfriend');
        expect(useSocial().relation('sara.k')).toBe('friend');
    });

    it('ends the friendship on a yes, says so once it has gone, and closes the sheet', async () =>
    {
        const container = await sheet('sara.k');

        fire(action(container, 'Remove Sara from friends')!, 'click');
        await answered(true);

        await vi.waitFor(() => expect(said()).toEqual([['info', 'Sara is no longer in your friends.']]));

        expect(server.friends).not.toContain('sara.k');
        expect(useSocial().relation('sara.k')).toBe('none');
        expect(closed).toHaveLength(1);
    });

    it('says it did not go through when the server refuses, and the friend is still a friend', async () =>
    {
        const container = await sheet('sara.k');
        const routes = client.social as unknown as Record<string, (input: unknown) => Promise<unknown>>;
        const real = routes.unfriend;

        routes.unfriend = async () =>
        {
            throw new ApiError(500, 'internal', 'Something went wrong.', undefined);
        };

        try
        {
            fire(action(container, 'Remove Sara from friends')!, 'click');
            await answered(true);

            await vi.waitFor(() => expect(said()).toEqual([['warning', 'That did not go through. Try again.']]));

            expect(useSocial().relation('sara.k')).toBe('friend');
        }
        finally
        {
            routes.unfriend = real;
        }
    });

    it('says all of it in Persian', async () =>
    {
        useLocale().setLocale('fa');

        const container = await sheet('sara.k');

        expect(offered(container)).toContain('حذف Sara از دوستان');

        fire(action(container, 'حذف Sara از دوستان')!, 'click');

        const asked = await answered(true);

        expect(asked.props).toMatchObject({ title: 'Sara از دوستانت حذف شود؟', confirm: 'حذف Sara از دوستان' });
        await vi.waitFor(() => expect(said()).toEqual([['info', 'Sara دیگر در دوستانت نیست.']]));
    });
});
