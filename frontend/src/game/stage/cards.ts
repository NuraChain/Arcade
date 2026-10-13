import { centreOf, rectIn, type Rect } from '../motion.ts';

export const CARD_RATIO = 288 / 204;

export function cardNode(card: number | null, width: number): HTMLElement
{
    const box = document.createElement('div');
    const face = document.createElement('span');

    box.style.setProperty('--card-w', `${ width }px`);
    box.style.setProperty('--back-w', `${ width }px`);

    if (card === null)
    {
        face.className = 'card-back';
    }
    else
    {
        face.className = 'card-face';
        face.style.setProperty('--at-rank', String(card % 13));
        face.style.setProperty('--at-suit', String(Math.floor(card / 13)));
    }

    box.append(face);

    return box;
}

export const STACK = 3;

export function stackNode(count: number, width: number)
{
    const box = cardNode(null, width);

    box.classList.add('stack');

    for (let nth = 1; nth < Math.min(STACK, count); nth += 1)
    {
        box.append(document.createElement('span'));
    }

    [...box.children].forEach((back, nth) =>
    {
        back.className = 'card-back';
        (back as HTMLElement).style.setProperty('--i', String(nth));
    });

    return box;
}

export function turnNode(card: number, width: number)
{
    const box = cardNode(null, width);
    const face = cardNode(card, width).firstElementChild as HTMLElement;

    face.style.opacity = '0';
    box.classList.add('turning');
    box.append(face);

    return box;
}

export const drawn = (element: Element | null): element is Element => element !== null && element.getClientRects().length > 0;

export function anchor(layer: Element, places: readonly (Element | null)[])
{
    const place = places.find(drawn) ?? places.filter((one) => one !== null).pop() ?? null;

    return place === null ? null : rectIn(layer, place);
}

export function cardAt(around: Rect, width: number): Rect
{
    const middle = centreOf(around);
    const height = width * CARD_RATIO;

    return { x: middle.x - width / 2, y: middle.y - height / 2, width, height };
}
