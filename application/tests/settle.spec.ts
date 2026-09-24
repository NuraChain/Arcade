import { describe, it, expect } from 'vitest';
import { AnimationClip, Group, Object3D, Vector3, VectorKeyframeTrack } from 'three';

import { FOCUS, SHOTS } from '../src/world/camera/shots.ts';
import { createSettling, type Settling } from '../src/world/settle.ts';

const scene = (): { root: Group; die: Group; face: Object3D; clip: AnimationClip } =>
{
    const root = new Group();
    const die = new Group();
    const face = new Object3D();
    die.name = 'ludo-die';
    die.add(face);
    root.add(die);

    const clip = new AnimationClip('settle-ludo', 0.7, [
        new VectorKeyframeTrack('ludo-die.position', [0, 0.4, 0.7], [0, 0.5, 0, 0, 0, 0, 0, 0, 0])
    ]);

    root.updateMatrixWorld(true);
    root.traverse((node) =>
    {
        node.matrixAutoUpdate = false;
        node.matrixWorldAutoUpdate = false;
    });

    return { root, die, face, clip };
};

const heightOf = (node: Object3D): number => node.matrixWorld.elements[13];

const finish = (settling: Settling): void =>
{
    let steps = 0;

    while (steps < 100 && settling.update(0.016))
    {
        steps += 1;
    }
};

describe('pieces that settle when their game arrives', () =>
{
    it('keeps a piece out of sight until the camera first reaches its game', () =>
    {
        const { root, die, clip } = scene();
        createSettling(root, [clip]);

        expect(die.visible).toBe(false);
    });

    it('drops it from above and leaves it exactly where the poster has it', () =>
    {
        const { root, die, face, clip } = scene();
        const settling = createSettling(root, [clip]);

        expect(settling.reach('together')).toBe(true);
        expect(die.visible).toBe(true);

        expect(settling.update(0.1)).toBe(true);
        expect(heightOf(face)).toBeGreaterThan(0.1);

        finish(settling);
        expect(settling.update(0.016)).toBe(false);
        expect(heightOf(face)).toBeCloseTo(0);
    });

    it('still shows the drop after a frame that took a whole second', () =>
    {
        const { root, face, clip } = scene();
        const settling = createSettling(root, [clip]);

        settling.reach('together');

        expect(settling.update(1)).toBe(true);
        expect(heightOf(face)).toBeGreaterThan(0.1);
    });

    it('plays once, however often the reader scrolls back past it', () =>
    {
        const { root, clip } = scene();
        const settling = createSettling(root, [clip]);

        expect(settling.reach('together')).toBe(true);
        finish(settling);

        expect(settling.reach('together')).toBe(false);
        expect(settling.update(0.016)).toBe(false);
    });

    it('does nothing for a beat with no piece of its own, like the arrival the poster shows', () =>
    {
        const { root, clip } = scene();
        const settling = createSettling(root, [clip]);

        expect(settling.reach('arrival')).toBe(false);
        expect(settling.reach('games')).toBe(false);
    });

    it('drops a piece once the camera itself has come to its game, not when the scroll points there', () =>
    {
        const { root, die, clip } = scene();
        const settling = createSettling(root, [clip]);

        expect(settling.look(new Vector3(...SHOTS.games.position))).toBe(false);
        expect(die.visible).toBe(false);

        expect(settling.look(new Vector3(...SHOTS.together.position))).toBe(true);
        expect(die.visible).toBe(true);
    });

    it('drops it for the close-up a hovered game card flies to as well', () =>
    {
        const { root, die, clip } = scene();
        const settling = createSettling(root, [clip]);

        expect(settling.look(new Vector3(...FOCUS.ludo.position))).toBe(true);
        expect(die.visible).toBe(true);
    });

    it('keeps the drop for later when a fling only carries the camera partway', () =>
    {
        const { root, die, clip } = scene();
        const settling = createSettling(root, [clip]);
        const partway = new Vector3(...SHOTS.games.position).lerp(new Vector3(...SHOTS.together.position), 0.8);

        expect(settling.look(partway)).toBe(false);
        expect(die.visible).toBe(false);
        expect(settling.update(0.016)).toBe(false);
    });
});
