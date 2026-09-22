import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, renderTest } from '@azerothjs/testing';
import { RouterProvider, createMemoryHistory, createRouter, type Route } from 'azerothjs';

import PersonRecord from '../src/components/social/person-record.component.azeroth';
import { manualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import '../src/locales/app-catalogue.ts';
import { useAccount } from '../src/stores/account.store.ts';
import { useCatalogue } from '../src/stores/catalogue.store.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { useRecord } from '../src/stores/record.store.ts';
import { server } from './fake-api.ts';

vi.mock('../src/api.ts', async () => await import('./fake-api.ts'));

type Rendered = HTMLElement;

const settle = async (): Promise<void> =>
{
    for (let i = 0; i < 8; i += 1)
    {
        await Promise.resolve();
    }
    await new Promise((resolve) => setTimeout(resolve, 40));
};

const achievement = (id: string, extra: Record<string, unknown> = {}): unknown => ({
    id,
    name: { en: `Name ${ id }`, fa: `نام ${ id }` },
    blurb: { en: `Blurb ${ id }`, fa: `شرح ${ id }` },
    icon: 'trophy',
    tier: 'silver',
    ...extra
});

const show = async (game?: string): Promise<HTMLElement> =>
{
    const Stub = (): HTMLElement => document.createElement('div');
    const routes: Route[] = [{ path: '/app', component: Stub }];
    const router = createRouter({ routes, history: createMemoryHistory('/app'), scroll: false });
    const { container } = renderTest(() => RouterProvider({ router, children: () => PersonRecord({ handle: 'alex', show: ['achievements'], game }) }) as Rendered);
    await settle();
    return container;
};

beforeEach(async () =>
{
    cleanup();
    resetRuntime();
    setRuntime({ clock: manualClock(5000), seed: 3 });
    useLocale().setLocale('en');
    server.reset();
    useCatalogue().reset();
    useRecord().reset();
    await useAccount().signIn('Alex');
    server.achievements = [
        achievement('first-win', { earnedAt: '2026-09-01T00:00:00.000Z' }),
        achievement('ludo-hunter', { game: 'ludo', progress: { have: 12, need: 25 } }),
        achievement('hokm-kot', { game: 'hokm', earnedAt: '2026-09-02T00:00:00.000Z' })
    ];
});

afterEach(() =>
{
    cleanup();
    resetRuntime();
});

describe('achievements on a record', () =>
{
    it('groups them by the game that awards them, with the ones every game shares first', async () =>
    {
        const container = await show();
        const headings = [...container.querySelectorAll('section p.text-ui-xs.font-semibold')].map((one) => one.textContent?.trim());

        expect(headings).toEqual(['Across every game', 'Ludo', 'Hokm']);
    });

    it('shows how far along an unearned one is, and no bar on one already earned', async () =>
    {
        const container = await show();
        const bars = [...container.querySelectorAll('[role="progressbar"]')];

        expect(bars.length).toBe(1);
        expect(bars[0].getAttribute('aria-valuenow')).toBe('12');
        expect(bars[0].getAttribute('aria-valuemax')).toBe('25');
        expect(container.textContent).toContain('12/25');
    });

    it('shows only one game’s achievements on that game’s page, without a heading to say which', async () =>
    {
        const container = await show('ludo');

        expect(container.textContent).toContain('Name ludo-hunter');
        expect(container.textContent).not.toContain('Name hokm-kot');
        expect(container.textContent).not.toContain('Name first-win');
        expect(container.querySelector('section p.text-ui-xs.font-semibold')).toBeNull();
    });
});
