import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, fire, renderTest } from '@azerothjs/testing';
import { RouterProvider, createMemoryHistory, createRouter, createSignal } from 'azerothjs';

import MessageBubble from '../src/components/chat/message-bubble.component.azeroth';
import type { Message } from '../src/data/chat.ts';
import { manualClock, type ManualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import { routes } from '../src/routes.ts';
import { useDevice } from '../src/stores/device.store.ts';
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

    it('says who won a game on the card of its result, under a trophy', () =>
    {
        const container = show(text('m-won', '', {
            kind: 'result',
            ref: { game: 'backgammon', winners: ['sara.k'] },
            line: { key: 'chat.line.result', params: { game: 'backgammon', winners: ['sara.k'] } }
        }));
        const card = container.querySelector('.rounded-panel')!;

        expect(card.querySelector('.truncate')?.textContent?.trim()).toMatch(/ won Backgammon$/);
        expect(card.querySelector('.truncate')?.textContent?.trim(), 'the card names nobody').not.toMatch(/^won /);
        expect(card.className).toContain('border-win/40');
        expect(card.querySelector('.text-win'), 'a game that was won has no trophy').not.toBeNull();
    });

    it('says a game the reader won in their own words, alone and beside a partner, in both languages', () =>
    {
        const title = (winners: string[]) =>
        {
            const container = show(text('m-won', '', {
                kind: 'result',
                ref: { game: 'hokm', winners },
                line: { key: 'chat.line.result', params: { game: 'hokm', winners } }
            }));
            const said = container.querySelector('.rounded-panel .truncate')?.textContent?.trim();

            cleanup();

            return said;
        };

        expect(title(['alex'])).toBe('You won Hokm');
        expect(title(['alex', 'sara.k'])).toBe('You and sara.k won Hokm');
        expect(title(['sara.k', 'alex'])).toBe('You and sara.k won Hokm');

        useLocale().setLocale('fa');

        expect(title(['alex'])).toBe('توی حکم بردی');
        expect(title(['alex', 'sara.k'])).toBe('تو و sara.k توی حکم بردین');
        expect(title(['sara.k'])).toBe('sara.k توی حکم برد');
        expect(title(['sara.k', 'omid.k'])).toBe('sara.k و omid.k توی حکم بردن');
    });

    it('does not say a game nobody won was won: the card is the game\'s name, with no trophy', () =>
    {
        const container = show(text('m-void', '', {
            kind: 'result',
            ref: { game: 'backgammon', winners: [] },
            line: { key: 'chat.line.result.none', params: { game: 'backgammon' } }
        }));
        const card = container.querySelector('.rounded-panel')!;
        const [title, said] = [...card.querySelectorAll('.truncate')].map((one) => one.textContent?.trim());

        expect(title, 'a game nobody won was said to have been won').toBe('Backgammon');
        expect(said).toBe('The game ended with nobody winning');
        expect(card.className).not.toContain('border-win/40');
        expect(card.querySelector('.text-win'), 'a game nobody won was given a trophy').toBeNull();
    });

    it('says a game Nura\'s team ended, with no trophy, in the room\'s own words', () =>
    {
        const ended = () => text('m-ended', '', {
            kind: 'result',
            ref: { game: 'ludo', winners: [] },
            line: { key: 'chat.line.result.void', params: { game: 'ludo' } }
        });
        const card = show(ended()).querySelector('.rounded-panel')!;
        const [title, said] = [...card.querySelectorAll('.truncate')].map((one) => one.textContent?.trim());

        expect([title, said]).toEqual(['Ludo', 'Nura’s team ended it as no contest']);
        expect(card.querySelector('.text-win'), 'a game nobody won was given a trophy').toBeNull();

        cleanup();
        useLocale().setLocale('fa');

        const persian = show(ended()).querySelector('.rounded-panel')!;

        expect([...persian.querySelectorAll('.truncate')].map((one) => one.textContent?.trim())).toEqual(['منچ', 'تیم نورا بازی رو بی‌نتیجه تموم کرد']);
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

describe('what became of a line of the reader’s', () =>
{
    const statusOf = (container: HTMLElement) => container.querySelector('time [data-status]');

    it('says a line was sent until somebody has read it, and read after', async () =>
    {
        const first = text('mine', 'Up for a game?', { from: 'alex' });
        const { container, read } = await held(first);
        const status = statusOf(container);

        expect(status?.getAttribute('data-status')).toBe('sent');
        expect(status?.textContent).toContain(useLocale().t('chat.sent'));
        expect(status?.querySelector('svg'), 'a mark, not only words for a screen reader').not.toBeNull();

        const row = container.querySelector('[data-message]');

        await read({ ...first, read: true });

        expect(statusOf(container)?.getAttribute('data-status')).toBe('read');
        expect(statusOf(container)?.textContent).toContain(useLocale().t('chat.read'));
        expect(container.querySelector('[data-message]'), 'the line was drawn again').toBe(row);
    });

    it('says nothing of the sort on anybody else’s line, read or not', () =>
    {
        expect(statusOf(show(text('theirs', 'Sure', { read: true })))).toBeNull();
    });

    it('keeps room after the time for the mark, so the last line never runs under it', () =>
    {
        const mine = show(text('mine', 'Up for a game?', { from: 'alex' }));
        const reserve = [...mine.querySelectorAll('.invisible')].find((node) => node.getAttribute('aria-hidden') === 'true');

        expect(reserve?.classList.contains('pe-4'), 'the reserve after the reader’s own line').toBe(true);

        cleanup();

        const theirs = show(text('theirs', 'Sure'));
        const plain = [...theirs.querySelectorAll('.invisible')].find((node) => node.getAttribute('aria-hidden') === 'true');

        expect(plain?.classList.contains('pe-4'), 'and none after anybody else’s').toBe(false);
    });

    it('says it in Persian too', async () =>
    {
        useLocale().setLocale('fa');

        const sent = show(text('mine', 'سلام', { from: 'alex' }));

        expect(statusOf(sent)?.textContent).toContain(useLocale().t('chat.sent'));
        expect(useLocale().t('chat.sent')).not.toBe('Sent');
    });
});

describe('a line of the reader’s on its way', () =>
{
    it('wears a clock while it goes, and offers nothing to do with it yet', () =>
    {
        const container = show(text('mine', 'on its way', { from: 'alex', outgoing: 'sending' }));
        const status = container.querySelector('time [data-status]');

        expect(status?.getAttribute('data-status')).toBe('sending');
        expect(status?.textContent).toContain(useLocale().t('chat.sending'));
        expect(container.querySelector(`button[aria-label="${ useLocale().t('chat.more') }"]`), 'no actions on a line the server has not got').toBeNull();
    });

    it('says a line was not sent, and offers to send it again or take it away', () =>
    {
        const retried: string[] = [];
        const dropped: string[] = [];
        const router = createRouter({ routes, history: createMemoryHistory('/app/chats/c-1'), scroll: false });
        const message = text('mine', 'did not go', { from: 'alex', outgoing: 'failed' });
        const container = renderTest(() => RouterProvider({
            router,
            children: () => MessageBubble({
                message,
                me: 'alex',
                onActions: () => undefined,
                onRetry: (one) => retried.push(one.id),
                onDiscard: (one) => dropped.push(one.id)
            })
        }) as Rendered).container;
        const button = (words: string) => [...container.querySelectorAll('button')].find((one) => one.textContent?.trim() === words);

        expect(container.querySelector('time [data-status]')?.getAttribute('data-status')).toBe('failed');
        expect(container.querySelector('[role="status"]')?.textContent).toContain(useLocale().t('chat.unsent'));

        fire(button(useLocale().t('common.retry'))!, 'click');
        fire(button(useLocale().t('chat.delete'))!, 'click');

        expect(retried).toEqual(['mine']);
        expect(dropped).toEqual(['mine']);
    });

    it('is the same line once the server has it, and only then offers its actions', async () =>
    {
        const first = text('mine', 'landing', { from: 'alex', outgoing: 'sending' });
        const { container, read } = await held(first);
        const row = container.querySelector('[data-message]');

        await read(text('mine', 'landing', { from: 'alex' }));

        expect(container.querySelector('[data-message]'), 'drawn again as it landed').toBe(row);
        expect(container.querySelector('time [data-status]')?.getAttribute('data-status')).toBe('sent');
    });
});

describe('a right click on a line, and the bar a pointer finds beside it', () =>
{
    const menued = (message: Message) =>
    {
        const asked: Array<{ id: string; at: { x: number; y: number }; anchor: HTMLElement }> = [];
        const router = createRouter({ routes, history: createMemoryHistory('/app/chats/c-1'), scroll: false });
        const container = renderTest(() => RouterProvider({
            router,
            children: () => MessageBubble({
                message,
                me: 'alex',
                onActions: () => undefined,
                onReply: () => undefined,
                onReact: () => undefined,
                onMenu: (one: Message, at: { x: number; y: number }, anchor: HTMLElement) => asked.push({ id: one.id, at, anchor })
            })
        }) as Rendered).container;

        return { container, asked };
    };

    const right = (target: Element) =>
    {
        const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 120, clientY: 240 });

        target.dispatchEvent(event);
        return event;
    };

    const boxed = (element: Element, left: number, top: number, width: number, height: number) =>
    {
        Object.defineProperty(element, 'getBoundingClientRect', {
            configurable: true,
            value: () => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top })
        });
    };

    afterEach(() =>
    {
        useDevice().overrideCoarse(null);
        vi.restoreAllMocks();
    });

    it('opens the line’s menu at the pointer, by the line, and keeps the browser’s own off it', () =>
    {
        const { container, asked } = menued(text('m-1', 'Up for a game?'));
        const event = right(container.querySelector('.bubble')!);

        expect(event.defaultPrevented).toBe(true);
        expect(asked.map((one) => [one.id, one.at])).toEqual([['m-1', { x: 120, y: 240 }]]);
        expect(asked[0].anchor).toBe(container.querySelector('[data-message="m-1"]'));
    });

    it('leaves a finger to its held press', () =>
    {
        useDevice().overrideCoarse(true);

        const { container, asked } = menued(text('m-1', 'Up for a game?'));

        expect(right(container.querySelector('.bubble')!).defaultPrevented).toBe(false);
        expect(asked).toEqual([]);
    });

    it('leaves a link and words chosen in the line to the browser’s own menu', () =>
    {
        const { container, asked } = menued(text('m-1', 'see https://example.com/a'));
        const bubble = container.querySelector('.bubble')!;

        expect(right(bubble.querySelector('a')!).defaultPrevented, 'a link').toBe(false);

        vi.spyOn(window, 'getSelection').mockReturnValue({ isCollapsed: false, anchorNode: bubble.firstChild } as unknown as Selection);
        expect(right(bubble).defaultPrevented, 'words chosen in the line').toBe(false);

        vi.spyOn(window, 'getSelection').mockReturnValue({ isCollapsed: false, anchorNode: document.body } as unknown as Selection);
        expect(right(bubble).defaultPrevented, 'words chosen somewhere else').toBe(true);
        expect(asked).toHaveLength(1);
    });

    it('offers nothing on a line still on its way, one this browser cannot open, or one the server wrote', () =>
    {
        const going = menued(text('mine', 'on its way', { from: 'alex', outgoing: 'sending' }));

        expect(right(going.container.querySelector('.bubble')!).defaultPrevented, 'on its way').toBe(false);
        cleanup();

        const shut = menued(text('m-1', '', { locked: 'no-epoch-key' }));

        expect(right(shut.container.querySelector('[data-message]')!).defaultPrevented, 'locked').toBe(false);
        cleanup();

        const written = menued({ ...text('m-2', ''), kind: 'system', line: { key: 'chat.line.group.joined', params: { who: 'sara.k' } } });

        expect(right(written.container.querySelector('p')!).defaultPrevented, 'a line of the server’s').toBe(false);
        expect([...going.asked, ...shut.asked, ...written.asked]).toEqual([]);
    });

    it('lets its bar take the pointer only while its line is hovered or holds the keyboard, with room round it to cross to it', () =>
    {
        const { container } = menued(text('m-1', 'Up for a game?'));
        const bar = [...container.querySelectorAll<HTMLElement>('div')].find((one) => one.className.includes('pointer-fine:flex'))!;
        const classes = bar.className.split(/\s+/);

        expect(classes, 'a bar nobody can see covers no line').toContain('pointer-events-none');
        expect(classes, 'and takes the pointer while its own line is hovered or holds the keyboard').toEqual(expect.arrayContaining(['group-hover/row:pointer-events-auto', 'focus-within:pointer-events-auto']));
        expect(classes, 'a bridge over the gaps fitBar leaves between the line and the bar, 8px across and 4px up and down').toEqual(expect.arrayContaining(['before:absolute', 'before:-inset-x-2', 'before:-inset-y-1', 'before:-z-10']));
        expect(classes, 'and no deeper, or it would reach past the end of the thread').not.toContain('before:-inset-2');
    });

    it('rests just inside the foot of its line until it is laid, and once laid is held by its top alone', () =>
    {
        const { container } = menued(text('m-1', 'Up for a game?'));
        const row = container.querySelector<HTMLElement>('[data-message]')!;
        const bar = [...container.querySelectorAll<HTMLElement>('div')].find((one) => one.className.includes('pointer-fine:flex'))!;
        const classes = bar.className.split(/\s+/);

        expect(classes, 'inside the foot of the newest line, where the thread already reaches').toContain('bottom-1');
        expect(classes, 'not hanging from the top of a line shorter than itself').not.toContain('top-0');

        Object.defineProperty(bar, 'offsetWidth', { configurable: true, value: 120 });
        Object.defineProperty(bar, 'offsetHeight', { configurable: true, value: 36 });
        boxed(row, 0, 100, 800, 60);
        boxed(bar.parentElement!, 40, 110, 300, 40);
        row.dispatchEvent(new Event('pointerenter'));

        expect([bar.style.top, bar.style.bottom], 'laid by its top, the foot let go').toEqual(['2px', 'auto']);
    });

    it('steps its bar aside while its menu is open, and keeps it', async () =>
    {
        const [open, setOpen] = createSignal(false);
        const router = createRouter({ routes, history: createMemoryHistory('/app/chats/c-1'), scroll: false });
        const container = renderTest(() => RouterProvider({
            router,
            children: () => MessageBubble({
                message: text('m-1', 'Up for a game?'),
                me: 'alex',
                onActions: () => undefined,
                onReply: () => undefined,
                onReact: () => undefined,
                onMenu: () => undefined,
                get menued()
                {
                    return open();
                }
            })
        }) as Rendered).container;
        const bar = () => [...container.querySelectorAll<HTMLElement>('div')].find((one) => one.className.includes('pointer-fine:flex'))!;
        const drawn = bar();

        expect(drawn.classList.contains('invisible')).toBe(false);

        setOpen(true);
        await settle();

        expect(bar().classList.contains('invisible'), 'aside while the menu is open').toBe(true);

        setOpen(false);
        await settle();

        expect(bar().classList.contains('invisible'), 'back once it is shut').toBe(false);
        expect(bar(), 'the same bar throughout').toBe(drawn);
    });

    it('lays its bar beside a line that leaves it room, and over one that does not', () =>
    {
        const { container } = menued(text('m-1', 'Up for a game?'));
        const row = container.querySelector<HTMLElement>('[data-message]')!;
        const bar = [...container.querySelectorAll<HTMLElement>('div')].find((one) => one.className.includes('pointer-fine:flex'))!;

        expect(bar, 'the bar a pointer finds').toBeDefined();

        Object.defineProperty(bar, 'offsetWidth', { configurable: true, value: 120 });
        Object.defineProperty(bar, 'offsetHeight', { configurable: true, value: 36 });
        boxed(row, 0, 100, 800, 60);
        boxed(bar.parentElement!, 40, 110, 300, 40);

        row.dispatchEvent(new Event('pointerenter'));

        expect([bar.style.left, bar.style.top], 'beside the line').toEqual(['308px', '2px']);

        boxed(bar.parentElement!, 40, 110, 700, 40);
        bar.querySelector('button')!.dispatchEvent(new Event('focusin', { bubbles: true }));

        expect([bar.style.left, bar.style.top], 'over the far end of a line too wide, found by the keyboard as well').toEqual(['580px', '-40px']);
    });
});

