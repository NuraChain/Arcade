import { afterEach, describe, expect, it, vi } from 'vitest';

import { manualClock } from '../src/lib/clock.ts';
import { POP_LINEAR, SNAP_LINEAR, TIMING, easings, flightFrames, outside, type Rect } from '../src/game/motion.ts';
import { CARD_RATIO, anchor, cardAt, cardNode, drawn, stackNode, turnNode } from '../src/game/stage/cards.ts';
import { EDGE, launch, turn } from '../src/game/stage/flight.ts';
import { createStage } from '../src/game/stage/stage.ts';

const FROM: Rect = { x: 10, y: 20, width: 30, height: 40 };

const TO: Rect = { x: 200, y: 120, width: 60, height: 80 };

const flush = async () =>
{
    for (let turn = 0; turn < 12; turn += 1)
    {
        await Promise.resolve();
    }
};

const rig = (quiet = false) =>
{
    const clock = manualClock(1000);
    const stage = createStage({ clock, quiet: () => quiet });
    const layer = document.createElement('div');

    document.body.append(layer);

    return { stage, layer, elapse: async (ms: number) =>
    {
        for (let left = ms; left > 0; left -= 5)
        {
            clock.advance(Math.min(5, left));
            await flush();
        }

        await flush();
    } };
};

const placed = (node: HTMLElement) => [node.style.left, node.style.top, node.style.width, node.style.height];

const boxed = (rect: Rect) => [`${ rect.x }px`, `${ rect.y }px`, `${ rect.width }px`, `${ rect.height }px`];

afterEach(() =>
{
    vi.restoreAllMocks();
    document.body.replaceChildren();
});

describe('a thing flown from one place to another', () =>
{
    it('is a copy in the layer where it ends, and is taken out when it has landed', async () =>
    {
        const { stage, layer, elapse } = rig();
        const told: string[] = [];
        const clone = document.createElement('div');
        const run = launch(stage, layer, clone, FROM, TO, { duration: 300, easing: 'linear', landed: () => told.push(layer.contains(clone) ? 'landed in the layer' : 'landed') });

        void run.done.then(() => told.push('done'));

        expect(layer.children.length).toBe(1);
        expect(clone.classList.contains('flight')).toBe(true);
        expect(clone.getAttribute('aria-hidden')).toBe('true');
        expect(placed(clone)).toEqual(boxed(TO));

        await elapse(295);
        expect(layer.contains(clone)).toBe(true);
        expect(told).toEqual([]);

        await elapse(5);
        expect(layer.children.length).toBe(0);
        expect(told).toEqual(['landed', 'done']);
    });

    it('holds its last frame until it is taken away, however late the clock is', () =>
    {
        const { stage, layer } = rig();
        const animate = vi.spyOn(Element.prototype, 'animate');

        launch(stage, layer, document.createElement('div'), FROM, TO, { duration: 300, easing: 'linear', toOpacity: 0, toScale: 0.4 });

        expect(animate).toHaveBeenCalledTimes(1);
        expect((animate.mock.calls[0][1] as KeyframeAnimationOptions).fill).toBe('both');
        expect(JSON.stringify(animate.mock.calls[0][0])).toContain('translate');
    });

    it('waits its delay before it leaves, and counts it in its length', async () =>
    {
        const { stage, layer, elapse } = rig();
        const clone = document.createElement('div');
        const run = launch(stage, layer, clone, FROM, TO, { duration: 200, easing: 'linear', delay: 100 });

        expect(run.length).toBe(300);

        await elapse(295);
        expect(layer.contains(clone)).toBe(true);

        await elapse(5);
        expect(layer.contains(clone)).toBe(false);
    });

    it('only fades in where it ends for somebody who asked for less motion', async () =>
    {
        const { stage, layer, elapse } = rig(true);
        const animate = vi.spyOn(Element.prototype, 'animate');
        const clone = document.createElement('div');
        const run = launch(stage, layer, clone, FROM, TO, { duration: 300, easing: 'linear' });

        expect(placed(clone)).toEqual(boxed(TO));
        expect(run.length).toBe(TIMING.FADE);
        expect(JSON.stringify(animate.mock.calls[0][0])).not.toContain('translate');

        await elapse(TIMING.FADE);
        expect(layer.children.length).toBe(0);
    });

    it('fades out where it was, for them, when it is a thing that ends in nothing', () =>
    {
        const { stage, layer } = rig(true);
        const clone = document.createElement('div');

        launch(stage, layer, clone, FROM, TO, { duration: 300, easing: 'linear', toOpacity: 0, quiet: 'out' });

        expect(placed(clone)).toEqual(boxed(FROM));
    });

    it('puts nothing in the layer for them when it is marked to be skipped, and still says it landed', async () =>
    {
        const { stage, layer, elapse } = rig(true);
        const told: string[] = [];
        const run = launch(stage, layer, document.createElement('div'), FROM, TO, { duration: 300, easing: 'linear', quiet: 'skip', landed: () => told.push('landed') });

        void run.done.then(() => told.push('done'));

        expect(layer.children.length).toBe(0);

        await elapse(5);
        expect(told).toEqual(['landed', 'done']);
    });

    it('is flown all the same for a reader who sees motion, whatever it is marked', () =>
    {
        const { stage, layer } = rig();
        const clone = document.createElement('div');

        launch(stage, layer, clone, FROM, TO, { duration: 300, easing: 'linear', quiet: 'skip' });

        expect(layer.contains(clone)).toBe(true);
        expect(placed(clone)).toEqual(boxed(TO));
    });
});

