const SELECTOR = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled]):not([type="hidden"])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
    '[contenteditable="true"]'
].join(',');

function visible(element: HTMLElement): boolean
{
    return element.getClientRects().length > 0 || element === document.activeElement;
}

export function tabbables(root: HTMLElement): HTMLElement[]
{
    return Array.from(root.querySelectorAll<HTMLElement>(SELECTOR)).filter((element) =>
        !element.hasAttribute('inert') && element.closest('[inert]') === null && visible(element));
}

export function firstTabbable(root: HTMLElement): HTMLElement | null
{
    const preferred = root.querySelector<HTMLElement>('[autofocus]');
    if (preferred !== null)
    {
        return preferred;
    }
    return tabbables(root)[0] ?? null;
}

export function isInside(root: HTMLElement, node: Node | null): boolean
{
    return node !== null && root.contains(node);
}

export function focusQuietly(element: HTMLElement | null): void
{
    if (element === null)
    {
        return;
    }
    try
    {
        element.focus({ preventScroll: true });
    }
    catch
    {
        element.focus();
    }
}
