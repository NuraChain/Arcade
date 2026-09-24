import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createSignal } from 'azerothjs';
import { cleanup, fire, renderTest } from '@azerothjs/testing';

import Select from '../src/components/ui/select.component.azeroth';
import { useLocale } from '../src/stores/locale.store.ts';

type Rendered = HTMLElement;

const OPTIONS = [
    { value: '', label: 'The system default' },
    { value: 'desk', label: 'Desk microphone' },
    { value: 'headset', label: 'Headset' }
];

const frame = async (): Promise<void> =>
{
    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
    await Promise.resolve();
};

const show = (): { container: HTMLElement; picked: string[]; value: () => string } =>
{
    const [value, setValue] = createSignal('');
    const picked: string[] = [];
    const { container } = renderTest(() => Select({
        label: 'Microphone',
        get value()
        {
            return value();
        },
        options: OPTIONS,
        onChange: (next: string) =>
        {
            picked.push(next);
            setValue(next);
        }
    }) as Rendered);

    return { container, picked, value };
};

const listbox = (): HTMLElement | null => document.querySelector('[role="listbox"]');

beforeEach(() =>
{
    cleanup();
    useLocale().setLocale('en');
});

afterEach(() => cleanup());

describe('Select', () =>
{
    it('shows the chosen option on a button that says it opens a list', () =>
    {
        const { container } = show();
        const trigger = container.querySelector('button')!;

        expect(trigger.textContent).toContain('The system default');
        expect(trigger.getAttribute('aria-haspopup')).toBe('listbox');
        expect(trigger.getAttribute('aria-expanded')).toBe('false');
        expect(listbox()).toBeNull();
    });

    it('opens on a click and picks the option pressed, then closes', async () =>
    {
        const { container, picked } = show();

        fire(container.querySelector('button')!, 'click');
        await frame();

        const options = [...document.querySelectorAll('[role="option"]')];
        expect(options.map((one) => one.textContent?.trim())).toEqual(['The system default', 'Desk microphone', 'Headset']);
        expect(options[0].getAttribute('aria-selected')).toBe('true');

        fire(options[2] as HTMLElement, 'click');
        await frame();

        expect(picked).toEqual(['headset']);
        expect(listbox()).toBeNull();
        expect(container.querySelector('button')!.textContent).toContain('Headset');
    });

    it('is driven by the keyboard: arrows move, Enter picks, Escape leaves it as it was', async () =>
    {
        const { container, picked } = show();
        const trigger = container.querySelector('button')!;

        trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
        await frame();

        const list = listbox()!;
        list.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
        expect(list.getAttribute('aria-activedescendant')).toMatch(/option-1$/);

        list.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        await frame();
        expect(picked).toEqual(['desk']);

        trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        await frame();
        listbox()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
        listbox()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await frame();

        expect(picked).toEqual(['desk']);
        expect(listbox()).toBeNull();
    });

    it('jumps to the next option starting with a typed letter', async () =>
    {
        const { container } = show();

        fire(container.querySelector('button')!, 'click');
        await frame();
        listbox()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'h', bubbles: true }));

        expect(listbox()!.getAttribute('aria-activedescendant')).toMatch(/option-2$/);
    });

    it('closes when somebody presses anywhere else', async () =>
    {
        const { container, picked } = show();

        fire(container.querySelector('button')!, 'click');
        await frame();
        document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
        await frame();

        expect(listbox()).toBeNull();
        expect(picked).toEqual([]);
    });
});
