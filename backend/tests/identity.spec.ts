import { createServer as httpServer, type Server, type ServerResponse } from 'node:http';
import { createServer as tcpServer, type AddressInfo, type Socket } from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';
import { decodeFunctionData, encodeErrorResult, hashMessage, parseAbi, serializeErc6492Signature, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

import { signInText, verifySignature } from '../src/domains/identity/signature.ts';
import { candidatesFor, checkHandle, handleFromAddress, handleFromName, normalizeHandle } from '../src/domains/identity/handle.ts';
import { hashToken, isAddress, mintNonce, mintToken, normalizeAddress, secretsMatch } from '../src/lib/crypto.ts';

/**
 * A real key, fixed so the vectors are reproducible. It controls nothing: it exists only to
 * produce signatures this suite can check, and it is the standard hardhat account zero.
 */
const KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const signer = privateKeyToAccount(KEY);

const challenge = (site = 'nura.games', deviceId?: string) => signInText(site, 'a'.repeat(32), deviceId);

describe('the sign-in text', () =>
{
    it('is a plain sentence naming the site, with no Ethereum, no chain and no address', () =>
    {
        const text = challenge();

        expect(text.split('\n')[0]).toBe('Sign in to Nura Games (nura.games).');
        expect(text).not.toMatch(/ethereum/i);
        expect(text).not.toContain('Chain ID');
        expect(text).not.toContain(signer.address.toLowerCase());
    });

    it('carries the nonce on its own line, so a captured signature signs in once', () =>
    {
        expect(challenge().split('\n').at(-1)).toBe(`Nonce: ${ 'a'.repeat(32) }`);
    });

    it('names a browser that is new to the account, and asks for its messages in the same sentence', () =>
    {
        expect(challenge('nura.games', 'abcdefghijklmnopqrstuv').split('\n')).toEqual([
            'Sign in to Nura Games (nura.games) and let this browser read and send your messages.',
            '',
            'Browser key: abcdefghijklmnopqrstuv',
            `Nonce: ${ 'a'.repeat(32) }`
        ]);
    });
});

describe('signature verification', () =>
{
    it('accepts a signature the address really made', async () =>
    {
        const message = challenge();
        const signature = await signer.signMessage({ message });

        const verdict = await verifySignature({ address: signer.address, message, signature });
        expect(verdict).toEqual({ ok: true, attestation: 'wallet' });
    });

    it('refuses a signature over a DIFFERENT message', async () =>
    {
        // The attack this stops: a signature harvested from some other site, replayed here.
        const signature = await signer.signMessage({ message: challenge('evil.example') });

        const verdict = await verifySignature({ address: signer.address, message: challenge(), signature });
        expect(verdict).toEqual({ ok: false, reason: 'bad-signature' });
    });

    it('refuses a valid signature attributed to someone else', async () =>
    {
        const message = challenge();
        const signature = await signer.signMessage({ message });
        const stranger = '0x000000000000000000000000000000000000dead';

        const verdict = await verifySignature({ address: stranger, message, signature });
        expect(verdict).toEqual({ ok: false, reason: 'bad-signature' });
    });

    it('refuses a signature whose r component has been altered', async () =>
    {
        const message = challenge();
        const signature = await signer.signMessage({ message });

        // The FIRST byte of r, not the last byte of the signature. The last byte is `v`, the
        // recovery id, where 0x00 and 0x1b are two spellings of the same value - flipping it
        // yields an equally valid signature, which is correct behaviour and not a mangling.
        const flipped = `0x${ signature[2] === 'f' ? '0' : 'f' }${ signature.slice(3) }` as `0x${ string }`;

        const verdict = await verifySignature({ address: signer.address, message, signature: flipped });
        expect(verdict.ok).toBe(false);
    });

    it('refuses outright garbage', async () =>
    {
        const verdict = await verifySignature({
            address: signer.address,
            message: challenge(),
            signature: '0xdeadbeef'
        });
        expect(verdict.ok).toBe(false);
    });

    it('never reports ok when the chain it needs is unreachable', async () =>
    {
        // An unverifiable signature must not become a verified one. The caller is told the
        // difference so it can say "we could not reach the network" rather than "wrong signature".
        const verdict = await verifySignature({
            address: '0x000000000000000000000000000000000000dead',
            message: challenge(),
            signature: '0x' + '11'.repeat(65),
            rpcUrl: 'http://127.0.0.1:1/'
        });
        expect(verdict.ok).toBe(false);
    });
});

describe('signature verification with a chain configured', () =>
{
    const CONTRACT = `0x${ 'c0ffee'.padStart(40, '0') }`;
    const MAGIC = `0x1626ba7e${ '0'.repeat(56) }`;
    const NOT_MAGIC = `0xffffffff${ '0'.repeat(56) }`;
    const ERC1271 = parseAbi(['function isValidSignature(bytes32 hash, bytes signature) view returns (bytes4)']);

    type Rpc = { method: string; params: unknown[] };
    type Answer = { result: unknown } | { error: { code: number; message: string; data?: string } } | { status: number } | 'stall';

    const open: Array<() => void> = [];

    afterEach(() =>
    {
        open.splice(0).forEach((close) => close());
    });

    const listen = async (server: Server | ReturnType<typeof tcpServer>) =>
    {
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
        return `http://127.0.0.1:${ (server.address() as AddressInfo).port }/`;
    };

    const silentChain = async () =>
    {
        const sockets = new Set<Socket>();
        const server = tcpServer((socket) => sockets.add(socket));
        open.push(() =>
        {
            sockets.forEach((socket) => socket.destroy());
            server.close();
        });
        return listen(server);
    };

    const chain = async (answer: (rpc: Rpc) => Answer) =>
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
            const reply = answer(rpc);
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
    };

    const deployed = (call: (to: string | undefined, data: Hex) => Answer) => (rpc: Rpc): Answer =>
    {
        if (rpc.method === 'eth_getCode')
        {
            return { result: '0x6080' };
        }
        const { to, data } = rpc.params[0] as { to?: string; data: Hex };
        return call(to, data);
    };

    const signed = async () =>
    {
        const message = challenge();
        return { message, signature: await signer.signMessage({ message }) };
    };

    const counterfactual = async () =>
    {
        const message = challenge();
        const signature = serializeErc6492Signature({
            address: `0x${ 'fac7'.padStart(40, '0') }`,
            data: '0xdeadbeef',
            signature: await signer.signMessage({ message })
        });
        return { message, signature };
    };

    it('trusts an ordinary wallet by its key and never waits on a chain that does not answer', async () =>
    {
        const { message, signature } = await signed();

        const verdict = await verifySignature({ address: signer.address, message, signature, rpcUrl: await silentChain() });
        expect(verdict).toEqual({ ok: true, attestation: 'wallet' });
    }, 2_000);

    it('refuses a bad signature from an address with no code, without calling it', async () =>
    {
        const message = challenge();
        const signature = await signer.signMessage({ message: challenge('evil.example') });
        const fake = await chain((rpc) => ({ result: rpc.method === 'eth_getCode' ? '0x' : MAGIC }));

        const verdict = await verifySignature({ address: signer.address, message, signature, rpcUrl: fake.url });
        expect(verdict).toEqual({ ok: false, reason: 'bad-signature' });
        expect(fake.asked).toEqual(['eth_getCode']);
    });

    it('asks a deployed contract wallet whether it signed exactly this message with exactly this signature', async () =>
    {
        const { message, signature } = await signed();
        const fake = await chain(deployed((to, data) =>
        {
            const { args } = decodeFunctionData({ abi: ERC1271, data });
            const asked = to?.toLowerCase() === CONTRACT && args[0] === hashMessage(message) && args[1] === signature;
            return { result: asked ? MAGIC : NOT_MAGIC };
        }));

        const verdict = await verifySignature({ address: CONTRACT, message, signature, rpcUrl: fake.url });
        expect(verdict).toEqual({ ok: true, attestation: 'contract' });
        expect(fake.asked).toEqual(['eth_getCode', 'eth_call']);
    });

    it('refuses a contract wallet that answers anything but the ERC-1271 magic value', async () =>
    {
        const { message, signature } = await signed();
        const fake = await chain(deployed(() => ({ result: NOT_MAGIC })));

        const verdict = await verifySignature({ address: CONTRACT, message, signature, rpcUrl: fake.url });
        expect(verdict).toEqual({ ok: false, reason: 'bad-signature' });
    });

    it('counts every way a contract says no as a bad signature, never as a reason to try again', async () =>
    {
        const { message, signature } = await signed();
        const refusals: Answer[] = [
            { error: { code: 3, message: 'execution reverted', data: '0x08c379a0' } },
            { error: { code: -32000, message: 'execution reverted' } },
            { result: '0x' }
        ];

        for (const refusal of refusals)
        {
            const fake = await chain(deployed(() => refusal));
            const verdict = await verifySignature({ address: CONTRACT, message, signature, rpcUrl: fake.url });
            expect(verdict, JSON.stringify(refusal)).toEqual({ ok: false, reason: 'bad-signature' });
        }
    });

    it('counts a chain that failed rather than answered as unreachable, never as a bad signature', async () =>
    {
        const { message, signature } = await signed();
        const failures: Answer[] = [
            { error: { code: -32603, message: 'upstream request timeout' } },
            { status: 413 },
            { status: 502 }
        ];

        for (const failure of failures)
        {
            const fake = await chain(deployed(() => failure));
            const verdict = await verifySignature({ address: CONTRACT, message, signature, rpcUrl: fake.url });
            expect(verdict, JSON.stringify(failure)).toEqual({ ok: false, reason: 'unreachable-chain' });
        }
    });

    it('never follows an offchain lookup a contract asks for, and calls that a bad signature', async () =>
    {
        const { message, signature } = await signed();
        let hits = 0;
        const gateway = httpServer((_request, response) =>
        {
            hits += 1;
            response.end('{"data":"0x"}');
        });
        const gatewayUrl = await listen(gateway);
        open.push(() => gateway.close());
        const lookup = encodeErrorResult({
            abi: parseAbi(['error OffchainLookup(address sender, string[] urls, bytes callData, bytes4 callbackFunction, bytes extraData)']),
            errorName: 'OffchainLookup',
            args: [CONTRACT as Hex, [`${ gatewayUrl }{sender}/{data}`], '0xdeadbeef', '0x12345678', '0x']
        });
        const fake = await chain(deployed(() => ({ error: { code: 3, message: 'execution reverted', data: lookup } })));

        const verdict = await verifySignature({ address: CONTRACT, message, signature, rpcUrl: fake.url });
        expect(verdict).toEqual({ ok: false, reason: 'bad-signature' });
        expect(hits).toBe(0);
    });

    it('lets a contract wallet that is not deployed yet prove itself through its ERC-6492 wrapper', async () =>
    {
        const { message, signature } = await counterfactual();
        const fake = await chain((rpc) => ({ result: (rpc.params[0] as { to?: string }).to === undefined ? `0x${ '1'.padStart(64, '0') }` : '0x' }));

        const verdict = await verifySignature({ address: CONTRACT, message, signature, rpcUrl: fake.url });
        expect(verdict).toEqual({ ok: true, attestation: 'contract' });
        expect(fake.asked).toEqual(['eth_call']);
    });

    it('says the chain was unreachable, not that an ERC-6492 signature was wrong, when the chain refuses the check', async () =>
    {
        const { message, signature } = await counterfactual();
        const fake = await chain(() => ({ status: 413 }));

        const verdict = await verifySignature({ address: CONTRACT, message, signature, rpcUrl: fake.url });
        expect(verdict).toEqual({ ok: false, reason: 'unreachable-chain' });
    });

    it('reports a silent chain as unreachable for a contract wallet within the browser\'s patience', async () =>
    {
        const { message, signature } = await signed();
        const started = performance.now();

        const verdict = await verifySignature({ address: CONTRACT, message, signature, rpcUrl: await silentChain() });
        expect(verdict).toEqual({ ok: false, reason: 'unreachable-chain' });
        expect(performance.now() - started).toBeLessThan(10_000);
    }, 12_000);

    it('gives up on a chain that sends the headers and then stalls the body, within the same patience', async () =>
    {
        const { message, signature } = await signed();
        const fake = await chain(deployed(() => 'stall'));
        const started = performance.now();

        const verdict = await verifySignature({ address: CONTRACT, message, signature, rpcUrl: fake.url });
        expect(verdict).toEqual({ ok: false, reason: 'unreachable-chain' });
        expect(performance.now() - started).toBeLessThan(12_000);
    }, 14_000);
});

