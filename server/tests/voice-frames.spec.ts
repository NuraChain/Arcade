import { describe, expect, it } from 'vitest';

import { parseClientFrame, SIGNAL_DATA_MAX } from '../src/realtime/frames.ts';

describe('the voice frames', () =>
{
    it('reads a join, a leave and a mute change', () =>
    {
        expect(parseClientFrame(JSON.stringify({ v: 1, t: 'voice', table: 't-1', on: true, muted: false })))
            .toEqual({ t: 'voice', table: 't-1', on: true, muted: false });
        expect(parseClientFrame(JSON.stringify({ v: 1, t: 'voice', table: 't-1', on: 'yes', muted: false }))).toBeNull();
    });

    it('carries an SDP-sized signal, and nothing bigger', () =>
    {
        const sdp = 'x'.repeat(8000);

        expect(parseClientFrame(JSON.stringify({ v: 1, t: 'signal', table: 't-1', to: 'sara.k', kind: 'offer', data: sdp })))
            .toEqual({ t: 'signal', table: 't-1', to: 'sara.k', kind: 'offer', data: sdp });
        expect(parseClientFrame(JSON.stringify({ v: 1, t: 'signal', table: 't-1', to: 'sara.k', kind: 'offer', data: 'x'.repeat(SIGNAL_DATA_MAX + 1) }))).toBeNull();
        expect(parseClientFrame(JSON.stringify({ v: 1, t: 'signal', table: 't-1', to: 'sara.k', kind: 'hangup', data: 'x' }))).toBeNull();
    });

    it('keeps the four kilobyte ceiling for every frame that is not a signal', () =>
    {
        const padded = `{"v":1,"t":"voice","table":"signal","on":true,"muted":false${ ' '.repeat(5000) }}`;

        expect(parseClientFrame(padded)).toBeNull();
    });

    it('refuses an unknown key on a voice frame', () =>
    {
        expect(parseClientFrame(JSON.stringify({ v: 1, t: 'signal', table: 't-1', to: 'a', kind: 'ice', data: 'x', extra: 1 }))).toBeNull();
    });
});
