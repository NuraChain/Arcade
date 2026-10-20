import { describe, it, expect, afterEach, vi } from 'vitest';

import { createSocketSource } from '../src/services/realtime.source.ts';

const OPEN = 1;

interface Wire
{
    readyState: number;
    bufferedAmount: number;
    sent: string[];
}

function wired()
{
    const wires: Wire[] = [];

    vi.stubGlobal('WebSocket', Object.assign(class
    {
        public readyState = 0;
        public bufferedAmount = 0;
        public sent: string[] = [];
        public onopen: (() => void) | null = null;
        public onmessage: ((event: { data: unknown }) => void) | null = null;
        public onclose: ((event: { code: number }) => void) | null = null;
        public onerror: (() => void) | null = null;

        constructor()
        {
            wires.push(this);
        }

        public send(text: string)
        {
            this.sent.push(text);
        }

        public close()
        {
            this.readyState = 3;
        }
    }, { OPEN }));

    const source = createSocketSource();
    const close = source.open({ onOpen: () => undefined, onFrame: () => undefined, onClose: () => undefined });

    return { source, close, wire: () => wires[0] };
}

afterEach(() =>
{
    vi.unstubAllGlobals();
});

describe('the socket, as the one place a frame is sent', () =>
{
    it('sends nothing before the socket is open, and every frame as version one once it is', () =>
    {
        const one = wired();

        expect(one.source.send({ t: 'sync' })).toBe(false);

        one.wire().readyState = OPEN;

        expect(one.source.send({ t: 'sync' })).toBe(true);
        expect(one.wire().sent.map((text) => JSON.parse(text) as unknown)).toEqual([{ v: 1, t: 'sync' }]);
        one.close();
    });

    it('refuses a frame given a ceiling while more than that is still waiting to leave, and sends it once the socket has caught up', () =>
    {
        const one = wired();
        const sound = { t: 'sound' as const, table: 't-1', to: ['j2'], codec: 'law' as const, at: 1, data: 'AQID' };

        one.wire().readyState = OPEN;
        one.wire().bufferedAmount = 9000;

        expect(one.source.send(sound, 8192)).toBe(false);
        expect(one.source.send({ t: 'sync' }), 'a frame with no ceiling was held back by one').toBe(true);

        one.wire().bufferedAmount = 8192;

        expect(one.source.send(sound, 8192)).toBe(true);
        expect(one.wire().sent.map((text) => (JSON.parse(text) as { t: string }).t)).toEqual(['sync', 'sound']);
        one.close();
    });
});
