import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { cleanup, renderTest } from '@azerothjs/testing';
import { createSignal } from 'azerothjs';

import LobbyPanel from '../src/components/games/lobby-panel.component.azeroth';
import { manualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import '../src/locales/app-catalogue.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { useSession } from '../src/stores/session.store.ts';
import type { TableSummary } from '../src/api.ts';
import { server } from './fake-api.ts';

type Rendered = HTMLElement;

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
        const chairs = (taken: number): TableSummary['chairs'] =>
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

    it('draws one row of chairs, as before, at a table where every seat plays for itself', () =>
    {
        const found = sides(shown(table({ game: 'ludo', teams: false })));

        expect(found).toHaveLength(1);
        expect(found[0].says).toBe(useLocale().t('create.seats'));
        expect(found[0].seats).toHaveLength(4);
    });
});
