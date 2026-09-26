import { describe, it, expect } from 'vitest';

import { dragScroll } from '../src/lib/drag-scroll.ts';

const strip = (): HTMLElement =>
{
    const element = document.createElement('div');
    Object.defineProperty(element, 'scrollWidth', { value: 900 });
    Object.defineProperty(element, 'clientWidth', { value: 300 });
    element.setPointerCapture = () => undefined;
    document.body.append(element);
    return element;
};

const pointer = (type: string, x: number, pointerType = 'mouse'): PointerEvent =>
    Object.assign(new MouseEvent(type, { clientX: x, button: 0, bubbles: true, cancelable: true }), { pointerId: 1, pointerType }) as unknown as PointerEvent;

describe('dragging a strip with a mouse', () =>
{
    it('scrolls with the pointer once it has moved past a small threshold', () =>
    {
        const element = strip();
        dragScroll(element);

        element.dispatchEvent(pointer('pointerdown', 200));
        element.dispatchEvent(pointer('pointermove', 198));
        expect(element.scrollLeft).toBe(0);

        element.dispatchEvent(pointer('pointermove', 120));
        expect(element.scrollLeft).toBe(80);
        expect(element.dataset.dragging).toBe('true');

        element.dispatchEvent(pointer('pointerup', 120));
        expect(element.dataset.dragging).toBeUndefined();
        element.remove();
    });

    it('does not let the end of a drag click whatever the pointer was over', () =>
    {
        const element = strip();
        const button = document.createElement('button');
        let clicked = 0;
        button.addEventListener('click', () => clicked += 1);
        element.append(button);
        dragScroll(element);

        button.dispatchEvent(pointer('pointerdown', 200));
        button.dispatchEvent(pointer('pointermove', 100));
        button.dispatchEvent(pointer('pointerup', 100));
        button.click();

        expect(clicked).toBe(0);
        element.remove();
    });

    it('leaves a finger to the browser, which already scrolls a strip natively', () =>
    {
        const element = strip();
        dragScroll(element);

        element.dispatchEvent(pointer('pointerdown', 200, 'touch'));
        element.dispatchEvent(pointer('pointermove', 100, 'touch'));

        expect(element.scrollLeft).toBe(0);
        element.remove();
    });

    it('lets go of everything when released', () =>
    {
        const element = strip();
        const stop = dragScroll(element);
        stop();

        element.dispatchEvent(pointer('pointerdown', 200));
        element.dispatchEvent(pointer('pointermove', 100));

        expect(element.scrollLeft).toBe(0);
        element.remove();
    });
});
