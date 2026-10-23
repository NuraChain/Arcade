import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, fire, renderTest } from '@azerothjs/testing';
import { createSignal } from 'azerothjs';

import LobbyPanel from '../src/components/games/lobby-panel.component.azeroth';
import { CHAIR_OUT } from '../src/components/games/seat-card.component.azeroth';
import { defaultTable } from '../src/data/tables.ts';
import { manualClock, type ManualClock } from '../src/lib/clock.ts';
import { resetRuntime, runtime, setRuntime } from '../src/lib/runtime.ts';
import '../src/locales/app-catalogue.ts';
import { useLobby } from '../src/stores/lobby.store.ts';
import { useDevice } from '../src/stores/device.store.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { useOverlay } from '../src/stores/overlay.store.ts';
import { usePeople } from '../src/stores/people.store.ts';
import { useSession } from '../src/stores/session.store.ts';
import { useToasts } from '../src/stores/toasts.store.ts';
import type { MatchView, TableSummary } from '../src/api.ts';
import { ApiError, client, server } from './fake-api.ts';

type Rendered = HTMLElement;

const settle = async () =>
{
    for (let turn = 0; turn < 12; turn += 1)
    {
        await Promise.resolve();
    }
};

const WHO = ['alex', 'sara.k', 'reza.t', 'parisa'];

const table = (extra: Partial<TableSummary> = {}): TableSummary => ({
    id: 'table-teams',
    code: 'teams1',
    game: 'hokm',
    seats: 4,
    mode: 'live',
    privacy: 'public',
    target: 7,
    cube: false,
    blinds: 'low',
    chat: true,
    voice: 'off',
    teams: true,
    status: 'open',
    chairs: WHO.map((who, seat) => ({ seat, who, ready: false, ...(seat === 0 ? { host: true } : {}) })) as TableSummary['chairs'],
    taken: 4,
    mine: 0,
    createdAt: new Date(0).toISOString(),
    ...extra
});

const shown = (held: TableSummary) =>
    renderTest(() => LobbyPanel({ table: held, onInvite: () => undefined, onCopyLink: () => undefined, onLeave: () => undefined }) as Rendered).container;

const chairsOf = (container: HTMLElement) => [...container.querySelectorAll<HTMLElement>('ul > li')].map((chair) => ({
    at: [chair.style.getPropertyValue('--x'), chair.style.getPropertyValue('--y')].map((one) => Number(Number(one).toFixed(2))),
    side: chair.querySelector<HTMLElement>('.lobby-chair')?.dataset.side,
    says: chair.querySelector('.lobby-chair-seat > .sr-only')?.textContent ?? null,
    text: chair.textContent ?? ''
}));

beforeEach(() =>
{
    cleanup();
    resetRuntime();
    setRuntime({ clock: manualClock(600_000), seed: 14 });
    server.reset();
    useLocale().setLocale('en');
    useSession().reset();
    useSession().establish({ id: 'alex', handle: 'alex', displayName: 'Alex Morgan', bio: '', hue: 210, isMinor: false });
});

afterEach(() =>
{
    cleanup();
});

describe('the lobby of a table that is still looking for players', () =>
{
    const chairs = (ready: boolean) =>
        [{ seat: 0, who: 'alex', ready, host: true }, { seat: 1, who: 'sara.k', ready: true }, { seat: 2 }, { seat: 3 }] as TableSummary['chairs'];

    const status = (container: HTMLElement) => container.querySelector('[aria-live="polite"]')?.textContent?.trim();

    it('says it is looking for players, and how many are here, to somebody sitting ready at a public table', () =>
    {
        const container = shown(table({ game: 'ludo', teams: false, chairs: chairs(true), taken: 2 }));

        expect(status(container)).toBe(useLocale().t('play.lobby.looking', { here: '2', seats: '4' }));
    });

    it('counts the empty chairs as it did where nobody is being looked for: by invitation, or before the reader is ready', () =>
    {
        expect(status(shown(table({ game: 'ludo', teams: false, privacy: 'invite', chairs: chairs(true), taken: 2 })))).toBe('2 empty seats');

        cleanup();

        expect(status(shown(table({ game: 'ludo', teams: false, chairs: chairs(false), taken: 2 })))).toBe('2 empty seats');
    });

    it('says it in Persian, in its own digits', () =>
    {
        useLocale().setLocale('fa');

        const said = status(shown(table({ game: 'ludo', teams: false, chairs: chairs(true), taken: 2 })));

        expect(said).toBe(useLocale().t('play.lobby.looking', { here: useLocale().n(2), seats: useLocale().n(4) }));
        expect(said).toContain('۴');
        expect(said).not.toContain('Looking');
    });
});