describe('a line its author edited', () =>
{
    const edited = { id: 'e-1', at: 1_700_000_100_000, plain: '{"edit":"changed words","on":"m-1"}', frankingKey: 'key' };

    const reserveOf = (container: HTMLElement) => [...container.querySelectorAll('.invisible')].find((node) => node.getAttribute('aria-hidden') === 'true');

    it('says so beside its time, and keeps room for the words so the last line never runs under them', () =>
    {
        const container = show(text('m-1', 'changed words', { edited }));

        expect(container.querySelector('time')?.textContent).toContain(useLocale().t('chat.edited'));
        expect(reserveOf(container)?.textContent).toContain(useLocale().t('chat.edited'));
    });

    it('says nothing of the sort on a line nobody changed', () =>
    {
        const container = show(text('m-1', 'as written'));

        expect(container.querySelector('time')?.textContent).not.toContain(useLocale().t('chat.edited'));
        expect(reserveOf(container)?.textContent).not.toContain(useLocale().t('chat.edited'));
    });

    it('says it in Persian', () =>
    {
        useLocale().setLocale('fa');

        const container = show(text('m-1', 'عوض شد', { edited }));

        expect(useLocale().t('chat.edited')).not.toBe('edited');
        expect(container.querySelector('time')?.textContent).toContain(useLocale().t('chat.edited'));
    });

    it('takes the new words and the mark on the line it was, when the line is read again edited', async () =>
    {
        const first = text('m-1', 'as written');
        const { container, read } = await held(first);
        const row = container.querySelector('[data-message]');

        await read({ ...first, text: 'changed words', edited });

        expect(container.querySelector('.bubble')?.textContent).toContain('changed words');
        expect(container.querySelector('time')?.textContent).toContain(useLocale().t('chat.edited'));
        expect(container.querySelector('[data-message]'), 'the same line').toBe(row);
    });
});

