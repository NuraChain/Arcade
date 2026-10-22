import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fire, renderTest } from '@azerothjs/testing';
import { RouterProvider, Routes, createMemoryHistory, createRouter, createSignal } from 'azerothjs';

import LobbyPanel from '../src/components/games/lobby-panel.component.azeroth';
import MatchResult from '../src/components/games/match-result.component.azeroth';
import PlayHeader from '../src/components/games/play-header.component.azeroth';
import TableRow from '../src/components/games/table-row.component.azeroth';
import { stakedOf, type Staked } from '../src/components/games/boards.ts';
import { manualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import '../src/locales/app-catalogue.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { usePeople } from '../src/stores/people.store.ts';
import { useSession } from '../src/stores/session.store.ts';
import { useToasts } from '../src/stores/toasts.store.ts';
import { useVault } from '../src/stores/vault.store.ts';
import type { MatchView, TableMoney, TableSummary } from '../src/api.ts';
import { client, nuraState, server } from './fake-api.ts';

const WEI = 10n ** 18n;
const TEN = (10n * WEI).toString();
const OPEN_TX = `0x${ 'ab'.repeat(32) }`;
const CLOSE_TX = `0x${ 'cd'.repeat(32) }`;

const settle = async () =>
{
    for (let turn = 0; turn < 16; turn += 1)
    {
        await Promise.resolve();
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
};

const routed = (component: () => HTMLElement) =>
{
    const router = createRouter({
        routes: [
            { path: '/', component },
            { path: '/app/play/:id', component: () => document.createElement('div') },
            { path: '/app/me/wallet', component: () => document.createElement('div') }
        ],
        history: createMemoryHistory('/'),
        scroll: false
    });

    return renderTest(() => RouterProvider({ router, children: () => Routes({}) }) as HTMLElement).container;
};

const tableOf = (extra: Partial<TableSummary> = {}): TableSummary => ({
    id: 'table-paid',
    code: 'paid12',
    game: 'ludo',
    seats: 2,
    mode: 'live',
    privacy: 'public',
    target: 0,
    cube: false,
    blinds: 'low',
    chat: true,
    voice: 'off',
    teams: false,
    status: 'ready',
    chairs: [
        { seat: 0, who: 'alex', ready: false, host: true },
        { seat: 1, who: 'sara.k', ready: true, host: false }
    ],
    taken: 2,
    mine: 0,
    createdAt: new Date(0).toISOString(),
    stake: TEN,
    ...extra
});

const finished = (winner: number) => ({
    id: 'm-paid',
    tableId: 'table-paid',
    game: 'ludo',
    rev: 40,
    seats: 2,
    mine: 0,
    outcome: 'won',
    startedAt: new Date(0).toISOString(),
    finishedAt: new Date(60_000).toISOString(),
    players: [
        { seat: 0, who: 'alex', result: winner === 0 ? 'won' : 'lost' },
        { seat: 1, who: 'sara.k', result: winner === 1 ? 'won' : 'lost' }
    ],
    view: { kind: 'ludo', seats: [], dice: null, controls: 0, moves: [] }
} as unknown as MatchView);

const stakeOf = (money?: Partial<TableMoney>, chainId = 31337): Staked => ({
    amount: TEN,
    fee: 500,
    chainId,
    ...(money === undefined ? {} : { money: { state: 'settled', feeBps: 500, ...money } as TableMoney })
});

const holding = async (free: bigint) =>
{
    server.nura.state = { ...nuraState(), balances: { address: '0x71c7656ec7ab88b098defb751b7401b5f6d8976f', free: free.toString(), locked: '0', wallet: '0' } } as typeof server.nura.state;
    await useVault().refresh();
    await settle();
};

const toasts = () => useToasts().items().map((one) => one.text);

beforeEach(async () =>
{
    cleanup();
    resetRuntime();
    setRuntime({ clock: manualClock(5_000_000), seed: 9 });
    server.reset();
    useLocale().setLocale('en');
    useSession().reset();
    useSession().establish({ id: 'alex', handle: 'alex', displayName: 'Alex Morgan', bio: '', hue: 210, isMinor: false });
    usePeople().remember([{ id: 'sara.k', handle: 'sara.k', displayName: 'Sara Kamali', bio: '', hue: 340, isMinor: false }]);
    useToasts().reset();
    server.nura.state = nuraState();
    await useVault().refresh();
    await settle();
});

afterEach(() =>
{
    cleanup();
    vi.restoreAllMocks();
    useToasts().reset();
    useLocale().setLocale('en');
});

describe('what a reader has free against a table\'s stake', () =>
{
    const moving = (state: TableMoney['state']) => tableOf({ money: { state, feeBps: 500 } as TableMoney });

    it('is short only when the free balance is under the stake', () =>
    {
        expect(stakedOf(tableOf(), 500, 31337, '0')?.short).toBe('0');
        expect(stakedOf(tableOf(), 500, 31337, (9n * WEI).toString())?.short).toBe((9n * WEI).toString());
        expect(stakedOf(tableOf(), 500, 31337, TEN)?.short).toBeUndefined();
        expect(stakedOf(tableOf(), 500, 31337, (50n * WEI).toString())?.short).toBeUndefined();
    });

    it('says nothing while the balance is not known, or at a free table', () =>
    {
        expect(stakedOf(tableOf(), 500, 31337)?.short).toBeUndefined();
        expect(stakedOf(tableOf({ stake: undefined }), 500, 31337, '0')).toBeUndefined();
    });

    it('waits while money is moving on the chain, because the balance is about to change', () =>
    {
        for (const state of ['locking', 'settling', 'refunding'] as const)
        {
            expect(stakedOf(moving(state), 500, 31337, '0')?.short, state).toBeUndefined();
        }

        for (const state of ['open', 'settled', 'refunded', 'reclaimed', 'failed'] as const)
        {
            expect(stakedOf(moving(state), 500, 31337, '0')?.short, state).toBe('0');
        }
    });
});

describe('a table played for NURA, wherever it is listed', () =>
{
    it('wears its stake on its row, and a free table wears none', async () =>
    {
        const paid = routed(() => TableRow({ table: tableOf() }) as unknown as HTMLElement);
        const mark = paid.querySelector('[data-stake]');

        expect(mark?.textContent?.replace(/\s+/g, ' ').trim()).toBe('Played for 10 NURA');
        expect(mark?.className).toContain('bg-madder');

        cleanup();
        const free = routed(() => TableRow({ table: tableOf({ stake: undefined }) }) as unknown as HTMLElement);

        expect(free.querySelector('[data-stake]')).toBeNull();
    });

    it('keeps the mark through a read of the row that changed nothing', async () =>
    {
        const [held, hold] = createSignal(tableOf());
        const container = routed(() => TableRow({ get table()
        {
            return held();
        } }) as unknown as HTMLElement);
        const mark = container.querySelector('[data-stake]');

        hold(tableOf());
        await settle();

        expect(container.contains(mark)).toBe(true);
    });

    it('wears it in the play header, in the reader\'s digits', async () =>
    {
        const container = routed(() => PlayHeader({ table: tableOf(), others: [] }) as unknown as HTMLElement);

        expect(container.querySelector('[data-stake]')?.textContent?.replace(/\s+/g, ' ').trim()).toBe('Played for 10 NURA');

        useLocale().setLocale('fa');
        await settle();

        expect(container.querySelector('[data-stake] .tally')?.textContent).toBe('۱۰');
    });
});

describe('the lobby of a table played for NURA', () =>
{
    const shown = (table: TableSummary) =>
        renderTest(() => LobbyPanel({ table, onInvite: () => undefined, onCopyLink: () => undefined, onLeave: () => undefined }) as HTMLElement).container;

    it('says what each player stakes and what the winner takes, alone or as a pair', () =>
    {
        expect(shown(tableOf()).querySelector('[data-stake]')?.textContent).toContain('Played for 10 NURA each. The winner takes 19 NURA.');

        cleanup();
        const teams = tableOf({
            seats: 4,
            teams: true,
            chairs: [0, 1, 2, 3].map((seat) => ({ seat, who: ['alex', 'sara.k', 'reza.t', 'parisa'][seat], ready: false, host: seat === 0 })) as TableSummary['chairs'],
            taken: 4
        });

        expect(shown(teams).querySelector('[data-stake]')?.textContent).toContain('Played for 10 NURA each. Each of the winning pair takes 19 NURA.');
    });

    it('says nothing about money at a free table', () =>
    {
        const container = shown(tableOf({ stake: undefined }));

        expect(container.querySelector('[data-stake]')).toBeNull();
        expect(container.textContent).not.toContain('NURA');
    });

    it('says the stakes are being locked, with the transaction on NuraChain and nowhere else', async () =>
    {
        const local = shown(tableOf({ money: { state: 'locking', feeBps: 500, openTx: OPEN_TX } }));

        expect(local.textContent).toContain('Locking the stakes on NuraChain…');
        expect(local.querySelector('a[target="_blank"]')).toBeNull();

        cleanup();
        server.nura.state = { ...nuraState(), chainId: 1020 } as typeof server.nura.state;
        await useVault().refresh();
        await settle();
        const mainnet = shown(tableOf({ money: { state: 'locking', feeBps: 500, openTx: OPEN_TX } }));

        expect(mainnet.querySelector('a[target="_blank"]')?.getAttribute('href')).toBe(`https://explorer.nurachain.net/tx/${ OPEN_TX }`);
    });

    it('says whose stake could not be locked, the reader\'s own in the second person, and everybody\'s when nobody is named', () =>
    {
        const failed = (blame?: string) => tableOf({ money: { state: 'failed', feeBps: 500, failed: 'StakeUnfunded', ...(blame === undefined ? {} : { blame }) } });

        expect(shown(failed('sara.k')).textContent).toContain('Sara’s stake could not be locked, so they have to sign it again.');

        cleanup();
        expect(shown(failed('alex')).textContent).toContain('Your stake could not be locked. Sign it again when you are ready.');

        cleanup();
        expect(shown(failed()).textContent).toContain('The stakes could not be locked, so everybody has to sign again.');
    });

    it('says nothing of a failed lock once a game is on', () =>
    {
        const container = shown(tableOf({ matchId: 'm-1', money: { state: 'failed', feeBps: 500, blame: 'sara.k' } }));

        expect(container.textContent).not.toContain('could not be locked');
    });

    it('reckons the winner\'s share at the fee the game was locked at, not the vault\'s fee now', () =>
    {
        const container = shown(tableOf({ money: { state: 'open', feeBps: 1000 } }));

        expect(container.querySelector('[data-stake]')?.textContent).toContain('The winner takes 18 NURA.');
    });

    it('says what the last game came to on its card in the waiting room', async () =>
    {
        const matches = client.matches as unknown as Record<string, unknown>;
        const real = matches.view;

        matches.view = async () => finished(0);

        try
        {
            const container = routed(() => LobbyPanel({ table: tableOf({ lastMatchId: 'm-paid', money: { state: 'settled', feeBps: 500, winners: [0] } }), onInvite: () => undefined, onCopyLink: () => undefined, onLeave: () => undefined }) as unknown as HTMLElement);

            await vi.waitFor(() => expect(container.querySelector('[data-last-game] [data-money]')?.textContent).toContain('You won 19 NURA.'));
        }
        finally
        {
            matches.view = real;
        }
    });

    it('says the stake line in Persian', async () =>
    {
        useLocale().setLocale('fa');
        await settle();

        expect(shown(tableOf()).querySelector('[data-stake]')?.textContent).toContain('هر نفر ۱۰ NURA می‌ذاره و برنده ۱۹ NURA می‌بره.');
    });

    const linked = (table: TableSummary) =>
        routed(() => LobbyPanel({ table, onInvite: () => undefined, onCopyLink: () => undefined, onLeave: () => undefined }) as unknown as HTMLElement);

    const ready = (container: HTMLElement) =>
        [...container.querySelectorAll<HTMLButtonElement>('button')].find((one) => one.textContent?.trim() === 'I’m ready');

    it('tells a seated reader with too little free NURA so before they press anything, and where to put more in', async () =>
    {
        await holding(3n * WEI);
        const container = linked(tableOf());

        expect(container.querySelector('[data-short] p')?.textContent).toBe('You have 3 NURA free in your vault, less than the stake.');
        expect(container.querySelector('[data-short] a')?.getAttribute('href')).toBe('/app/me/wallet');
        expect(container.querySelector('[data-short] a')?.textContent).toBe('Your NURA');
    });

    it('asks the wallet nothing when Ready is pressed with too little free NURA, and says why', async () =>
    {
        await holding(3n * WEI);
        const sign = vi.spyOn(useVault(), 'signStake');
        const container = linked(tableOf());
        server.calls = [];

        fire(ready(container)!, 'click');
        await settle();

        expect(sign).not.toHaveBeenCalled();
        expect(server.calls).not.toContain('tables.ready');
        expect(toasts()).toContain('There is not that much NURA free in your vault balance.');
    });

    it('says nothing of the balance to a reader who has enough, who is ready, who is watching, or at a free table', async () =>
    {
        expect(linked(tableOf()).querySelector('[data-short]')).toBeNull();

        await holding(3n * WEI);

        cleanup();
        const signed = tableOf({ chairs: [{ seat: 0, who: 'alex', ready: true, host: true }, { seat: 1, who: 'sara.k', ready: true, host: false }] as TableSummary['chairs'] });
        expect(linked(signed).querySelector('[data-short]')).toBeNull();

        cleanup();
        const watched = tableOf({ chairs: [{ seat: 0, who: 'reza.t', ready: false, host: true }, { seat: 1, who: 'sara.k', ready: true, host: false }] as TableSummary['chairs'] });
        delete watched.mine;
        expect(linked(watched).querySelector('[data-short]')).toBeNull();

        cleanup();
        expect(linked(tableOf({ stake: undefined })).querySelector('[data-short]')).toBeNull();
    });

    it('waits to say it while the stakes of a game are being paid', async () =>
    {
        await holding(0n);

        expect(linked(tableOf({ money: { state: 'settling', feeBps: 500, winners: [0] } })).querySelector('[data-short]')).toBeNull();
    });

    it('says it in Persian', async () =>
    {
        await holding(3n * WEI);
        useLocale().setLocale('fa');
        await settle();

        expect(linked(tableOf()).querySelector('[data-short] p')?.textContent).toBe('توی صندوقت فقط ۳ NURA آزاد داری که از مبلغ میز کمتره.');
    });
});

describe('the result of a game played for NURA', () =>
{
    const card = (match: MatchView, stake?: Staked, mine: number | null = 0, rematch?: { ready: boolean; waiting: string[]; empty: number }) =>
        routed(() => MatchResult({
            match,
            ...(mine === null ? {} : { mine }),
            ...(stake === undefined ? {} : { stake }),
            ...(rematch === undefined ? {} : { rematch, onAgain: () => undefined })
        }) as unknown as HTMLElement);

    const money = (container: HTMLElement) => container.querySelector('[data-money] > span')?.textContent?.replace(/\s+/g, ' ').trim() ?? null;

    it('says what the winner was paid once it is paid, with the transaction on NuraChain', () =>
    {
        const container = card(finished(0), stakeOf({ state: 'settled', winners: [0], closeTx: CLOSE_TX }, 1020));

        expect(money(container)).toBe('You won 19 NURA.');
        expect(container.querySelector('[data-money] a')?.getAttribute('href')).toBe(`https://explorer.nurachain.net/tx/${ CLOSE_TX }`);
    });

    it('leads a player to check the game the money was paid for, and nobody else', () =>
    {
        const paid = card(finished(0), stakeOf({ state: 'settled', winners: [0], closeTx: CLOSE_TX }));

        expect(paid.querySelector('[data-check]')?.getAttribute('href')).toBe('/app/me/wallet/check/m-paid');
        expect(paid.querySelector('[data-check]')?.textContent?.trim()).toBe('Check this game');

        cleanup();
        expect(card(finished(0), stakeOf({ state: 'refunded' })).querySelector('[data-check]')).not.toBeNull();

        cleanup();
        expect(card(finished(0), stakeOf({ state: 'settled', winners: [0] }), null).querySelector('[data-check]')).toBeNull();

        cleanup();
        expect(card(finished(0)).querySelector('[data-check]')).toBeNull();

        cleanup();
        expect(card(finished(0), stakeOf({ state: 'locking' })).querySelector('[data-check]')).toBeNull();
    });

    it('says the win is being paid out until it is', () =>
    {
        expect(money(card(finished(0), stakeOf({ state: 'settling', winners: [0] })))).toBe('You won 19 NURA. Paying it out…');
    });

    it('says what the loser lost, and links nothing off NuraChain', () =>
    {
        const container = card(finished(1), stakeOf({ state: 'settled', winners: [1], closeTx: CLOSE_TX }));

        expect(money(container)).toBe('You lost 10 NURA.');
        expect(container.querySelector('[data-money] a')).toBeNull();
    });

    it('pays a pair the pot less the fee between them', () =>
    {
        const four = { ...finished(0), seats: 4, players: [0, 1, 2, 3].map((seat) => ({ seat, who: `p${ seat }`, result: seat % 2 === 0 ? 'won' : 'lost' })) } as unknown as MatchView;

        expect(money(card(four, stakeOf({ state: 'settled', winners: [0, 2] })))).toBe('You won 19 NURA.');
    });

    it('says every stake goes back from a game nobody won, and that it went', () =>
    {
        expect(money(card(finished(0), stakeOf({ state: 'refunding' })))).toBe('Nobody won, so every stake goes back. Paying it out…');

        cleanup();
        expect(money(card(finished(0), stakeOf({ state: 'refunded' })))).toBe('Nobody won, so every stake went back to the vault.');

        cleanup();
        expect(money(card(finished(0), stakeOf({ state: 'reclaimed' })))).toBe('The stakes of this game were taken back from the vault.');
    });

    it('says nothing about money to somebody watching, at a free table, or once the next game is locking', () =>
    {
        expect(money(card(finished(0), stakeOf({ state: 'settled', winners: [0] }), null))).toBeNull();

        cleanup();
        expect(money(card(finished(0)))).toBeNull();

        cleanup();
        expect(money(card(finished(0), stakeOf({ state: 'locking' })))).toBeNull();
    });

    it('offers no Start for the next game at a paid table, and says its stakes are being locked', () =>
    {
        const container = card(finished(0), stakeOf({ state: 'settled', winners: [0] }), 0, { ready: true, waiting: [], empty: 0 });

        expect([...container.querySelectorAll('button')].map((one) => one.textContent?.trim())).not.toContain('Start the game');
        expect(container.textContent).toContain('Locking the stakes on NuraChain…');

        cleanup();
        const free = card(finished(0), undefined, 0, { ready: true, waiting: [], empty: 0 });

        expect([...free.querySelectorAll('button')].map((one) => one.textContent?.trim())).toContain('Start the game');
        expect(free.textContent).not.toContain('Locking the stakes');
    });

    it('says the win in Persian', async () =>
    {
        useLocale().setLocale('fa');
        await settle();

        expect(money(card(finished(0), stakeOf({ state: 'settled', winners: [0] })))).toBe('۱۹ NURA بردی.');
    });

    it('keeps what its own game came to while the next game\'s stakes are locked, and tells another game nothing of it', async () =>
    {
        const [stake, restake] = createSignal(stakeOf({ state: 'settled', winners: [0], closeTx: CLOSE_TX }, 1020));
        const [match, rematch] = createSignal(finished(0));
        const container = routed(() => MatchResult({ get match()
        {
            return match();
        }, mine: 0, get stake()
        {
            return stake();
        } }) as unknown as HTMLElement);

        await settle();
        restake(stakeOf({ state: 'locking' }, 1020));
        await settle();

        expect(money(container)).toBe('You won 19 NURA.');
        expect(container.querySelector('[data-money] a')?.getAttribute('href')).toBe(`https://explorer.nurachain.net/tx/${ CLOSE_TX }`);

        rematch({ ...finished(0), id: 'm-next' } as MatchView);
        await settle();

        expect(money(container)).toBeNull();
    });

    const walkedOut = (gone: number) => ({
        ...finished(0),
        outcome: 'abandoned',
        players: [0, 1].map((seat) => ({ seat, who: seat === 0 ? 'alex' : 'sara.k', ...(seat === gone ? { result: 'abandoned', exit: 'resign' } : { result: 'void' }) }))
    } as unknown as MatchView);

    const headline = (container: HTMLElement) => container.querySelector('p.text-ui-lg')?.textContent?.trim() ?? null;

    it('names whoever the stakes were paid to as the winner of a game that ended too early to be rated', () =>
    {
        const paid = card(walkedOut(1), stakeOf({ state: 'settled', winners: [0] }));

        expect(headline(paid)).toBe('You won.');
        expect(money(paid)).toBe('You won 19 NURA.');
        expect(paid.textContent).not.toContain('Ended too early to count.');
        expect(paid.textContent).toContain('The game ended too early to move your rating or your streak.');
        expect(paid.textContent).not.toContain('This one did not count for you');

        cleanup();
        const lost = card(walkedOut(0), stakeOf({ state: 'settling', winners: [1] }));

        expect(headline(lost)).toBe('Sara Kamali won.');
        expect(money(lost)).toBe('You lost 10 NURA.');
        expect(lost.textContent).not.toContain('Ended too early to count.');
    });

    it('says only that the game is over until the table says what its stakes came to', async () =>
    {
        const [stake, restake] = createSignal(stakeOf({ state: 'open' }));
        const container = routed(() => MatchResult({ match: walkedOut(1), mine: 0, get stake()
        {
            return stake();
        } }) as unknown as HTMLElement);

        expect(headline(container)).toBe('That game is over.');
        expect(container.textContent).not.toContain('Ended too early to count.');
        expect(container.textContent).not.toContain('did not count for you');

        restake(stakeOf({ state: 'settling', winners: [0] }));
        await settle();

        expect(headline(container)).toBe('You won.');
        expect(container.textContent).toContain('The game ended too early to move your rating or your streak.');
    });

    it('goes on naming whoever was paid while the next game\'s stakes are locked', async () =>
    {
        const [stake, restake] = createSignal(stakeOf({ state: 'settled', winners: [0] }));
        const container = routed(() => MatchResult({ match: walkedOut(1), mine: 0, get stake()
        {
            return stake();
        } }) as unknown as HTMLElement);

        await settle();
        restake(stakeOf({ state: 'locking' }));
        await settle();

        expect(headline(container)).toBe('You won.');
    });

    it('still says a game ended too early when nobody was paid, or the table was free', () =>
    {
        expect(headline(card(walkedOut(1), stakeOf({ state: 'refunded' })))).toBe('Ended too early to count.');

        cleanup();
        expect(headline(card(walkedOut(1)))).toBe('Ended too early to count.');

        cleanup();
        expect(headline(card(walkedOut(1), stakeOf({ state: 'locking' })))).toBe('Ended too early to count.');
    });

    it('names the winner in Persian', async () =>
    {
        useLocale().setLocale('fa');
        await settle();

        const paid = card(walkedOut(1), stakeOf({ state: 'settled', winners: [0] }));

        expect(headline(paid)).toBe('بردی.');
        expect(paid.textContent).toContain('بازی زودتر از اون تموم شد که ریتینگ یا بردهای پشت سر همت عوض بشه.');
    });

    const asked = (stake: Staked, ready = false) =>
        routed(() => MatchResult({ match: finished(1), mine: 0, stake, rematch: { ready, waiting: [], empty: 0 }, onAgain: () => undefined }) as unknown as HTMLElement);

    it('tells a reader with too little free NURA so under Play again, and where to put more in', () =>
    {
        const container = asked({ ...stakeOf({ state: 'settled', winners: [1] }), short: (3n * WEI).toString() });

        expect(container.querySelector('[data-short] p')?.textContent).toBe('You have 3 NURA free in your vault, less than the stake.');
        expect(container.querySelector('[data-short] a')?.getAttribute('href')).toBe('/app/me/wallet');

        cleanup();
        expect(asked(stakeOf({ state: 'settled', winners: [1] })).querySelector('[data-short]')).toBeNull();

        cleanup();
        expect(asked({ ...stakeOf({ state: 'settled', winners: [1] }), short: '0' }, true).querySelector('[data-short]')).toBeNull();
    });
});