describe('the frames of a flight', () =>
{
    it('go from the source centre to the destination, scaled by width', () =>
    {
        const [first, last] = flightFrames({ x: 0, y: 0, width: 20, height: 28 }, { x: 100, y: 50, width: 40, height: 56 }, { toRotate: 4 });

        expect(first).toMatchObject({ translate: '-110px -64px', scale: '0.5', rotate: '0deg', opacity: 1 });
        expect(last).toMatchObject({ translate: '0px 0px', scale: '1', rotate: '4deg' });
    });

    it('fade out only over the tail when asked', () =>
    {
        const frames = flightFrames({ x: 0, y: 0, width: 10, height: 10 }, { x: 10, y: 0, width: 10, height: 10 }, { toOpacity: 0, fadeFrom: 0.6 });

        expect(frames).toHaveLength(3);
        expect(frames[1]).toMatchObject({ offset: 0.6, opacity: 1 });
        expect(frames[2]).toMatchObject({ opacity: 0 });
    });

    it('leave a box by the edge that faces where they are going, a gap beyond it', () =>
    {
        const plate: Rect = { x: 150, y: 10, width: 100, height: 40 };
        const corner = outside({ x: 0, y: 0, width: 100, height: 40 }, { x: 150, y: 120 }, 0);

        expect(outside(plate, { x: 200, y: 300 }, 14), 'below a box when that is the way').toEqual({ x: 200, y: 64, dx: 0, dy: 1 });
        expect(outside(plate, { x: 200, y: -300 }, 14), 'above it').toEqual({ x: 200, y: -4, dx: 0, dy: -1 });
        expect(outside(plate, { x: 500, y: 30 }, 14), 'beside it').toEqual({ x: 264, y: 30, dx: 1, dy: 0 });
        expect(outside(plate, { x: 200, y: 300 }, 0).y, 'on the edge itself with no gap').toBe(50);
        expect([corner.x, corner.y].map((one) => Math.round(one)), 'through the nearer edge when the way is a slant').toEqual([70, 40]);
        expect(Math.hypot(corner.dx, corner.dy)).toBeCloseTo(1, 9);
        expect(outside(plate, { x: 200, y: 30 }, 14), 'nowhere, from a box that is already there').toEqual({ x: 200, y: 30, dx: 0, dy: 0 });
    });

    it('use the spring curves only where linear() is understood', () =>
    {
        expect(easings(true).snap).toBe(SNAP_LINEAR);
        expect(easings(true).pop).toBe(POP_LINEAR);
        expect(easings(false).snap).toBe('cubic-bezier(0.2, 0, 0, 1)');
        expect(easings(false).pop).toBe('cubic-bezier(0.34, 1.56, 0.64, 1)');
        expect(SNAP_LINEAR.startsWith('linear(0,') && SNAP_LINEAR.endsWith(' 1)')).toBe(true);
    });
});

