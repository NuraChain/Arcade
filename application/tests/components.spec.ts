import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RouterProvider, createMemoryHistory, createRouter, createSignal } from 'azerothjs';
import { cleanup, fire, renderTest } from '@azerothjs/testing';

import BrandMark from '../src/components/layout/brand-mark.component.azeroth';
import Button from '../src/components/ui/button.component.azeroth';
import Panel from '../src/components/ui/panel.component.azeroth';
import GameRow from '../src/components/ui/game-row.component.azeroth';
import SectionHeading from '../src/components/ui/section-heading.component.azeroth';
import { GAMES } from '../src/data/games.ts';
import { ALL_ICONS } from '../src/icons/all.ts';
import { ICONS } from '../src/icons/registry.ts';
import { useFocus } from '../src/stores/focus.store.ts';
import { useLocale } from '../src/stores/locale.store.ts';

type Rendered = HTMLElement;

beforeEach(() =>
{
    cleanup();
    useLocale().setLocale('en');
    useFocus().focus(null);
});

describe('SectionHeading', () =>
{
    it('renders the controls it was handed', () =>
    {
        // It used to take no children at all, so a heading written with a button INSIDE it
        // rendered the heading and dropped the button - silently, and on two pages at once.
        const { container } = renderTest(() => SectionHeading({
            title: 'Your groups',
            actions: Button({ children: 'New group' })
        }) as Rendered);

        expect(container.textContent).toContain('Your groups');
        expect(container.querySelector('button')?.textContent).toContain('New group');
    });
});

describe('SectionHeading type', () =>
{
    it('titles a section in sentence case at reading size', () =>
    {
        const { container } = renderTest(() => SectionHeading({ title: 'Featured games' }) as Rendered);
        const heading = container.querySelector('h2')!;

        expect(heading.className).toContain('text-ui-lg');
        expect(heading.className).toContain('text-text');
        expect(heading.className).not.toContain('uppercase');
    });
});

describe('Button', () =>
{
    it('renders a <button> that defaults to type=button', () =>
    {
        const { container } = renderTest(() => Button({ children: 'Pull up a chair' }) as Rendered);
        const button = container.querySelector('button')!;
        expect(button.textContent).toContain('Pull up a chair');
        expect(button.getAttribute('type')).toBe('button');
    });

    it('renders an <a> when it navigates, not a button with a click handler', () =>
    {
        const { container } = renderTest(() => Button({ children: 'Games', href: '#games' }) as Rendered);
        const link = container.querySelector('a')!;
        expect(link.getAttribute('href')).toBe('#games');
        expect(container.querySelector('button')).toBeNull();
    });

    it('does NOT fire while disabled', () =>
    {
        const onClick = vi.fn();
        const { container } = renderTest(() => Button({ children: 'Join', onClick, disabled: true }) as Rendered);
        const button = container.querySelector('button')!;
        expect(button.disabled).toBe(true);
        fire(button, 'click');
        expect(onClick).not.toHaveBeenCalled();
    });

    it('drops the pointer cursor when it cannot be pressed', () =>
    {
        const { container } = renderTest(() => Button({ children: 'Join', disabled: true }) as Rendered);
        expect(container.querySelector('button')!.className).not.toContain('cursor-pointer');
    });

    it('fills a primary button with the blue white text passes AA on, never the text blue', () =>
    {
        const { container } = renderTest(() => Button({ variant: 'primary', children: 'Go' }) as Rendered);
        const button = container.querySelector('button')!;
        expect(button.className).toContain('bg-accent-fill');
        expect(button.className).toContain('text-accent-ink');
        expect(button.className).not.toMatch(/\bbg-accent(?!-)/);
    });

    it('paints the pressed state INSTEAD of its variant, because two utilities on one property are decided by stylesheet order', () =>
    {
        const { container } = renderTest(() => Button({ variant: 'secondary', pressed: true, children: 'Sort' }) as Rendered);
        const button = container.querySelector('button')!;
        const classes = button.className.split(' ');
        expect(button.getAttribute('aria-pressed')).toBe('true');
        expect(classes).toContain('bg-accent/15');
        expect(classes).toContain('text-accent');
        expect(classes).toContain('border');
        expect(classes).not.toContain('bg-raised');
        expect(classes).not.toContain('text-text');
    });

    it('swaps between its variant and the pressed look as the toggle moves', async () =>
    {
        const [pressed, setPressed] = createSignal(false);
        const { container } = renderTest(() => Button({
            variant: 'secondary',
            get pressed()
            {
                return pressed();
            },
            children: 'Sort'
        }) as Rendered);
        const button = container.querySelector('button')!;
        expect(button.className.split(' ')).toContain('bg-raised');
        expect(button.className.split(' ')).not.toContain('bg-accent/15');

        setPressed(true);
        for (let turn = 0; turn < 4; turn += 1)
        {
            await Promise.resolve();
        }

        expect(button.getAttribute('aria-pressed')).toBe('true');
        expect(button.className.split(' ')).toContain('bg-accent/15');
        expect(button.className.split(' ')).not.toContain('bg-raised');
    });
});

describe('BrandMark', () =>
{
    it('reverses its slots for Persian rather than reordering the markup', () =>
    {
        const locale = useLocale();

        const english = renderTest(() => BrandMark({}) as Rendered);
        expect(english.container.textContent?.trim()).toBe('Nura Games');
        english.unmount();

        locale.setLocale('fa');
        const persian = renderTest(() => BrandMark({}) as Rendered);
        expect(persian.container.textContent?.trim()).toBe('بازی‌های نورا');
    });

    it('leaves no stray space where a slot is empty', () =>
    {
        const { container } = renderTest(() => BrandMark({}) as Rendered);
        expect(container.textContent).not.toMatch(/\s$/);
    });
});

