import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, fire, renderTest } from '@azerothjs/testing';
import { createSignal } from 'azerothjs';

import LobbyPanel from '../src/components/games/lobby-panel.component.azeroth';
import { defaultTable } from '../src/data/tables.ts';
import { manualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import '../src/locales/app-catalogue.ts';
import { useLobby } from '../src/stores/lobby.store.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { useOverlay } from '../src/stores/overlay.store.ts';
import { usePeople } from '../src/stores/people.store.ts';
import { useSession } from '../src/stores/session.store.ts';
import { useToasts } from '../src/stores/toasts.store.ts';
import type { TableSummary } from '../src/api.ts';
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

const sides = (container: HTMLElement) => [...container.querySelectorAll<HTMLElement>('ul')].map((list) => ({
    says: list.getAttribute('aria-label'),
    seats: [...list.querySelectorAll(':scope > li')].map((chair) => chair.textContent ?? '')
}));

beforeEach(() =>
{
    cleanup();
    resetRuntime();
    setRuntime({ clock: manualClock(600_000), seed: 14 });
    server.reset();
    useLocale().setLocale('en');
    useSession().reset();
    useSession().establish({ id: 'alex', handle: 'alex', displayName: 'Alex Morgan', bio: '', hue: 210, kind: 'guest', isMinor: false });
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
        usePeople().want(['sara.k']);
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

        expect(named(shown(table()))).toEqual(['reza.t', 'sara.k', 'parisa'].map(labelFor));
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
        expect(container.querySelectorAll('ul > li')[1].textContent).toContain(useLocale().t('play.lobby.open'));
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
    it('seats partners together under their side, and calls the reader\'s own theirs', () =>
    {
        const found = sides(shown(table()));

        expect(found.map((one) => one.says)).toEqual(['Your team', 'Team 2']);
        expect(found.map((one) => one.seats.length)).toEqual([2, 2]);
        expect(found[0].seats[1]).toContain('reza.t');
        expect(found[1].seats[0]).toContain('sara.k');
        expect(found[1].seats[1]).toContain('parisa');
    });

    it('keeps the sides where they are for the other side, and names that one theirs', () =>
    {
        const found = sides(shown(table({ mine: 3 })));

        expect(found.map((one) => one.says)).toEqual(['Team 1', 'Your team']);
    });

    it('numbers both sides for somebody who is not sitting', () =>
    {
        const { mine: _mine, ...unseated } = table();
        const found = sides(shown(unseated as TableSummary));

        expect(found.map((one) => one.says)).toEqual(['Team 1', 'Team 2']);
    });

    it('names the sides in Persian', () =>
    {
        useLocale().setLocale('fa');

        const found = sides(shown(table()));

        expect(found.map((one) => one.says)).toEqual([useLocale().t('team.yours'), useLocale().t('team.n', { n: useLocale().n(2) })]);
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
        const named = () => [...container.querySelectorAll<HTMLElement>('.lobby-side > p')];
        const lists = [...container.querySelectorAll<HTMLElement>('ul')];
        const labels = named();
        const before = drawn();

        expect(labels).toHaveLength(2);

        expect(sides(container)[0].seats[1]).not.toContain('reza.t');

        setHeld(table({ chairs: chairs(3), taken: 3 }));

        expect(sides(container)[0].seats[1]).toContain('reza.t');
        expect(drawn()).toHaveLength(4);

        for (const [at, list] of [...container.querySelectorAll<HTMLElement>('ul')].entries())
        {
            expect(list, `side ${ at } was drawn again`).toBe(lists[at]);
        }

        for (const [at, chair] of drawn().entries())
        {
            expect(chair, `chair ${ at } was drawn again`).toBe(before[at]);
        }

        for (const [at, label] of named().entries())
        {
            expect(label, `the name of side ${ at } was drawn again`).toBe(labels[at]);
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
        expect(chair.textContent).toContain(useLocale().t('play.lobby.host'));

        setHeld(table({ chairs: chairs(false) }));

        expect(inside.filter((one) => !chair.contains(one)).map((one) => `<${ one.tagName.toLowerCase() }> ${ one.textContent?.trim() ?? '' }`), 'drawn again for the answer it already had').toEqual([]);

        setHeld(table({ chairs: chairs(true) }));

        expect(chair.contains(tag!), 'the tag was drawn again to change what it says').toBe(true);
        expect(tag!.textContent?.trim()).toBe(useLocale().t('play.lobby.readyTag'));
    });

    it('draws one row of chairs, as before, at a table where every seat plays for itself', () =>
    {
        const found = sides(shown(table({ game: 'ludo', teams: false })));

        expect(found).toHaveLength(1);
        expect(found[0].says).toBe(useLocale().t('create.seats'));
        expect(found[0].seats).toHaveLength(4);
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
        for (const [language, ready, why] of [['en', 'I’m ready', 'That table has closed.'], ['fa', 'آماده‌ام', 'آن میز بسته شده.']] as const)
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
