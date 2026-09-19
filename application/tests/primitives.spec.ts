import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, fire, renderTest } from '@azerothjs/testing';

import Badge from '../src/components/ui/badge.component.azeroth';
import Pagination from '../src/components/ui/pagination.component.azeroth';
import Slider from '../src/components/ui/slider.component.azeroth';
import Tooltip from '../src/components/ui/tooltip.component.azeroth';
import { place, physicalSide } from '../src/lib/anchor.ts';
import { clampPage, pageCount, slice, windowOf } from '../src/lib/pagination.ts';
import { createDrag } from '../src/lib/swipe.ts';
import { manualClock, type ManualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import '../src/locales/app-catalogue.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { TOAST_VISIBLE, useToasts } from '../src/stores/toasts.store.ts';

type Rendered = HTMLElement;

const noop = (): void => undefined;

let clock: ManualClock;

const settle = async (): Promise<void> =>
{
    await Promise.resolve();
    await Promise.resolve();
};

beforeEach(() =>
{
    cleanup();
    resetRuntime();
    clock = manualClock(500_000);
    setRuntime({ clock, seed: 12 });
    useLocale().setLocale('en');
    useToasts().reset();
});

afterEach(() =>
{
    cleanup();
    useToasts().reset();
});

describe('anchor placement', () =>
{
    const viewport = { width: 1000, height: 800 };
    const anchor = { x: 400, y: 400, width: 40, height: 40 };
    const floating = { width: 120, height: 40 };

    it('resolves logical sides against the reading direction', () =>
    {
        expect(physicalSide('start', false)).toBe('left');
        expect(physicalSide('start', true)).toBe('right');
        expect(physicalSide('end', false)).toBe('right');
        expect(physicalSide('end', true)).toBe('left');
        expect(physicalSide('top', true)).toBe('top');
    });

    it('centres on the anchor and sits the requested gap away', () =>
    {
        const placed = place(anchor, floating, viewport, { side: 'top', gap: 10 });
        expect(placed.side).toBe('top');
        expect(placed.y).toBe(400 - 10 - 40);
        expect(placed.x).toBe(400 + 20 - 60);
    });

    it('flips to the opposite side when the preferred one does not fit', () =>
    {
        const high = { x: 400, y: 10, width: 40, height: 40 };
        expect(place(high, floating, viewport, { side: 'top' }).side).toBe('bottom');
        const low = { x: 400, y: 750, width: 40, height: 40 };
        expect(place(low, floating, viewport, { side: 'bottom' }).side).toBe('top');
    });

    it('does not flip when asked not to', () =>
    {
        const high = { x: 400, y: 10, width: 40, height: 40 };
        expect(place(high, floating, viewport, { side: 'top', flip: false }).side).toBe('top');
    });

    it('shifts along the cross axis to stay inside the viewport', () =>
    {
        const edge = { x: 4, y: 400, width: 40, height: 40 };
        const placed = place(edge, floating, viewport, { side: 'top', padding: 8 });
        expect(placed.x).toBe(8);
        expect(placed.arrow).toBeGreaterThanOrEqual(10);
        expect(placed.arrow).toBeLessThanOrEqual(floating.width - 10);
    });

    it('keeps a wide floating box inside the right edge too', () =>
    {
        const edge = { x: 980, y: 400, width: 40, height: 40 };
        const placed = place(edge, floating, viewport, { side: 'top', padding: 8 });
        expect(placed.x + floating.width).toBeLessThanOrEqual(viewport.width - 8);
    });
});

describe('pagination maths', () =>
{
    it('counts pages and clamps out-of-range requests', () =>
    {
        expect(pageCount(0, 10)).toBe(1);
        expect(pageCount(10, 10)).toBe(1);
        expect(pageCount(11, 10)).toBe(2);
        expect(clampPage(0, 5)).toBe(1);
        expect(clampPage(9, 5)).toBe(5);
    });

    it('reports the visible range', () =>
    {
        const view = windowOf(24, 8, 2);
        expect(view.from).toBe(9);
        expect(view.to).toBe(16);
        expect(view.pages).toBe(3);
    });

    it('always keeps the first and last page, with gaps in between', () =>
    {
        const view = windowOf(200, 10, 10);
        expect(view.items[0]).toBe(1);
        expect(view.items[view.items.length - 1]).toBe(20);
        expect(view.items).toContain('gap');
        expect(view.items).toContain(10);
    });

    it('never emits a gap that hides a single page', () =>
    {
        const view = windowOf(50, 10, 1);
        const index = view.items.indexOf('gap');
        if (index > 0)
        {
            const before = view.items[index - 1] as number;
            const after = view.items[index + 1] as number;
            expect(after - before).toBeGreaterThan(1);
        }
    });

    it('slices the page it describes', () =>
    {
        const items = Array.from({ length: 25 }, (_value, index) => index);
        expect(slice(items, 10, 1)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
        expect(slice(items, 10, 3)).toEqual([20, 21, 22, 23, 24]);
        expect(slice(items, 10, 99)).toEqual([20, 21, 22, 23, 24]);
    });
});

describe('drag', () =>
{
    it('locks to the axis the finger actually moved', () =>
    {
        const drag = createDrag({ threshold: 50, velocity: 0.5, axis: 'y' });
        drag.start(100, 100, 0);
        drag.move(160, 104, 20);
        expect(drag.axis()).toBe('x');
        expect(drag.active()).toBe(false);
    });

    it('ignores movement below the lock distance', () =>
    {
        const drag = createDrag({ threshold: 50, velocity: 0.5, axis: 'y' });
        drag.start(100, 100, 0);
        expect(drag.move(102, 103, 10).axis).toBeNull();
        expect(drag.active()).toBe(true);
    });

    it('dismisses past the threshold', () =>
    {
        const drag = createDrag({ threshold: 50, velocity: 5, axis: 'y' });
        drag.start(100, 100, 0);
        drag.move(100, 140, 40);
        drag.move(100, 180, 80);
        expect(drag.end(80).dismiss).toBe(true);
    });

    it('dismisses on a flick that never reached the threshold', () =>
    {
        const drag = createDrag({ threshold: 500, velocity: 0.5, axis: 'y' });
        drag.start(100, 100, 0);
        drag.move(100, 120, 10);
        drag.move(100, 150, 20);
        expect(drag.end(20).dismiss).toBe(true);
    });

    it('does not read a flick when the finger paused before lifting', () =>
    {
        const drag = createDrag({ threshold: 500, velocity: 0.5, axis: 'y' });
        drag.start(100, 100, 0);
        drag.move(100, 120, 10);
        drag.move(100, 150, 20);
        expect(drag.end(400).dismiss).toBe(false);
    });

    it('clamps to one direction unless told otherwise', () =>
    {
        const drag = createDrag({ threshold: 50, velocity: 5, axis: 'y' });
        drag.start(100, 100, 0);
        expect(drag.move(100, 40, 20).offset).toBe(0);

        const signed = createDrag({ threshold: 50, velocity: 5, axis: 'y', allowNegative: true });
        signed.start(100, 100, 0);
        expect(signed.move(100, 40, 20).offset).toBe(-60);
    });
});

describe('Badge', () =>
{
    it('renders nothing for zero unless asked', () =>
    {
        const { container } = renderTest(() => Badge({ count: 0 }) as Rendered);
        expect(container.textContent).toBe('');
        cleanup();
        const shown = renderTest(() => Badge({ count: 0, showZero: true }) as Rendered);
        expect(shown.container.textContent).toBe('0');
    });

    it('caps at the maximum', () =>
    {
        const { container } = renderTest(() => Badge({ count: 250, max: 99 }) as Rendered);
        expect(container.textContent).toBe('99+');
    });

    it('renders free text as well as a count', () =>
    {
        const { container } = renderTest(() => Badge({ text: 'NEW', tone: 'gold' }) as Rendered);
        expect(container.textContent).toBe('NEW');
    });

    it('draws a dot with no text but keeps its label', () =>
    {
        const { container } = renderTest(() => Badge({ dot: true, tone: 'live', label: 'unread' }) as Rendered);

        /*
         * By label rather than by `querySelector('span')`. Every badge is wrapped in a `Tooltip`
         * host - `display: contents` and boxless when there is nothing to say - so the first span is
         * the host and the one being asked about is the badge inside it.
         */
        const dot = container.querySelector('[aria-label="unread"]')!;

        expect(dot.textContent).toBe('');
        expect(dot.getAttribute('role')).toBe('status');
    });

    /**
     * A badge is a number with no noun. `label` answers that for a screen reader and `tip` answers
     * it for everybody else, through the product's own tooltip rather than the browser's `title` -
     * which cannot be styled, cannot be reached by a finger, and renders in the OS's font.
     */
    it('says what a count means through the product tooltip, never the browser one', () =>
    {
        const { container } = renderTest(() => Badge({ count: 3, tip: 'three unread', label: 'unread' }) as Rendered);

        expect(container.querySelector('[title]'), 'a badge used the browser tooltip').toBeNull();
        expect(container.textContent).toContain('3');

        const host = container.querySelector('span')!;

        expect(host.getAttribute('aria-describedby'), 'the tooltip is not open until it is asked for').toBeNull();
    });

    it('takes no box at all when there is nothing to say', () =>
    {
        const { container } = renderTest(() => Badge({ count: 3, label: 'unread' }) as Rendered);
        const host = container.querySelector('span')!;

        expect(host.className, 'an untipped badge still costs a box').toContain('contents');
    });
});

describe('Pagination', () =>
{
    it('marks exactly one current page and moves on click', async () =>
    {
        const onPage = vi.fn();
        const { container } = renderTest(() => Pagination({ total: 40, size: 10, page: 2, label: 'Pages', onPage }) as Rendered);
        await settle();

        expect(container.querySelectorAll('[aria-current="page"]').length).toBe(1);
        expect(container.querySelector('[aria-current="page"]')?.textContent).toBe('2');

        const next = container.querySelector('button[aria-label="Next page"]') as HTMLButtonElement;
        fire(next, 'click');
        expect(onPage).toHaveBeenCalledWith(3);
    });

    it('disables the ends and renders nothing for a single page', async () =>
    {
        const { container } = renderTest(() => Pagination({ total: 40, size: 10, page: 1, label: 'Pages', onPage: noop }) as Rendered);
        await settle();
        expect((container.querySelector('button[aria-label="Previous page"]') as HTMLButtonElement).disabled).toBe(true);
        cleanup();

        const single = renderTest(() => Pagination({ total: 6, size: 10, page: 1, label: 'Pages', onPage: noop }) as Rendered);
        await settle();
        expect(single.container.querySelector('nav')).toBeNull();
    });

    it('offers a load-more button that counts what is left', async () =>
    {
        const onPage = vi.fn();
        const { container } = renderTest(() => Pagination({ total: 40, size: 8, page: 1, mode: 'more', label: 'More', onPage }) as Rendered);
        await settle();
        const button = container.querySelector('button') as HTMLButtonElement;
        expect(button.textContent).toContain('32');
        fire(button, 'click');
        expect(onPage).toHaveBeenCalledWith(2);
    });
});

describe('Slider', () =>
{
    it('exposes the slider role with its range', async () =>
    {
        const { container } = renderTest(() => Slider({ value: 0.4, min: 0, max: 1, step: 0.1, label: 'Width', onChange: noop }) as Rendered);
        await settle();
        const slider = container.querySelector('[role="slider"]')!;
        expect(slider.getAttribute('aria-valuemin')).toBe('0');
        expect(slider.getAttribute('aria-valuemax')).toBe('1');
        expect(slider.getAttribute('aria-valuenow')).toBe('0.4');
        expect(slider.getAttribute('tabindex')).toBe('0');
    });

    it('steps with the arrow keys and jumps with Home and End', async () =>
    {
        const onChange = vi.fn();
        const { container } = renderTest(() => Slider({ value: 0.5, min: 0, max: 1, step: 0.25, label: 'Width', onChange }) as Rendered);
        await settle();
        const slider = container.querySelector('[role="slider"]') as HTMLElement;

        slider.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
        expect(onChange).toHaveBeenLastCalledWith(0.75);

        slider.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
        expect(onChange).toHaveBeenLastCalledWith(0.25);

        slider.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
        expect(onChange).toHaveBeenLastCalledWith(0);

        slider.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
        expect(onChange).toHaveBeenLastCalledWith(1);
    });

    it('never steps past its own bounds', async () =>
    {
        const onChange = vi.fn();
        const { container } = renderTest(() => Slider({ value: 1, min: 0, max: 1, step: 0.25, label: 'Width', onChange }) as Rendered);
        await settle();
        (container.querySelector('[role="slider"]') as HTMLElement).dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
        expect(onChange).toHaveBeenLastCalledWith(1);
    });

    it('refuses keyboard and pointer input while disabled', async () =>
    {
        const onChange = vi.fn();
        const { container } = renderTest(() => Slider({ value: 0.5, label: 'Width', disabled: true, onChange }) as Rendered);
        await settle();
        const slider = container.querySelector('[role="slider"]') as HTMLElement;
        expect(slider.getAttribute('tabindex')).toBe('-1');
        slider.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
        expect(onChange).not.toHaveBeenCalled();
    });
});

describe('Tooltip', () =>
{
    const Probe = (): HTMLElement =>
    {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = 'more';
        return button;
    };

    /**
     * Tabs to the trigger, by FOCUSING it rather than by dispatching a focus event at the wrapper.
     *
     * These used to dispatch `focusin` on the host span, which is not focusable and never became the
     * active element - so the event said focus had arrived while nothing was focused. That was close
     * enough while the tooltip showed for any focus at all, and stopped being close enough the day
     * it started asking `:focus-visible`: the browser's own answer to "did a person tab here" is no
     * when nothing is focused, and it is right.
     *
     * jsdom implements the selector and matches a genuinely focused element, so this is the shape
     * that exercises what a browser does. What jsdom cannot tell apart is a tab from a programmatic
     * `.focus()` - both match there - so the half of the rule that keeps a sheet's close tooltip off
     * its own first paragraph is checked in a real browser and not here.
     */
    const tabTo = (host: HTMLElement): void =>
    {
        const button = host.querySelector('button')!;

        // Blur first: `.focus()` on the element that already has focus fires nothing at all, so a
        // reopen after a synthetic `focusout` would silently measure the tooltip that never closed.
        button.blur();
        button.focus();
    };

    /** Leaves for real, so the element stops being the active one and the next arrival counts. */
    const tabAway = (host: HTMLElement): void =>
    {
        host.querySelector('button')!.blur();
    };

    /**
     * The scroll watch exists to hide a VISIBLE tooltip when the page moves under it, and it used to
     * be armed in `mount` for every instance whether shown or not. `IconButton` wraps every
     * icon-only control in a `Tooltip`, and the listener is registered with `capture: true` - so it
     * ran for a scroll of any scrollable element anywhere, once per icon button on screen. Scrolling
     * a chat thread meant dozens of callbacks per event, each one hiding something already hidden.
     */
    it('holds a scroll listener only while it is actually showing', async () =>
    {
        const added = new Set<EventListenerOrEventListenerObject>();
        const realAdd = window.addEventListener.bind(window);
        const realRemove = window.removeEventListener.bind(window);
        let live = 0;

        const addSpy = vi.spyOn(window, 'addEventListener').mockImplementation((type, listener, options) =>
        {
            if (type === 'scroll')
            {
                live += 1;
                added.add(listener as EventListenerOrEventListenerObject);
            }
            return realAdd(type, listener as EventListenerOrEventListenerObject, options as boolean);
        });
        const removeSpy = vi.spyOn(window, 'removeEventListener').mockImplementation((type, listener, options) =>
        {
            if (type === 'scroll' && added.has(listener as EventListenerOrEventListenerObject))
            {
                live -= 1;
            }
            return realRemove(type, listener as EventListenerOrEventListenerObject, options as boolean);
        });

        try
        {
            const { container } = renderTest(() => Tooltip({ label: 'More actions', children: Probe() }) as Rendered);
            await settle();

            expect(live, 'a hidden tooltip was already listening to every scroll on the page').toBe(0);

            const host = container.querySelector('span')!;
            tabTo(host);
            await settle();
            expect(live, 'a shown tooltip must watch for the page moving under it').toBe(1);

            host.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            await settle();
            expect(live, 'the watch outlived the tooltip it was serving').toBe(0);
        }
        finally
        {
            addSpy.mockRestore();
            removeSpy.mockRestore();
        }
    });

    it('stays closed until focus arrives, then describes its trigger', async () =>
    {
        const { container } = renderTest(() => Tooltip({ label: 'More actions', children: Probe(), id: 'tip-probe' }) as Rendered);
        await settle();
        expect(document.body.querySelector('[role="tooltip"]')).toBeNull();

        const host = container.querySelector('span')!;
        tabTo(host);
        await settle();

        const tip = document.body.querySelector('[role="tooltip"]');
        expect(tip).not.toBeNull();
        expect(tip?.textContent).toBe('More actions');
        expect(host.getAttribute('aria-describedby')).toBe('tip-probe');
    });

    it('closes on blur and on Escape without swallowing focus', async () =>
    {
        const { container } = renderTest(() => Tooltip({ label: 'More actions', children: Probe() }) as Rendered);
        await settle();
        const host = container.querySelector('span')!;

        tabTo(host);
        await settle();
        expect(document.body.querySelector('[role="tooltip"]')).not.toBeNull();
        expect(document.body.querySelector('[role="tooltip"]')?.closest('[tabindex]')).toBeNull();

        host.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await settle();
        expect(document.body.querySelector('[role="tooltip"]')).toBeNull();

        tabTo(host);
        await settle();
        tabAway(host);
        await settle();
        expect(document.body.querySelector('[role="tooltip"]')).toBeNull();
    });

    it('never paints before it has been measured, so a reopen cannot flash at the last position', async () =>
    {
        const { container } = renderTest(() => Tooltip({ label: 'More actions', children: Probe() }) as Rendered);
        await settle();
        const host = container.querySelector('span')!;

        tabTo(host);
        await settle();
        expect(document.body.querySelector('[role="tooltip"]')?.getAttribute('data-placed')).toBe('false');

        tabAway(host);
        await settle();
        tabTo(host);
        await settle();
        expect(document.body.querySelector('[role="tooltip"]')?.getAttribute('data-placed')).toBe('false');
    });

    /**
     * Only one tooltip is ever on screen, and it is a MODULE-level handle that makes it so.
     *
     * Two open at once is not a cosmetic problem: they are portalled to the same anchor root, and
     * the second one's id would be a duplicate of the first while both are described by
     * `aria-describedby`.
     */
    it('closes the one that was open when another opens', async () =>
    {
        const first = renderTest(() => Tooltip({ label: 'First', children: Probe(), id: 'tip-first' }) as Rendered);
        const second = renderTest(() => Tooltip({ label: 'Second', children: Probe(), id: 'tip-second' }) as Rendered);
        await settle();

        tabTo(first.container.querySelector('span')!);
        await settle();
        expect(document.body.querySelector('#tip-first')).not.toBeNull();

        tabTo(second.container.querySelector('span')!);
        await settle();

        expect(document.body.querySelector('#tip-second')).not.toBeNull();
        expect(document.body.querySelector('#tip-first')).toBeNull();
        expect(document.body.querySelectorAll('[role="tooltip"]').length).toBe(1);
    });

    /**
     * A tooltip is placed once, against a box that was measured at that moment. Anything that moves
     * the trigger leaves it pointing at empty space, so scrolling closes it rather than chasing it.
     * The listener is on the capture phase because the product scrolls an ELEMENT, not the window.
     */
    it('closes when anything scrolls underneath it', async () =>
    {
        const { container } = renderTest(() => Tooltip({ label: 'More actions', children: Probe() }) as Rendered);
        await settle();
        const host = container.querySelector('span')!;

        tabTo(host);
        await settle();
        expect(document.body.querySelector('[role="tooltip"]')).not.toBeNull();

        document.body.dispatchEvent(new Event('scroll', { bubbles: true }));
        await settle();
        expect(document.body.querySelector('[role="tooltip"]')).toBeNull();
    });

    it('drops a pending open when the pointer leaves before the delay elapses', async () =>
    {
        const { container } = renderTest(() => Tooltip({ label: 'More actions', children: Probe(), delay: 300 }) as Rendered);
        await settle();
        const host = container.querySelector('span')!;

        const enter = new Event('pointerenter', { bubbles: true });
        Object.defineProperty(enter, 'pointerType', { value: 'mouse' });
        host.dispatchEvent(enter);
        clock.advance(120);
        host.dispatchEvent(new Event('pointerleave', { bubbles: true }));
        clock.advance(600);
        await settle();
        expect(document.body.querySelector('[role="tooltip"]')).toBeNull();
    });
});

describe('toasts', () =>
{
    it('shows at most three and queues the rest', () =>
    {
        const toasts = useToasts();
        for (let index = 0; index < 5; index += 1)
        {
            toasts.show({ text: `toast ${ index }` });
        }
        expect(toasts.items().length).toBe(TOAST_VISIBLE);
        expect(toasts.queued()).toBe(2);

        toasts.dismiss(toasts.items()[0].id);
        expect(toasts.items().length).toBe(TOAST_VISIBLE);
        expect(toasts.queued()).toBe(1);
    });

    it('keeps errors on screen and lets everything else expire', () =>
    {
        const toasts = useToasts();
        toasts.show({ text: 'gone soon' });
        toasts.show({ kind: 'error', text: 'stays' });
        clock.advance(10_000);
        expect(toasts.items().length).toBe(1);
        expect(toasts.items()[0].kind).toBe('error');
    });

    it('pauses and resumes without eating the remaining time', () =>
    {
        const toasts = useToasts();
        const id = toasts.show({ text: 'hold me', duration: 4000 });

        clock.advance(1000);
        toasts.pause(id);
        expect(toasts.items()[0].remaining).toBe(3000);

        clock.advance(60_000);
        expect(toasts.items().length).toBe(1);

        toasts.resume(id);
        clock.advance(2900);
        expect(toasts.items().length).toBe(1);
        clock.advance(200);
        expect(toasts.items().length).toBe(0);
    });

    it('collapses repeats that share a dedupe key', () =>
    {
        const toasts = useToasts();
        const first = toasts.show({ text: 'saved', dedupe: 'save' });
        const second = toasts.show({ text: 'saved again', dedupe: 'save' });
        expect(second).toBe(first);
        expect(toasts.items().length).toBe(1);
        expect(toasts.items()[0].text).toBe('saved again');
    });

    it('carries a promise from pending to done', async () =>
    {
        const toasts = useToasts();
        const value = await toasts.promise(Promise.resolve(7), { pending: 'working', done: (result) => `got ${ result }` });
        expect(value).toBe(7);
        expect(toasts.items()[0].kind).toBe('success');
        expect(toasts.items()[0].text).toBe('got 7');
    });

    it('turns a rejected promise into a sticky error', async () =>
    {
        const toasts = useToasts();
        await expect(toasts.promise(Promise.reject(new Error('nope')), { pending: 'working', done: () => 'done', failed: 'failed' })).rejects.toThrow('nope');
        expect(toasts.items()[0].kind).toBe('error');
        expect(toasts.items()[0].text).toBe('failed');
        clock.advance(60_000);
        expect(toasts.items().length).toBe(1);
    });

    it('reports how much of a toast has burned down', () =>
    {
        const toasts = useToasts();
        const id = toasts.show({ text: 'timing', duration: 4000 });
        expect(toasts.progress(id, clock.now())).toBe(0);
        clock.advance(2000);
        expect(toasts.progress(id, clock.now())).toBeCloseTo(0.5, 2);
    });

    /**
     * The bar has to STOP when the countdown stops, and this is what it looked like when it did not.
     *
     * `pause` takes the spent time out of `remaining` and deliberately leaves `startedAt` where it
     * is, because that is what the subtraction was measured from. `progress` then added
     * `now - startedAt` on top of the already-reduced remainder, which counted the same stretch
     * twice - the bar jumped forward the instant the pointer arrived - and went on counting while
     * the pointer sat still, so it crept toward the end of a toast that was not going anywhere.
     */
    it('freezes the progress bar while a toast is paused, rather than jumping it forward', () =>
    {
        const toasts = useToasts();
        const id = toasts.show({ text: 'hover me', duration: 4000 });

        clock.advance(1000);
        const before = toasts.progress(id, clock.now());
        expect(before).toBeCloseTo(0.25, 2);

        toasts.pause(id);
        expect(toasts.progress(id, clock.now())).toBeCloseTo(before, 2);

        clock.advance(5000);
        expect(toasts.progress(id, clock.now())).toBeCloseTo(before, 2);

        toasts.resume(id);
        clock.advance(1000);
        expect(toasts.progress(id, clock.now())).toBeCloseTo(0.5, 2);
    });

    /**
     * A toast is paused by two different things - a pointer arriving and focus landing on it - and
     * both fire when somebody hovers a toast and then tabs to its button. Pausing twice used to take
     * two bites out of one countdown, because the second subtraction measured from the same
     * `startedAt` as the first.
     */
    it('does not take two bites out of the clock when it is paused twice', () =>
    {
        const toasts = useToasts();
        const id = toasts.show({ text: 'hover and focus', duration: 4000 });

        clock.advance(1000);
        toasts.pause(id);
        toasts.pause(id);
        toasts.pause(id);

        expect(toasts.items()[0].remaining).toBe(3000);

        toasts.resume(id);
        clock.advance(2900);
        expect(toasts.items().length).toBe(1);
        clock.advance(200);
        expect(toasts.items().length).toBe(0);
    });

    it('ignores a resume for a toast that was never paused', () =>
    {
        const toasts = useToasts();
        const id = toasts.show({ text: 'running', duration: 4000 });

        clock.advance(1000);
        toasts.resume(id);

        // The countdown must not restart: it should still have 3000 of its 4000 left, so it dies on
        // the original schedule rather than living a second longer for having been touched.
        clock.advance(3000);
        expect(toasts.items().length).toBe(0);
    });
});