describe('GameRow', () =>
{
    const hokm = GAMES.find((game) => game.id === 'hokm')!;
    const backgammon = GAMES.find((game) => game.id === 'backgammon')!;
    const ludo = GAMES.find((game) => game.id === 'ludo')!;

    it('states a single seat count without a range', () =>
    {
        const { container } = renderTest(() => GameRow({ game: backgammon }) as Rendered);
        expect(container.querySelector('.tally')!.textContent).toBe('2');
    });

    it('states a range with an en dash, and isolates it so it cannot reverse', () =>
    {
        const { container } = renderTest(() => GameRow({ game: ludo }) as Rendered);
        const tally = container.querySelector('.tally')!;
        expect(tally.textContent).toBe('2–4');
        expect(tally.className).toContain('tally');
    });

    it('prints the range in the reader’s digits', () =>
    {
        useLocale().setLocale('fa');
        const { container } = renderTest(() => GameRow({ game: ludo }) as Rendered);
        expect(container.querySelector('.tally')!.textContent).toBe('۲–۴');
    });

    it('is a real control, so the keyboard reaches every table', () =>
    {
        const { container } = renderTest(() => GameRow({ game: hokm }) as Rendered);
        expect(container.querySelector('button')).not.toBeNull();
    });

    it('lights the matching table on focus and lets go on blur', () =>
    {
        const focus = useFocus();
        const { container } = renderTest(() => GameRow({ game: hokm }) as Rendered);
        const button = container.querySelector('button')!;

        fire(button, 'focus');
        expect(focus.game()).toBe('hokm');

        fire(button, 'blur');
        expect(focus.game()).toBeNull();
    });
});

describe('focus store', () =>
{
    it('ignores a write that changes nothing', () =>
    {
        const focus = useFocus();
        focus.focus('poker');
        const before = focus.game();
        focus.focus('poker');
        expect(focus.game()).toBe(before);
    });
});

describe('Panel', () =>
{
    /**
     * The surface ten files used to spell by hand while `Card` - which rendered exactly it - sat with
     * zero importers for its whole life. Every gate was green the entire time, because nothing renders
     * what nothing calls.
     */
    it('is a plain div by default, wearing the panel surface', () =>
    {
        const { container } = renderTest(() => Panel({ children: 'Body' }) as Rendered);
        const panel = container.querySelector('div')!;
        expect(panel.tagName).toBe('DIV');
        expect(panel.className).toContain('rounded-panel');
        expect(panel.className).toContain('bg-field');
        expect(panel.className).toContain('p-4');
        expect(panel.textContent).toBe('Body');
    });

    it('becomes a link when given a destination, and never also a button', () =>
    {
        const Stub = (): HTMLElement => document.createElement('div');
        const router = createRouter({
            routes: [ { path: '/app', component: Stub, children: [ { path: 'games', component: Stub } ] } ],
            history: createMemoryHistory('/app'),
            scroll: false
        });
        const { container } = renderTest(() => RouterProvider({
            router,
            children: () => Panel({ children: 'Go', to: '/app/games' })
        }) as Rendered);
        expect(container.querySelector('a')?.getAttribute('href')).toBe('/app/games');
        expect(container.querySelector('button')).toBeNull();
    });

    it('becomes a button when given a handler, and runs it once', () =>
    {
        const onClick = vi.fn();
        const { container } = renderTest(() => Panel({ children: 'Press', onClick }) as Rendered);
        const button = container.querySelector('button')!;
        fire(button, 'click');
        expect(onClick).toHaveBeenCalledTimes(1);
        expect(container.querySelector('a')).toBeNull();
    });

    it('renders a section when asked, so a landmark can carry a label', () =>
    {
        const { container } = renderTest(() => Panel({ children: 'Body', section: true, label: 'Rules' }) as Rendered);
        const section = container.querySelector('section')!;
        expect(section.getAttribute('aria-label')).toBe('Rules');
    });

    it('emits no padding utility at all when told not to pad', () =>
    {
        const { container } = renderTest(() => Panel({ children: 'Body', pad: 'none' }) as Rendered);
        const panel = container.querySelector('div')!;
        expect(panel.className).not.toMatch(/\bp-[0-9]/);
    });

    /**
     * `danger` is the destructive colour and `madder` means a table is playing for something.
     * `PanelTone` deliberately omits `madder`, so the wrong one cannot be written here at all - this
     * asserts the tone that IS allowed resolves to the danger surface rather than the default.
     */
    it('wears the danger surface, which is not the default one', () =>
    {
        const { container } = renderTest(() => Panel({ children: 'Careful', tone: 'danger' }) as Rendered);
        const panel = container.querySelector('div')!;
        expect(panel.className).toContain('border-danger/40');
        expect(panel.className).not.toContain('bg-field');
    });
});

describe('the icon registry', () =>
{
    it('draws every icon the product names once the full set has loaded', () =>
    {
        for (const name of Object.keys(ALL_ICONS) as (keyof typeof ALL_ICONS)[])
        {
            expect(ICONS[name]?.length ?? 0, name).toBeGreaterThan(0);
        }
    });
});
