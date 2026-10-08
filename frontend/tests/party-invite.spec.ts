import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fire, renderTest } from '@azerothjs/testing';

import ToastHost from '../src/components/app/toast-host.component.azeroth';
import PartyInvite from '../src/components/social/party-invite.component.azeroth';
import { begin } from '../src/components/social/party.ts';
import PlayWithSheet from '../src/components/social/play-with-sheet.component.azeroth';
import { manualClock, type ManualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import '../src/locales/app-catalogue.ts';
import { useCatalogue } from '../src/stores/catalogue.store.ts';
import { useDevice } from '../src/stores/device.store.ts';
import { useLobby } from '../src/stores/lobby.store.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { useOverlay } from '../src/stores/overlay.store.ts';
import { startParty } from '../src/stores/party-loader.ts';
import { useParty } from '../src/stores/party.store.ts';
import { usePeople } from '../src/stores/people.store.ts';
import { NUDGE_WINDOW_MS, useRealtime } from '../src/stores/realtime.store.ts';
import { useSession } from '../src/stores/session.store.ts';
import { useSocial } from '../src/stores/social.store.ts';
import { useToasts } from '../src/stores/toasts.store.ts';
import { INVITE_MS } from '../../backend/src/domains/party/rules.ts';
import { client, server } from './fake-api.ts';
import { socket } from './fake-realtime.ts';

const TOASTS = '[role="region"][data-placement]:not([data-party-invites])';

const SOURCES = import.meta.glob(
    ['../src/**/*.{ts,azeroth}', '!../src/main.azeroth'],
    { query: '?raw', import: 'default', eager: true }
) as Record<string, string>;

const LAZY = [
    '../src/stores/party.store.ts',
    '../src/components/social/party.ts',
    '../src/components/social/party-invite.component.azeroth',
    '../src/components/social/party-panel.component.azeroth',
    '../src/components/social/play-with-sheet.component.azeroth'
];

let clock: ManualClock;

const settle = async () =>
{
    for (let turn = 0; turn < 16; turn += 1)
    {
        await Promise.resolve();
    }
};

const askedBy = async (leader: string, game = 'hokm') =>
{
    const answer = await server.parties.invite(leader, 'alex', game);

    if (!answer.ok)
    {
        throw new Error(`the invitation was refused: ${ answer.why }`);
    }

    return (await server.parties.state(leader)).party!.id;
};

const drawn = async () =>
{
    const { container, unmount } = renderTest(() => PartyInvite({}) as HTMLElement);

    await settle();

    return { container, unmount };
};

const regionOf = (within: ParentNode) => within.querySelector<HTMLElement>('[data-party-invites]')!;

const cardsIn = (within: ParentNode) => [...within.querySelectorAll<HTMLElement>('[data-invite]')];

const named = (card: HTMLElement, name: string) =>
    [...card.querySelectorAll<HTMLButtonElement>('button')].find((one) => one.textContent?.trim() === name) ?? null;

const told = () => useToasts().items().map((toast) => [toast.kind, toast.text]);

const standing = async (verb: string, stand: (real: (input: unknown) => Promise<unknown>) => (input: unknown) => Promise<unknown>, of: Record<string, unknown>, run: () => Promise<void>) =>
{
    const real = of[verb] as (input: unknown) => Promise<unknown>;

    of[verb] = stand(real);

    try
    {
        await run();
    }
    finally
    {
        of[verb] = real;
    }
};

beforeEach(async () =>
{
    cleanup();
    resetRuntime();
    clock = manualClock(5_000_000);
    setRuntime({ clock, seed: 29 });
    server.reset();
    useRealtime().reset();
    socket.reset();
    useLocale().setLocale('en');
    useSession().reset();
    useSession().establish({ id: 'alex', handle: 'alex', displayName: 'Alex Morgan', bio: '', hue: 210, kind: 'guest', isMinor: false });
    useDevice().override('phone');
    useCatalogue().reset();
    usePeople().reset();
    useSocial().reset();
    useOverlay().reset();
    useToasts().reset();
    useLobby().reset();
    useParty().reset();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await useSocial().refresh();
    await settle();
    server.calls = [];
});

afterEach(() =>
{
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    cleanup();
    useParty().reset();
    useLobby().reset();
    useOverlay().reset();
    useToasts().reset();
    useSocial().reset();
    useDevice().override(null);
    useRealtime().reset();
});

describe('an invitation to team up', () =>
{
    it('is nothing but an empty region, politely announced, until somebody asks', async () =>
    {
        const region = regionOf((await drawn()).container);

        expect(region.getAttribute('role')).toBe('region');
        expect(region.getAttribute('aria-live')).toBe('polite');
        expect(region.getAttribute('aria-label')).toBe('Invitations to team up');
        expect(cardsIn(region)).toEqual([]);
        expect(region.className, 'an empty region took the taps meant for the page under it').toContain('pointer-events-none');
    });

    it('arrives with no reload, says who is asking and for what, and takes the focus from nobody', async () =>
    {
        const stop = useParty().start();
        const field = document.createElement('input');

        document.body.append(field);

        try
        {
            const { container } = await drawn();

            useRealtime().start();
            socket.accept();
            clock.advance(NUDGE_WINDOW_MS);
            await settle();
            field.focus();

            const id = await askedBy('sara.k');

            expect(cardsIn(container), 'the card was drawn before anything rang').toEqual([]);

            socket.deliver({ v: 1, t: 'nudge', n: 9, scope: 'me', id: 'party', at: 0 });
            clock.advance(NUDGE_WINDOW_MS);
            await settle();

            const [card] = cardsIn(container);

            expect(card.dataset.invite).toBe(id);
            expect(card.getAttribute('role')).toBe('status');
            expect(card.querySelector('[dir="auto"]')?.textContent).toBe('Sara Kamali');
            expect(card.textContent).toContain('wants to team up for Hokm');
            expect([...card.querySelectorAll('button')].map((one) => one.textContent?.trim())).toEqual(['Team up', 'Not now']);
            expect(card.className).toContain('pointer-events-auto');
            expect(document.activeElement, 'the card took the focus').toBe(field);
            expect(card.querySelector('[autofocus], [tabindex]')).toBeNull();
            expect(card.closest('[role="dialog"], [aria-modal]')).toBeNull();
        }
        finally
        {
            field.remove();
            stop();
        }
    });

    it('says it in Persian to a Persian reader, with nothing in it that is laid out by left and right', async () =>
    {
        useLocale().setLocale('fa');
        await askedBy('sara.k');
        await useParty().refresh();

        const { container } = await drawn();
        const [card] = cardsIn(container);
        const t = useLocale().t;

        expect(regionOf(container).getAttribute('aria-label')).toBe(t('party.invite.region'));
        expect(card.textContent).toContain(t('party.invite.asks', { game: t('games.hokm.name') }));
        expect([...card.querySelectorAll('button')].map((one) => one.textContent?.trim())).toEqual([t('party.teamUp'), t('party.invite.decline')]);
        expect(card.textContent).not.toContain('Team up');
        expect(regionOf(container).outerHTML).not.toMatch(/[\s"'](?:[a-z0-9[\]=/-]+:)*-?(?:ml|mr|pl|pr|left|right|text-left|text-right|rounded-[lr]|border-[lr])-/);
    });

    it('names somebody it has only a handle for by the handle, and by their name once it is told, in the card it drew', async () =>
    {
        const answers: (() => void)[] = [];

        await standing('names', (real) => async (input) =>
        {
            await new Promise<void>((resolve) =>
            {
                answers.push(resolve);
            });

            return await real(input);
        }, client.social as unknown as Record<string, unknown>, async () =>
        {
            await askedBy('shirin');
            await useParty().refresh();

            const { container } = await drawn();
            const [card] = cardsIn(container);

            expect(card.querySelector('[dir="auto"]')?.textContent).toBe('shirin');
            expect(answers, 'nobody asked who they are').toHaveLength(1);

            answers[0]();

            await vi.waitFor(() => expect(card.querySelector('[dir="auto"]')?.textContent).toBe('Shirin Rahimi'), { timeout: 4000 });
            expect(cardsIn(container)[0], 'the card was drawn again to change a name').toBe(card);
        });
    });

    it('is a card for each invitation, and each is the card it was when the list is read again', async () =>
    {
        await askedBy('sara.k');
        clock.advance(1_000);
        await askedBy('reza.t', 'ludo');
        await useParty().refresh();

        const { container } = await drawn();
        const before = cardsIn(container);

        expect(before.map((card) => card.querySelector('[dir="auto"]')?.textContent)).toEqual(['Sara Kamali', 'Reza Tehrani']);
        expect(before[1].textContent).toContain('wants to team up for Ludo');

        await useParty().refresh();
        await useParty().refresh();

        expect(cardsIn(container)).toEqual(before);
        expect(cardsIn(container)[0]).toBe(before[0]);
    });

    it('has two controls a finger can hit', async () =>
    {
        await askedBy('sara.k');
        await useParty().refresh();

        const [card] = cardsIn((await drawn()).container);
        const buttons = [...card.querySelectorAll('button')];

        expect(buttons).toHaveLength(2);

        for (const button of buttons)
        {
            expect(button.className, button.textContent ?? '').toContain('coarse:h-11');
        }
    });

    it('draws nothing for a game this browser has never heard of', async () =>
    {
        await standing('state', () => async () => ({
            invites: [{ id: '3f0e3c2a-1111-4222-8333-444455556666', game: 'a-game-from-a-newer-server', from: 'sara.k', remainingMs: 60_000 }]
        }), client.parties as unknown as Record<string, unknown>, async () =>
        {
            await useParty().refresh();

            const { container } = await drawn();

            expect(useParty().invites()).toHaveLength(1);
            expect(cardsIn(container)).toEqual([]);
        });
    });
});

describe('answering an invitation', () =>
{
    it('says yes on Team up, once however often it is pressed, and opens the team the reader is now in', async () =>
    {
        const id = await askedBy('sara.k');

        await useParty().refresh();

        const { container } = await drawn();
        const [card] = cardsIn(container);

        server.calls = [];
        fire(named(card, 'Team up')!, 'click');

        expect(named(card, 'Team up')?.getAttribute('aria-busy')).toBe('true');
        expect(named(card, 'Not now')?.disabled, 'a not now could be sent on top of a yes').toBe(true);

        fire(named(card, 'Team up')!, 'click');

        await vi.waitFor(() => expect(cardsIn(container)).toEqual([]), { timeout: 4000 });

        expect(server.calls.filter((call) => call === 'parties.accept')).toHaveLength(1);
        expect(useParty().party()).toMatchObject({ id, stage: 'ready', leader: 'sara.k', member: 'alex' });

        await vi.waitFor(() => expect(useOverlay().items().map((entry) => [entry.id, entry.component, entry.props.personId, entry.label]))
            .toEqual([['play-with', PlayWithSheet, 'sara.k', 'Play with Sara Kamali']]), { timeout: 4000 });
        expect(told()).toEqual([]);
    });

    it('says not now on Not now, and tells the reader nothing about what they just did', async () =>
    {
        await askedBy('sara.k');
        await useParty().refresh();

        const { container } = await drawn();

        server.calls = [];
        fire(named(cardsIn(container)[0], 'Not now')!, 'click');

        await vi.waitFor(() => expect(cardsIn(container)).toEqual([]), { timeout: 4000 });
        await settle();

        expect(server.calls).toContain('parties.decline');
        expect(server.calls).not.toContain('parties.accept');
        expect(useOverlay().items()).toEqual([]);
        expect(told()).toEqual([]);
        expect((await server.parties.state('sara.k')).ended).toMatchObject({ reason: 'declined', by: 'alex' });
    });

    it('says the team-up is no longer there when it was taken back first, opens nothing, and takes the card away', async () =>
    {
        const id = await askedBy('sara.k');

        await useParty().refresh();

        const { container } = await drawn();

        server.parties.leave('sara.k', id);
        fire(named(cardsIn(container)[0], 'Team up')!, 'click');

        await vi.waitFor(() => expect(cardsIn(container)).toEqual([]), { timeout: 4000 });
        await settle();

        expect(told()).toEqual([['warning', 'That team-up is no longer there.']]);
        expect(useOverlay().items()).toEqual([]);
    });

    it('goes when its time runs out, with nothing said to whoever let it', async () =>
    {
        const stop = useParty().start();

        await askedBy('sara.k');
        await useParty().refresh();

        const { container } = await drawn();

        expect(cardsIn(container)).toHaveLength(1);

        clock.advance(INVITE_MS + 1_000);
        await vi.waitFor(() => expect(cardsIn(container)).toEqual([]), { timeout: 4000 });

        expect(told()).toEqual([]);
        stop();
    });
});

describe('the time an invitation has left, on its card', () =>
{
    it('is a bar that runs from what is left when the card is drawn, and is never started again by a read', async () =>
    {
        await askedBy('sara.k');
        clock.advance(30_000);
        await useParty().refresh();
        clock.advance(15_000);

        const { container } = await drawn();
        const bar = cardsIn(container)[0].querySelector<HTMLElement>('[data-clock]')!;

        expect(bar.closest('[aria-hidden="true"]')).not.toBeNull();
        expect(bar.style.getPropertyValue('--left')).toBe(`${ INVITE_MS - 45_000 }ms`);
        expect(Number(bar.style.getPropertyValue('--from'))).toBeCloseTo(0.5, 4);

        clock.advance(10_000);
        await useParty().refresh();

        const after = cardsIn(container)[0].querySelector<HTMLElement>('[data-clock]')!;

        expect(after).toBe(bar);
        expect(after.style.getPropertyValue('--left')).toBe(`${ INVITE_MS - 45_000 }ms`);
    });
});

describe('where an invitation is drawn', () =>
{
    const both = async () =>
    {
        renderTest(() => ToastHost({}) as HTMLElement);

        const { container, unmount } = await drawn();

        return { region: regionOf(container), toasts: document.querySelector<HTMLElement>(TOASTS)!, unmount };
    };

    it('is the foot of the page, where the toasts are, clear of the island', async () =>
    {
        const { region, toasts } = await both();

        expect(toasts, 'the toasts’ region is no longer where the card looks for it').not.toBeNull();
        expect(region.dataset.placement).toBe('bottom');
        expect(region.dataset.placement).toBe(toasts.dataset.placement);
        expect(region.dataset.posture).toBe('phone');
        expect(region.className).toContain('--nav-room');
    });

    it('is the head of the page at a table, over no hand, no dice and no chat, on a wide screen as on a phone', async () =>
    {
        const { region } = await both();

        useLobby().open('a-table');
        await settle();

        expect(region.dataset.placement).toBe('top');

        useDevice().override('sidebar');
        await settle();

        expect(region.dataset.placement).toBe('top');
        expect(region.dataset.posture).toBe('sidebar');

        useLobby().close();
        await settle();

        expect(region.dataset.placement).toBe('bottom');
    });

    it('is one row at the head of the page however many are waiting: the oldest, with the others counted on it', async () =>
    {
        const first = await askedBy('sara.k');

        clock.advance(1_000);

        const second = await askedBy('reza.t', 'ludo');

        clock.advance(1_000);

        const third = await askedBy('shirin');

        await useParty().refresh();

        const { region } = await both();
        const [oldest] = cardsIn(region);
        const drawnFor = () => cardsIn(region).map((card) => card.dataset.invite);
        const counted = () => region.querySelector<HTMLElement>('[data-more]');
        const said = () => region.querySelector('.sr-only')?.textContent ?? null;

        expect(drawnFor(), 'at the foot each has a card').toEqual([first, second, third]);
        expect([counted(), said()]).toEqual([null, null]);

        useLobby().open('a-table');
        await settle();

        expect(region.dataset.placement).toBe('top');
        expect(drawnFor(), 'a second row was drawn down over the board').toEqual([first]);
        expect(cardsIn(region)[0], 'the card was drawn again to move it').toBe(oldest);
        expect(counted()?.textContent?.trim()).toBe('+2');
        expect(counted()?.getAttribute('aria-hidden')).toBe('true');
        expect(said()).toBe('2 more invitations are waiting');
        expect(oldest.contains(counted()), 'the count is a row of its own').toBe(true);

        clock.advance(1_000);

        const fourth = await askedBy('mina');

        await useParty().refresh();
        await settle();

        expect(drawnFor(), 'a later invitation was drawn under the one on show').toEqual([first]);
        expect(cardsIn(region)[0]).toBe(oldest);
        expect(counted()?.textContent?.trim(), 'the count did not follow an arrival').toBe('+3');

        await useParty().decline(first);
        await settle();

        expect(drawnFor(), 'the next did not take its place').toEqual([second]);
        expect(said()).toBe('2 more invitations are waiting');

        useLobby().close();
        await settle();

        expect(drawnFor()).toEqual([second, third, fourth]);
        expect([counted(), said()], 'a count was left on a card at the foot').toEqual([null, null]);

        useLobby().open('a-table');
        await useParty().decline(second);
        await settle();

        expect(drawnFor()).toEqual([third]);
        expect([counted()?.textContent?.trim(), said()]).toEqual(['+1', '1 more invitation is waiting']);

        await useParty().decline(third);
        await settle();

        expect(drawnFor()).toEqual([fourth]);
        expect([counted(), said()], 'a count was left beside the last one').toEqual([null, null]);
    });

    it('is one row under a sheet on a phone as well, and counts the others in Persian for a Persian reader', async () =>
    {
        useLocale().setLocale('fa');
        await askedBy('sara.k');
        clock.advance(1_000);
        await askedBy('reza.t', 'ludo');
        await useParty().refresh();

        const { region } = await both();

        useOverlay().open(() => document.createElement('div'), {}, { label: 'A sheet', kind: 'sheet' });
        await settle();

        const counted = region.querySelector<HTMLElement>('[data-more]');
        const said = region.querySelector('.sr-only')?.textContent;

        expect(region.dataset.placement).toBe('top');
        expect(cardsIn(region)).toHaveLength(1);
        expect(said).toBe(useLocale().plural('party.invite.more', 1));
        expect(said).not.toContain('waiting');
        expect(counted?.textContent?.trim()).toBe(`+${ useLocale().n(1) }`);
        expect(counted?.className, 'a number in a mirrored line can turn round').toContain('tally');
        expect(region.outerHTML).not.toMatch(/[\s"'](?:[a-z0-9[\]=/-]+:)*-?(?:ml|mr|pl|pr|left|right|text-left|text-right|rounded-[lr]|border-[lr])-/);
    });

    it('follows the toasts to the head of the page when a page lifts them, and when a sheet is open on a phone', async () =>
    {
        const { region, toasts } = await both();
        const release = useToasts().lift();

        await settle();

        expect([region.dataset.placement, toasts.dataset.placement]).toEqual(['top', 'top']);

        release();
        await settle();

        expect([region.dataset.placement, toasts.dataset.placement]).toEqual(['bottom', 'bottom']);

        const sheet = useOverlay().open(() => document.createElement('div'), {}, { label: 'A sheet', kind: 'sheet' });

        await settle();

        expect([region.dataset.placement, toasts.dataset.placement]).toEqual(['top', 'top']);

        sheet.close();
        await settle();

        expect([region.dataset.placement, toasts.dataset.placement], 'a sheet that is leaving still held the card up').toEqual(['bottom', 'bottom']);

        useDevice().override('sidebar');
        useOverlay().open(() => document.createElement('div'), {}, { label: 'A dialog' });
        await settle();

        expect([region.dataset.placement, toasts.dataset.placement], 'a dialog on a wide screen is centred and moves nothing').toEqual(['bottom', 'bottom']);
    });

    it('keeps its place at the edge and moves the toasts clear of it by its own height, only while they share that edge', async () =>
    {
        const watching: (() => void)[] = [];

        vi.stubGlobal('ResizeObserver', class
        {
            readonly #changed: () => void;

            constructor(changed: () => void)
            {
                this.#changed = changed;
            }

            public observe()
            {
                watching.push(this.#changed);
            }

            public disconnect()
            {
                watching.length = 0;
            }
        });

        const id = await askedBy('sara.k');

        await useParty().refresh();

        const { region, toasts, unmount } = await both();
        const moved = () => toasts.style.getPropertyValue('translate');

        expect(watching, 'nothing watches the card’s own height').toHaveLength(1);

        Object.defineProperty(region, 'offsetHeight', { configurable: true, get: () => 120 });
        watching[0]();

        expect(moved()).toBe('0 -120px');

        const release = useToasts().lift();

        await settle();

        expect([region.dataset.placement, toasts.dataset.placement]).toEqual(['top', 'top']);
        expect(moved()).toBe('0 120px');

        release();
        useDevice().override('sidebar');
        useLobby().open('a-table');
        await settle();

        expect([region.dataset.placement, toasts.dataset.placement]).toEqual(['top', 'bottom']);
        expect(moved(), 'the toasts were moved away from a card on the other edge').toBe('');

        useLobby().close();
        await settle();

        expect(moved()).toBe('0 -120px');

        await useParty().decline(id);
        await settle();

        expect(cardsIn(region)).toEqual([]);
        expect(moved(), 'room was kept for an invitation that has gone').toBe('');

        clock.advance(60_000);
        await askedBy('reza.t');
        await useParty().refresh();
        watching[0]();

        expect(moved()).toBe('0 -120px');

        unmount();

        expect(moved(), 'the toasts were left where a card that is gone had put them').toBe('');
    });
});

describe('the part of the party the shell never imports', () =>
{
    it('starts the store and draws the invitations outside the page, and takes both away when it is stopped', async () =>
    {
        const stop = begin();

        try
        {
            await settle();

            const region = regionOf(document.body);

            expect(region).not.toBeNull();
            expect(region.closest('#app-shell'), 'an open sheet would make the card inert').toBeNull();

            useRealtime().start();
            socket.accept();
            clock.advance(NUDGE_WINDOW_MS);
            await settle();
            await askedBy('sara.k');
            socket.deliver({ v: 1, t: 'nudge', n: 3, scope: 'me', id: 'party', at: 0 });
            clock.advance(NUDGE_WINDOW_MS);
            await settle();

            expect(cardsIn(document.body)).toHaveLength(1);
        }
        finally
        {
            stop();
        }

        expect(document.querySelector('[data-party-invites]')).toBeNull();

        server.calls = [];
        socket.deliver({ v: 1, t: 'nudge', n: 4, scope: 'me', id: 'party', at: 0 });
        clock.advance(NUDGE_WINDOW_MS);
        await settle();

        expect(server.calls, 'a store that was stopped went on answering the doorbell').not.toContain('parties.state');
    });

    it('is fetched a promise after the shell asks, and stopped with the shell', async () =>
    {
        const stops: (() => void)[] = [];

        startParty(stops);

        expect(document.querySelector('[data-party-invites]'), 'the party was drawn in the shell’s own tick').toBeNull();
        expect(stops).toHaveLength(1);

        await vi.waitFor(() => expect(document.querySelector('[data-party-invites]')).not.toBeNull(), { timeout: 4000 });

        stops[0]();

        expect(document.querySelector('[data-party-invites]')).toBeNull();
    });

    it('is reached by the shell through the loader alone, and imported eagerly by nothing outside itself', () =>
    {
        const shell = SOURCES['../src/components/app/app-shell.component.azeroth'];

        expect(shell).toMatch(/^import \{ startParty \} from '\.\.\/\.\.\/stores\/party-loader\.ts';$/m);
        expect(shell).toMatch(/^ {8}startParty\(stops\);$/m);

        const eager = Object.entries(SOURCES)
            .filter(([path]) => !LAZY.includes(path))
            .filter(([, source]) => [...source.matchAll(/^import (?!type )[^;]*?from '([^']+)';/gm)]
                .some(([, from]) => LAZY.some((lazy) => from.endsWith(lazy.slice(lazy.lastIndexOf('/'))))))
            .map(([path]) => path);

        expect(eager, 'the party is in a chunk every page pays for').toEqual([]);
        expect(LAZY.filter((lazy) => SOURCES[lazy] === undefined), 'a file this rule is about has moved').toEqual([]);
    });

    it('is never drawn for a shell that went before it arrived', async () =>
    {
        const stops: (() => void)[] = [];

        startParty(stops);
        stops[0]();
        await new Promise((resolve) => setTimeout(resolve, 60));
        await settle();

        expect(document.querySelector('[data-party-invites]')).toBeNull();
    });
});
