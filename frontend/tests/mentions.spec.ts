import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, renderTest } from '@azerothjs/testing';
import { RouterProvider, Routes, createMemoryHistory, createRouter, type Route } from 'azerothjs';

import MessageBubble from '../src/components/chat/message-bubble.component.azeroth';
import RichText from '../src/components/chat/rich-text.component.azeroth';
import type { Message } from '../src/data/chat.ts';
import { paintMarkdown } from '../src/lib/markdown-dom.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import '../src/locales/app-catalogue.ts';

vi.mock('../src/api.ts', async () => await import('./fake-api.ts'));

type Rendered = HTMLElement;

const settle = async () =>
{
    for (let step = 0; step < 12; step += 1)
    {
        await Promise.resolve();
    }

    await new Promise((resolve) => setTimeout(resolve, 20));
};

const painted = (text: string, open?: (handle: string) => void) =>
{
    const host = document.createElement('span');

    paintMarkdown(host, text, { spoiler: 'Hidden', mine: false, ...(open === undefined ? {} : { open }) });

    return host;
};

const press = (link: Element, init: MouseEventInit = {}) =>
{
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...init });

    link.dispatchEvent(event);

    return event;
};

const routed = (page: () => HTMLElement, at = '/app/chats/c-1') =>
{
    const Stub = (): HTMLElement => document.createElement('div');
    const routes: Route[] = [
        { path: '/app/chats/:id', component: page },
        { path: '/app/people/:handle', component: Stub }
    ];
    const router = createRouter({ routes, history: createMemoryHistory(at), scroll: false });
    const { container } = renderTest(() => RouterProvider({ router, children: () => Routes({}) }) as Rendered);

    return { container, router };
};

beforeEach(() =>
{
    cleanup();
    useLocale().setLocale('en');
});

afterEach(() =>
{
    cleanup();
});

describe('a mention, as it is drawn', () =>
{
    it('is a link to that person\'s profile that says what was typed, read left to right', () =>
    {
        const host = painted('ask @Dana.W about it');
        const link = host.querySelector('a')!;

        expect(link.textContent).toBe('@Dana.W');
        expect(link.getAttribute('href')).toBe('/app/people/dana.w');
        expect(link.dir).toBe('ltr');
        expect(link.target).toBe('');
        expect(host.textContent).toBe('ask @Dana.W about it');
    });

    it('spells a handle in another script safely into the address', () =>
    {
        const link = painted('@سارا').querySelector('a')!;

        expect(link.getAttribute('href')).toBe(`/app/people/${ encodeURIComponent('سارا') }`);
        expect(link.textContent).toBe('@سارا');
    });

    it('opens the profile in the page when it is pressed, and leaves a press that asks for another tab to the browser', () =>
    {
        const opened: string[] = [];
        const link = painted('hi @dana.w', (handle) => opened.push(handle)).querySelector('a')!;

        expect(press(link).defaultPrevented).toBe(true);
        expect(opened).toEqual(['dana.w']);

        expect(press(link, { ctrlKey: true }).defaultPrevented).toBe(false);
        expect(press(link, { metaKey: true }).defaultPrevented).toBe(false);
        expect(press(link, { shiftKey: true }).defaultPrevented).toBe(false);
        expect(press(link, { button: 1 }).defaultPrevented).toBe(false);
        expect(opened).toEqual(['dana.w']);
    });

    it('is a plain link where nothing was given to open it with', () =>
    {
        const link = painted('hi @dana.w').querySelector('a')!;

        expect(press(link).defaultPrevented).toBe(false);
    });

    it('keeps a link to somewhere else what it was: a new tab, and no profile', () =>
    {
        const host = painted('see https://nura.games/@dana.w');
        const links = [...host.querySelectorAll('a')];

        expect(links).toHaveLength(1);
        expect(links[0].target).toBe('_blank');
        expect(links[0].getAttribute('href')).toBe('https://nura.games/@dana.w');
    });
});

describe('a mention in a message', () =>
{
    const message = (words: string): Message => ({
        id: 'm-1',
        conversationId: 'c-1',
        from: 'sara.k',
        kind: 'text',
        text: words,
        at: 1_700_000_000_000,
        ref: null
    });

    it('takes the reader to that person without loading the page, from the words of a message', async () =>
    {
        const { container, router } = routed(() => RichText({ text: 'ask @dana.w, not @mina' }) as HTMLElement);

        await settle();

        const links = [...container.querySelectorAll('a')];

        expect(links.map((one) => one.textContent)).toEqual(['@dana.w', '@mina']);
        expect(press(links[1]).defaultPrevented).toBe(true);

        await vi.waitFor(() => expect(router.location().pathname).toBe('/app/people/mina'), { timeout: 4000 });
    });

    it('does the same from inside a bubble', async () =>
    {
        const { container, router } = routed(() => MessageBubble({
            message: message('gg @dana.w'),
            me: 'alex',
            onActions: () => undefined,
            onReply: () => undefined
        }) as HTMLElement);

        await settle();

        const link = [...container.querySelectorAll('a')].find((one) => one.textContent === '@dana.w')!;

        expect(link).toBeDefined();
        press(link);

        await vi.waitFor(() => expect(router.location().pathname).toBe('/app/people/dana.w'), { timeout: 4000 });
    });
});
