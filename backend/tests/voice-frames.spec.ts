import { describe, expect, it } from 'vitest';

import { parseClientFrame, SIGNAL_DATA_MAX, SOUND_DATA_MAX, SOUND_TO_MOST } from '../src/realtime/frames.ts';

describe('the voice frames', () =>
{
    it('reads a join, a leave and a mute change, and whether the caller can hear Opus', () =>
    {
        expect(parseClientFrame(JSON.stringify({ v: 1, t: 'voice', table: 't-1', on: true, muted: false, opus: true })))
            .toEqual({ t: 'voice', table: 't-1', on: true, muted: false, opus: true });
        expect(parseClientFrame(JSON.stringify({ v: 1, t: 'voice', table: 't-1', on: 'yes', muted: false, opus: true }))).toBeNull();
        expect(parseClientFrame(JSON.stringify({ v: 1, t: 'voice', table: 't-1', on: true, muted: false })), 'a caller that did not say what it can hear').toBeNull();
        expect(parseClientFrame(JSON.stringify({ v: 1, t: 'voice', table: 't-1', on: true, muted: false, opus: 'yes' }))).toBeNull();
    });

    it('carries sound for up to eight joinings, in a codec it knows, as base64 under its ceiling', () =>
    {
        const frame = (over: Record<string, unknown>) => parseClientFrame(JSON.stringify({ v: 1, t: 'sound', table: 't-1', to: ['j2', 'j3'], codec: 'opus', at: 3, data: 'AQID', ...over }));
        const most = 'A'.repeat(SOUND_DATA_MAX);

        expect(frame({ data: most })).toEqual({ t: 'sound', table: 't-1', to: ['j2', 'j3'], codec: 'opus', at: 3, data: most });
        expect(frame({ codec: 'law', at: 0 })).toEqual({ t: 'sound', table: 't-1', to: ['j2', 'j3'], codec: 'law', at: 0, data: 'AQID' });
        expect(frame({ to: Array.from({ length: SOUND_TO_MOST }, (_, index) => `j${ index }`) })).not.toBeNull();

        for (const [why, over] of [
            ['a body over its ceiling', { data: `${ most }AAAA` }],
            ['a codec it does not know', { codec: 'mp3' }],
            ['nobody to send it to', { to: [] }],
            ['more joinings than a table has', { to: Array.from({ length: SOUND_TO_MOST + 1 }, (_, index) => `j${ index }`) }],
            ['a joining with no name', { to: [''] }],
            ['a joining that is not a name', { to: [7] }],
            ['a stamp before the first', { at: -1 }],
            ['a stamp that is not whole', { at: 1.5 }],
            ['a body that is not base64', { data: 'not base64!' }],
            ['no body at all', { data: '' }],
            ['a key it does not know', { extra: 1 }]
        ] as const)
        {
            expect(frame(over), why).toBeNull();
        }
    });

    it('carries an SDP-sized signal, and nothing bigger', () =>
    {
        const sdp = 'x'.repeat(8000);

        expect(parseClientFrame(JSON.stringify({ v: 1, t: 'signal', table: 't-1', to: 'sara.k', join: 'j2', kind: 'offer', data: sdp })))
            .toEqual({ t: 'signal', table: 't-1', to: 'sara.k', join: 'j2', kind: 'offer', data: sdp });
        expect(parseClientFrame(JSON.stringify({ v: 1, t: 'signal', table: 't-1', to: 'sara.k', join: 'j2', kind: 'offer', data: 'x'.repeat(SIGNAL_DATA_MAX + 1) }))).toBeNull();
        expect(parseClientFrame(JSON.stringify({ v: 1, t: 'signal', table: 't-1', to: 'sara.k', join: 'j2', kind: 'hangup', data: 'x' }))).toBeNull();
    });

    it('refuses a signal that does not say which joining it is for', () =>
    {
        expect(parseClientFrame(JSON.stringify({ v: 1, t: 'signal', table: 't-1', to: 'sara.k', kind: 'offer', data: 'x' }))).toBeNull();
        expect(parseClientFrame(JSON.stringify({ v: 1, t: 'signal', table: 't-1', to: 'sara.k', join: '', kind: 'offer', data: 'x' }))).toBeNull();
        expect(parseClientFrame(JSON.stringify({ v: 1, t: 'signal', table: 't-1', to: 'sara.k', join: 7, kind: 'offer', data: 'x' }))).toBeNull();
        expect(parseClientFrame(JSON.stringify({ v: 1, t: 'signal', table: 't-1', to: 'sara.k', join: 'j'.repeat(65), kind: 'offer', data: 'x' }))).toBeNull();
    });

    it('keeps the four kilobyte ceiling for every frame that is not a signal', () =>
    {
        const padded = `{"v":1,"t":"voice","table":"signal","on":true,"muted":false${ ' '.repeat(5000) }}`;

        expect(parseClientFrame(padded)).toBeNull();
    });

    it('refuses an unknown key on a voice frame', () =>
    {
        expect(parseClientFrame(JSON.stringify({ v: 1, t: 'signal', table: 't-1', to: 'a', join: 'j2', kind: 'ice', data: 'x', extra: 1 }))).toBeNull();
    });
});