describe('a chair the host can take somebody out of', () =>
{
    const labelFor = (name: string) => useLocale().t('play.lobby.remove', { name });

    const controls = (container: HTMLElement) =>
        [...container.querySelectorAll<HTMLButtonElement>('ul > li button')].filter((one) => one.querySelector('svg') !== null && one.textContent?.trim() === '');

    const named = (container: HTMLElement) => controls(container).map((one) => one.getAttribute('aria-label'));

    const mixed = (extra: Partial<TableSummary> = {}) => table({
        game: 'ludo',
        teams: false,
        chairs: [{ seat: 0, who: 'alex', ready: true, host: true }, { seat: 1, who: 'sara.k', ready: false }, { seat: 2, invited: 'reza.t', ready: false }, { seat: 3, ready: false }] as TableSummary['chairs'],
        taken: 2,
        ...extra
    });

    const said = () => useToasts().items().map((toast) => [toast.kind, toast.text]);

    const hosted = async () =>
    {
        const lobby = useLobby();
        const id = await lobby.host('ludo', { ...defaultTable('ludo'), privacy: 'public' }, []);
        const held = server.tables.find((one) => one.id === id)!;

        held.chairs[1].who = 'sara.k';
        lobby.open(id);
        void usePeople().want(['sara.k']);
        await vi.waitFor(() => expect(lobby.table()?.taken).toBe(2));
        await vi.waitFor(() => expect(usePeople().byHandle('sara.k')?.displayName).toBe('Sara Kamali'));
        useToasts().reset();
        server.calls = [];

        const { container } = renderTest(() => LobbyPanel({
            get table()
            {
                return lobby.table()!;
            },
            onInvite: () => undefined,
            onCopyLink: () => undefined,
            onLeave: () => undefined
        }) as Rendered);

        return { container, lobby, id, held };
    };

    const answered = async (yes: boolean) =>
    {
        await vi.waitFor(() => expect(useOverlay().top()).not.toBeNull());

        const sheet = useOverlay().top()!;

        useOverlay().close(sheet.id, yes);

        return sheet;
    };

    beforeEach(() =>
    {
        usePeople().reset();
        useLobby().reset();
        useToasts().reset();
        useOverlay().reset();
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
    });

    afterEach(() =>
    {
        cleanup();
        vi.restoreAllMocks();
        useOverlay().reset();
        useToasts().reset();
        useLobby().reset();
        usePeople().reset();
    });

    it('is offered to a host who is sitting, on every other chair somebody is in and on no other', () =>
    {
        expect(named(shown(mixed()))).toEqual([labelFor('sara.k')]);
        expect(labelFor('sara.k')).toBe('Take sara.k out of the table');

        cleanup();

        expect(named(shown(table())), 'the chairs are not in the order of their seats').toEqual(['sara.k', 'reza.t', 'parisa'].map(labelFor));
    });

    it('is offered to nobody at a table quick play opened, its host included, because nobody chose who sits there', () =>
    {
        expect(named(shown(mixed({ quick: true })))).toEqual([]);

        cleanup();

        expect(named(shown(mixed({ quick: false }))), 'a table the host opened lost its control').toEqual([labelFor('sara.k')]);
    });

    it('is offered to nobody else: a player who is not the host, a host with no chair, somebody only looking', () =>
    {
        const others = [{ seat: 0, who: 'sara.k', ready: true, host: true }, { seat: 1, who: 'reza.t', ready: false }, { seat: 2, ready: false }, { seat: 3, ready: false }] as TableSummary['chairs'];
        const guest = mixed({ host: 'sara.k', chairs: [others[0], others[1], { seat: 2, who: 'alex', ready: false }, others[3]] as TableSummary['chairs'], mine: 2, taken: 3 });
        const { mine: _mine, ...looking } = mixed({ host: 'sara.k', chairs: others });
        const { mine: _own, ...stoodUp } = mixed({ host: 'alex', chairs: [{ seat: 0, ready: false }, { seat: 1, who: 'sara.k', ready: false }, { seat: 2, ready: false }, { seat: 3, ready: false }] as TableSummary['chairs'], taken: 1 });

        expect(named(shown(guest))).toEqual([]);

        cleanup();

        expect(named(shown(looking as TableSummary))).toEqual([]);

        cleanup();

        expect(named(shown(stoodUp as TableSummary))).toEqual([]);
    });

    it('names them in Persian on the same control', () =>
    {
        useLocale().setLocale('fa');

        const labels = named(shown(mixed()));

        expect(labels).toEqual([labelFor('sara.k')]);
        expect(labels[0]).toContain('sara.k');
        expect(labels[0]).not.toContain('Take');
    });

    it('asks first, in words that say what it costs, and sends nothing until the answer is yes', async () =>
    {
        const { container, held } = await hosted();

        fire(controls(container)[0], 'click');

        const sheet = await answered(false);

        expect(sheet.label).toBe(useLocale().t('play.remove.title', { name: 'Sara Kamali' }));
        expect(sheet.props).toMatchObject({
            title: 'Take Sara Kamali out of the table?',
            lead: useLocale().t('play.remove.lead'),
            confirm: useLocale().t('play.remove.confirm'),
            destructive: true
        });

        await settle();

        expect(server.calls).not.toContain('tables.remove');
        expect(held.chairs[1].who).toBe('sara.k');
        expect(said()).toEqual([]);
    });

    it('sends one request naming them once the answer is yes, and shows the chair empty with no control on it', async () =>
    {
        const { container, held, id } = await hosted();

        fire(controls(container)[0], 'click');
        await answered(true);

        await vi.waitFor(() => expect(controls(container)).toEqual([]), { timeout: 4000 });

        expect(server.calls.filter((call) => call === 'tables.remove')).toHaveLength(1);
        expect(held.chairs[1].who).toBeUndefined();
        expect(server.keptOut[id]).toEqual(['sara.k']);

        const chair = container.querySelectorAll('ul > li')[1];

        expect(chair.querySelector('.lobby-chair')?.getAttribute('data-leaving'), 'the person was gone from the chair at once, with nothing seen to leave').toBe('true');
        expect(chair.querySelector('.lobby-chair-name')?.textContent).toBe('Sara');
        expect(chair.querySelector('.lobby-chair-seat')?.hasAttribute('inert'), 'somebody leaving the table could still be pressed').toBe(true);

        (runtime().clock as ManualClock).advance(CHAIR_OUT);
        await settle();

        expect(chair.querySelector('.lobby-chair')?.hasAttribute('data-leaving')).toBe(false);
        expect(chair.textContent).toContain(useLocale().t('play.lobby.open'));
        expect(container.querySelectorAll('ul > li')[1], 'the chair was drawn again for the person leaving it').toBe(chair);
        expect(said()).toEqual([]);
    });

    it.each(['en', 'fa'] as const)('says a game has just started when that is why it was refused, in %s, and reads the table again', async (language) =>
    {
        useLocale().setLocale(language);

        const { container, held } = await hosted();

        held.matchId = 'live-1';
        fire(controls(container)[0], 'click');
        await answered(true);

        await vi.waitFor(() => expect(said()).toEqual([['warning', useLocale().t('play.remove.started')]]), { timeout: 4000 });
        await vi.waitFor(() => expect(server.calls.filter((call) => call === 'tables.view').length).toBeGreaterThan(0), { timeout: 4000 });

        expect(held.chairs[1].who).toBe('sara.k');
        expect(useLocale().t('play.remove.started')).not.toBe(useLocale().t('common.actionFailed'));
    });

    it('says only that it did not go through when they had already gone, or the request never arrived, and reads the table again', async () =>
    {
        const { container, held } = await hosted();
        const tables = client.tables as unknown as Record<string, unknown>;
        const real = tables.remove;

        delete held.chairs[1].who;
        fire(controls(container)[0], 'click');
        await answered(true);

        await vi.waitFor(() => expect(said()).toEqual([['warning', useLocale().t('common.actionFailed')]]), { timeout: 4000 });
        await vi.waitFor(() => expect(controls(container)).toEqual([]), { timeout: 4000 });

        held.chairs[1].who = 'sara.k';
        await useLobby().refresh();
        await vi.waitFor(() => expect(controls(container)).toHaveLength(1), { timeout: 4000 });
        useToasts().reset();

        tables.remove = async () =>
        {
            throw new TypeError('Failed to fetch');
        };

        try
        {
            fire(controls(container)[0], 'click');
            await answered(true);

            await vi.waitFor(() => expect(said()).toEqual([['warning', useLocale().t('common.actionFailed')]]), { timeout: 4000 });
        }
        finally
        {
            tables.remove = real;
        }

        expect(held.chairs[1].who).toBe('sara.k');
    });

    it('keeps the control it drew when the table is read again, and names whoever sits there now', () =>
    {
        const [held, setHeld] = createSignal(mixed());
        const { container } = renderTest(() => LobbyPanel({
            get table()
            {
                return held();
            },
            onInvite: () => undefined,
            onCopyLink: () => undefined,
            onLeave: () => undefined
        }) as Rendered);
        const [control] = controls(container);
        const chair = container.querySelectorAll<HTMLElement>('ul > li')[1];
        const inside = [...chair.querySelectorAll<HTMLElement>('*')];

        expect(control).toBeDefined();

        setHeld(mixed());

        expect(controls(container), 'the control was drawn again for the answer it already had').toEqual([control]);
        expect(inside.filter((one) => !chair.contains(one)).map((one) => `<${ one.tagName.toLowerCase() }>`), 'the chair was drawn again').toEqual([]);

        setHeld(mixed({ chairs: [{ seat: 0, who: 'alex', ready: true, host: true }, { seat: 1, who: 'parisa', ready: true }, { seat: 2, invited: 'reza.t', ready: false }, { seat: 3, ready: false }] as TableSummary['chairs'] }));

        expect(controls(container), 'the control was drawn again to change whom it names').toEqual([control]);
        expect(control.getAttribute('aria-label')).toBe(labelFor('parisa'));

        setHeld(mixed({ chairs: [{ seat: 0, who: 'alex', ready: true, host: true }, { seat: 1, ready: false }, { seat: 2, invited: 'reza.t', ready: false }, { seat: 3, ready: false }] as TableSummary['chairs'], taken: 1 }));

        expect(controls(container)).toEqual([]);
    });
});

