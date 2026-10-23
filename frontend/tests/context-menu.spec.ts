import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, fire, renderTest } from '@azerothjs/testing';

import type { ChatAction, MenuPoint } from '../src/components/chat/actions.ts';
import ContextMenu from '../src/components/chat/context-menu.component.azeroth';
import '../src/locales/app-catalogue.ts';
import { useLocale } from '../src/stores/locale.store.ts';

type Rendered = HTMLElement;

const frame = async () =>
{
    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
    await Promise.resolve();
};

const panel = () => document.querySelector<HTMLElement>('[role="menu"]');

const choices = () => [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];

const named = () => (document.activeElement as HTMLElement | null)?.getAttribute('data-item') ?? (document.activeElement as HTMLElement | null)?.getAttribute('aria-label') ?? null;

const press = (key: string) => panel()!.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));

const open = async (options: { at?: MenuPoint; reactions?: boolean; mine?: string[] } = {}) =>
{
    const log: string[] = [];
    const item = (id: string, icon: ChatAction['icon'], danger = false): ChatAction => ({ id, icon, label: id, ...(danger ? { danger: true } : {}), run: () => log.push(`run ${ id }`) });
    const reactions = options.reactions === true
        ? {
            reactions: {
                emoji: ['👍', '😂'],
                mine: (emoji: string) => (options.mine ?? []).includes(emoji),
                pick: (emoji: string) => log.push(`pick ${ emoji }`),
                more: () => log.push('more')
            }
        }
        : {};

    renderTest(() => ContextMenu({
        at: options.at ?? { x: 100, y: 120 },
        label: 'Message actions',
        items: [item('reply', 'reply'), item('copy', 'copy'), item('delete', 'trash', true)],
        ...reactions,
        onClose: () => log.push('close')
    }) as Rendered);

    await placed();

    return log;
};

const placed = async () =>
{
    await frame();
    await vi.waitFor(() => expect(panel()!.style.left).not.toBe('-9999px'));
};

const sized = (width: number, height: number) =>
{
    Object.defineProperty(panel()!, 'offsetWidth', { configurable: true, value: width });
    Object.defineProperty(panel()!, 'offsetHeight', { configurable: true, value: height });
};

const screen = (width: number, height: number) =>
{
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: height });
};

beforeEach(() =>
{
    cleanup();
    useLocale().setLocale('en');
});

afterEach(() =>
{
    Reflect.deleteProperty(window, 'innerWidth');
    Reflect.deleteProperty(window, 'innerHeight');
    cleanup();
    document.body.querySelectorAll('[data-before]').forEach((node) => node.remove());
});

