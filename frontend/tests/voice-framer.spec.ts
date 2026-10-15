import { describe, it, expect } from 'vitest';

import { Framer } from '../src/services/voice.framer.ts';

describe('the microphone, cut into frames', () =>
{
    it('hands over a frame each time it has a frame\'s worth, carrying what is left to the next', () =>
    {
        const framer = new Framer(5);

        expect(framer.push(Float32Array.from([1, 2, 3]), 3)).toEqual([]);

        const [frame] = framer.push(Float32Array.from([4, 5, 6, 7]), 4);

        expect([...frame]).toEqual([1, 2, 3, 4, 5]);
        expect([...framer.push(Float32Array.from([8, 9, 10]), 3)[0]]).toEqual([6, 7, 8, 9, 10]);
    });

    it('counts time the microphone gave nothing as silence, so the frames keep the clock', () =>
    {
        const framer = new Framer(4);

        expect(framer.push(undefined, 128)).toHaveLength(32);
        expect(framer.push(undefined, 6).map((frame) => [...frame])).toEqual([[0, 0, 0, 0]]);
        expect([...framer.push(Float32Array.from([7, 8]), 2)[0]]).toEqual([0, 0, 7, 8]);
    });
});
