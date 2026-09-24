import 'reflect-metadata';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { connect as tcpConnect, type Socket } from 'node:net';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { FrameParser, OPCODE, serializeFrame } from '@azerothjs/ws';

import { attachRealtime } from '../src/realtime/gateway.ts';
import { createHub } from '../src/realtime/hub.ts';
import type { ServerConfig } from '../src/env.ts';
import type { Ports } from '../src/ports.ts';
import type { Principal } from '../src/http/auth.ts';
import type { ServerFrame } from '../src/realtime/frames.ts';

/**
 * The handful of claims that need an actual socket.
 *
 * Everything else about the realtime layer is a pure function or a fake-backed hub, and both run
 * in milliseconds with no port bound. What is left here is the handshake itself: who is refused
 * before the 101, what happens to a frame that arrives in the same TCP segment as the upgrade,
 * and whether a shutdown says goodbye with a code or just vanishes.
 *
 * OPT-IN through `TEST_WS=1` (`npm run test:ws`), the same shape the database suites use. It is
 * out of `npm test` for two reasons: that run promises no network, and a port-binding file is
 * exactly what makes `npm run test:shuffle` flaky. It needs no database - the ports are fakes.
 */

const active = process.env.TEST_WS === '1';

const noted: string[] = [];

const silent = {
    info: () => undefined,
    warn: () => undefined,
    error: (message: string, fields?: Record<string, unknown>) => noted.push(`${ message } ${ String((fields as { error?: unknown })?.error) }`),
    debug: (message: string, fields?: Record<string, unknown>) => noted.push(`dbg ${ message } ${ JSON.stringify(fields ?? {}) }`),
    trace: () => undefined,
    fatal: () => undefined,
    child: () => silent
} as unknown as Parameters<typeof attachRealtime>[1]['log'];

const PRINCIPAL: Principal = {
    userId: '11111111-1111-4111-8111-111111111111',
    handle: 'alex',
    kind: 'guest',
    isMinor: false,
    sessionId: '22222222-2222-4222-8222-222222222222'
};

let server: Server;
let port = 0;
let detach: () => void;
let identify: (request: Request) => Promise<Principal | null>;

const config = {
    env: 'test',
    origin: 'http://localhost:3100',
    wsHandshakeMax: 1000,
    wsMaxConnections: 100,
    // Generous on purpose. The per-account cap is exercised in `realtime-hub.spec.ts` against a
    // fake, where it is one assertion; here it would only mean an earlier test's socket silently
    // turning a later one's `hello` into a 4429.
    wsAccountMax: 100
} as unknown as ServerConfig;

