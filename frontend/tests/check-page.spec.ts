import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fire, renderTest } from '@azerothjs/testing';
import { RouterProvider, Routes, createMemoryHistory, createRouter } from 'azerothjs';
import { getAddress, type Hex } from 'viem';

import CheckPage from '../src/pages/app/check.page.azeroth';
import { manualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import '../src/locales/app-catalogue.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { usePeople } from '../src/stores/people.store.ts';
import { useSession } from '../src/stores/session.store.ts';
import type { MatchProof } from '../src/api.ts';
import { server } from './fake-api.ts';
import { PLAYERS, STRANGER, proofOf, signed } from './proofs.ts';
import { halfwayOut } from './leaving.ts';

const MATCH = '3f2b6c1e-6d1a-4b4e-9c55-2f4a8a9b1c01';

const opened = (id = MATCH) =>
{
    const router = createRouter({
        routes: [
            { path: '/app/me/wallet/check/:id', component: () => CheckPage() as HTMLElement },
            { path: '/app/me/wallet', component: () => document.createElement('div') }
        ],
        history: createMemoryHistory(`/app/me/wallet/check/${ id }`),
        scroll: false
    });

    return renderTest(() => RouterProvider({ router, children: () => Routes({}) }) as HTMLElement).container;
};

const said = (container: HTMLElement, selector: string) => container.querySelector(selector)?.textContent?.replace(/\s+/g, ' ').trim() ?? null;

const verdict = (container: HTMLElement) => said(container, '[data-verdict]');

beforeEach(() =>
{
    cleanup();
    resetRuntime();
    setRuntime({ clock: manualClock(7_000_000), seed: 3 });
    server.reset();
    useLocale().setLocale('en');
    useSession().reset();
    useSession().establish({ id: 'alex', handle: 'alex', displayName: 'Alex Morgan', bio: '', hue: 210, isMinor: false });
    usePeople().remember([{ id: 'sara.k', handle: 'sara.k', displayName: 'Sara Kamali', bio: '', hue: 340, isMinor: false }]);
});

afterEach(() =>
{
    cleanup();
    useLocale().setLocale('en');
});

describe('the page that checks a game played for NURA', () =>
{
    it('says everything checks out, and shows who signed, the secrets, the seed and every move', async () =>
    {
        const proof = await proofOf('ludo', { wired: true, resign: true });
        server.proofs[MATCH] = proof;
        const container = opened();

        await vi.waitFor(() => expect(verdict(container)).toBe('Everything checks out.'), { timeout: 4000 });

        expect(container.querySelector('[data-verdict]')?.getAttribute('data-verdict')).toBe('ok');
        expect([...container.querySelectorAll('[data-signed]')].map((row) => row.getAttribute('data-signed'))).toEqual(['yes', 'yes']);
        expect([...container.querySelectorAll('[data-kept]')].map((row) => row.getAttribute('data-kept'))).toEqual(['yes', 'yes']);
        expect(said(container, '[data-signed="yes"]')).toContain('Signed this stake');
        expect(said(container, '[data-seed]')).toMatch(/^0x[0-9a-f]{64}$/);
        expect(said(container, '[data-moves="ok"]')).toBe(`${ proof.actions.length } moves played again by the rules of Ludo, and every roll came out as the server logged it.`);
        expect(container.textContent).toContain('Sara Kamali');
        expect(container.textContent).toContain(PLAYERS[0].address.slice(0, 6).toLowerCase());
        expect(server.calls).toContain('matches.proof');
    });

    it('keeps the game it was built for while it is being left', async () =>
    {
        server.proofs[MATCH] = await proofOf('ludo', { wired: true, resign: true });

        const container = await halfwayOut(
            [{ path: '/app/me/wallet/check/:id', component: () => CheckPage() as HTMLElement }],
            `/app/me/wallet/check/${ MATCH }`,
            (root) => verdict(root) === 'Everything checks out.'
        );

        expect(verdict(container)).toBe('Everything checks out.');
    });

    it('says where the seed and the server part, and shows both', async () =>
    {
        const proof = await proofOf('hokm');
        const at = 3;
        server.proofs[MATCH] = { ...proof, actions: proof.actions.map((action, index) => (index === at ? { ...action, events: '[{"e":"forged"}]' } : action)) };
        const container = opened();

        await vi.waitFor(() => expect(verdict(container)).toBe('Something here does not add up.'), { timeout: 4000 });

        expect(said(container, '[data-moves="wrong"] p')).toBe(`At move ${ proof.actions[at].rev } the server logged something this seed does not give.`);
        expect([...container.querySelectorAll('[data-moves="wrong"] pre')].map((one) => one.textContent)).toContain('[{"e":"forged"}]');
        expect(container.querySelector('[data-moves="ok"]')).toBeNull();
    });

    it('marks a signature that is not the player\'s', async () =>
    {
        const proof = await proofOf('ludo', { steps: 6 });
        const [forged] = await signed('ludo', proof.players.map((seat) => seat.secret as Hex), [STRANGER, PLAYERS[1]]);
        server.proofs[MATCH] = { ...proof, players: proof.players.map((seat) => (seat.seat === 0 ? { ...seat, signature: forged } : seat)) } satisfies MatchProof;
        const container = opened();

        await vi.waitFor(() => expect(verdict(container)).toBe('Something here does not add up.'), { timeout: 4000 });

        expect([...container.querySelectorAll('[data-signed]')].map((row) => row.getAttribute('data-signed'))).toEqual(['no', 'yes']);
        expect(said(container, '[data-signed="no"]')).toContain('Not their signature');
    });

    it('links the two transactions on NuraChain and nowhere else, and says when the payment has not landed', async () =>
    {
        const local = await proofOf('ludo', { steps: 4 });
        server.proofs[MATCH] = local;
        const first = opened();

        await vi.waitFor(() => expect(verdict(first)).toBe('Everything checks out.'), { timeout: 4000 });
        expect(first.querySelector('a[target="_blank"]')).toBeNull();

        cleanup();
        const { closeTx: _closeTx, ...paying } = { ...local, chainId: 1020, state: 'settling' as const };
        server.proofs[MATCH] = paying;
        const mainnet = opened();

        await vi.waitFor(() => expect(said(mainnet, '[aria-labelledby="fair-chain"]')).toContain('The payment has not landed yet.'), { timeout: 4000 });
        expect([...mainnet.querySelectorAll('a[target="_blank"]')].map((one) => one.getAttribute('href'))).toEqual([`https://explorer.nurachain.net/tx/${ local.openTx }`]);
    });

    it('says something does not add up when only a signature or a secret is wrong, though every move plays again', async () =>
    {
        const proof = await proofOf('ludo', { steps: 0, resign: true });
        const [forged] = await signed('ludo', proof.players.map((seat) => seat.secret as Hex), [STRANGER, PLAYERS[1]]);
        server.proofs[MATCH] = { ...proof, players: proof.players.map((seat) => (seat.seat === 0 ? { ...seat, signature: forged } : seat)) } satisfies MatchProof;
        const stranger = opened();

        await vi.waitFor(() => expect(verdict(stranger)).toBe('Something here does not add up.'), { timeout: 4000 });
        expect(stranger.querySelector('[data-moves="ok"]')).not.toBeNull();
        expect([...stranger.querySelectorAll('[data-signed]')].map((row) => row.getAttribute('data-signed'))).toEqual(['no', 'yes']);
        expect([...stranger.querySelectorAll('[data-kept]')].map((row) => row.getAttribute('data-kept'))).toEqual(['yes', 'yes']);

        cleanup();
        server.proofs[MATCH] = { ...proof, players: proof.players.map((seat) => (seat.seat === 1 ? { ...seat, secret: `0x${ '77'.repeat(32) }` } : seat)) } satisfies MatchProof;
        const broken = opened();

        await vi.waitFor(() => expect(verdict(broken)).toBe('Something here does not add up.'), { timeout: 4000 });
        expect(broken.querySelector('[data-moves="ok"]')).not.toBeNull();
        expect([...broken.querySelectorAll('[data-signed]')].map((row) => row.getAttribute('data-signed'))).toEqual(['yes', 'yes']);
        expect([...broken.querySelectorAll('[data-kept]')].map((row) => row.getAttribute('data-kept'))).toEqual(['yes', 'no']);
    });

    it('speaks of rolls at a game of dice and of cards at a game of cards', async () =>
    {
        server.proofs[MATCH] = await proofOf('ludo', { steps: 6 });
        const dice = opened();

        await vi.waitFor(() => expect(verdict(dice)).toBe('Everything checks out.'), { timeout: 4000 });
        expect(dice.textContent).toContain('Every roll in this game came from a seed nobody could choose alone.');
        expect(dice.textContent).toContain('and every roll came from the seed.');
        expect(said(dice, '[aria-labelledby="fair-limits"]')).toContain('work out every roll before it is thrown');
        expect(dice.textContent).not.toContain('card');

        cleanup();
        const poker = await proofOf('poker', { steps: 6 });
        server.proofs[MATCH] = poker;
        const cards = opened();

        await vi.waitFor(() => expect(verdict(cards)).toBe('Everything checks out.'), { timeout: 4000 });
        expect(cards.textContent).toContain('Every card in this game was dealt from a seed nobody could choose alone.');
        expect(cards.textContent).toContain('and every card was dealt from the seed.');
        expect(said(cards, '[data-moves="ok"]')).toBe(`${ poker.actions.length } moves played again by the rules of Poker, and every card came out as the server logged it.`);
        expect(said(cards, '[aria-labelledby="fair-limits"]')).toContain('as any dealer does');
        expect(cards.textContent).not.toContain('roll');
    });

    it('says what the vault checked when the stakes were given back, or taken back by the players', async () =>
    {
        const local = await proofOf('ludo', { steps: 4 });
        server.proofs[MATCH] = { ...local, chainId: 1020, state: 'refunded' } satisfies MatchProof;
        const refunded = opened();

        await vi.waitFor(() => expect(said(refunded, '[aria-labelledby="fair-chain"]')).toContain('every stake was given back, so the secrets were never put to it.'), { timeout: 4000 });
        expect([...refunded.querySelectorAll('a[target="_blank"]')].map((one) => one.textContent?.trim())).toEqual(['The stakes locked', 'The stakes given back']);

        cleanup();
        const { closeTx: _closeTx, ...giving } = { ...local, chainId: 1020, state: 'refunding' as const };
        server.proofs[MATCH] = giving;
        const refunding = opened();

        await vi.waitFor(() => expect(said(refunding, '[aria-labelledby="fair-chain"]')).toContain('The stakes have not been given back yet.'), { timeout: 4000 });
        expect(said(refunding, '[aria-labelledby="fair-chain"]')).not.toContain('The payment has not landed yet.');

        cleanup();
        server.proofs[MATCH] = { ...local, chainId: 1020, state: 'reclaimed' } satisfies MatchProof;
        const reclaimed = opened();

        await vi.waitFor(() => expect(said(reclaimed, '[aria-labelledby="fair-chain"]')).toContain('The players took their stakes back themselves'), { timeout: 4000 });
        expect([...reclaimed.querySelectorAll('a[target="_blank"]')].map((one) => one.getAttribute('href'))).toEqual([`https://explorer.nurachain.net/tx/${ local.openTx }`]);
        expect(said(reclaimed, '[aria-labelledby="fair-chain"]')).not.toContain('not been given back');
        expect(said(reclaimed, '[aria-labelledby="fair-chain"]')).not.toContain('not landed');

        cleanup();
        const { closeTx: _unsent, ...unsent } = { ...local, chainId: 1020, state: 'reclaimed' as const };
        server.proofs[MATCH] = unsent;
        const quiet = opened();

        await vi.waitFor(() => expect(said(quiet, '[aria-labelledby="fair-chain"]')).toContain('The players took their stakes back themselves'), { timeout: 4000 });
        expect(said(quiet, '[aria-labelledby="fair-chain"]')).not.toContain('not landed');
        expect(said(quiet, '[aria-labelledby="fair-chain"]')).not.toContain('not been given back');
    });

    it('names a player once where their name is their address', async () =>
    {
        const proof = await proofOf('ludo', { steps: 4 });
        const address = proof.players[0].address;
        const short = `${ address.slice(0, 6) }…${ address.slice(-4) }`;
        usePeople().remember([{ id: 'f39fd6', handle: 'f39fd6', displayName: `${ getAddress(address).slice(0, 6) }…${ address.slice(-4) }`, bio: '', hue: 120, isMinor: false }]);
        server.proofs[MATCH] = { ...proof, players: proof.players.map((seat) => (seat.seat === 0 ? { ...seat, who: 'f39fd6' } : seat)) } satisfies MatchProof;
        const container = opened();

        await vi.waitFor(() => expect(verdict(container)).toBe('Everything checks out.'), { timeout: 4000 });

        const rows = [...container.querySelectorAll('[data-signed]')].map((row) => (row.textContent ?? '').toLowerCase());

        expect(rows[0].split(short.toLowerCase())).toHaveLength(2);
        expect(rows[1]).toContain('sara kamali');
        expect(rows[1]).toContain(`${ proof.players[1].address.slice(0, 6) }…`.toLowerCase());
    });

    it('says there is nothing to check for a game it may not see', async () =>
    {
        const container = opened();

        await vi.waitFor(() => expect(container.textContent).toContain('There is nothing to check here.'), { timeout: 4000 });
        expect(container.querySelector('[data-verdict]')).toBeNull();
    });

    it('says the game could not be read, and reads it again when asked', async () =>
    {
        server.proofRefused = { status: 500, code: 'internal' };
        const container = opened();

        await vi.waitFor(() => expect(container.textContent).toContain('This game could not be read.'), { timeout: 4000 });
        expect(container.textContent).not.toContain('There is nothing to check here.');

        server.proofRefused = null;
        server.proofs[MATCH] = await proofOf('ludo', { steps: 4 });
        const retry = [...container.querySelectorAll('button')].find((one) => one.textContent?.trim() === 'Try again');

        fire(retry!, 'click');

        await vi.waitFor(() => expect(verdict(container)).toBe('Everything checks out.'), { timeout: 4000 });
        expect(server.calls.filter((call) => call === 'matches.proof')).toHaveLength(2);
    });

    it('says it all in Persian', async () =>
    {
        useLocale().setLocale('fa');
        server.proofs[MATCH] = await proofOf('ludo', { steps: 4 });
        const container = opened();

        await vi.waitFor(() => expect(verdict(container)).toBe('همه‌چی درسته.'), { timeout: 4000 });
        expect(said(container, '[data-signed="yes"]')).toContain('این مبلغ رو امضا کرده');
        expect(said(container, '[data-moves="ok"]')).toContain('حرکت با قانون‌های');
        expect(said(container, '[data-moves="ok"]')).toContain('همه‌ی تاس‌ها همون عددی اومدن');
    });
});
