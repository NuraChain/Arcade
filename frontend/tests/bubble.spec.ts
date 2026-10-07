import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, fire, renderTest } from '@azerothjs/testing';
import { RouterProvider, createMemoryHistory, createRouter, createSignal } from 'azerothjs';

import MessageBubble from '../src/components/chat/message-bubble.component.azeroth';
import type { Message } from '../src/data/chat.ts';
import { manualClock, type ManualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import { routes } from '../src/routes.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import '../src/locales/app-catalogue.ts';

vi.mock('../src/api.ts', async () => await import('./fake-api.ts'));

type Rendered = HTMLElement;

const text = (id: string, words: string, extra: Partial<Message> = {}): Message => ({
    id,
    conversationId: 'c-1',
    from: 'sara.k',
    kind: 'text',
    text: words,
    at: 1_700_000_000_000,
    ref: null,
    ...extra
});

const show = (message: Message, options: { quoteOf?: (id: string) => Message | undefined; onReact?: (message: Message, emoji: string) => void } = {}): HTMLElement =>
{
    const router = createRouter({ routes, history: createMemoryHistory('/app/chats/c-1'), scroll: false });
    return renderTest(() => RouterProvider({
        router,
        children: () => MessageBubble({
            message,
            me: 'alex',
            onActions: () => undefined,
            onReply: () => undefined,
            ...(options.onReact === undefined ? {} : { onReact: options.onReact }),
            ...(options.quoteOf === undefined ? {} : { quoteOf: options.quoteOf })
        })
    }) as Rendered).container;
};

let clock: ManualClock;

const settle = async () =>
{
    for (let turn = 0; turn < 12; turn += 1)
    {
        await Promise.resolve();
    }
};

const pointer = (target: Element, type: string, x: number, y: number) =>
{
    const event = new Event(type, { bubbles: true, cancelable: true });

    Object.defineProperty(event, 'clientX', { value: x });
    Object.defineProperty(event, 'clientY', { value: y });
    Object.defineProperty(event, 'pointerType', { value: 'touch' });
    Object.defineProperty(event, 'isPrimary', { value: true });
    target.dispatchEvent(event);
};

const held = async (first: Message, handlers: { onActions?: (message: Message) => void; onReply?: (message: Message) => void } = {}) =>
{
    const [message, setMessage] = createSignal(first);
    const router = createRouter({ routes, history: createMemoryHistory('/app/chats/c-1'), scroll: false });
    const container = renderTest(() => RouterProvider({
        router,
        children: () => MessageBubble({
            get message()
            {
                return message();
            },
            me: 'alex',
            onActions: handlers.onActions ?? (() => undefined),
            onReply: handlers.onReply ?? (() => undefined),
            onReact: () => undefined
        })
    }) as Rendered).container;

    await settle();

    return {
        container,
        read: async (next: Message) =>
        {
            setMessage(next);
            await settle();
        }
    };
};

beforeEach(() =>
{
    resetRuntime();
    clock = manualClock(1_700_000_000_000);
    setRuntime({ clock, seed: 3 });
    useLocale().setLocale('en');
});

afterEach(() =>
{
    cleanup();
});

describe('a message bubble', () =>
{
    it('renders what was typed as formatting, never as markup', () =>
    {
        const container = show(text('m-1', '**bold** and <img src=x onerror=alert(1)>'));

        expect(container.querySelector('.bubble strong')?.textContent).toBe('bold');
        expect(container.querySelector('.bubble img')).toBeNull();
        expect(container.querySelector('.bubble')?.textContent).toContain('<img src=x onerror=alert(1)>');
    });

    it('hides a spoiler until it is pressed', () =>
    {
        const container = show(text('m-1', 'the end is ||everyone wins||'));
        const spoiler = container.querySelector<HTMLElement>('[data-shown]')!;

        expect(spoiler.dataset.shown).toBe('false');
        expect(spoiler.getAttribute('role')).toBe('button');

        fire(spoiler, 'click');

        expect(spoiler.dataset.shown).toBe('true');
        expect(spoiler.getAttribute('role')).toBeNull();
    });

    it('quotes what it replies to, and says so when the original is gone', () =>
    {
        const original = text('m-0', 'are we playing tonight?');
        const quoted = show(text('m-1', 'yes', { reply: 'm-0' }), { quoteOf: (id) => (id === 'm-0' ? original : undefined) });

        expect(quoted.textContent).toContain('are we playing tonight?');

        cleanup();

        const deleted = show(text('m-1', 'yes', { reply: 'm-0' }), { quoteOf: () => ({ ...original, kind: 'deleted', text: '' }) });
        expect(deleted.textContent).toContain('The original message was deleted.');
    });

    it('says a forwarded message was forwarded', () =>
    {
        expect(show(text('m-1', 'look', { forwarded: true })).textContent).toContain('Forwarded');
    });

    it('counts one person once per emoji and toggles through the chip', () =>
    {
        const picked: string[] = [];
        const container = show(text('m-1', 'nice', {
            reactions: [
                { id: 'r1', from: 'omid.k', emoji: '👍' },
                { id: 'r2', from: 'omid.k', emoji: '👍' },
                { id: 'r3', from: 'alex', emoji: '👍' },
                { id: 'r4', from: 'omid.k', emoji: '🔥' }
            ]
        }), { onReact: (_message, emoji) => picked.push(emoji) });

        const chips = [...container.querySelectorAll<HTMLButtonElement>('[aria-label="Reactions"] button[aria-pressed]')];

        expect(chips.map((chip) => chip.textContent?.replace(/\s+/g, ''))).toEqual(['👍2', '🔥1']);
        expect(chips.map((chip) => chip.getAttribute('aria-pressed'))).toEqual(['true', 'false']);

        fire(chips[1], 'click');
        expect(picked).toEqual(['🔥']);
    });
});

describe('a message the thread reads again', () =>
{
    const chipsOf = (container: HTMLElement) => [...container.querySelectorAll<HTMLButtonElement>('[aria-label="Reactions"] button[aria-pressed]')];

    it('is the same bubble, and shows what changed', async () =>
    {
        const first = text('m-1', 'nice');
        const { container, read } = await held(first);
        const row = container.querySelector('[data-message]');
        const bubble = container.querySelector('.bubble');

        expect(bubble).not.toBeNull();

        await read({ ...first, reactions: [{ id: 'r1', from: 'omid.k', emoji: '👍' }] });

        expect(container.querySelector('[data-message]'), 'the row was drawn again').toBe(row);
        expect(container.querySelector('.bubble'), 'the bubble was drawn again').toBe(bubble);
        expect(chipsOf(container).map((chip) => chip.textContent?.replace(/\s+/g, ''))).toEqual(['👍1']);
    });

    it('keeps a reaction, and whoever is on it, when somebody else adds theirs', async () =>
    {
        const first = text('m-1', 'nice', { reactions: [{ id: 'r1', from: 'omid.k', emoji: '👍' }] });
        const { container, read } = await held(first);
        const chip = chipsOf(container)[0];

        chip.focus();

        await read({ ...first, reactions: [{ id: 'r1', from: 'omid.k', emoji: '👍' }, { id: 'r2', from: 'sara.k', emoji: '👍' }] });

        expect(chipsOf(container)[0], 'the reaction was drawn again').toBe(chip);
        expect(document.activeElement).toBe(chip);
        expect(chip.textContent?.replace(/\s+/g, '')).toBe('👍2');
    });

    it('still opens its actions under a held finger', async () =>
    {
        const onActions = vi.fn();
        const first = text('m-1', 'nice');
        const { container, read } = await held(first, { onActions });

        await read({ ...first });

        pointer(container.querySelector('.bubble')!, 'pointerdown', 10, 10);
        clock.advance(500);

        expect(onActions, 'the bubble on screen has no hold on it').toHaveBeenCalledTimes(1);
    });

    it('is still answered by a swipe', async () =>
    {
        const onReply = vi.fn();
        const first = text('m-1', 'nice');
        const { container, read } = await held(first, { onReply });

        await read({ ...first });

        const row = container.querySelector('[data-message]')!;

        pointer(row, 'pointerdown', 200, 10);
        pointer(row, 'pointermove', 110, 10);
        pointer(row, 'pointerup', 110, 10);

        expect(onReply, 'the row on screen has no swipe on it').toHaveBeenCalledTimes(1);
    });

    it('opens its actions under a held finger once it can be read, when it was locked as it was first drawn', async () =>
    {
        const onActions = vi.fn();
        const { container, read } = await held(text('m-1', '', { locked: 'no-key' }), { onActions });

        expect(container.querySelector('.bubble')).toBeNull();

        await read(text('m-1', 'now it can be read'));

        const bubble = container.querySelector('.bubble');

        expect(bubble?.textContent).toContain('now it can be read');

        pointer(bubble!, 'pointerdown', 10, 10);
        clock.advance(500);

        expect(onActions).toHaveBeenCalledTimes(1);
    });

    it('says a line the server wrote, then the next one, in the same pill', async () =>
    {
        const first: Message = { ...text('m-2', ''), kind: 'system', line: { key: 'chat.line.group.joined', params: { who: 'sara.k' } } };
        const { container, read } = await held(first);
        const pill = container.querySelector('p');

        expect(pill).not.toBeNull();

        await read({ ...first });

        expect(container.querySelector('p'), 'the line was drawn again').toBe(pill);
    });
});