describe('the lobby of a table two sides will play at', () =>
{
    it('seats partners across the table from each other, the reader at its foot, and says whose side each chair is on', () =>
    {
        const found = chairsOf(shown(table()));

        expect(found.map((one) => one.at), 'a chair is not where it will be at the table').toEqual([[0.5, 1], [1, 0.5], [0.5, 0], [0, 0.5]]);
        expect(found.map((one) => one.side)).toEqual(['0', '1', '0', '1']);
        expect(found.map((one) => one.says)).toEqual(['Your team', 'Team 2', 'Your team', 'Team 2']);
        expect(found[2].text).toContain('reza.t');
    });

    it('turns the table for whoever reads it, and names their side theirs', () =>
    {
        const found = chairsOf(shown(table({ mine: 3 })));

        expect(found[3].at).toEqual([0.5, 1]);
        expect(found[0].at, 'the next to play is not on the reader\'s right').toEqual([1, 0.5]);
        expect(found.map((one) => one.says)).toEqual(['Team 1', 'Your team', 'Team 1', 'Your team']);
    });

    it('numbers both sides for somebody who is not sitting, and draws the table from its first chair', () =>
    {
        const { mine: _mine, ...unseated } = table();
        const found = chairsOf(shown(unseated as TableSummary));

        expect(found.map((one) => one.says)).toEqual(['Team 1', 'Team 2', 'Team 1', 'Team 2']);
        expect(found[0].at).toEqual([0.5, 1]);
    });

    it('names the sides in Persian', () =>
    {
        useLocale().setLocale('fa');

        const found = chairsOf(shown(table()));

        expect(found.map((one) => one.says)).toEqual([useLocale().t('team.yours'), useLocale().t('team.n', { n: useLocale().n(2) }), useLocale().t('team.yours'), useLocale().t('team.n', { n: useLocale().n(2) })]);
        expect(found[0].says).not.toBe('Your team');
    });

    it('keeps every chair it has drawn when the table is read again, and shows who sat down in one', () =>
    {
        const chairs = (taken: number) =>
            WHO.map((who, seat) => (seat < taken ? { seat, who, ready: false, ...(seat === 0 ? { host: true } : {}) } : { seat })) as TableSummary['chairs'];
        const [held, setHeld] = createSignal(table({ chairs: chairs(2), taken: 2 }));
        const { container } = renderTest(() => LobbyPanel({
            get table()
            {
                return held();
            },
            onInvite: () => undefined,
            onCopyLink: () => undefined,
            onLeave: () => undefined
        }) as Rendered);
        const drawn = () => [...container.querySelectorAll<HTMLElement>('ul > li')];
        const list = container.querySelector('ul');
        const before = drawn();

        expect(chairsOf(container)[2].text).not.toContain('reza.t');

        setHeld(table({ chairs: chairs(3), taken: 3 }));

        expect(chairsOf(container)[2].text).toContain('reza.t');
        expect(drawn()).toHaveLength(4);
        expect(container.querySelector('ul'), 'the chairs were drawn again').toBe(list);

        for (const [at, chair] of drawn().entries())
        {
            expect(chair, `chair ${ at } was drawn again`).toBe(before[at]);
        }
    });

    it('keeps what a chair holds when the table is read again, and turns its tag where it is', () =>
    {
        const chairs = (ready: boolean) =>
            WHO.map((who, seat) => ({ seat, who, ready: ready && seat === 0, ...(seat === 0 ? { host: true } : {}) })) as TableSummary['chairs'];
        const [held, setHeld] = createSignal(table({ chairs: chairs(false) }));
        const { container } = renderTest(() => LobbyPanel({
            get table()
            {
                return held();
            },
            onInvite: () => undefined,
            onCopyLink: () => undefined,
            onLeave: () => undefined
        }) as Rendered);
        const chair = container.querySelector<HTMLElement>('ul > li')!;
        const inside = [...chair.querySelectorAll<HTMLElement>('*')];
        const tag = inside.find((one) => one.childElementCount === 0 && one.textContent?.trim() === useLocale().t('play.lobby.notReady'));

        expect(tag, 'the chair says its player is not ready').toBeDefined();
        expect(chair.querySelector('.lobby-chair-host')?.getAttribute('aria-label'), 'the host is not marked on their chair').toBe(useLocale().t('play.lobby.host'));

        setHeld(table({ chairs: chairs(false) }));

        expect(inside.filter((one) => !chair.contains(one)).map((one) => `<${ one.tagName.toLowerCase() }> ${ one.textContent?.trim() ?? '' }`), 'drawn again for the answer it already had').toEqual([]);

        setHeld(table({ chairs: chairs(true) }));

        expect(chair.contains(tag!), 'the tag was drawn again to change what it says').toBe(true);
        expect(tag!.textContent?.trim()).toBe(useLocale().t('play.lobby.readyTag'));
    });

    it('says no side for a chair at a table where every seat plays for itself, and puts each at its colour\'s corner', () =>
    {
        const container = shown(table({ game: 'ludo', teams: false }));
        const found = chairsOf(container);

        expect(container.querySelectorAll('ul')).toHaveLength(1);
        expect(container.querySelector('ul')?.getAttribute('aria-label')).toBe(useLocale().t('create.seats'));
        expect(found.map((one) => [one.side, one.says])).toEqual([[undefined, null], [undefined, null], [undefined, null], [undefined, null]]);
        expect(found.map((one) => one.at)).toEqual([[0, 0], [1, 0], [1, 1], [0, 1]]);
    });
});

