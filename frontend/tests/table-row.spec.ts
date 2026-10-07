import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { cleanup, renderTest } from '@azerothjs/testing';
import { RouterProvider, createMemoryHistory, createRouter, type Route } from 'azerothjs';

import TableRow from '../src/components/games/table-row.component.azeroth';
import { manualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import '../src/locales/app-catalogue.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import type { TableSummary } from '../src/api.ts';

type Rendered = HTMLElement;

const table = (extra: Partial<TableSummary> = {}): TableSummary => ({
    id: 'table-row',
    code: 'row001',
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
    chairs: [],
    taken: 2,
    createdAt: new Date(0).toISOString(),
    ...extra
});

const row = (held: TableSummary) =>
{
    const Stub = (): HTMLElement => document.createElement('div');
    const routes: Route[] = [{ path: '/app', component: Stub }];
    const router = createRouter({ routes, history: createMemoryHistory('/app'), scroll: false });

    return renderTest(() => RouterProvider({ router, children: () => TableRow({ table: held }) }) as Rendered).container;
};

beforeEach(() =>
{
    cleanup();
    resetRuntime();
    setRuntime({ clock: manualClock(600_000), seed: 15 });
    useLocale().setLocale('en');
});

afterEach(() =>
{
    cleanup();
});

describe('a table in a list', () =>
{
    it('says two against two where partners will sit, in the reader\'s language', () =>
    {
        expect(row(table()).querySelector('[data-format="teams"]')?.textContent).toBe('2 v 2');

        cleanup();
        useLocale().setLocale('fa');

        const persian = row(table()).querySelector('[data-format="teams"]')?.textContent;

        expect(persian).toBe(useLocale().t('create.format.teams'));
        expect(persian).not.toBe('2 v 2');
    });

    it('says nothing of the kind where every seat plays for itself', () =>
    {
        expect(row(table({ game: 'ludo', teams: false })).querySelector('[data-format="teams"]')).toBeNull();
    });
});