describe('tokens and addresses', () =>
{
    it('mints tokens that do not repeat', () =>
    {
        const seen = new Set(Array.from({ length: 500 }, () => mintToken()));
        expect(seen.size).toBe(500);
    });

    it('mints nonces that do not repeat', () =>
    {
        const seen = new Set(Array.from({ length: 500 }, () => mintNonce()));
        expect(seen.size).toBe(500);
    });

    it('stores a token only as its hash', () =>
    {
        const token = mintToken();
        const hash = hashToken(token);
        expect(hash).toMatch(/^[0-9a-f]{64}$/);
        expect(hash).not.toContain(token);
        expect(hashToken(token)).toBe(hash);
    });

    it('compares secrets without leaking a prefix through length', () =>
    {
        expect(secretsMatch('abc', 'abc')).toBe(true);
        expect(secretsMatch('abc', 'abd')).toBe(false);
        expect(secretsMatch('abc', 'abcd')).toBe(false);
        expect(secretsMatch('', '')).toBe(true);
    });

    it('treats one address in two casings as one address', () =>
    {
        const mixed = '0xAbC0000000000000000000000000000000000123';
        expect(normalizeAddress(mixed)).toBe('0xabc0000000000000000000000000000000000123');
        expect(isAddress(mixed)).toBe(true);
    });

    it('refuses things that are not addresses', () =>
    {
        expect(isAddress('0x123')).toBe(false);
        expect(isAddress('not an address')).toBe(false);
        expect(isAddress(`0x${ 'z'.repeat(40) }`)).toBe(false);
        expect(isAddress('')).toBe(false);
    });
});

