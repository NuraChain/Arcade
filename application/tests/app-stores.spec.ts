import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { manualClock, type ManualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import { requireAnonymous, requireSession, safeNext } from '../src/lib/guards.ts';
import { RESTORED_MS, useConnection } from '../src/stores/connection.store.ts';
import { postureFor, useDevice } from '../src/stores/device.store.ts';
import { OVERLAY_SETTLE, useOverlay } from '../src/stores/overlay.store.ts';
import { useAccount } from '../src/stores/account.store.ts';
import { useRealtime } from '../src/stores/realtime.store.ts';
import { useSession } from '../src/stores/session.store.ts';
import { defaultSettings, useSettings } from '../src/stores/settings.store.ts';
import { useShell } from '../src/stores/shell.store.ts';
import { TOAST_DURATION, TOAST_VISIBLE, useToasts } from '../src/stores/toasts.store.ts';
import { resetDataset } from '../src/data/mock/index.ts';
import { server } from './fake-api.ts';
import { socket } from './fake-realtime.ts';

vi.mock('../src/api.ts', async () => await import('./fake-api.ts'));

let clock: ManualClock;

const memory = new Map<string, string>();
const original = Object.getOwnPropertyDescriptor(window, 'localStorage');

beforeEach(() =>
{
    resetRuntime();
    clock = manualClock(1_000_000);
    setRuntime({ clock, seed: 3 });
    resetDataset();
    server.reset();
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
    useSession().reset();
    useSettings().reset();
    useToasts().reset();
    useOverlay().reset();
    useRealtime().reset();
    socket.reset();
    useConnection().reset();
    useShell().reset();
    useDevice().override(null);
});

afterEach(() =>
{
    if (original !== undefined)
    {
        Object.defineProperty(window, 'localStorage', original);
    }
});

describe('device posture', () =>
{
    it('draws the three postures at the documented widths', () =>
    {
        expect(postureFor(320)).toBe('phone');
        expect(postureFor(767)).toBe('phone');
        expect(postureFor(768)).toBe('rail');
        expect(postureFor(1023)).toBe('rail');
        expect(postureFor(1024)).toBe('sidebar');
    });

    it('lets a test pin the posture and lets go again', () =>
    {
        const device = useDevice();
        device.override('sidebar');
        expect(device.posture()).toBe('sidebar');
        device.override(null);
        expect(device.posture()).toBe(postureFor(device.width()));
    });
});

describe('session', () =>
{
    it('asks the server for the account and adopts the one it issues', async () =>
    {
        const session = useSession();
        const account = useAccount();
        const person = await account.signIn('Darya');
        expect(server.calls).toContain('auth.guest');
        expect(session.signedIn()).toBe(true);
        expect(person?.handle).toBe('darya');
        expect(account.user()?.handle).toBe('darya');
    });

    it('claims a fresh handle rather than taking one that is spoken for', async () =>
    {
        const person = await useAccount().signIn('alex');
        expect(person?.id).not.toBe('alex');
        expect(person?.displayName).toBe('alex');
    });

    it('keeps a name nobody in the dataset has ever answered to', async () =>
    {
        const account = useAccount();
        const person = await account.signIn('Darya');
        expect(person?.handle).toBe('darya');
        expect(person?.displayName).toBe('Darya');
        expect(account.user()?.displayName).toBe('Darya');
    });

    it('ends the session on the server rather than only in this tab', async () =>
    {
        const session = useSession();
        const account = useAccount();
        await account.signIn('Darya');
        await session.signOut();
        expect(server.calls).toContain('auth.sign-out');
        expect(server.account).toBeNull();
        expect(account.user()).toBeNull();
    });

    it('ends every session at once and reports how many it closed', async () =>
    {
        const session = useSession();
        await useAccount().signIn('Darya');
        expect(await session.signOutEverywhere()).toBe(3);
        expect(session.signedIn()).toBe(false);
    });

    it('takes the answer from the server when nothing has been established', async () =>
    {
        const session = useSession();
        server.account = { id: 'u-darya', handle: 'darya', displayName: 'Darya', bio: '', hue: 280, kind: 'guest', isMinor: false };
        await session.ready();
        expect(server.calls).toContain('auth.me');
        expect(session.signedIn()).toBe(true);
        expect(useAccount().user()?.id).toBe('darya');
    });
});

describe('guards', () =>
{
    const context = (pathname: string, next?: string): Parameters<typeof requireSession>[0] => ({
        params: {},
        pathname,
        query: next === undefined ? {} : { next },
        from: null
    });

    it('sends a stranger to sign-in with a way back', async () =>
    {
        const verdict = await requireSession(context('/app/friends'));
        expect(verdict).toMatchObject({ to: { pathname: '/sign-in', query: { next: '/app/friends' } } });
    });

    it('asks the server once and answers every navigation after it from the answer', async () =>
    {
        await requireSession(context('/app'));
        await requireSession(context('/app/friends'));
        expect(server.calls.filter((call) => call === 'auth.me').length).toBe(1);
    });

    it('lets a signed-in person through, and bounces them off the sign-in page', async () =>
    {
        await useAccount().signIn('Alex');
        expect(await requireSession(context('/app'))).toBe(true);
        expect(await requireAnonymous(context('/sign-in', '/app/chats'))).toMatchObject({ to: '/app/chats' });
    });

    it('never follows a next that leaves the app', () =>
    {
        expect(safeNext('/app/games')).toBe('/app/games');
        expect(safeNext('//evil.example')).toBe('/app');
        expect(safeNext('/')).toBe('/app');
        expect(safeNext(undefined)).toBe('/app');
    });
});

describe('settings', () =>
{
    it('persists a patch to this device', () =>
    {
        const settings = useSettings();
        settings.update({ sound: true });
        expect(JSON.parse(memory.get('nura-games.settings') ?? '{}').sound).toBe(true);
    });

    it('keeps nothing that belongs to the account', () =>
    {
        const stored = Object.keys(defaultSettings());
        expect(stored).not.toContain('mutedConversations');
        expect(stored).not.toContain('mutedGames');
        expect(stored).not.toContain('strangerMessages');
        expect(stored).not.toContain('showOnline');
    });

    it('starts silent and with the chat rail open', () =>
    {
        expect(defaultSettings().sound).toBe(false);
        expect(defaultSettings().railOpen).toBe(true);
    });
});

describe('toasts', () =>
{
    it('shows at most three and promotes the queue as they expire', () =>
    {
        const toasts = useToasts();
        for (let index = 0; index < 5; index += 1)
        {
            toasts.show({ text: `t${ index }` });
        }
        expect(toasts.items().length).toBe(TOAST_VISIBLE);
        expect(toasts.queued()).toBe(2);
        clock.advance(TOAST_DURATION);
        expect(toasts.items().map((toast) => toast.text)).toEqual(['t3', 't4']);
    });

    it('pauses the clock while hovered and resumes with what is left', () =>
    {
        const toasts = useToasts();
        const id = toasts.show({ text: 'hold' });
        clock.advance(1000);
        toasts.pause(id);
        clock.advance(10_000);
        expect(toasts.items().length).toBe(1);
        toasts.resume(id);
        clock.advance(TOAST_DURATION - 1000 - 1);
        expect(toasts.items().length).toBe(1);
        clock.advance(2);
        expect(toasts.items().length).toBe(0);
    });

    it('keeps an error until it is dismissed by hand', () =>
    {
        const toasts = useToasts();
        const id = toasts.show({ kind: 'error', text: 'lost' });
        clock.advance(60_000);
        expect(toasts.items().length).toBe(1);
        toasts.dismiss(id);
        expect(toasts.items().length).toBe(0);
    });
});

describe('overlay stack', () =>
{
    const Probe = (): HTMLElement => document.createElement('div');

    it('opens, marks open, closes through the closing phase and settles', async () =>
    {
        const overlay = useOverlay();
        const handle = overlay.open(Probe, {}, { label: 'probe' });
        expect(overlay.blocking()).toBe(true);
        expect(overlay.top()?.phase).toBe('opening');
        overlay.opened(handle.id);
        expect(overlay.top()?.phase).toBe('open');
        handle.close('picked');
        expect(overlay.items()[0].phase).toBe('closing');
        expect(overlay.top()).toBeNull();
        await expect(handle.closed).resolves.toBe('picked');
        clock.advance(OVERLAY_SETTLE);
        expect(overlay.items()).toEqual([]);
        expect(overlay.blocking()).toBe(false);
    });

    it('stacks a second layer on top and closes them all', () =>
    {
        const overlay = useOverlay();
        overlay.open(Probe, {}, { label: 'a' });
        const second = overlay.open(Probe, {}, { label: 'b' });
        expect(overlay.top()?.id).toBe(second.id);
        overlay.closeAll();
        clock.advance(OVERLAY_SETTLE);
        expect(overlay.items()).toEqual([]);
    });

    it('replaces the props of an entry opened again under the same id', () =>
    {
        const overlay = useOverlay();
        overlay.open(Probe, { tab: 'a' }, { label: 'x', id: 'fixed' });
        overlay.open(Probe, { tab: 'b' }, { label: 'x', id: 'fixed' });
        expect(overlay.items().length).toBe(1);
        expect(overlay.items()[0].props.tab).toBe('b');
    });
});

describe('connection', () =>
{
    it('says nothing at all until a socket has actually stood up', () =>
    {
        const connection = useConnection();
        const stop = connection.start();
        const live = useRealtime();

        live.start();
        expect(connection.state()).toBe('online');

        // Never connected, so there is nothing to have been interrupted. The app is exactly what
        // it was before the socket existed - a working pull-model app - and it stays quiet.
        socket.drop();
        expect(connection.state()).toBe('online');

        stop();
    });

    it('reports an interruption, then says so when it is over, then goes quiet', () =>
    {
        const connection = useConnection();
        const stop = connection.start();
        const live = useRealtime();

        live.start();
        socket.accept();
        expect(connection.state()).toBe('online');

        socket.drop();
        expect(connection.state()).toBe('reconnecting');

        // Down, then connecting, then down again: the banner must not follow every flap.
        clock.advance(1100);
        expect(connection.state()).toBe('reconnecting');

        socket.accept();
        expect(connection.state()).toBe('restored');

        clock.advance(RESTORED_MS);
        expect(connection.state()).toBe('online');

        stop();
    });

    it('calls it offline when the browser says there is no network', () =>
    {
        const connection = useConnection();
        const stop = connection.start();

        useRealtime().start();
        socket.accept();

        window.dispatchEvent(new Event('offline'));
        expect(connection.state()).toBe('offline');

        window.dispatchEvent(new Event('online'));
        expect(connection.state()).toBe('online');

        stop();
    });

    it('calls it offline when the client has stopped trying', () =>
    {
        const connection = useConnection();
        const stop = connection.start();

        useRealtime().start();
        socket.accept();
        socket.drop(4401);

        expect(connection.state()).toBe('offline');
        stop();
    });

    it('stops watching for a recovery once it is stopped', () =>
    {
        const connection = useConnection();
        const stop = connection.start();
        const live = useRealtime();

        live.start();
        socket.accept();
        socket.drop();
        stop();

        clock.advance(1100);
        socket.accept();

        // Nothing was listening, so there is no "back online" to show - and the state is simply
        // what the socket is, which is up.
        expect(connection.state()).toBe('online');
        live.stop();
    });
});

describe('shell', () =>
{
    it('tracks push depth and lets the latest title claim win', () =>
    {
        const shell = useShell();
        shell.notePush();
        shell.notePush();
        shell.notePop();
        expect(shell.depth()).toBe(1);
        const release = shell.claimTitle(() => 'Sara');
        expect(shell.title()).toBe('Sara');
        release();
        expect(shell.title()).toBeNull();
    });
});
