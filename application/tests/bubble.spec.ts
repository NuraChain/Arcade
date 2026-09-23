import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, fire, renderTest } from '@azerothjs/testing';
import { RouterProvider, createMemoryHistory, createRouter } from 'azerothjs';

import MessageBubble from '../src/components/chat/message-bubble.component.azeroth';
import type { Message } from '../src/data/chat.ts';
import { manualClock } from '../src/lib/clock.ts';
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

beforeEach(() =>
{
    resetRuntime();
    setRuntime({ clock: manualClock(1_700_000_000_000), seed: 3 });
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
