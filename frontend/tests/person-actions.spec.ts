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
import { useRealtime } from '../src/stores/realtime.store.ts';
import { useSettings } from '../src/stores/settings.store.ts';
import { setVoiceCall, setVoiceMedia, useVoice } from '../src/stores/voice.store.ts';
import { ApiError, client, server } from './fake-api.ts';
import { socket } from './fake-realtime.ts';

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
    useSession().establish({ id: 'alex', handle: 'alex', displayName: 'Alex Morgan', bio: '', hue: 210, isMinor: false });
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

describe('how loud somebody in the call is, from the sheet about them', () =>
{
    let stop: () => void = () => undefined;
    let frames = 0;

    const call = async (sara: { talk?: boolean; muted?: boolean } = {}) =>
    {
        frames += 1;
        socket.deliver({
            v: 1,
            t: 'voice',
            n: frames,
            table: 'table-1',
            joined: true,
            mine: 'join-alex',
            peers: [
                { who: 'alex', muted: true, talk: true, join: 'join-alex', opus: false },
                { who: 'sara.k', muted: sara.muted ?? false, talk: sara.talk ?? true, join: 'join-sara', opus: false }
            ]
        });
        await settle();
    };

    const join = async () =>
    {
        await useVoice().join('table-1');
        await call();
    };

    const slider = (container: HTMLElement) => container.querySelector<HTMLElement>('[role="slider"]');

    const silencer = (container: HTMLElement) => container.querySelector<HTMLButtonElement>('section button[aria-pressed]');

    beforeEach(() =>
    {
        useSettings().reset();
        useRealtime().reset();
        socket.reset();
        useRealtime().start();
        socket.accept();
        setVoiceMedia(() => ({ getUserMedia: async () => ({ getTracks: () => [], getAudioTracks: () => [] }) }) as unknown as MediaDevices);
        setVoiceCall(() => ({
            setMic: async () => undefined,
            setMuted: () => undefined,
            sync: () => undefined,
            receive: async () => undefined,
            heard: () => undefined,
            setVolume: () => undefined,
            setSink: () => undefined,
            setQuality: () => undefined,
            facts: async () => ({}),
            close: () => undefined
        }));
        useVoice().reset();
        stop = useVoice().start();
    });

    afterEach(() =>
    {
        stop();
        useVoice().reset();
        setVoiceCall(null);
        setVoiceMedia(null);
        useRealtime().reset();
        useSettings().reset();
    });

    it('offers how loud they are, and silencing them, while the reader and they are both in the call', async () =>
    {
        await join();

        const container = await sheet('sara.k');
        const control = slider(container)!;

        expect(control, 'nothing to turn her up or down with').not.toBeNull();
        expect(control.getAttribute('aria-valuenow')).toBe('1');

        control.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
        await settle();

        expect(useVoice().volumeOf('sara.k')).toBeCloseTo(0.95);
        expect(control.getAttribute('aria-valuenow')).toBe('0.95');

        silencer(container)!.click();
        await settle();

        expect(useVoice().volumeOf('sara.k')).toBe(0);
        expect(silencer(container)!.getAttribute('aria-pressed')).toBe('true');

        silencer(container)!.click();
        await settle();

        expect(useVoice().volumeOf('sara.k'), 'heard again at full, not at the volume she had').toBeCloseTo(0.95);
    });

    it('offers nothing about a call to a reader who is in none', async () =>
    {
        const container = await sheet('sara.k');

        expect(slider(container)).toBeNull();
        expect(silencer(container)).toBeNull();
    });

    it('offers nothing about a call for somebody the reader cannot talk with in it', async () =>
    {
        await useVoice().join('table-1');
        await call({ talk: false });

        const container = await sheet('sara.k');

        expect(slider(container)).toBeNull();
    });

    it('keeps the slider, and the keyboard on it, while the call around her changes', async () =>
    {
        await join();

        const container = await sheet('sara.k');
        const control = slider(container)!;

        control.focus();
        await call({ muted: true });
        await call({ muted: false });

        expect(slider(container), 'the slider was drawn again').toBe(control);
        expect(document.activeElement).toBe(control);
    });
});

