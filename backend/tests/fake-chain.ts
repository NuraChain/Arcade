import { createServer as httpServer, type Server, type ServerResponse } from 'node:http';
import { createServer as tcpServer, type AddressInfo, type Socket } from 'node:net';

import { encodeErrorResult, parseAbi, type Hex } from 'viem';

export type Rpc = { method: string; params: unknown[] };

export type Answer = { result: unknown } | { error: { code: number; message: string; data?: string } } | { status: number } | 'stall';

const OFFCHAIN_LOOKUP = parseAbi(['error OffchainLookup(address sender, string[] urls, bytes callData, bytes4 callbackFunction, bytes extraData)']);

export const REFUSED_BY_FETCH: ReadonlySet<number> = new Set([
    1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95, 101, 102, 103, 104, 109, 110, 111,
    113, 115, 117, 119, 123, 135, 137, 139, 143, 161, 179, 389, 427, 465, 512, 513, 514, 515, 526, 530, 531, 532, 540, 548,
    554, 556, 563, 587, 601, 636, 989, 990, 993, 995, 1719, 1720, 1723, 2049, 3659, 4045, 4190, 5060, 5061, 6000, 6566, 6665,
    6666, 6667, 6668, 6669, 6679, 6697, 10080
]);

const open: Array<() => void> = [];

export function closeChains()
{
    open.splice(0).forEach((close) => close());
}

export async function listen(server: Server | ReturnType<typeof tcpServer>)
{
    for (;;)
    {
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

        const { port } = server.address() as AddressInfo;

        if (!REFUSED_BY_FETCH.has(port))
        {
            return `http://127.0.0.1:${ port }/`;
        }

        await new Promise<void>((resolve) => server.close(() => resolve()));
    }
}

export async function silentChain()
{
    const sockets = new Set<Socket>();
    const server = tcpServer((socket) => sockets.add(socket));
    open.push(() =>
    {
        sockets.forEach((socket) => socket.destroy());
        server.close();
    });
    return listen(server);
}

export async function fakeChain(answer: (rpc: Rpc) => Answer | Promise<Answer>)
{
    const asked: string[] = [];
    const held = new Set<ServerResponse>();
    const server = httpServer(async (request, response) =>
    {
        let body = '';
        for await (const chunk of request)
        {
            body += String(chunk);
        }
        const rpc = JSON.parse(body) as Rpc & { id: number };
        asked.push(rpc.method);
        const reply = await answer(rpc);
        if (response.destroyed)
        {
            return;
        }
        if (reply === 'stall')
        {
            held.add(response);
            response.writeHead(200, { 'content-type': 'application/json' });
            response.write('{"jsonrpc":"2.0",');
            return;
        }
        if ('status' in reply)
        {
            response.writeHead(reply.status);
            response.end();
            return;
        }
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, ...reply }));
    });
    open.push(() =>
    {
        held.forEach((response) => response.destroy());
        server.close();
    });
    return { url: await listen(server), asked };
}

export async function lookupGateway()
{
    let hits = 0;
    const server = httpServer((_request, response) =>
    {
        hits += 1;
        response.end('{"data":"0x"}');
    });
    const url = await listen(server);
    open.push(() => server.close());
    return { url, hits: () => hits };
}

export function offchainLookup(sender: string, gatewayUrl: string)
{
    return {
        error: {
            code: 3,
            message: 'execution reverted',
            data: encodeErrorResult({
                abi: OFFCHAIN_LOOKUP,
                errorName: 'OffchainLookup',
                args: [sender as Hex, [`${ gatewayUrl }{sender}/{data}`], '0xdeadbeef', '0x12345678', '0x']
            })
        }
    };
}

export function callOf(rpc: Rpc)
{
    return rpc.params[0] as { to?: string; data: Hex };
}