describe('a menu at the pointer', () =>
{
    it('is a menu of its items, named, with the keyboard on the first thing it offers to do', async () =>
    {
        await open({ reactions: true });

        expect(panel()?.getAttribute('aria-label')).toBe('Message actions');
        expect(choices().map((one) => one.getAttribute('data-item') ?? one.getAttribute('aria-label'))).toEqual([
            useLocale().t('chat.reactWith', { emoji: '👍' }),
            useLocale().t('chat.reactWith', { emoji: '😂' }),
            useLocale().t('chat.moreReactions'),
            'reply',
            'copy',
            'delete'
        ]);
        expect(named(), 'the keyboard on the first action, past the reactions').toBe('reply');
        expect(panel()?.querySelector('[data-item="delete"]')?.className).toContain('text-danger');
    });

    it('marks the reactions the reader has already given', async () =>
    {
        await open({ reactions: true, mine: ['😂'] });

        const mark = (emoji: string) => choices().find((one) => one.getAttribute('aria-label') === useLocale().t('chat.reactWith', { emoji }))!.className.includes('bg-accent/20');

        expect(mark('😂')).toBe(true);
        expect(mark('👍')).toBe(false);
    });

    it('opens where the pointer was, and stays on the screen near its edges', async () =>
    {
        screen(1280, 800);
        await openSized({ x: 600, y: 120 }, 200, 240);

        expect(panel()!.style.left, 'at the pointer').toBe('600px');
        expect(panel()!.style.top, 'just under it').toBe('122px');

        cleanup();
        await openSized({ x: 1250, y: 780 }, 200, 240);

        expect(panel()!.style.left, 'kept off the right edge').toBe('1072px');
        expect(panel()!.style.top, 'over the pointer where there is no room under it').toBe('538px');
    });

    it('ends at the pointer for a reader of Persian', async () =>
    {
        useLocale().setLocale('fa');
        screen(1280, 800);
        await openSized({ x: 600, y: 120 }, 200, 240);

        expect(panel()!.style.left).toBe('400px');
    });

    it('walks its choices with the arrows, round and round, and goes to its ends with Home and End', async () =>
    {
        await open();

        press('ArrowDown');
        expect(named()).toBe('copy');
        press('ArrowDown');
        expect(named()).toBe('delete');
        press('ArrowDown');
        expect(named(), 'round to the first').toBe('reply');
        press('ArrowUp');
        expect(named(), 'round to the last').toBe('delete');
        press('Home');
        expect(named()).toBe('reply');
        press('End');
        expect(named()).toBe('delete');
        press('ArrowLeft');
        expect(named(), 'left is back in English').toBe('copy');
        press('ArrowRight');
        expect(named(), 'right is on').toBe('delete');
    });

    it('walks left and right the way a Persian page reads', async () =>
    {
        useLocale().setLocale('fa');
        await open();

        press('ArrowLeft');
        expect(named(), 'left is on').toBe('copy');
        press('ArrowRight');
        expect(named(), 'right is back').toBe('reply');
    });

    it('closes before it does what was chosen', async () =>
    {
        const log = await open({ reactions: true });

        fire(panel()!.querySelector<HTMLButtonElement>('[data-item="copy"]')!, 'click');

        expect(log).toEqual(['close', 'run copy']);
    });

    it('closes before it reacts, and before it opens the rest of the reactions', async () =>
    {
        const log = await open({ reactions: true });

        fire(choices().find((one) => one.getAttribute('aria-label') === useLocale().t('chat.reactWith', { emoji: '😂' }))!, 'click');
        fire(choices().find((one) => one.getAttribute('aria-label') === useLocale().t('chat.moreReactions'))!, 'click');

        expect(log).toEqual(['close', 'pick 😂', 'close', 'more']);
    });

    it('closes at Escape and hands the keyboard back to where it was', async () =>
    {
        const before = document.createElement('button');

        before.setAttribute('data-before', '');
        document.body.append(before);
        before.focus();

        const log = await open();

        expect(named()).toBe('reply');

        const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });

        panel()!.dispatchEvent(escape);

        expect(log).toEqual(['close']);
        expect(escape.defaultPrevented, 'nothing else answers that Escape').toBe(true);
        expect(document.activeElement).toBe(before);
    });

    it('closes at Tab and lets the keyboard go on', async () =>
    {
        const log = await open();
        const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });

        panel()!.dispatchEvent(tab);

        expect(log).toEqual(['close']);
        expect(tab.defaultPrevented).toBe(false);
    });

    it('closes at a press anywhere else, and not at a press on itself', async () =>
    {
        const log = await open();

        panel()!.dispatchEvent(new Event('pointerdown', { bubbles: true }));
        expect(log, 'a press on the menu').toEqual([]);

        document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
        expect(log, 'a press elsewhere').toEqual(['close']);
    });

    it('closes when the page scrolls, the window changes size or loses focus', async () =>
    {
        const scrolled = await open();
        const list = document.createElement('div');

        document.body.append(list);
        list.dispatchEvent(new Event('scroll'));
        list.remove();
        expect(scrolled, 'a list that scrolls').toEqual(['close']);
        cleanup();

        const resized = await open();

        window.dispatchEvent(new Event('resize'));
        expect(resized).toEqual(['close']);
        cleanup();

        const blurred = await open();

        window.dispatchEvent(new Event('blur'));
        expect(blurred).toEqual(['close']);
    });

    it('lets go of the page when it is gone', async () =>
    {
        const log = await open();

        cleanup();

        document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
        window.dispatchEvent(new Event('resize'));
        window.dispatchEvent(new Event('blur'));

        expect(log).toEqual([]);
    });

    it('keeps the browser’s own menu off itself', async () =>
    {
        await open();

        const right = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });

        panel()!.dispatchEvent(right);

        expect(right.defaultPrevented).toBe(true);
    });
});

async function openSized(at: MenuPoint, width: number, height: number)
{
    const log: string[] = [];

    renderTest(() => ContextMenu({
        at,
        label: 'Message actions',
        items: [{ id: 'copy', icon: 'copy', label: 'copy', run: () => log.push('copy') }],
        onClose: () => log.push('close')
    }) as Rendered);

    sized(width, height);
    await placed();

    return log;
}
