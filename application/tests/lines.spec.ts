import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, renderTest } from '@azerothjs/testing';
import { RouterProvider, createMemoryHistory, createRouter } from 'azerothjs';

import MessageBubble from '../src/components/chat/message-bubble.component.azeroth';
import type { Message } from '../src/data/chat.ts';
import { manualClock } from '../src/lib/clock.ts';
import { LINE_KEYS, isLineKey } from '../src/lib/lines.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import { routes } from '../src/routes.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import '../src/locales/app-catalogue.ts';
import { en } from '../src/locales/en/index.ts';
import { fa } from '../src/locales/fa/index.ts';

vi.mock('../src/api.ts', async () => await import('./fake-api.ts'));

type Rendered = HTMLElement;

/**
 * The bubble offers to sit down at the table an invite names, so it reaches for the router. A
 * memory router keeps the test to what it is about - the words - rather than the navigation.
 */
const inRouter = (message: Message): Rendered =>
{
    const router = createRouter({ routes, history: createMemoryHistory('/app/chats/c-1'), scroll: false });
    return RouterProvider({ router, children: () => MessageBubble({ message, me: 'alex', showAuthor: true }) }) as Rendered;
};

/**
 * A line the SERVER wrote, rendered by the browser.
 *
 * `system`, `invite` and `result` carry `{ key, params }` rather than prose, and the whole point
 * of that shape is this test: the sentence is composed at DISPLAY time, so switching language
 * re-renders it instead of leaving whatever language it happened to be stored in. The version
 * this replaces put bilingual strings in the store, which could not follow a switch at all.
 */

const line = (key: string, params: Record<string, string> = {}): Message => ({
    id: 'm-1',
    conversationId: 'c-1',
    from: 'sara.k',
    kind: 'invite',
    text: '',
    line: { key, params },
    at: 1_700_000_000_000,
    ref: { game: 'backgammon' }
});

beforeEach(() =>
{
    resetRuntime();
    setRuntime({ clock: manualClock(1_700_000_000_000), seed: 3 });
    useLocale().setLocale('en');
});

afterEach(() =>
{
    cleanup();
    useLocale().setLocale('en');
});

/**
 * The server file that writes the lines, as text.
 *
 * Read through the bundler rather than `node:fs`: this suite runs under jsdom, where
 * `import.meta.url` is an http url and `readFileSync` refuses it.
 */
const SERVICES = (import.meta.glob('../../server/src/services.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>)['../../server/src/services.ts'];

describe('a server-authored line', () =>
{
    it('is composed at display time, so a language switch re-renders it', () =>
    {
        const { container } = renderTest(() => inRouter(line('chat.line.invite')));

        const english = container.textContent ?? '';
        expect(english).toContain(en['chat.line.invite']);

        useLocale().setLocale('fa');

        const persian = container.textContent ?? '';
        expect(persian).toContain(fa['chat.line.invite']);
        expect(persian).not.toContain(en['chat.line.invite']);
    });

    it('renders nothing at all for a key this client has never heard of', () =>
    {
        const { container } = renderTest(() => inRouter(line('chat.line.from-the-future')));

        // An older client meeting a newer server is a designed state. What it must never do is
        // print the key: an internal identifier on the screen is worse than a blank line.
        expect(container.textContent ?? '').not.toContain('chat.line.from-the-future');
        expect(container.textContent ?? '').not.toContain('from-the-future');
    });

    it('has a producer for every key it declares', () =>
    {
        // The rule from CLAUDE.md, as a test: a key with no producer is filler copy standing in
        // for a sentence nobody has written. Every group key is written by `services.ts`.
        const written = SERVICES;

        for (const key of LINE_KEYS.filter((one) => one.startsWith('chat.line.group.')))
        {
            const what = key.slice('chat.line.group.'.length);
            expect(written, key).toContain(`'${ what }'`);
        }
        expect(written).toContain('chat.line.group.');
    });

    it('knows exactly which keys it can render, and they are all in both catalogues', () =>
    {
        for (const key of LINE_KEYS)
        {
            expect(isLineKey(key)).toBe(true);
            expect(en[key], key).toBeDefined();
            expect(fa[key], key).toBeDefined();
            expect(fa[key], key).not.toBe(en[key]);
        }
    });

    it('refuses a key that only looks like one', () =>
    {
        expect(isLineKey('chat.line')).toBe(false);
        expect(isLineKey('chat.empty')).toBe(false);
        expect(isLineKey('')).toBe(false);
    });
});