describe.skipIf(!active)('realtime, over a real socket', () =>
{
beforeAll(async () =>
{
    identify = async () => PRINCIPAL;

    const base = createHub({
        now: () => Date.now(),
        accountMax: config.wsAccountMax,
        edgesFor: async () => ({
            party: { id: 'alex', isMinor: false, allowStrangerMessages: true, showOnline: true },
            handle: 'alex',
            friends: new Set<string>(),
            blocks: new Set<string>(),
            loadedAt: Date.now()
        }),
        recipientsOf: async () => [],
        aliveSessions: async (ids) => new Set(ids),
        touchSeen: () => undefined,
        report: () => undefined,
        voiceAllowed: async () => false,
        mayTalk: async () => false
    });

    const hub = {
        ...base,
        async bind(connection: Parameters<typeof base.bind>[0], principal: Parameters<typeof base.bind>[1])
        {
            noted.push(`bound ${ principal.handle }`);
            await base.bind(connection, principal);
        },
        resync(connection: Parameters<typeof base.resync>[0])
        {
            noted.push('resync');
            base.resync(connection);
        }
    };

    const ports = {
        identity: {
            principal: async (request: Request) =>
            {
                noted.push('principal asked');
                const answer = await identify(request);
                noted.push('principal -> ' + (answer === null ? 'null' : answer.handle));
                return answer;
            }
        }
    } as unknown as Ports;

    server = createServer((_request, response) =>
    {
        response.writeHead(404);
        response.end();
    });

    await new Promise<void>((resolve) => server.listen(0, resolve));
    port = (server.address() as { port: number }).port;

    detach = attachRealtime(server, { ports, hub, config, log: silent });
});

afterAll(async () =>
{
    detach();
    await new Promise<void>((resolve) => server.close(() => resolve()));
});

interface Conversation
{
    socket: Socket;
    frames: ServerFrame[];
    faults: string[];
    status: Promise<number>;
    closed: Promise<{ code: number }>;
    send(frame: unknown): void;
    end(): void;
}

/**
 * Speaks the wire with the package's own codec.
 *
 * No browser and no new dependency: `serializeFrame` masks like a client and `FrameParser` in
 * client role reads the server's answers, which is exactly the pair the package ships.
 */
function talk(path: string, headers: Record<string, string>): Conversation
{
    const socket = tcpConnect(port, '127.0.0.1');
    const frames: ServerFrame[] = [];
    const faults: string[] = [];
    const parser = new FrameParser({ role: 'client' });

    let settleStatus: (code: number) => void;
    let settleClose: (value: { code: number }) => void;
    const status = new Promise<number>((resolve) => { settleStatus = resolve; });
    const closed = new Promise<{ code: number }>((resolve) => { settleClose = resolve; });

    let upgraded = false;
    let buffer = Buffer.alloc(0);

    socket.on('connect', () =>
    {
        const lines = [
            `GET ${ path } HTTP/1.1`,
            `Host: localhost:${ port }`,
            'Upgrade: websocket',
            'Connection: Upgrade',
            `Sec-WebSocket-Key: ${ randomBytes(16).toString('base64') }`,
            'Sec-WebSocket-Version: 13',
            ...Object.entries(headers).map(([name, value]) => `${ name }: ${ value }`)
        ];
        socket.write(`${ lines.join('\r\n') }\r\n\r\n`);
    });

    let seen = 0;

    socket.on('data', (chunk) =>
    {
        seen += chunk.length;
        buffer = Buffer.concat([buffer, chunk]);

        if (!upgraded)
        {
            const end = buffer.indexOf(TERMINATOR);
            if (end === -1)
            {
                return;
            }
            const head = buffer.subarray(0, end).toString('latin1');
            settleStatus(Number(head.split(' ')[1]));
            upgraded = head.startsWith('HTTP/1.1 101');
            buffer = buffer.subarray(end + 4);
            if (!upgraded)
            {
                return;
            }
        }

        let parsed: ReturnType<typeof parser.push> = [];
        try
        {
            parsed = parser.push(buffer);
        }
        catch (error)
        {
            faults.push((error as Error).message);
        }

        for (const frame of parsed)
        {
            if (frame.opcode === OPCODE.text)
            {
                frames.push(JSON.parse(Buffer.from(frame.payload).toString('utf8')) as ServerFrame);
            }
            if (frame.opcode === OPCODE.close)
            {
                settleClose({ code: frame.payload.length >= 2 ? (frame.payload[0] << 8) | frame.payload[1] : 1005 });
            }
        }
        buffer = Buffer.alloc(0);
    });

    socket.on('close', () => settleClose({ code: 1006 }));

    return {
        socket,
        frames,
        faults,
        status,
        closed,
        send: (frame) => socket.write(serializeFrame(OPCODE.text, Buffer.from(JSON.stringify(frame), 'utf8'), { mask: true })),
        end: () => socket.destroy()
    };
}

/**
 * Searched as BYTES, never as a string.
 *
 * The chunk holds the headers and the first frames together, and a frame begins with 0x81 - not
 * valid UTF-8. Searching such a buffer for a string needle decodes the haystack, and the answer
 * comes back shifted: the slice then starts one byte late, with the frame's own header eaten, and
 * the parser reports nothing at all rather than an error.
 */
const TERMINATOR = Buffer.from([13, 10, 13, 10]);

const settle = (ms = 250): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const COOKIE = 'nura.session=token';

describe('the handshake', () =>
{
    it('refuses a socket with no session cookie before any upgrade', async () =>
    {
        const talker = talk('/ws', { Origin: 'http://localhost:3100' });
        expect(await talker.status).toBe(403);
        talker.end();
    });

    it('refuses a foreign origin', async () =>
    {
        const talker = talk('/ws', { Origin: 'http://evil.example', Cookie: COOKIE });
        expect(await talker.status).toBe(403);
        talker.end();
    });

    it('admits the configured origin and the same origin alike', async () =>
    {
        const configured = talk('/ws', { Origin: 'http://localhost:3100', Cookie: COOKIE });
        expect(await configured.status).toBe(101);
        configured.end();

        const same = talk('/ws', { Origin: `http://localhost:${ port }`, Cookie: COOKIE });
        expect(await same.status).toBe(101);
        same.end();
    });

    it('serves exactly /ws and 404s anything beside it', async () =>
    {
        const trailing = talk('/ws/', { Origin: 'http://localhost:3100', Cookie: COOKIE });
        expect(await trailing.status).toBe(404);
        trailing.end();
    });
});

describe('a bound socket', () =>
{
    it('asks who it is talking to, and binds them', async () =>
    {
        const talker = talk('/ws', { Origin: 'http://localhost:3100', Cookie: COOKIE });
        expect(await talker.status).toBe(101);
        await settle();

        expect(noted).toContain('principal asked');
        expect(noted).toContain('bound alex');
        talker.end();
    });

    it('hangs up on a frame it does not recognise', async () =>
    {
        const talker = talk('/ws', { Origin: 'http://localhost:3100', Cookie: COOKIE });
        expect(await talker.status).toBe(101);
        await settle();

        talker.send({ v: 1, t: 'subscribe', topic: 'everything' });

        // A frame that does not parse closes the socket on the spot - the ten-fault budget in the
        // gateway is for frames that arrive too FAST, not for ones it cannot read.
        //
        // Asserted on the close FRAME rather than on `socket.destroyed`, because a close is a
        // handshake: the server sends its frame and the TCP socket stays open until somebody
        // hangs up. The old assertion read the transport and could pass while nothing had been
        // said - which is exactly what it did while OPCODE.TEXT was undefined and this suite
        // parsed no frames at all.
        expect((await talker.closed).code).toBe(4400);
    });

    it('does not bind a socket whose session turns out to be dead', async () =>
    {
        identify = async () => null;
        const mark = noted.length;
        const talker = talk('/ws', { Origin: 'http://localhost:3100', Cookie: COOKIE });

        expect(await talker.status).toBe(101);
        await settle(400);

        const since = noted.slice(mark);

        // Promptly, from the answer - not five seconds later from the deadline.
        expect(since).toContain('principal -> null');
        expect(since).not.toContain('bound alex');

        identify = async () => PRINCIPAL;
        talker.end();
    });
});

});