describe('handles', () =>
{
    it('accepts ordinary names in either script', () =>
    {
        expect(checkHandle('sara')).toBeNull();
        expect(checkHandle('roya.m')).toBeNull();
        expect(checkHandle('reza_1994')).toBeNull();

        // Half this product writes Persian. A rule built on ASCII would tell them their own name
        // is invalid.
        expect(checkHandle('سارا')).toBeNull();
        expect(checkHandle('رضا۱۹۹۴')).toBeNull();
    });

    it('refuses names that are too short, too long, or shaped wrong', () =>
    {
        expect(checkHandle('a')).toBe('too-short');
        expect(checkHandle('x'.repeat(33))).toBe('too-long');
        expect(checkHandle('.sara')).toBe('bad-shape');
        expect(checkHandle('sara.')).toBe('bad-shape');
        expect(checkHandle('sa ra')).toBe('bad-shape');
        expect(checkHandle('sara@k')).toBe('bad-shape');
    });

    it('refuses names that would impersonate the product or shadow a route', () =>
    {
        expect(checkHandle('admin')).toBe('reserved');
        expect(checkHandle('ADMIN')).toBe('reserved');
        expect(checkHandle('support')).toBe('reserved');
        expect(checkHandle('settings')).toBe('reserved');
        expect(checkHandle('nura')).toBe('reserved');
    });

    it('folds to one form so two spellings cannot become two people', () =>
    {
        expect(normalizeHandle('  Sara.K  ')).toBe('sara.k');
        expect(normalizeHandle('SARA')).toBe(normalizeHandle('sara'));
    });

    it('keeps the punctuation of a typed name that is already a legal handle', () =>
    {
        expect(handleFromName('roya.m')).toBe('roya.m');
        expect(handleFromName('reza_1994')).toBe('reza_1994');
        expect(handleFromName('  Mina  ')).toBe('mina');
        expect(handleFromName('نیما.ف')).toBe('نیما.ف');
    });

    it('folds on shape, not on whether the name is free', () =>
    {
        // A reserved name keeps its shape and is REFUSED by name, rather than being quietly
        // folded into a near-miss the person never asked for.
        expect(handleFromName('settings')).toBe('settings');
        expect(checkHandle(handleFromName('settings'))).toBe('reserved');
    });

    it('strips a typed name that is not, rather than refusing it outright', () =>
    {
        expect(handleFromName('Sara Kamali')).toBe('sarakamali');
        expect(handleFromName('.leading')).toBe('leading');
        expect(handleFromName('who?!')).toBe('who');
    });

    it('leaves a name with nothing usable in it for checkHandle to refuse', () =>
    {
        expect(handleFromName('!!!')).toBe('');
        expect(checkHandle(handleFromName('!!!'))).toBe('too-short');
        expect(checkHandle(handleFromName('Admin'))).toBe('reserved');
    });

    it('suggests a handle from an address without promising it is free', () =>
    {
        expect(handleFromAddress('0xAbCdEf1234567890000000000000000000000000')).toBe('abcdef');
    });

    it('offers the asked-for name first, then widening suffixes', () =>
    {
        let counter = 0;
        const fixed = () => [0.42, 0.42, 0.7, 0.7][counter++] ?? 0.5;

        expect(candidatesFor('sara', 0, fixed)).toBe('sara');

        const second = candidatesFor('sara', 1, fixed);
        expect(second).toMatch(/^sara\d{2}$/);

        const later = candidatesFor('sara', 4, fixed);
        expect(later).toMatch(/^sara\d{4}$/);
    });

    it('keeps a suffixed candidate inside the column', () =>
    {
        const long = 'x'.repeat(40);
        expect(candidatesFor(long, 5, () => 0.999).length).toBeLessThanOrEqual(32);
    });
});