describe('a line the thread’s search brought the reader to', () =>
{
    const drawn = (found: () => boolean, replying: () => boolean) =>
    {
        const router = createRouter({ routes, history: createMemoryHistory('/app/chats/c-1'), scroll: false });

        return renderTest(() => RouterProvider({
            router,
            children: () => MessageBubble({
                message: text('m-found', 'never'),
                me: 'alex',
                onActions: () => undefined,
                get found()
                {
                    return found();
                },
                get replying()
                {
                    return replying();
                }
            })
        }) as Rendered).container;
    };

    it('wears a gold ring of its own while it is the one found, in the bubble it was', async () =>
    {
        const [found, setFound] = createSignal(true);
        const [replying] = createSignal(false);
        const container = drawn(found, replying);
        const bubble = () => container.querySelector<HTMLElement>('.bubble')!;

        await settle();

        const kept = bubble();

        expect(kept.hasAttribute('data-found')).toBe(true);
        expect(kept.className).toContain('ring-gold');

        setFound(false);
        await settle();

        expect(bubble(), 'the same bubble').toBe(kept);
        expect(kept.hasAttribute('data-found')).toBe(false);
        expect(kept.className).not.toContain('ring-gold');
    });

    it('wears the reply’s ring instead while it is being answered, so the two are never one ring', async () =>
    {
        const [found] = createSignal(true);
        const [replying] = createSignal(true);
        const container = drawn(found, replying);

        await settle();

        const bubble = container.querySelector<HTMLElement>('.bubble')!;

        expect(bubble.className).toContain('ring-accent');
        expect(bubble.className).not.toContain('ring-gold');
    });
});