describe('the button that says ready', () =>
{
    const routes = client.tables as unknown as Record<string, (input: unknown) => Promise<unknown>>;

    const said = () => useToasts().items().map((toast) => [toast.kind, toast.text]);

    const seated = async () =>
    {
        const lobby = useLobby();
        const id = await lobby.host('ludo', { ...defaultTable('ludo'), seats: 2, privacy: 'invite' }, []);
        const held = server.tables.find((one) => one.id === id)!;

        held.chairs[1].who = 'sara.k';
        lobby.open(id);
        await vi.waitFor(() => expect(lobby.table()?.taken).toBe(2));
        useToasts().reset();

        const { container } = renderTest(() => LobbyPanel({
            get table()
            {
                return lobby.table()!;
            },
            onInvite: () => undefined,
            onCopyLink: () => undefined,
            onLeave: () => undefined
        }) as Rendered);

        return { container, lobby, id, held };
    };

    const button = (container: HTMLElement) =>
    {
        const words = [useLocale().t('play.lobby.ready'), useLocale().t('play.lobby.readyTag')];

        return [...container.querySelectorAll<HTMLButtonElement>('section > div:last-child button')].find((one) => words.includes(one.textContent?.trim() ?? ''))!;
    };

    const chair = (container: HTMLElement) => container.querySelector('ul > li')?.textContent ?? '';

    const answering = async (answer: (input: unknown, real: (input: unknown) => Promise<unknown>) => Promise<unknown>, run: () => Promise<void>) =>
    {
        const real = routes.ready;

        routes.ready = (input) => answer(input, real);

        try
        {
            await run();
        }
        finally
        {
            routes.ready = real;
        }
    };

    beforeEach(() =>
    {
        usePeople().reset();
        useLobby().reset();
        useToasts().reset();
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
    });

    afterEach(() =>
    {
        cleanup();
        vi.restoreAllMocks();
        useToasts().reset();
        useLobby().reset();
        usePeople().reset();
    });

    it('says so on itself and on the chair before the server has answered, and is the button it was', async () =>
    {
        const { container, held } = await seated();
        const pressed = button(container);
        let answer: () => void = () => undefined;

        expect(pressed.textContent?.trim()).toBe('I’m ready');
        expect(chair(container)).toContain('Not ready');

        await answering(async (input, real) =>
        {
            await new Promise<void>((resolve) =>
            {
                answer = resolve;
            });

            return await real(input);
        }, async () =>
        {
            fire(pressed, 'click');
            await settle();

            expect(held.chairs[0].ready).toBe(false);
            expect(button(container)).toBe(pressed);
            expect(pressed.textContent?.trim()).toBe('Ready');
            expect(pressed.getAttribute('aria-busy')).not.toBe('true');
            expect(chair(container)).toContain('Ready');
            expect(chair(container)).not.toContain('Not ready');

            answer();
            await vi.waitFor(() => expect(held.chairs[0].ready).toBe(true));
            await settle();

            expect(button(container)).toBe(pressed);
            expect(pressed.textContent?.trim()).toBe('Ready');
            expect(said()).toEqual([]);
        });
    });

    it('goes back and says why when the server refuses, in the reader\'s own language', async () =>
    {
        for (const [language, ready, why] of [['en', 'I’m ready', 'That table has closed.'], ['fa', 'آماده‌م', 'اون میز بسته شده.']] as const)
        {
            cleanup();
            useLobby().reset();
            useToasts().reset();
            server.reset();
            useLocale().setLocale(language);

            const { container } = await seated();
            const pressed = button(container);

            await answering(async () =>
            {
                throw new ApiError(409, 'table-closed', 'That table has closed.', undefined);
            }, async () =>
            {
                fire(pressed, 'click');
                await vi.waitFor(() => expect(said()).toEqual([['warning', why]]));

                expect(button(container)).toBe(pressed);
                expect(pressed.textContent?.trim()).toBe(ready);
            });
        }
    });

    it('says the generic sentence for a request that never arrived', async () =>
    {
        const { container } = await seated();
        const pressed = button(container);

        await answering(async () =>
        {
            throw new TypeError('Failed to fetch');
        }, async () =>
        {
            fire(pressed, 'click');
            await vi.waitFor(() => expect(said()).toEqual([['warning', 'That did not go through. Try again.']]));

            expect(pressed.textContent?.trim()).toBe('I’m ready');
        });
    });
});

