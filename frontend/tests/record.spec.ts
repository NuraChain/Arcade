import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, renderTest } from '@azerothjs/testing';
import { RouterProvider, createMemoryHistory, createRouter, type Route } from 'azerothjs';

import PersonRecord from '../src/components/social/person-record.component.azeroth';
import AchievementLadderSheet from '../src/components/social/achievement-ladder-sheet.component.azeroth';
import { manualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import '../src/locales/app-catalogue.ts';
import { useAccount } from '../src/stores/account.store.ts';
import { useCatalogue } from '../src/stores/catalogue.store.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { useOverlay } from '../src/stores/overlay.store.ts';
import { useRecord } from '../src/stores/record.store.ts';
import type { AchievementFamily } from '../src/api.ts';
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

const family = (id: string, game: string | undefined, extra: Partial<AchievementFamily> = {}): AchievementFamily => ({
    id,
    ...(game === undefined ? {} : { game }),
    icon: 'trophy',
    name: { en: `Family ${ id }`, fa: `خانواده ${ id }` },
    have: 3,
    earned: 2,
    total: 70,
    tier: 'bronze',
    next: { step: 3, need: 5, tier: 'bronze', blurb: { en: `Reach ${ id } 5.`, fa: `به ${ id } ۵ برس.` } },
    ...extra
});

const WON_LUDO = family('won', 'ludo', { have: 12, earned: 11, next: { step: 12, need: 15, tier: 'bronze', blurb: { en: 'Win 15 games of Ludo.', fa: '۱۵ بازی منچ را ببر.' } } });

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
    useOverlay().reset();
    await useAccount().signIn('Alex');
    server.achievements = {
        scopes: [
            { earned: 40, total: 1000 },
            { game: 'ludo', earned: 30, total: 1000 },
            { game: 'hokm', earned: 0, total: 1000 },
            { game: 'backgammon', earned: 0, total: 1000 },
            { game: 'poker', earned: 0, total: 1000 }
        ],
        families: [
            family('played', undefined),
            family('level', undefined, { have: 60, earned: 60, total: 60, tier: 'diamond', next: undefined }),
            WON_LUDO,
            family('won', 'hokm', { have: 0, earned: 0, tier: undefined })
        ],
        recent: [
            { id: 'ludo-won-11', name: { en: 'Winner 11', fa: 'برنده ۱۱' }, blurb: { en: 'Win 11 games of Ludo.', fa: '۱۱ بازی منچ را ببر.' }, icon: 'trophy', tier: 'bronze', game: 'ludo', earnedAt: '2026-09-02T00:00:00.000Z' }
        ]
    };
});

afterEach(() =>
{
    cleanup();
    resetRuntime();
});

describe('achievements on a record', () =>
{
    it('counts every rung earned against every rung there is', async () =>
    {
        const container = await show();

        const count = [...container.querySelectorAll('span')].find((one) => one.textContent?.endsWith('of 5,000'));

        expect(count?.textContent?.replace(/\s+/g, ' ').trim()).toBe('70 of 5,000');
    });

    it('opens on the families every game shares, and a game chip swaps them for that game’s', async () =>
    {
        const container = await show();

        expect(container.textContent).toContain('Family played');
        expect(container.textContent).not.toContain('Win 15 games of Ludo.');

        const ludo = [...container.querySelectorAll('button')].find((one) => one.textContent?.includes('Ludo') && one.textContent.includes('30'));

        expect(ludo).toBeDefined();
        ludo!.click();
        await settle();

        expect(container.textContent).toContain('Win 15 games of Ludo.');
        expect(container.textContent).not.toContain('Family played');
    });

    it('shows the next rung and how far along it is, and says so when a ladder is climbed', async () =>
    {
        const container = await show();

        expect(container.textContent).toContain('Reach played 5.');
        expect(container.textContent).toContain('3/5');
        expect(container.textContent).toContain('Every rung climbed.');
    });

    it('lists what was earned most recently on a profile', async () =>
    {
        const container = await show();

        expect(container.textContent).toContain('Recently earned');
        expect(container.textContent).toContain('Winner 11');
    });

    it('shows only that game’s families on a game’s page, with no chips and no recent medals', async () =>
    {
        const container = await show('ludo');

        expect(container.textContent).toContain('Win 15 games of Ludo.');
        expect(container.textContent).not.toContain('Family played');
        expect(container.textContent).not.toContain('Recently earned');
        expect(container.textContent).toContain('of 1,000');
    });

    it('opens a family’s whole ladder from its card', async () =>
    {
        const container = await show('ludo');
        const card = [...container.querySelectorAll('button')].find((one) => one.textContent?.includes('Win 15 games of Ludo.'));

        card!.click();

        for (let tries = 0; tries < 50 && useOverlay().items().length === 0; tries += 1)
        {
            await settle();
        }

        expect(useOverlay().items().map((one) => one.label)).toEqual(['Family won']);
    });
});

describe('a ladder', () =>
{
    it('lists every rung, earned or not, and reads its own family', async () =>
    {
        server.ladders['ludo-won'] = {
            family: WON_LUDO,
            rungs: [
                { step: 1, need: 1, tier: 'bronze', name: { en: 'Winner 1', fa: 'برنده ۱' }, blurb: { en: 'Win 1 game of Ludo.', fa: '۱ بازی منچ را ببر.' }, earnedAt: '2026-09-01T00:00:00.000Z' },
                { step: 2, need: 2, tier: 'bronze', name: { en: 'Winner 2', fa: 'برنده ۲' }, blurb: { en: 'Win 2 games of Ludo.', fa: '۲ بازی منچ را ببر.' } }
            ]
        };

        const { container } = renderTest(() => AchievementLadderSheet({ handle: 'alex', family: WON_LUDO, overlayId: 'ladder', close: () => undefined }) as Rendered);

        await settle();

        const rows = [...container.querySelectorAll('ol > li')];

        expect(server.calls).toContain('social.ladder');
        expect(rows.map((row) => row.textContent)).toEqual([expect.stringContaining('Winner 1'), expect.stringContaining('Winner 2')]);
        expect(rows[0].textContent).toContain('Earned');
        expect(rows[1].textContent).toContain('Not earned yet');
    });

    it('offers to try again when the ladder cannot be read', async () =>
    {
        const { container } = renderTest(() => AchievementLadderSheet({ handle: 'alex', family: WON_LUDO, overlayId: 'ladder', close: () => undefined }) as Rendered);

        await settle();

        expect(container.querySelector('[role="alert"]')).not.toBeNull();
    });
});