/**
 * The one assertion in this file that needs no socket, no port and no database - and it spent its
 * life inside `describe.skipIf(!active)` with everything else, so it never ran under `npm test`.
 *
 * It guards the rule CLAUDE.md calls the hardest-won here: nothing in `onConnection` may await,
 * because the package replays the bytes that arrived with the handshake AFTER it returns. It was
 * deliberately written as a text assertion so it would be deterministic rather than a race - and
 * then opted out along with the tests that really do need a listening port.
 */
describe('the gateway, read as text', () =>
{
it('assigns its handlers before it can possibly yield', () =>
{
    // The package replays the bytes that arrived WITH the handshake by emitting them on the
    // raw socket after `onConnection` returns. A handler assigned behind an `await` misses
    // them, and they are dropped against a null handler with no error at all.
    //
    // Asserted over the SOURCE rather than by racing a real socket. Reproducing that race
    // from a hand-rolled client is timing-dependent and was not worth the flake; the thing
    // that actually protects the invariant is that the function cannot yield, and that is a
    // property of the text. A test that is deterministic beats one that is atmospheric.
    const source = readFileSync(new URL('../src/realtime/gateway.ts', import.meta.url), 'utf8');
    const body = source.slice(source.indexOf('onConnection: (socket, request) =>'));
    const opened = body.indexOf('{');

    let depth = 0;
    let handler = '';
    for (let at = opened; at < body.length; at += 1)
    {
        if (body[at] === '{') { depth += 1; }
        if (body[at] === '}') { depth -= 1; }
        handler += body[at];
        if (depth === 0) { break; }
    }

    // The nested `.then` callback is allowed to await - it runs long after the replay.
    const beforeTheThen = handler.slice(0, handler.indexOf('.then('));

    expect(beforeTheThen).not.toMatch(/\bawait\b/);
    expect(handler).not.toMatch(/onConnection: async/);

    // And the handlers really are assigned first, before anything that could yield.
    expect(handler.indexOf('socket.onMessage =')).toBeLessThan(handler.indexOf('.then('));
    expect(handler.indexOf('socket.onClose =')).toBeLessThan(handler.indexOf('.then('));
});
});