describe('what can be done about a person', () =>
{
    const friendly = (labels: string[]) => labels.filter((label) =>
        label === 'Add friend' || label === 'Cancel request' || label.startsWith('Accept ') || label.includes('from friends'));

    it('leads with the profile, and then a message', async () =>
    {
        expect(offered(await sheet('mina')).slice(0, 2)).toEqual(['View profile', 'Message']);
    });

    it('offers the one friend action that is true for the person: to add, to take back what was asked, to accept what was asked of you, or to leave', async () =>
    {
        expect(friendly(offered(await sheet('mina')))).toEqual(['Add friend']);

        cleanup();

        expect(friendly(offered(await sheet('maya.c')))).toEqual(['Cancel request']);

        cleanup();

        expect(friendly(offered(await sheet('mahsa')))).toEqual(['Accept Mahsa’s friend request']);

        cleanup();

        expect(friendly(offered(await sheet('sara.k')))).toEqual(['Remove Sara from friends']);
    });

    it('offers a friend a game together, after their profile, and opens the sheet that chooses the game', async () =>
    {
        const container = await sheet('sara.k');

        expect(offered(container).slice(0, 3)).toEqual(['View profile', 'Play with Sara', 'Message']);

        fire(action(container, 'Play with Sara')!, 'click');

        await vi.waitFor(() => expect(useOverlay().items().map((one) => one.id)).toContain('play-with'), { timeout: 4000 });

        expect(useOverlay().items().find((one) => one.id === 'play-with')?.props, 'the game is chosen for somebody else, or alone').toMatchObject({ personId: 'sara.k', teamable: true });
        expect(closed, 'the sheet about Sara stayed open under the one that chooses a game').toEqual([undefined]);
    });

    it('offers a game together to a friend and to nobody else', async () =>
    {
        for (const who of ['mina', 'maya.c', 'mahsa'])
        {
            expect(offered(await sheet(who)).filter((one) => one.startsWith('Play with')), `${ who } was offered a game as a friend`).toEqual([]);

            cleanup();
        }
    });

    it('offers no way to reach somebody the reader has blocked: no message and no friend action, only their profile, their handle and the way back', async () =>
    {
        await useSocial().block('mina');

        expect(useSocial().relation('mina')).toBe('blocked');
        expect(offered(await sheet('mina'))).toEqual(['View profile', 'Copy @handle', 'Mute Mina', 'Report Mina', 'Unblock Mina']);
    });

    it('offers somebody looking at themselves their profile and their handle, and nothing they would do to somebody else', async () =>
    {
        const mine = offered(await sheet('alex'));

        expect(mine).toEqual([useLocale().t('chat.viewProfile'), useLocale().t('actions.copyHandle')]);
        expect(mine.some((one) => /Message|Mute|Report|Block|Add/.test(one)), 'the reader was offered to message, mute, report or block themselves').toBe(false);
    });

    it('asks to be friends at the press, says the request went and closes the sheet', async () =>
    {
        const container = await sheet('mina');

        server.calls = [];
        fire(action(container, 'Add friend')!, 'click');

        await vi.waitFor(() => expect(said().map(([, text]) => text)).toEqual(['Request sent']));

        expect(server.calls).toContain('social.request');
        expect(useSocial().relation('mina')).toBe('outgoing');
        expect(closed).toHaveLength(1);
    });

    it('takes back a request that is out, and accepts one that came in', async () =>
    {
        fire(action(await sheet('maya.c'), 'Cancel request')!, 'click');

        await vi.waitFor(() => expect(useSocial().relation('maya.c')).toBe('none'));

        cleanup();

        fire(action(await sheet('mahsa'), 'Accept Mahsa’s friend request')!, 'click');

        await vi.waitFor(() => expect(useSocial().relation('mahsa')).toBe('friend'));

        await vi.waitFor(() => expect(server.friends).toContain('mahsa'));
    });

    it('says the friend actions in Persian too', async () =>
    {
        useLocale().setLocale('fa');

        expect(offered(await sheet('mina'))).toContain('افزودن دوست');

        cleanup();

        expect(offered(await sheet('maya.c'))).toContain('لغو درخواست');

        cleanup();

        expect(offered(await sheet('mahsa'))).toContain('قبول درخواست دوستی Mahsa');
    });

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
