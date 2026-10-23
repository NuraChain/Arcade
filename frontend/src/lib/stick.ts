import { runtime } from './runtime.ts';

/**
 * Whether a scroller is close enough to its bottom that new content should follow it down.
 *
 * The chat used to decide this with `messages.length + typing.length >= 0` - a sum of two lengths,
 * so always true - which made the guard dead code and the behaviour "jump to the bottom on every
 * change". That included somebody merely starting to type, and it fired while a reader was part way
 * up the history, so reading an old message was interrupted by anyone's keystroke.
 *
 * The question is not "did something change" but "was the reader at the bottom BEFORE it changed",
 * and only the second one can be answered without taking the scroll away from them.
 *
 * Split out as plain arithmetic because jsdom has no layout: `scrollTop`, `scrollHeight` and
 * `clientHeight` are ordinary properties there, so a spec can install them and drive this directly,
 * the way `touch.spec.ts` drives `attachGestures`.
 */
export const STICK_SLACK = 120;

/** How long a journey to a line may take before the scroll speaks for the reader again: a browser that never says a scroll has ended still ends it. */
export const JOURNEY_MS = 1500;

export interface Scrolled
{
    scrollTop: number;
    scrollHeight: number;
    clientHeight: number;
}

export function isNearBottom(view: Scrolled, slack: number = STICK_SLACK)
{
    return view.scrollHeight - view.scrollTop - view.clientHeight <= slack;
}

/**
 * Where `centreOn` is taking a scroller, while it goes. The scroll on the way says nothing about
 * where the reader is: its first frames are still at the end, and taken for the reader's place they
 * let a line arriving pull the thread back to its end, cutting the journey short. A search that read
 * back a page to reach its oldest match was cut short that way every time.
 */
const heading = new WeakMap<HTMLElement, number>();

/** What each scroller's stick reads, so a journey given up on can read it again. */
const readers = new WeakMap<HTMLElement, () => void>();

/**
 * Reports whether `element` is near its bottom, now and on every scroll, and hands back the removal.
 *
 * It reports once immediately so a caller never starts from a guess, and the listener is passive
 * because nothing here calls `preventDefault`. While `centreOn` is taking the element somewhere it
 * reports nothing until the scroll arrives, ends, or the reader takes it with a wheel or a finger.
 */
export function attachStick(element: HTMLElement, onChange: (near: boolean) => void, slack: number = STICK_SLACK): () => void
{
    const read = () =>
    {
        const bound = heading.get(element);

        if (bound !== undefined && Math.abs(element.scrollTop - bound) > 1)
        {
            return;
        }

        heading.delete(element);
        onChange(isNearBottom(element, slack));
    };
    const ended = () =>
    {
        heading.delete(element);
        read();
    };
    const taken = () => heading.delete(element);

    element.addEventListener('scroll', read, { passive: true });
    element.addEventListener('scrollend', ended, { passive: true });
    element.addEventListener('wheel', taken, { passive: true });
    element.addEventListener('touchstart', taken, { passive: true });
    readers.set(element, read);
    read();

    return () =>
    {
        element.removeEventListener('scroll', read);
        element.removeEventListener('scrollend', ended);
        element.removeEventListener('wheel', taken);
        element.removeEventListener('touchstart', taken);
        readers.delete(element);
    };
}

/**
 * Takes `element` so that `line` stands in its middle, or as near it as the ends allow, and answers
 * whether the reader is near the end there. That answer holds from the moment they ask, not from
 * when the scroll arrives.
 */
export function centreOn(element: HTMLElement, line: Element, smooth: boolean, slack: number = STICK_SLACK)
{
    const frame = element.getBoundingClientRect();
    const box = line.getBoundingClientRect();
    const most = Math.max(0, element.scrollHeight - element.clientHeight);
    const top = Math.round(Math.min(most, Math.max(0, element.scrollTop + box.top - frame.top - (element.clientHeight - box.height) / 2)));

    if (Math.abs(element.scrollTop - top) > 1)
    {
        heading.set(element, top);
        runtime().clock.after(JOURNEY_MS, () =>
        {
            if (heading.get(element) === top)
            {
                heading.delete(element);
                readers.get(element)?.();
            }
        });
    }
    else
    {
        heading.delete(element);
    }

    element.scrollTo({ top, behavior: smooth ? 'smooth' : 'auto' });

    return isNearBottom({ scrollTop: top, scrollHeight: element.scrollHeight, clientHeight: element.clientHeight }, slack);
}