describe('the lobby as the table about to be played', () =>
{
    const room = (container: HTMLElement) => container.querySelector<HTMLElement>('.lobby-table');

    const top = (container: HTMLElement) => container.querySelector<HTMLElement>('.lobby-top');

    const pressed = (container: HTMLElement) => [...container.querySelectorAll<HTMLButtonElement>('.lobby-acts button')].map((one) => one.textContent?.trim() ?? '');

    const button = (container: HTMLElement, text: string) => [...container.querySelectorAll<HTMLButtonElement>('button')].find((one) => one.textContent?.trim() === text);

    const status = (container: HTMLElement) => container.querySelector('.lobby [aria-live="polite"]')?.textContent?.trim();

    const drawn = (extra: Partial<Parameters<typeof LobbyPanel>[0]>, held: TableSummary = table()) =>
        renderTest(() => LobbyPanel({ table: held, onInvite: () => undefined, onCopyLink: () => undefined, onLeave: () => undefined, ...extra }) as Rendered).container;

    const ready = () => table({ status: 'ready', chairs: WHO.map((who, seat) => ({ seat, who, ready: true, ...(seat === 0 ? { host: true } : {}) })) as TableSummary['chairs'] });

    afterEach(() =>
    {
        vi.restoreAllMocks();
        useOverlay().reset();
        usePeople().reset();
    });

    it('is drawn in the art of the game that is about to be played', () =>
    {
        const hokm = shown(table());

        expect([room(hokm)?.dataset.game, top(hokm)?.classList.contains('hokm-table')]).toEqual(['hokm', true]);

        cleanup();

        const poker = shown(table({ game: 'poker', seats: 6, teams: false, chairs: [{ seat: 0, who: 'alex', ready: false, host: true }, ...[1, 2, 3, 4, 5].map((seat) => ({ seat, ready: false }))] as TableSummary['chairs'], taken: 1 }));

        expect(top(poker)?.classList.contains('poker-table')).toBe(true);

        cleanup();

        const ludo = shown(table({ game: 'ludo', teams: false }));

        expect(top(ludo)?.querySelector('span.lobby-board'), 'a Ludo table with no board on it').not.toBeNull();

        cleanup();

        const backgammon = shown(table({ game: 'backgammon', seats: 2, teams: false, chairs: [{ seat: 0, who: 'alex', ready: false, host: true }, { seat: 1, ready: false }] as TableSummary['chairs'], taken: 1 }));
        const board = top(backgammon)?.querySelector('svg.lobby-board');

        expect(board?.querySelectorAll('polygon').length, 'a backgammon board without its twenty-four points').toBe(24);
        expect(top(backgammon)?.getAttribute('aria-hidden'), 'a picture of a table was read out').toBe('true');
    });

    it('crowds a table of more than six chairs, and no other', () =>
    {
        const many = (seats: number) => table({ game: 'poker', seats, teams: false, chairs: Array.from({ length: seats }, (_, seat) => (seat === 0 ? { seat, who: 'alex', ready: false, host: true } : { seat, ready: false })) as TableSummary['chairs'], taken: 1 });

        expect(room(shown(many(9)))?.dataset.crowd).toBe('true');

        cleanup();

        expect(room(shown(many(6)))?.hasAttribute('data-crowd')).toBe(false);
    });

    it('offers the start where the table can start, says so, and still lets the reader take their ready back', () =>
    {
        const started = vi.fn();
        const container = drawn({ onStart: started }, ready());

        expect(status(container)).toBe(useLocale().t('match.startHint'));
        expect(pressed(container).slice(0, 2)).toEqual([useLocale().t('match.start'), useLocale().t('play.lobby.readyTag')]);

        fire(button(container, useLocale().t('match.start'))!, 'click');

        expect(started).toHaveBeenCalledTimes(1);

        cleanup();

        expect(pressed(drawn({}, ready())), 'a table nobody may start offered its start').not.toContain(useLocale().t('match.start'));
    });

    it('says a game the staff paused where it would say go, and offers no start', () =>
    {
        const container = drawn({ paused: true }, ready());

        expect(status(container)).toBe('This game is paused for now. A game can start here again once it is back.');
        expect(pressed(container)).not.toContain(useLocale().t('match.start'));
        expect(pressed(container)).toContain(useLocale().t('play.lobby.readyTag'));
        expect(container.querySelector('.lobby [aria-live="polite"] .live-dot'), 'a paused game wore the dot of a table about to start').toBeNull();
        expect(container.querySelector('.lobby [aria-live="polite"] svg')).not.toBeNull();

        cleanup();

        expect(drawn({}, ready()).querySelector('.lobby [aria-live="polite"] .live-dot')).not.toBeNull();

        cleanup();
        useLocale().setLocale('fa');

        expect(status(drawn({ paused: true }, ready()))).toBe('این بازی فعلاً متوقفه. وقتی برگرده، دوباره می‌شه این‌جا شروعش کرد.');
        useLocale().setLocale('en');
    });

    it('shows somebody standing the table as it stands, says they are only looking, and offers a seat while there is one', () =>
    {
        const sat = vi.fn();
        const three = WHO.map((who, seat) => (seat < 3 ? { seat, who, ready: false, ...(seat === 0 ? { host: true } : {}) } : { seat, ready: false })) as TableSummary['chairs'];
        const { mine: _mine, ...standing } = table({ chairs: three, taken: 3 });
        const container = drawn({ onSit: sat }, standing as TableSummary);

        expect(status(container)).toBe(useLocale().t('play.table.watching'));
        expect(container.textContent).toContain(useLocale().plural('play.lobby.emptySeats', 1));
        expect(pressed(container)).toEqual([useLocale().t('play.table.sitDown'), useLocale().t('play.lobby.copyLink')]);
        expect(container.querySelectorAll('ul > li'), 'somebody standing is not shown who sits there').toHaveLength(4);

        fire(button(container, useLocale().t('play.table.sitDown'))!, 'click');

        expect(sat).toHaveBeenCalledTimes(1);

        cleanup();

        const { mine: _also, ...full } = table();

        expect(button(drawn({ onSit: sat }, full as TableSummary), useLocale().t('play.table.sitDown'))?.disabled, 'a full table offered a seat').toBe(true);

        cleanup();

        const removed = drawn({ removed: true }, standing as TableSummary);

        expect(status(removed)).toBe(useLocale().t('play.table.removed'));
        expect(button(removed, useLocale().t('play.table.sitDown')), 'a seat was offered to somebody who would be refused it').toBeUndefined();
    });

    it('offers the host the closing of the table, and nobody else', () =>
    {
        const closed = vi.fn();
        const container = drawn({ onClose: closed });

        fire(button(container, useLocale().t('play.close.confirm'))!, 'click');

        expect(closed).toHaveBeenCalledTimes(1);

        cleanup();

        expect(button(drawn({}), useLocale().t('play.close.confirm'))).toBeUndefined();
    });

    it('puts the closing of the table last, under a line, as wide as the buttons above it and in red words with no red block', () =>
    {
        const container = drawn({ onClose: vi.fn() });
        const close = button(container, useLocale().t('play.close.confirm'))!;
        const row = close.closest<HTMLElement>('[data-close]')!;
        const classes = close.className.split(' ');

        expect(container.querySelector('.lobby-acts')?.lastElementChild).toBe(row);
        expect(row.className.split(' ')).toEqual(expect.arrayContaining(['border-t', 'border-line']));
        expect(classes).toEqual(expect.arrayContaining(['w-full', 'text-danger']));
        expect(classes.filter((one) => one.startsWith('bg-'))).toEqual([]);
    });

    it('keeps the board a waiting Ludo table is drawn with when the table is read again', () =>
    {
        const [held, setHeld] = createSignal(table({ game: 'ludo', seats: 4 }));
        const { container } = renderTest(() => LobbyPanel({
            get table()
            {
                return held();
            },
            onInvite: () => undefined,
            onCopyLink: () => undefined,
            onLeave: () => undefined
        }) as Rendered);
        const board = container.querySelector('.lobby-board');

        expect(board).not.toBeNull();

        setHeld(table({ game: 'ludo', seats: 4 }));

        expect(container.querySelector('.lobby-board'), 'the board was drawn again for an answer that changed nothing').toBe(board);
    });

    it('keeps the host’s Close the table when the table is read again and says the same', () =>
    {
        const [held, setHeld] = createSignal(table());
        const { container } = renderTest(() => LobbyPanel({
            get table()
            {
                return held();
            },
            get onClose()
            {
                held();

                return () => undefined;
            },
            onInvite: () => undefined,
            onCopyLink: () => undefined,
            onLeave: () => undefined
        }) as Rendered);
        const close = button(container, useLocale().t('play.close.confirm'));

        expect(close).toBeDefined();

        setHeld(table());

        expect(button(container, useLocale().t('play.close.confirm')), 'Close the table was drawn again for an answer that changed nothing').toBe(close);
    });

    it('opens what can be done about a person from their chair, and offers nothing of the kind about the reader', async () =>
    {
        const container = shown(table());
        const presses = [...container.querySelectorAll<HTMLButtonElement>('.lobby-chair-press')];

        expect(presses.map((one) => one.getAttribute('aria-label'))).toEqual(['sara.k', 'reza.t', 'parisa'].map((name) => useLocale().t('actions.about', { name })));
        expect(presses.every((one) => one.getAttribute('aria-haspopup') === 'dialog' && !one.hasAttribute('tabindex')), 'a chair is not a stop for the keyboard').toBe(true);

        fire(presses[0], 'click');

        await vi.waitFor(() => expect(useOverlay().top()?.id).toBe('person-menu'), { timeout: 4000 });
        expect(useOverlay().top()?.props).toMatchObject({ personId: 'sara.k' });
    });

    it('turns the ready tick on a chair where it stands', () =>
    {
        const [held, setHeld] = createSignal(table());
        const { container } = renderTest(() => LobbyPanel({
            get table()
            {
                return held();
            },
            onInvite: () => undefined,
            onCopyLink: () => undefined,
            onLeave: () => undefined
        }) as Rendered);
        const tick = container.querySelector<HTMLElement>('ul > li .lobby-chair-tick')!;

        expect(tick.hasAttribute('data-on')).toBe(false);

        setHeld(table({ chairs: WHO.map((who, seat) => ({ seat, who, ready: seat === 0, ...(seat === 0 ? { host: true } : {}) })) as TableSummary['chairs'] }));

        expect(container.querySelector('ul > li .lobby-chair-tick'), 'the tick was drawn again to say ready').toBe(tick);
        expect(tick.getAttribute('data-on')).toBe('true');
    });

    it('empties a chair at once when less motion is asked for', () =>
    {
        vi.spyOn(useDevice(), 'reducedMotion').mockReturnValue(true);

        const [held, setHeld] = createSignal(table());
        const { container } = renderTest(() => LobbyPanel({
            get table()
            {
                return held();
            },
            onInvite: () => undefined,
            onCopyLink: () => undefined,
            onLeave: () => undefined
        }) as Rendered);

        setHeld(table({ chairs: WHO.map((who, seat) => (seat === 1 ? { seat, ready: false } : { seat, who, ready: false, ...(seat === 0 ? { host: true } : {}) })) as TableSummary['chairs'], taken: 3 }));

        const chair = container.querySelectorAll('ul > li')[1];

        expect(chair.querySelector('.lobby-chair')?.hasAttribute('data-leaving'), 'a person lingered in a chair with less motion asked for').toBe(false);
        expect(chair.textContent).not.toContain('sara.k');
    });

    it('names a person in their chair by their first name, and in full wherever they are acted on', async () =>
    {
        void usePeople().want(['sara.k']);
        await vi.waitFor(() => expect(usePeople().byHandle('sara.k')?.displayName).toBe('Sara Kamali'));

        const container = shown(table());
        const chair = container.querySelectorAll('ul > li')[1];

        expect(chair.querySelector('.lobby-chair-name')?.textContent).toBe('Sara');
        expect(chair.querySelector('.lobby-chair-press')?.getAttribute('aria-label')).toBe(useLocale().t('actions.about', { name: 'Sara Kamali' }));
        expect(chair.querySelector('.lobby-chair-out button')?.getAttribute('aria-label')).toBe(useLocale().t('play.lobby.remove', { name: 'Sara Kamali' }));
        expect(container.querySelectorAll('ul > li')[0].querySelector('.lobby-chair-name')?.textContent).toBe(useLocale().t('common.you'));
    });
});