describe('a card to fly', () =>
{
    it('is a face that knows its rank and suit, or a back, at the width it is asked for', () =>
    {
        const face = cardNode(27, 48);
        const back = cardNode(null, 30);

        expect(face.style.getPropertyValue('--card-w')).toBe('48px');
        expect(face.firstElementChild?.className).toBe('card-face');
        expect((face.firstElementChild as HTMLElement).style.getPropertyValue('--at-rank')).toBe('1');
        expect((face.firstElementChild as HTMLElement).style.getPropertyValue('--at-suit')).toBe('2');
        expect(back.style.getPropertyValue('--back-w')).toBe('30px');
        expect(back.firstElementChild?.className).toBe('card-back');
    });

    it('leaves from the first place that is really drawn, and from the last one given when none is', () =>
    {
        const layer = document.createElement('div');
        const pile = document.createElement('span');
        const plate = document.createElement('div');
        const boxes = new Map<Element, DOMRect>([
            [layer, { left: 100, top: 50, width: 400, height: 300 } as DOMRect],
            [pile, { left: 0, top: 0, width: 0, height: 0 } as DOMRect],
            [plate, { left: 180, top: 90, width: 80, height: 40 } as DOMRect]
        ]);

        vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element)
        {
            return boxes.get(this) ?? ({ left: 0, top: 0, width: 0, height: 0 } as DOMRect);
        });

        const has = vi.spyOn(Element.prototype, 'getClientRects').mockImplementation(function (this: Element)
        {
            return (this === plate ? [{}] : []) as unknown as DOMRectList;
        });

        expect(drawn(pile)).toBe(false);
        expect(drawn(plate)).toBe(true);
        expect(drawn(null)).toBe(false);
        expect(anchor(layer, [null, pile, plate])).toEqual({ x: 80, y: 40, width: 80, height: 40 });

        has.mockImplementation(() => [] as unknown as DOMRectList);

        expect(anchor(layer, [plate, null, pile]), 'with nothing drawn the last place given stands in').toEqual({ x: -100, y: -50, width: 0, height: 0 });
        expect(anchor(layer, [null, null])).toBeNull();
        expect(anchor(layer, [])).toBeNull();
    });

    it('is cut to a card\'s own shape around the middle of a place', () =>
    {
        const card = cardAt({ x: 100, y: 100, width: 80, height: 40 }, 30);

        expect(card.width).toBe(30);
        expect(card.height).toBeCloseTo(30 * CARD_RATIO, 6);
        expect(card.x).toBe(125);
        expect(card.y).toBeCloseTo(120 - 15 * CARD_RATIO, 6);
    });
});

