import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { manualClock, type ManualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import { requireAnonymous, requireSession, safeNext } from '../src/lib/guards.ts';
import { RECONNECT_DELAY, useConnection } from '../src/stores/connection.store.ts';
import { postureFor, useDevice } from '../src/stores/device.store.ts';
import { OVERLAY_SETTLE, useOverlay } from '../src/stores/overlay.store.ts';
import { useAccount } from '../src/stores/account.store.ts';
import { useSession } from '../src/stores/session.store.ts';
import { defaultSettings, useSettings } from '../src/stores/settings.store.ts';
import { useShell } from '../src/stores/shell.store.ts';
import { TOAST_DURATION, TOAST_VISIBLE, useToasts } from '../src/stores/toasts.store.ts';
import { resetDataset } from '../src/data/mock/index.ts';

let clock: ManualClock;

const memory = new Map<string, string>();
const original = Object.getOwnPropertyDescriptor(window, 'localStorage');

beforeEach(() =>
{
    resetRuntime();
    clock = manualClock(1_000_000);
    setRuntime({ clock, seed: 3 });
    resetDataset();
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
    it('offers three demo identities, one of them a minor', async () =>
    {
        const identities = useAccount().demoIdentities();
        expect(identities.length).toBe(3);
        expect(identities.filter((person) => person.minor).length).toBe(1);
    });

    it('signs a known handle in after the runtime latency and remembers it', async () =>
    {
        const session = useSession();
        const account = useAccount();
        const pending = account.signIn('sara.k');
        expect(account.user()).toBeNull();
        clock.advance(500);
        const person = await pending;
        expect(person.id).toBe('sara');
        expect(session.signedIn()).toBe(true);
        expect(account.user()?.id).toBe('sara');
        expect(memory.get('nura-games.session')).toContain('sara');
    });

    it('seats an unknown name as a guest, keeps the name, and forgets it on sign-out', async () =>
    {
        const session = useSession();
        const account = useAccount();
        const pending = account.signIn('Darya');
        clock.advance(500);
        const person = await pending;
        expect(person.id).toBe('guest-darya');
        expect(person.name.en).toBe('Darya');
        expect(account.user()?.name.en).toBe('Darya');
        session.signOut();
        expect(account.user()).toBeNull();
        expect(memory.has('nura-games.session')).toBe(false);
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

    it('sends a stranger to sign-in with a way back', () =>
    {
        const verdict = requireSession(context('/app/friends'));
        expect(verdict).toMatchObject({ to: { pathname: '/sign-in', query: { next: '/app/friends' } } });
    });

    it('lets a signed-in person through, and bounces them off the sign-in page', async () =>
    {
        const pending = useAccount().signIn('alex');
        clock.advance(500);
        await pending;
        expect(requireSession(context('/app'))).toBe(true);
        expect(requireAnonymous(context('/sign-in', '/app/chats'))).toMatchObject({ to: '/app/chats' });
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
    it('persists a patch and toggles mutes', () =>
    {
        const settings = useSettings();
        settings.update({ sound: true });
        expect(JSON.parse(memory.get('nura-games.settings') ?? '{}').sound).toBe(true);
        settings.toggleMutedConversation('c-1');
        expect(settings.isMuted('c-1')).toBe(true);
        settings.toggleMutedConversation('c-1');
        expect(settings.isMuted('c-1')).toBe(false);
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
    it('drops, reconnects and heals on the clock', () =>
    {
        const connection = useConnection();
        connection.simulateDrop(1000);
        expect(connection.state()).toBe('offline');
        clock.advance(1000);
        expect(connection.state()).toBe('reconnecting');
        expect(connection.latency()).toBeGreaterThan(1);
        clock.advance(RECONNECT_DELAY);
        expect(connection.state()).toBe('online');
        expect(connection.latency()).toBe(1);
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
