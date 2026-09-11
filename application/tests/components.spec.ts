import { describe, it, expect, beforeEach, vi } from 'vitest';
import { cleanup, fire, renderTest } from '@azerothjs/testing';

import BrandMark from '../src/components/layout/brand-mark.component.azeroth';
import Button from '../src/components/ui/button.component.azeroth';
import GameRow from '../src/components/ui/game-row.component.azeroth';
import { GAMES } from '../src/data/games.ts';
import { useFocus } from '../src/stores/focus.store.ts';
import { useLocale } from '../src/stores/locale.store.ts';

type Rendered = HTMLElement;

beforeEach(() =>
{
    cleanup();
    useLocale().setLocale('en');
    useFocus().focus(null);
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
    const ludo = GAMES.find((game) => game.id === 'ludo')!;

    it('states a single seat count without a range', () =>
    {
        const { container } = renderTest(() => GameRow({ game: hokm }) as Rendered);
        expect(container.querySelector('.tally')!.textContent).toBe('4');
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