describe('the lobby of a table where a game has ended', () =>
{
    interface Asked
    {
        params: { id: string };
    }

    const matches = client.matches as unknown as { view?: (asked: Asked) => Promise<MatchView> };

    const ended = (winner: number, id = 'match-last') => ({
        id,
        tableId: 'table-teams',
        game: 'ludo',
        rev: 31,
        seats: 2,
        players: [0, 1].map((seat) => ({ seat, who: WHO[seat], timeouts: 0, result: seat === winner ? 'won' : 'lost' })),
        mine: 0,
        outcome: 'won',
        startedAt: new Date(0).toISOString(),
        finishedAt: new Date(60_000).toISOString(),
        view: {
            kind: 'ludo',
            moves: [],
            controls: 0,
            seats: ['red', 'yellow'].map((colour, seat) => ({ seat, colour, tokens: [0, 1, 2, 3].map((piece) => ({ piece, at: seat === winner ? 57 : -1 })), home: seat === winner ? 4 : 0, out: false, side: seat }))
        }
    }) as MatchView;

    const reads = (answer: (asked: Asked) => MatchView) =>
    {
        const read = vi.fn(async (asked: Asked) => answer(asked));

        matches.view = read;

        return read;
    };

    const asked = (read: ReturnType<typeof reads>) => read.mock.calls.map(([one]) => one.params.id);

    const two = (extra: Partial<TableSummary> = {}) => table({
        game: 'ludo',
        seats: 2,
        teams: false,
        chairs: [{ seat: 0, who: 'alex', ready: false, host: true }, { seat: 1, who: 'sara.k', ready: false }] as TableSummary['chairs'],
        taken: 2,
        ...extra
    });

    const held = (first: TableSummary) =>
    {
        const [current, setCurrent] = createSignal(first);
        const { container } = renderTest(() => LobbyPanel({
            get table()
            {
                return current();
            },
            onInvite: () => undefined,
            onCopyLink: () => undefined,
            onLeave: () => undefined
        }) as Rendered);

        return { container, setCurrent };
    };

    const said = (container: HTMLElement) => container.querySelector<HTMLElement>('[data-last-game]');

    const landed = async () =>
    {
        await settle();
        await new Promise((resolve) => setTimeout(resolve, 20));
        await settle();
    };

    afterEach(() =>
    {
        delete matches.view;
        vi.restoreAllMocks();
    });

    it('says how the last game there ended, under everything a waiting room is for', async () =>
    {
        const read = reads(() => ended(1));
        const container = shown(two({ lastMatchId: 'match-last' }));

        await landed();

        expect(asked(read)).toEqual(['match-last']);
        expect(said(container)?.querySelector('p')?.textContent).toBe('The last game here');
        expect(said(container)?.querySelector('[aria-live="polite"]')?.textContent).toBe(`${ usePeople().byHandle('sara.k')?.displayName ?? 'sara.k' } won.`);
        expect(said(container)?.querySelector('button'), 'a game that is over offers to be played again from the past').toBeNull();
        expect(container.querySelector('section')?.lastElementChild, 'it stands above something a waiting room is for').toBe(said(container));
    });

    it('says it as the reader\'s own when they won it', async () =>
    {
        reads(() => ended(0));

        const container = shown(two({ lastMatchId: 'match-last' }));

        await landed();

        expect(said(container)?.querySelector('[aria-live="polite"]')?.textContent).toBe('You won.');
    });

    it('asks for it once, however often the table is looked at again, and again when another game has ended', async () =>
    {
        const read = reads((one) => ended(1, one.params.id));
        const { container, setCurrent } = held(two({ lastMatchId: 'match-last' }));

        await landed();

        const first = said(container);

        expect(first).not.toBeNull();

        setCurrent(two({ lastMatchId: 'match-last', chairs: [{ seat: 0, who: 'alex', ready: true, host: true }, { seat: 1, who: 'sara.k', ready: false }] as TableSummary['chairs'] }));
        await landed();

        expect(read).toHaveBeenCalledTimes(1);
        expect(said(container), 'the result was drawn again for a chair that changed').toBe(first);

        setCurrent(two({ lastMatchId: 'match-newer' }));
        await landed();

        expect(asked(read)).toEqual(['match-last', 'match-newer']);
        expect(said(container), 'the game that ended since is not told of').not.toBeNull();
    });

    it('tells of no game but the one the table names: not the one before, while the one that ended since is still being read', async () =>
    {
        let answer: (match: MatchView) => void = () => undefined;

        matches.view = async (one) => (one.params.id === 'match-last'
            ? ended(1)
            : await new Promise<MatchView>((resolve) =>
            {
                answer = resolve;
            }));

        const { container, setCurrent } = held(two({ lastMatchId: 'match-last' }));

        await landed();

        expect(said(container)?.querySelector('[aria-live="polite"]')?.textContent).toBe(`${ usePeople().byHandle('sara.k')?.displayName ?? 'sara.k' } won.`);

        setCurrent(two({ id: 'table-other', code: 'other1', lastMatchId: 'match-newer' }));
        await landed();

        expect(said(container), 'another table was told of the game that ended at the one before').toBeNull();

        answer(ended(0, 'match-newer'));
        await landed();

        expect(said(container)?.querySelector('[aria-live="polite"]')?.textContent).toBe('You won.');
    });

    it('has nothing to say, and asks for nothing, at a table where no game the reader played in has ended', async () =>
    {
        const read = reads(() => ended(1));
        const container = shown(two());

        await landed();

        expect(read).not.toHaveBeenCalled();
        expect(said(container)).toBeNull();
    });

    it('says nothing of one table\'s game at another table, when the room is shown a table where none has ended', async () =>
    {
        reads(() => ended(1));

        const { container, setCurrent } = held(two({ lastMatchId: 'match-last' }));

        await landed();

        expect(said(container)).not.toBeNull();

        setCurrent(two({ id: 'table-other', code: 'other1' }));
        await landed();

        expect(said(container), 'the game that ended at the table before is told of at this one').toBeNull();
    });

    it('leaves the room as it is when the game cannot be read: it is a courtesy, and the room does not fail with it', async () =>
    {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);

        const read = reads(() =>
        {
            throw new ApiError(404, 'not-found', 'No game there.', undefined);
        });
        const container = shown(two({ lastMatchId: 'match-last' }));

        await landed();

        expect(read).toHaveBeenCalledTimes(1);
        expect(said(container)).toBeNull();
        expect(container.querySelector('[aria-live="polite"]')?.textContent?.trim()).not.toBe('');
        expect([...container.querySelectorAll('button')].map((one) => one.textContent?.trim())).toContain(useLocale().t('play.lobby.ready'));
    });

    it('names it in Persian', async () =>
    {
        reads(() => ended(1));
        useLocale().setLocale('fa');

        const container = shown(two({ lastMatchId: 'match-last' }));

        await landed();

        expect(said(container)?.querySelector('p')?.textContent).toBe('آخرین بازی این میز');
        useLocale().setLocale('en');
    });
});
