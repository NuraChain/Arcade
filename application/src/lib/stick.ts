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

export interface Scrolled
{
    scrollTop: number;
    scrollHeight: number;
    clientHeight: number;
}

export function isNearBottom(view: Scrolled, slack: number = STICK_SLACK): boolean
{
    return view.scrollHeight - view.scrollTop - view.clientHeight <= slack;
}

/**
 * Reports whether `element` is near its bottom, now and on every scroll, and hands back the removal.
 *
 * It reports once immediately so a caller never starts from a guess, and the listener is passive
 * because nothing here calls `preventDefault`.
 */
export function attachStick(element: HTMLElement, onChange: (near: boolean) => void, slack: number = STICK_SLACK): () => void
{
    const read = (): void => onChange(isNearBottom(element, slack));

    element.addEventListener('scroll', read, { passive: true });
    read();

    return (): void => element.removeEventListener('scroll', read);
}
