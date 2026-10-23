import { describe, expect, it } from 'vitest';
import type { Hex } from 'viem';

import { STAKE_FIELDS, commitOf, stakeDigest as serverDigest } from '../../backend/src/chain/vault.ts';
import { OPENING, bytesOf, drawsOf, hexOf, seedOf } from '../../backend/src/domains/match/fair.ts';
import { hmacSha256, keccak as serverKeccak } from '../../backend/src/lib/crypto.ts';
import type { MatchProof } from '../src/api.ts';
import { keccak, mac } from '../src/lib/fair.ts';
import { check, stakeDigest } from '../src/lib/proof.ts';
import { PLAYERS, STRANGER, VAULT, proofOf, signed, type Played } from './proofs.ts';

const bytes = (length: number, start: number) => Uint8Array.from({ length }, (_, at) => (start + at * 37) % 256);

const keyOrder = (text: string) =>
{
    const flip = (value: unknown): unknown =>
    {
        if (Array.isArray(value))
        {
            return value.map(flip);
        }

        if (value !== null && typeof value === 'object')
        {
            return Object.fromEntries(Object.entries(value).reverse().map(([key, held]) => [key, flip(held)]));
        }

        return value;
    };

    return JSON.stringify(flip(JSON.parse(text)));
};

describe('the seed and the draws, in the browser and on the server', () =>
{
    it('are one formula: the browser\'s HMAC and keccak answer what the server\'s do', () =>
    {
        for (let round = 0; round < 24; round += 1)
        {
            const key = bytes(32 + round, round);
            const message = bytes(round * 3, round + 7);

            expect(hexOf(mac(key, message))).toBe(hexOf(hmacSha256(key, message)));
            expect(hexOf(keccak(message))).toBe(hexOf(serverKeccak(message)));
        }
    });

    it('make the same seed and the same dice on either side', () =>
    {
        const secrets = [`0x${ '0f'.repeat(32) }`, `0x${ 'f0'.repeat(32) }`];
        const signatures = [`0x${ '1b'.repeat(65) }`, `0x${ 'c4'.repeat(65) }`];
        const browser = seedOf(keccak, secrets, signatures);
        const server = seedOf(serverKeccak, secrets, signatures);

        expect(hexOf(browser)).toBe(hexOf(server));

        for (const sides of [2, 6, 36, 52])
        {
            const here = drawsOf(mac, browser, 12);
            const there = drawsOf(hmacSha256, server, 12);

            expect(Array.from({ length: 30 }, () => here.die(sides))).toEqual(Array.from({ length: 30 }, () => there.die(sides)));
        }
    });

    it('hashes a stake the way the server and the vault do', async () =>
    {
        const proof = await proofOf('ludo', { steps: 1 });

        for (const seat of proof.players)
        {
            const theirs = serverDigest(proof.chainId, VAULT, {
                player: PLAYERS[seat.seat].address,
                game: proof.game,
                amount: BigInt(proof.amount),
                feeBps: proof.feeBps,
                commit: seat.commit as Hex,
                nonce: seat.nonce as Hex,
                deadline: BigInt(seat.deadline)
            });

            expect(hexOf(stakeDigest(proof, seat))).toBe(theirs);
        }

        expect(STAKE_FIELDS.map((field) => field.name)).toEqual(['player', 'game', 'amount', 'feeBps', 'commit', 'nonce', 'deadline']);
    });
});

