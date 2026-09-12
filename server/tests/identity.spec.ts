import { describe, expect, it } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';

import { buildSiweMessage, verifySignature } from '../src/domains/identity/siwe.ts';
import { candidatesFor, checkHandle, handleFromAddress, handleFromName, normalizeHandle } from '../src/domains/identity/handle.ts';
import { hashToken, isAddress, mintNonce, mintToken, normalizeAddress, secretsMatch } from '../src/lib/crypto.ts';
import { DEMO_SEEDS } from '../src/db/seed-reference.ts';

/**
 * A real key, fixed so the vectors are reproducible. It controls nothing: it exists only to
 * produce signatures this suite can check, and it is the standard hardhat account zero.
 */
const KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const signer = privateKeyToAccount(KEY);

const challenge = (overrides: Partial<Parameters<typeof buildSiweMessage>[0]> = {}): string =>
    buildSiweMessage({
        domain: 'nura.games',
        uri: 'https://nura.games',
        address: signer.address,
        chainId: '1',
        nonce: 'a'.repeat(32),
        issuedAt: new Date('2026-01-01T00:00:00.000Z'),
        expiresAt: new Date('2026-01-01T00:05:00.000Z'),
        statement: 'Sign in to Nura Games. This proves the seat is yours. It costs nothing and moves nothing.',
        ...overrides
    });

describe('the SIWE message', () =>
{
    it('is EIP-4361 shaped, with the address on its own second line', () =>
    {
        const lines = challenge().split('\n');
        expect(lines[0]).toBe('nura.games wants you to sign in with your Ethereum account:');
        expect(lines[1]).toBe(signer.address.toLowerCase());
        expect(lines[2]).toBe('');
    });

    it('carries a DECIMAL chain id, never a chain name', () =>
    {
        // The version this replaces sent `Chain ID: NuraChain` whenever no chain was configured.
        // No SIWE parser accepts that, so wallets fell back to showing raw bytes.
        const line = challenge({ chainId: '1' }).split('\n').find((one) => one.startsWith('Chain ID:'));
        expect(line).toBe('Chain ID: 1');

        // The VALUE must be digits. The label is words, so the assertion is on what follows it.
        expect(line!.slice('Chain ID: '.length)).toMatch(/^\d+$/);
    });

    it('states an expiry, so a captured message cannot be signed a week later', () =>
    {
        expect(challenge()).toContain('Expiration Time: 2026-01-01T00:05:00.000Z');
    });

    it('lowercases the address it binds, whatever casing the provider handed over', () =>
    {
        const upper = challenge({ address: signer.address.toUpperCase().replace('0X', '0x') });
        expect(upper.split('\n')[1]).toBe(signer.address.toLowerCase());
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
        const signature = await signer.signMessage({ message: challenge({ domain: 'evil.example' }) });

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

    it('holds every seeded demo persona out of reach', () =>
    {
        for (const demo of DEMO_SEEDS)
        {
            expect(checkHandle(demo.handle)).toBe('reserved');
        }
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
        expect(handleFromName('sara.k')).toBe('sara.k');
        expect(checkHandle(handleFromName('sara.k'))).toBe('reserved');
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
        const fixed = (): number => [0.42, 0.42, 0.7, 0.7][counter++] ?? 0.5;

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