describe('a packet of cards, and a card turned over on its way', () =>
{
    const frames = (animate: ReturnType<typeof vi.spyOn>, target: Element) =>
    {
        const at = animate.mock.contexts.lastIndexOf(target);

        return at === -1 ? null : { frames: animate.mock.calls[at][0] as Keyframe[], timing: animate.mock.calls[at][1] as KeyframeAnimationOptions };
    };

    it('is as many backs as it holds cards, one on another, and never more than three thick', () =>
    {
        const five = stackNode(5, 30);
        const two = stackNode(2, 30);
        const none = stackNode(0, 30);

        expect(five.style.getPropertyValue('--back-w')).toBe('30px');
        expect(five.classList.contains('stack')).toBe(true);
        expect([...five.children].map((one) => one.className)).toEqual(['card-back', 'card-back', 'card-back']);
        expect([...five.children].map((one) => (one as HTMLElement).style.getPropertyValue('--i'))).toEqual(['0', '1', '2']);
        expect(two.children.length).toBe(2);
        expect(none.children.length, 'a packet of nothing was drawn as nothing at all').toBe(1);
    });

    it('is a back with the face under it, the face not yet to be seen', () =>
    {
        const node = turnNode(27, 48);
        const [back, face] = [...node.children] as HTMLElement[];

        expect(node.classList.contains('turning')).toBe(true);
        expect(back.className).toBe('card-back');
        expect(face.className).toBe('card-face');
        expect(face.style.getPropertyValue('--at-rank')).toBe('1');
        expect(face.style.getPropertyValue('--at-suit')).toBe('2');
        expect(face.style.opacity).toBe('0');
    });

    it('goes edge on halfway there, a back until then and a face from then on, all three on one clock', () =>
    {
        const { stage, layer } = rig();
        const animate = vi.spyOn(Element.prototype, 'animate');
        const node = turnNode(27, 60);
        const [back, face] = [...node.children];

        turn(stage, layer, node, FROM, TO, { duration: 240, delay: 60, easing: 'ease-out' });

        const box = frames(animate, node);
        const under = frames(animate, face);
        const over = frames(animate, back);

        expect(layer.contains(node)).toBe(true);
        expect(node.classList.contains('flight')).toBe(true);
        expect(placed(node)).toEqual(boxed(TO));
        expect(box?.frames.map((one) => one.translate)).toEqual(['-205px -120px', '-102.5px -60px', '0px 0px']);
        expect(box?.frames.map((one) => one.scale)).toEqual(['0.5 0.5', `${ EDGE } 0.75`, '1 1']);
        expect(box?.frames[1].offset).toBe(0.5);
        expect(over?.frames.map((one) => [one.opacity, one.offset])).toEqual([[1, undefined], [1, 0.5], [0, 0.5], [0, undefined]]);
        expect(under?.frames.map((one) => [one.opacity, one.offset])).toEqual([[0, undefined], [0, 0.5], [1, 0.5], [1, undefined]]);

        for (const one of [box, under, over])
        {
            expect([one?.timing.duration, one?.timing.delay, one?.timing.easing, one?.timing.fill]).toEqual([240, 60, 'ease-out', 'both']);
        }
    });

    it('is turned the other way when it is asked to go face down: the face until halfway, the back from then on', () =>
    {
        const { stage, layer } = rig();
        const animate = vi.spyOn(Element.prototype, 'animate');
        const node = turnNode(27, 60);
        const [back, face] = [...node.children];

        turn(stage, layer, node, FROM, TO, { duration: 240, easing: 'ease-out', down: true });

        expect(frames(animate, face)?.frames.map((one) => [one.opacity, one.offset]), 'the face was not the side that left').toEqual([[1, undefined], [1, 0.5], [0, 0.5], [0, undefined]]);
        expect(frames(animate, back)?.frames.map((one) => [one.opacity, one.offset])).toEqual([[0, undefined], [0, 0.5], [1, 0.5], [1, undefined]]);
        expect(frames(animate, node)?.frames.map((one) => one.scale), 'it did not go edge on').toEqual(['0.5 0.5', `${ EDGE } 0.75`, '1 1']);
        expect(frames(animate, face)?.timing.fill, 'the face it was built with hidden would show nothing before it leaves').toBe('both');
    });

    it('is taken out when it has landed, and says so once', async () =>
    {
        const { stage, layer, elapse } = rig();
        const told: string[] = [];
        const node = turnNode(3, 60);
        const run = turn(stage, layer, node, FROM, TO, { duration: 200, easing: 'linear', landed: () => told.push(layer.contains(node) ? 'landed in the layer' : 'landed') });

        void run.done.then(() => told.push('done'));

        expect(run.length).toBe(200);

        await elapse(195);
        expect(layer.contains(node)).toBe(true);
        expect(told).toEqual([]);

        await elapse(5);
        expect(layer.children.length).toBe(0);
        expect(told).toEqual(['landed', 'done']);
    });

    it('is not flown for a reader who asked for less motion, and still says it landed', async () =>
    {
        const { stage, layer, elapse } = rig(true);
        const told: string[] = [];
        const run = turn(stage, layer, turnNode(3, 60), FROM, TO, { duration: 200, easing: 'linear', landed: () => told.push('landed') });

        void run.done.then(() => told.push('done'));

        expect(layer.children.length).toBe(0);

        await elapse(5);
        expect(told).toEqual(['landed', 'done']);
    });
});