describe('checking a game played for NURA', () =>
{
    it.each<Played>(['ludo', 'hokm', 'backgammon', 'poker'])('finds every move of a game of %s where the seed says it is', async (game) =>
    {
        const proof = await proofOf(game, { resign: true });
        const checked = check(proof);

        expect(proof.actions.length).toBeGreaterThan(8);
        expect(checked.seats.every((seat) => seat.signed && seat.kept)).toBe(true);
        expect(checked.wrong).toBeNull();
        expect(checked.moves).toBe(proof.actions.length);
        expect(checked.seed).toBe(hexOf(seedOf(keccak, proof.players.map((seat) => seat.secret), proof.players.map((seat) => seat.signature))));
    });

    it('plays the moves people made again, and a resignation, as well as the ones the clock played', async () =>
    {
        const proof = await proofOf('ludo', { wired: true, resign: true });
        const verbs = proof.actions.map((action) => (JSON.parse(action.payload) as { verb?: string }).verb);

        expect(verbs).toContain('roll');
        expect(verbs).toContain('move');
        expect(verbs.at(-1)).toBe('resign');
        expect(check(proof).wrong).toBeNull();
    });

    it('reads the events in whatever order the database keeps their keys', async () =>
    {
        const proof = await proofOf('poker');
        const shuffled: MatchProof = { ...proof, actions: proof.actions.map((action) => ({ ...action, events: keyOrder(action.events) })) };

        expect(shuffled.actions[0].events).not.toBe(proof.actions[0].events);
        expect(check(shuffled).wrong).toBeNull();
    });

    it('names the first move the seed does not give', async () =>
    {
        const proof = await proofOf('hokm');
        const at = 4;
        const told = JSON.parse(proof.actions[at].events) as Record<string, unknown>[];
        const forged = told.length === 0 ? [{ e: 'forged' }] : [{ ...told[0], forged: true }, ...told.slice(1)];
        const tampered: MatchProof = { ...proof, actions: proof.actions.map((action, index) => (index === at ? { ...action, events: JSON.stringify(forged) } : action)) };
        const checked = check(tampered);

        expect(checked.wrong?.rev).toBe(proof.actions[at].rev);
        expect(checked.moves).toBe(at);
        expect(checked.wrong?.said).toBe(JSON.stringify(forged));
    });

    it('finds a dealt card the server changed in the opening', async () =>
    {
        const proof = await proofOf('poker', { steps: 2 });
        const opened = JSON.parse(proof.actions[0].events) as { e: string; cards?: number[] }[];
        const hole = opened.findIndex((event) => event.e === 'hole');

        expect(hole).toBeGreaterThanOrEqual(0);

        opened[hole] = { ...opened[hole], cards: [...(opened[hole].cards ?? [])].reverse() };
        const tampered: MatchProof = { ...proof, actions: [{ ...proof.actions[0], events: JSON.stringify(opened) }, ...proof.actions.slice(1)] };

        expect(check(tampered).wrong?.rev).toBe(OPENING);
    });

    it('catches a secret that is not the one the server promised', async () =>
    {
        const proof = await proofOf('ludo');
        const other = `0x${ '99'.repeat(32) }`;
        const checked = check({ ...proof, players: proof.players.map((seat) => (seat.seat === 1 ? { ...seat, secret: other } : seat)) });

        expect(checked.seats.map((seat) => seat.kept)).toEqual([true, false]);
        expect(commitOf(other as Hex)).not.toBe(proof.players[1].commit);
        expect(checked.wrong).not.toBeNull();
    });

    it('catches a signature that is not the player\'s', async () =>
    {
        const proof = await proofOf('ludo');
        const [forged] = await signed('ludo', proof.players.map((seat) => seat.secret as Hex), [STRANGER, PLAYERS[1]]);
        const checked = check({ ...proof, players: proof.players.map((seat) => (seat.seat === 0 ? { ...seat, signature: forged } : seat)) });

        expect(checked.seats.map((seat) => seat.signed)).toEqual([false, true]);
    });

    it('catches a stake signed at another fee, for another vault, or a signature that is no signature at all', async () =>
    {
        const proof = await proofOf('ludo');

        expect(check({ ...proof, feeBps: 400 }).seats.every((seat) => !seat.signed)).toBe(true);
        expect(check({ ...proof, vault: `0x${ '12'.repeat(20) }` }).seats.every((seat) => !seat.signed)).toBe(true);
        expect(check({ ...proof, players: proof.players.map((seat) => ({ ...seat, signature: '0x1234' })) }).seats.every((seat) => !seat.signed)).toBe(true);
    });

    it('does not replay a game whose seats the seed was made in another order', async () =>
    {
        const proof = await proofOf('backgammon');
        const checked = check({ ...proof, players: [...proof.players].reverse() });

        expect(checked.wrong).not.toBeNull();
    });

    it('answers a game it does not know with nothing played', async () =>
    {
        const proof = await proofOf('ludo', { steps: 3 });
        const checked = check({ ...proof, game: 'no-such-game' });

        expect(checked.moves).toBe(0);
        expect(checked.wrong?.rev).toBe(OPENING);
    });

    it('reads its hex the way the chain writes it', () =>
    {
        expect(hexOf(bytesOf(commitOf(`0x${ '00'.repeat(32) }`)))).toBe(commitOf(`0x${ '00'.repeat(32) }`));
    });
});
