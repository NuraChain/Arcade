import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { RouterProvider, createMemoryHistory, createRouter } from 'azerothjs';
import { cleanup, fire, renderTest } from '@azerothjs/testing';

import LandingGameCard from '../src/components/games/landing-game-card.component.azeroth';
import PlayCta from '../src/components/layout/play-cta.component.azeroth';
import { GAMES } from '../src/data/games.ts';
import LandingPage from '../src/pages/landing.page.azeroth';
import { useConnect } from '../src/stores/connect.store.ts';
import { useFocus } from '../src/stores/focus.store.ts';
import { useLocale } from '../src/stores/locale.store.ts';

type Rendered = HTMLElement;

const original = window.matchMedia;

const routed = (build: () => unknown): HTMLElement =>
{
    const router = createRouter({ routes: [{ path: '/', component: (): HTMLElement => document.createElement('div') }], history: createMemoryHistory('/'), scroll: false });
    return renderTest(() => RouterProvider({ router, children: () => build() }) as Rendered).container;
};

const settle = async (): Promise<void> =>
{
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
};

beforeEach(() =>
{
    cleanup();
    useLocale().setLocale('en');
    useFocus().focus(null);
    useConnect().close();
    document.cookie = 'nura.here=; path=/; max-age=0';
    window.matchMedia = ((query: string) => ({
        matches: query.includes('reduce'),
        media: query,
        addEventListener: () => undefined,
        removeEventListener: () => undefined
    })) as unknown as typeof window.matchMedia;
});

afterEach(() =>
{
    window.matchMedia = original;
    document.cookie = 'nura.here=; path=/; max-age=0';
});

describe('the landing page', () =>
{
    it('has one h1 and the five beats the camera follows, in order', () =>
    {
        const container = routed(() => LandingPage({}));
        expect(container.querySelectorAll('h1')).toHaveLength(1);
        expect([...container.querySelectorAll<HTMLElement>('[data-beat]')].map((element) => element.dataset.beat))
            .toEqual(['arrival', 'games', 'together', 'compete', 'finale']);
    });

    it('keeps the stage out of the accessibility tree', () =>
    {
        const container = routed(() => LandingPage({}));
        expect(container.querySelector('.stage')?.getAttribute('aria-hidden')).toBe('true');
    });

    it('offers a stranger buttons that open the wallet chooser', () =>
    {
        const container = routed(() => LandingPage({}));
        expect(container.querySelector('a[href="/app"]')).toBeNull();
        const start = [...container.querySelectorAll('button')].find((button) => button.textContent?.includes('Start playing'))!;
        fire(start, 'click');
        expect(useConnect().open()).toBe(true);
    });

    it('sends somebody who has been here back to their tables, decided after mount', async () =>
    {
        document.cookie = 'nura.here=1; path=/';
        const container = routed(() => LandingPage({}));
        await settle();
        expect(container.querySelectorAll('a[href="/app"]').length).toBeGreaterThanOrEqual(2);
        expect(container.querySelector('a[href="/app/games/hokm"]')).not.toBeNull();
        expect([...container.querySelectorAll('button')].some((button) => button.textContent?.includes('Start playing'))).toBe(false);
    });

    it('prints every sentence in Persian, with no key left showing', () =>
    {
        useLocale().setLocale('fa');
        const container = routed(() => LandingPage({}));
        const text = container.textContent ?? '';
        expect(text).not.toMatch(/landing\.|games\.|nav\./);
        expect(text).toContain('بیا سر میز');
    });
});

describe('the landing game card', () =>
{
    const ludo = GAMES.find((game) => game.id === 'ludo')!;

    it('prints the seat range isolated, in the reader’s digits', () =>
    {
        useLocale().setLocale('fa');
        const container = routed(() => LandingGameCard({ game: ludo, returning: false }));
        expect(container.querySelector('.tally')!.textContent).toBe('۲–۴');
    });

    it('lists the seat counts a game really plays when they are not a run', () =>
    {
        const poker = GAMES.find((game) => game.id === 'poker')!;
        expect(routed(() => LandingGameCard({ game: poker, returning: false })).textContent).toMatch(/2, 6,? or 9 players/);
        cleanup();
        useLocale().setLocale('fa');
        expect(routed(() => LandingGameCard({ game: poker, returning: false })).textContent).toMatch(/۲،.*۶،? یا ۹ بازیکن/);
    });

    it('names its button after the game', () =>
    {
        const container = routed(() => LandingGameCard({ game: ludo, returning: false }));
        expect(container.querySelector('button')!.getAttribute('aria-label')).toBe('Play now: Ludo');
    });

    it('turns the camera to its game on focus and lets go on blur', () =>
    {
        const container = routed(() => LandingGameCard({ game: ludo, returning: false }));
        const card = container.querySelector('article')!;
        fire(card, 'focusin');
        expect(useFocus().game()).toBe('ludo');
        fire(card, 'focusout');
        expect(useFocus().game()).toBeNull();
    });

    it('does not move the camera for a finger', () =>
    {
        const container = routed(() => LandingGameCard({ game: ludo, returning: false }));
        const card = container.querySelector('article')!;
        card.dispatchEvent(Object.assign(new Event('pointerenter'), { pointerType: 'touch' }));
        expect(useFocus().game()).toBeNull();
        card.dispatchEvent(Object.assign(new Event('pointerenter'), { pointerType: 'mouse' }));
        expect(useFocus().game()).toBe('ludo');
    });
});

describe('the play button', () =>
{
    it('offers a guest seat only where it is asked to', () =>
    {
        const plain = routed(() => PlayCta({ returning: false }));
        expect(plain.querySelector('a[href="/sign-in"]')).toBeNull();
        cleanup();
        const finale = routed(() => PlayCta({ returning: false, guest: true }));
        expect(finale.querySelector('a[href="/sign-in"]')).not.toBeNull();
    });
});
