import type { Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

import { STAKE_FIELDS, commitOf, stakeDomain } from '../../backend/src/chain/vault.ts';
import type { Engine, TableConfig } from '../../backend/src/domains/match/engine.ts';
import { backgammonEngine } from '../../backend/src/domains/match/engines/backgammon.ts';
import { hokmEngine } from '../../backend/src/domains/match/engines/hokm.ts';
import { ludoEngine } from '../../backend/src/domains/match/engines/ludo.ts';
import { pokerEngine } from '../../backend/src/domains/match/engines/poker.ts';
import { OPENING, drawsOf, seedOf } from '../../backend/src/domains/match/fair.ts';
import { hmacSha256, keccak } from '../../backend/src/lib/crypto.ts';
import type { MatchPlay, MatchProof } from '../src/api.ts';

export const PLAYERS = [
    privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'),
    privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d')
];

export const STRANGER = privateKeyToAccount('0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a');

export const VAULT = '0x5fbdb2315678afecb367f032d93f642f64180aa3';

const ENGINES = { ludo: ludoEngine, hokm: hokmEngine, backgammon: backgammonEngine, poker: pokerEngine };

export type Played = keyof typeof ENGINES;

const CONFIG: Record<Played, TableConfig> = {
    ludo: { target: 0, cube: false, blinds: 'low', variant: 'standard' },
    hokm: { target: 7, cube: false, blinds: 'low', variant: 'standard' },
    backgammon: { target: 3, cube: true, blinds: 'low', variant: 'standard' },
    poker: { target: 0, cube: false, blinds: 'low', variant: 'standard' }
};

const AMOUNT = 10n * 10n ** 18n;

const DEADLINE = 1_900_000_000n;

const revOf = (state: unknown) => (state as { rev: number }).rev;

const ludoWire = (state: unknown): MatchPlay =>
{
    const held = state as { die: number | null };
    const moves = ludoEngine.legal(state as never, ludoEngine.turnOf(state as never) as number) as { kind: string; piece?: number }[];
    const move = moves.find((one) => one.kind === 'move');

    return held.die === null || move === undefined ? { kind: 'ludo', verb: 'roll' } : { kind: 'ludo', verb: 'move', piece: move.piece };
};

export async function signed(game: Played, secrets: readonly Hex[], signers = PLAYERS)
{
    return await Promise.all(signers.map((account, seat) => account.signTypedData({
        domain: stakeDomain(31337, VAULT),
        types: { Stake: STAKE_FIELDS },
        primaryType: 'Stake',
        message: {
            player: PLAYERS[seat].address,
            game,
            amount: AMOUNT,
            feeBps: 500,
            commit: commitOf(secrets[seat]),
            nonce: `0x${ (0xa0 + seat).toString(16).repeat(32) }`,
            deadline: DEADLINE
        }
    })));
}

export async function proofOf(game: Played, options: { steps?: number; wired?: boolean; resign?: boolean } = {})
{
    const engine = ENGINES[game] as Engine;
    const seats = [0, 1];
    const secrets = seats.map((seat) => `0x${ (0x11 * (seat + 1)).toString(16).padStart(2, '0').repeat(32) }` as Hex);
    const signatures = await signed(game, secrets);
    const seed = seedOf(keccak, secrets, signatures);
    const opened = engine.create(seats, drawsOf(hmacSha256, seed, OPENING), CONFIG[game]);
    const actions: MatchProof['actions'] = [{ rev: OPENING, seat: -1, kind: 'open', payload: '{}', events: JSON.stringify(opened.events) }];
    let state = opened.state;

    for (let step = 0; step < (options.steps ?? 40); step += 1)
    {
        const seat = engine.turnOf(state);

        if (seat === null || engine.finish(state) !== null)
        {
            break;
        }

        const dice = drawsOf(hmacSha256, seed, revOf(state) + 1);
        const wire = options.wired === true && game === 'ludo' ? ludoWire(state) : null;
        const action = wire === null ? engine.autoplay(state, seat, dice) : engine.parse(wire, seat);
        const outcome = action === null ? null : engine.apply(state, action, dice);

        if (outcome === null || !outcome.ok)
        {
            break;
        }

        actions.push({ rev: revOf(outcome.state), seat, kind: 'play', payload: JSON.stringify(wire ?? { verb: 'auto' }), events: JSON.stringify(outcome.events) });
        state = outcome.state;
    }

    if (options.resign === true && engine.finish(state) === null)
    {
        const dice = drawsOf(hmacSha256, seed, revOf(state) + 1);
        const outcome = engine.apply(state, engine.forfeit(0, 'resign'), dice);

        if (outcome.ok)
        {
            actions.push({ rev: revOf(outcome.state), seat: 0, kind: 'forfeit', payload: JSON.stringify({ verb: 'resign' }), events: JSON.stringify(outcome.events) });
        }
    }

    const proof: MatchProof = {
        game,
        variant: CONFIG[game].variant,
        seats,
        target: CONFIG[game].target,
        cube: CONFIG[game].cube,
        blinds: CONFIG[game].blinds,
        chainId: 31337,
        vault: VAULT,
        amount: AMOUNT.toString(),
        feeBps: 500,
        state: 'settled',
        players: seats.map((seat) => ({
            seat,
            who: seat === 0 ? 'alex' : 'sara.k',
            address: PLAYERS[seat].address.toLowerCase(),
            commit: commitOf(secrets[seat]),
            secret: secrets[seat],
            nonce: `0x${ (0xa0 + seat).toString(16).repeat(32) }`,
            deadline: Number(DEADLINE),
            signature: signatures[seat]
        })),
        actions,
        openTx: `0x${ 'ab'.repeat(32) }`,
        closeTx: `0x${ 'cd'.repeat(32) }`
    };

    return proof;
}
