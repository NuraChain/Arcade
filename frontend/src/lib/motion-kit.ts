import { spring } from 'motion';
import { animate } from 'motion/mini';

const SETTLE = { type: spring, duration: 0.42, bounce: 0.16 };

const GLIDE = { type: spring, duration: 0.5, bounce: 0.08 };

export function settle(element: HTMLElement, from: number, to: number): Promise<void>
{
    return animate(element, { transform: [`translateY(${ from }px)`, `translateY(${ to }px)`] }, SETTLE).then(() => undefined);
}

export function glide(element: HTMLElement, by: number): Promise<void>
{
    return animate(element, { transform: [`translateY(${ by }px)`, 'translateY(0px)'] }, GLIDE).then(() => undefined);
}
