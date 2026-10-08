import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, renderTest } from '@azerothjs/testing';

import { manualClock, type ManualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import { requireAdmin, requireAnonymous, requireSession, safeNext } from '../src/lib/guards.ts';
import { heldUp } from '../src/lib/held-up.ts';
import NotFoundPage from '../src/pages/not-found.page.azeroth';
import { useLocale } from '../src/stores/locale.store.ts';
import { LIFELINE_MS, RESTORED_MS, UNREACHED_MS, useConnection } from '../src/stores/connection.store.ts';
import { bareFor, postureFor, useDevice } from '../src/stores/device.store.ts';
import { OVERLAY_SETTLE, useOverlay } from '../src/stores/overlay.store.ts';
import { useAccount } from '../src/stores/account.store.ts';
import { useRealtime } from '../src/stores/realtime.store.ts';
import { ASK_AGAIN_MAX_MS, ASK_AGAIN_MS, useSession } from '../src/stores/session.store.ts';
import { defaultSettings, useSettings } from '../src/stores/settings.store.ts';
import { useShell } from '../src/stores/shell.store.ts';
import { usePeople } from '../src/stores/people.store.ts';
import { TOAST_DURATION, TOAST_VISIBLE, useToasts } from '../src/stores/toasts.store.ts';
import { ApiError, client, server } from './fake-api.ts';
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
    server.reset();
    memory.clear();
    Object.defineProperty(window, 'localStorage', {
        configurable: true,
        value: {
            getItem: (key: string) => memory.get(key) ?? null,
            setItem: (key: string, value: string) =>
            {
                memory.set(key, value);
            },
            removeItem: (key: string) =>
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
    it('gives a game the whole screen on a phone, and on any screen too short to spare a bar', () =>
    {
        expect(bareFor(true, 'phone', 844)).toBe(true);
        expect(bareFor(true, 'rail', 390)).toBe(true);
        expect(bareFor(true, 'sidebar', 500)).toBe(true);
        expect(bareFor(true, 'rail', 1024)).toBe(false);
        expect(bareFor(true, 'sidebar', 900)).toBe(false);
        expect(bareFor(false, 'phone', 390)).toBe(false);
    });

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

    /**
     * The four window listeners used to be attached in the store's FACTORY, and two of them could
     * never be removed at all - the `matchMedia` objects were built inline, so no handle survived to
     * hand to `removeEventListener`. A browser builds one store and never noticed; a test file that
     * builds a fresh store scope per render accumulated four listeners at a time.
     *
     * Both halves are asserted, because only the second one was ever the bug: starting has to make
     * the store follow the window, and stopping has to make it stop.
     */
    it('follows the window once started, and stops watching the window when it is told to', () =>
    {
        const device = useDevice();
        const stop = device.start();

        (window as unknown as { innerWidth: number }).innerWidth = 500;
        window.dispatchEvent(new Event('resize'));
        expect(device.width()).toBe(500);

        stop();

        (window as unknown as { innerWidth: number }).innerWidth = 1400;
        window.dispatchEvent(new Event('resize'));
        expect(device.width(), 'the store kept following the window after it was stopped').toBe(500);

        device.start();
        window.dispatchEvent(new Event('resize'));
        expect(device.width(), 'starting again did not resume the watch').toBe(1400);
        device.stop();
    });
});

const DARYA = { id: 'u-darya', handle: 'darya', displayName: 'Darya', bio: '', hue: 280, isMinor: false };

const auth = client.auth as unknown as Record<string, () => Promise<unknown>>;

const whoAmI = auth.me;

const flush = async () =>
{
    for (let turn = 0; turn < 12; turn += 1)
    {
        await Promise.resolve();
    }

    await new Promise((resolve) => setTimeout(resolve, 5));
};

const unreachable = () =>
{
    const line = { asks: 0, answer: (): Promise<unknown> => Promise.reject(new TypeError('Failed to fetch')) };

    auth.me = async () =>
    {
        line.asks += 1;

        return await line.answer();
    };

    return line;
};

describe('session', () =>
{
    it('adopts the account the server issued and reports it as the person', () =>
    {
        const session = useSession();
        const account = useAccount();

        session.establish(DARYA);

        expect(session.signedIn()).toBe(true);
        expect(account.user()?.handle).toBe('darya');
        expect(account.user()?.displayName).toBe('Darya');
    });

    it('ends the session on the server rather than only in this tab', async () =>
    {
        const session = useSession();
        const account = useAccount();
        session.establish(DARYA);
        await session.signOut();
        expect(server.calls).toContain('auth.sign-out');
        expect(server.account).toBeNull();
        expect(account.user()).toBeNull();
    });

    it('ends every session at once and reports how many it closed', async () =>
    {
        const session = useSession();
        session.establish(DARYA);
        expect(await session.signOutEverywhere()).toBe(3);
        expect(session.signedIn()).toBe(false);
    });

    it('takes the answer from the server when nothing has been established', async () =>
    {
        const session = useSession();
        server.account = DARYA;
        await session.ready();
        expect(server.calls).toContain('auth.me');
        expect(session.signedIn()).toBe(true);
        expect(useAccount().user()?.id).toBe('darya');
    });

    describe('when the server cannot be asked who is signed in', () =>
    {
        afterEach(() =>
        {
            auth.me = whoAmI;
            useSession().reset();
        });

        it('asks again, more slowly each time, and takes the answer when it comes', async () =>
        {
            const session = useSession();
            const line = unreachable();
            let done = false;

            server.account = DARYA;
            void session.ready().then(() => done = true);
            await flush();

            expect(line.asks).toBe(1);
            expect(done).toBe(false);
            expect(heldUp()).toBe(false);
            expect(session.signedIn()).toBe(false);

            clock.advance(ASK_AGAIN_MS - 1);
            await flush();

            expect(line.asks).toBe(1);

            clock.advance(1);
            await flush();

            expect(line.asks).toBe(2);
            expect(heldUp()).toBe(true);

            clock.advance(ASK_AGAIN_MS * 2 - 1);
            await flush();

            expect(line.asks).toBe(2);

            line.answer = whoAmI;
            clock.advance(1);
            await flush();

            expect(line.asks).toBe(3);
            expect(done).toBe(true);
            expect(heldUp()).toBe(false);
            expect(session.signedIn()).toBe(true);
        });

        it('never leaves more than eight seconds between two asks', async () =>
        {
            const line = unreachable();

            void useSession().ready();
            await flush();

            for (const wait of [ASK_AGAIN_MS, ASK_AGAIN_MS * 2, ASK_AGAIN_MS * 4, ASK_AGAIN_MAX_MS, ASK_AGAIN_MAX_MS, ASK_AGAIN_MAX_MS])
            {
                const before = line.asks;

                clock.advance(wait - 1);
                await flush();

                expect(line.asks).toBe(before);

                clock.advance(1);
                await flush();

                expect(line.asks).toBe(before + 1);
            }

            expect(ASK_AGAIN_MAX_MS).toBe(8000);
        });

        it('asks again when the server says it is down, and when it says to slow down', async () =>
        {
            const session = useSession();
            const line = unreachable();
            let done = false;

            line.answer = () => Promise.reject(new ApiError(503, 'unavailable', 'Try again shortly.', undefined));
            void session.ready().then(() => done = true);
            await flush();

            expect(done).toBe(false);
            expect(heldUp()).toBe(false);

            line.answer = () => Promise.reject(new ApiError(429, 'rate-limited', 'Slow down.', undefined));
            clock.advance(ASK_AGAIN_MS);
            await flush();

            expect(line.asks).toBe(2);
            expect(done).toBe(false);
            expect(heldUp()).toBe(true);

            line.answer = whoAmI;
            clock.advance(ASK_AGAIN_MS * 2);
            await flush();

            expect(done).toBe(true);
            expect(heldUp()).toBe(false);
        });

        it('takes a refusal for the answer it is: nobody is signed in', async () =>
        {
            const session = useSession();
            const line = unreachable();

            line.answer = () => Promise.reject(new ApiError(401, 'unauthorized', 'Sign in first.', undefined));
            await session.ready();

            expect(line.asks).toBe(1);
            expect(session.signedIn()).toBe(false);
            expect(heldUp()).toBe(false);

            clock.advance(ASK_AGAIN_MAX_MS * 4);
            await flush();

            expect(line.asks).toBe(1);
        });

        it('says so on the page that is holding for it once a second ask has failed too, in the reader\'s language, and draws nothing while a page simply holds', async () =>
        {
            const { container } = renderTest(() => NotFoundPage({ holding: true }) as HTMLElement);

            expect(container.textContent).toBe('');

            unreachable();
            void useSession().ready();
            await flush();

            expect(container.textContent).toBe('');

            clock.advance(ASK_AGAIN_MS);
            await flush();

            expect(container.querySelector('[role="status"]')?.textContent).toContain(useLocale().t('held.title'));
            expect(container.textContent).toContain(useLocale().t('held.lead'));
            expect(container.textContent).not.toContain(useLocale().t('notFound.title'));

            const nowhere = renderTest(() => NotFoundPage({}) as HTMLElement).container;

            expect(nowhere.textContent).toContain(useLocale().t('notFound.title'));
            expect(nowhere.textContent).not.toContain(useLocale().t('held.title'));
            expect(nowhere.querySelector('[role="status"]')).toBeNull();

            useLocale().setLocale('fa');

            expect(container.textContent).toContain(useLocale().t('held.title'));
            expect(useLocale().t('held.title')).not.toBe('The server is not answering.');

            useLocale().setLocale('en');
            auth.me = whoAmI;
            clock.advance(ASK_AGAIN_MS * 2);
            await flush();

            expect(container.textContent).toBe('');

            cleanup();
        });
    });
});

describe('guards', () =>
{
    const context = (pathname: string, next?: string): Parameters<typeof requireSession>[0] => ({
        params: {},
        pathname,
        query: next === undefined ? {} : { next },
        from: null,
        request: null
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
        useSession().establish(DARYA);
        expect(await requireSession(context('/app'))).toBe(true);
        expect(await requireAnonymous(context('/sign-in', '/app/chats'))).toMatchObject({ to: '/app/chats' });
    });

    it('holds somebody at the door while the server cannot be asked, and sends nobody to sign-in for that', async () =>
    {
        const line = unreachable();
        let verdict: unknown = 'held';

        try
        {
            server.account = DARYA;
            void requireSession(context('/app/friends')).then((answer) => verdict = answer);
            await flush();

            expect(verdict).toBe('held');

            clock.advance(ASK_AGAIN_MS);
            await flush();

            expect(line.asks).toBe(2);
            expect(verdict).toBe('held');

            line.answer = whoAmI;
            clock.advance(ASK_AGAIN_MS * 2);
            await flush();

            expect(verdict).toBe(true);
        }
        finally
        {
            auth.me = whoAmI;
            useSession().reset();
        }
    });

    it('holds the sign-in page the same way, and opens it for a stranger once the server says so', async () =>
    {
        const line = unreachable();
        let verdict: unknown = 'held';

        try
        {
            void requireAnonymous(context('/sign-in')).then((answer) => verdict = answer);
            await flush();

            expect(verdict).toBe('held');

            line.answer = whoAmI;
            clock.advance(ASK_AGAIN_MS);
            await flush();

            expect(verdict).toBe(true);
        }
        finally
        {
            auth.me = whoAmI;
            useSession().reset();
        }
    });

    it('opens /admin only for the account the server calls the admin', async () =>
    {
        expect(await requireAdmin()).toBe(false);

        useSession().establish(DARYA);
        expect(await requireAdmin()).toBe(false);

        const admin = { id: 'u-admin', handle: 'admin.w', displayName: '', bio: '', hue: 1, isMinor: false, address: '0x9965507d1a55bcc2695c58ba16fb37d819b0a4dc', admin: true };
        useSession().establish(admin);
        expect(await requireAdmin()).toBe(true);
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
        settings.update({ sound: false });
        expect(JSON.parse(memory.get('nura-games.settings') ?? '{}').sound).toBe(false);
    });

    it('keeps nothing that belongs to the account', () =>
    {
        const stored = Object.keys(defaultSettings());
        expect(stored).not.toContain('mutedConversations');
        expect(stored).not.toContain('mutedGames');
        expect(stored).not.toContain('strangerMessages');
        expect(stored).not.toContain('showOnline');
    });

    it('starts with sound on and the table chat tucked into its pill', () =>
    {
        expect(defaultSettings().sound).toBe(true);
        expect(defaultSettings().railOpen).toBe(false);
    });
});

describe('people nobody has described yet', () =>
{
    it('are asked about together, in one request, and never twice', async () =>
    {
        const people = usePeople();
        people.reset();
        server.calls = [];

        people.want(['sara.k', 'reza.t', 'mina', 'sara.k']);
        people.want(['sara.k']);
        await vi.waitFor(() => expect(people.byHandle('mina')?.displayName).toBe('Mina Sadeghi'));

        expect(server.calls.filter((call) => call === 'social.names')).toHaveLength(1);
        expect(server.calls).not.toContain('social.person');
    });
});

describe('toasts', () =>
{
    /**
     * The floor under every request nobody caught.
     *
     * About forty call sites are `void store.method()` - the promise rejects, nothing catches, and
     * the control goes back to how it was with nothing on screen. Catching each one where it is
     * thrown is the real fix; this is what makes sure that until then, and afterwards for anything
     * missed, a failure is never SILENT.
     */
    it('shows a failure for a rejection nobody caught, and only one however many reject', () =>
    {
        const toasts = useToasts();
        const stop = toasts.start();

        const reject = (reason: string) =>
        {
            window.dispatchEvent(Object.assign(new Event('unhandledrejection'), { reason, promise: null }));
        };

        reject('the first');

        expect(toasts.items().length, 'a rejection nobody caught showed nothing').toBe(1);
        expect(toasts.items()[0].kind).toBe('error');

        /*
         * A dropped connection rejects everything in flight at once, and a stack of identical
         * toasts is a worse answer than one - which is what `dedupe` is for.
         */
        reject('the second');
        reject('the third');

        expect(toasts.items().length, 'every rejection stacked its own toast').toBe(1);

        stop();
        reject('after the teardown');

        expect(toasts.items().length, 'the listener outlived the store that owns it').toBe(1);
    });

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

    it('lets the oldest error that would never leave give its slot to what came after it', () =>
    {
        const toasts = useToasts();

        toasts.show({ kind: 'error', text: 'e1' });
        toasts.show({ kind: 'error', text: 'e2' });
        toasts.show({ kind: 'error', text: 'e3' });
        toasts.show({ kind: 'success', text: 'saved' });

        expect(toasts.items().map((toast) => toast.text)).toEqual(['e2', 'e3', 'saved']);
        expect(toasts.queued()).toBe(0);
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
    it('says nothing while a first connection is still being made', () =>
    {
        const connection = useConnection();
        const stop = connection.start();
        const live = useRealtime();

        live.start();
        expect(connection.state()).toBe('online');

        socket.drop();
        expect(connection.state()).toBe('online');

        clock.advance(UNREACHED_MS - 1000);
        expect(connection.state()).toBe('online');

        stop();
    });

    it('says the live connection has not come when a socket never stood up, and goes quiet when one does', () =>
    {
        const connection = useConnection();
        const stop = connection.start();
        const live = useRealtime();

        live.start();
        socket.drop();
        clock.advance(UNREACHED_MS);

        expect(connection.state(), 'a socket that never connected was passed over in silence').toBe('unreached');

        clock.advance(20_000);
        expect(connection.state()).toBe('unreached');

        socket.accept();
        expect(connection.state()).toBe('online');

        stop();
    });

    it('reads everything again on a slow beat while there is no socket, and stops when there is one', () =>
    {
        const connection = useConnection();
        const stop = connection.start();
        const live = useRealtime();
        const rung: string[] = [];
        const deaf = live.onNudge((scope, id) => rung.push(id === undefined ? scope : `${ scope }:${ id }`));

        live.start();
        socket.drop();

        clock.advance(LIFELINE_MS + 500);
        expect([...rung].sort(), 'nothing was read again though no socket could ring').toEqual(['chat', 'game', 'me', 'social', 'table']);

        rung.length = 0;
        clock.advance(LIFELINE_MS);
        expect([...rung].sort()).toEqual(['chat', 'game', 'me', 'social', 'table']);

        socket.accept();
        clock.advance(500);
        rung.length = 0;

        clock.advance(LIFELINE_MS * 3);
        expect(rung, 'a page with a socket went on asking by itself').toEqual([]);

        socket.drop();
        clock.advance(LIFELINE_MS + 500);
        expect([...rung].sort(), 'a socket that dropped left the page with nothing to read by').toEqual(['chat', 'game', 'me', 'social', 'table']);

        deaf();
        stop();
    });

    it('does not ask a network that is not there', () =>
    {
        const connection = useConnection();
        const stop = connection.start();
        const live = useRealtime();
        const rung: string[] = [];
        const deaf = live.onNudge((scope) => rung.push(scope));

        live.start();
        socket.drop();
        window.dispatchEvent(new Event('offline'));

        clock.advance(LIFELINE_MS * 2);
        expect(rung).toEqual([]);

        window.dispatchEvent(new Event('online'));
        deaf();
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
