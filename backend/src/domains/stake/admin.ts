import type { HttpError } from '@azerothjs/http';
import type { DataSource } from 'typeorm';
import type { Address } from 'viem';

import type { Asked, Vault } from '../../chain/vault.ts';
import { Escrow } from '../../entities/escrow.entity.ts';
import type { AdminVault } from '../../schemas.ts';
import { tableRefusal } from '../table/service.ts';
import { ESCROW_STATES, MAX_FEE_BPS, MIN_FEE_BPS, weiOf, type EscrowState } from './policy.ts';
import { notAmount, notOpen, wireCall } from './service.ts';

const GAME_GAS = 1_100_000n;

const GAMES_LOW = 20n;

const STUCK_MINUTES = 10;

const STUCK_MAX = 50;

const IN_FLIGHT = ['locking', 'settling', 'refunding'];

interface StuckRow
{
    id: string;
    table_id: string;
    match_id: string | null;
    game: string;
    state: EscrowState;
    amount: string;
    seats: number;
    error: string | null;
    open_tx: string | null;
    close_tx: string | null;
    updated_at: Date;
}

const outOfRange = () => tableRefusal('vault-fee', 'A fee is from 1% to 15%.');

const REFUSED: Partial<Record<string, () => HttpError>> = {
    AccessControlUnauthorizedAccount: () => tableRefusal('vault-role', 'This wallet does not hold that role on the vault.'),
    FeeOutOfRange: outOfRange,
    InsufficientFees: () => tableRefusal('vault-fees', 'The vault does not hold that much in fees.'),
    EnforcedPause: () => tableRefusal('vault-paused', 'The vault is already paused.'),
    ExpectedPause: () => tableRefusal('vault-running', 'The vault is not paused.'),
    ZeroAmount: notAmount
};

const refusedBy = (error: string) => (REFUSED[error] ?? (() => tableRefusal('vault-refused', 'The vault would refuse that.')))();

export function createVaultAdmin(db: DataSource, vault: Vault)
{
    const answered = (admin: Address, asked: Asked) =>
    {
        if (!asked.ok)
        {
            throw refusedBy(asked.refusal.error);
        }

        return wireCall(admin, asked.call);
    };

    const amountOf = (amount: string) =>
    {
        if (!vault.configured)
        {
            throw notOpen();
        }

        const wei = weiOf(amount);

        if (wei === null)
        {
            throw notAmount();
        }

        return wei;
    };

    return {
        async counts()
        {
            const [row, stuck] = await Promise.all([
                db.getRepository(Escrow).createQueryBuilder('e')
                    .select(`(count(*) filter (where e.state = 'open'))::int`, 'playing')
                    .addSelect(
                        `coalesce(sum(e.amount * (select count(*) from escrow_seats s where s.escrow_id = e.id)) filter (where e.state in ('locking', 'open', 'settling')), 0)::text`,
                        'in_play'
                    )
                    .getRawOne<{ playing: number; in_play: string }>(),
                db.getRepository(Escrow).createQueryBuilder('e')
                    .where('e.state in (:...flight)', { flight: IN_FLIGHT })
                    .andWhere('(e.updated_at < now() - make_interval(mins => :minutes) or e.error is not null)', { minutes: STUCK_MINUTES })
                    .getCount()
            ]);

            return { playing: row?.playing ?? 0, inPlay: row?.in_play ?? '0', stuck };
        },

        async standing(admin: Address): Promise<AdminVault>
        {
            if (!vault.configured || vault.address === null || vault.referee === null)
            {
                return { configured: false };
            }

            const [ledger, counted, stuck] = await Promise.all([
                vault.ledger(admin),
                db.getRepository(Escrow).createQueryBuilder('e')
                    .select('e.state', 'state')
                    .addSelect('count(*)::int', 'count')
                    .groupBy('e.state')
                    .getRawMany<{ state: EscrowState; count: number }>(),
                db.getRepository(Escrow).createQueryBuilder('e')
                    .select('e.id', 'id')
                    .addSelect('e.table_id', 'table_id')
                    .addSelect('e.match_id', 'match_id')
                    .addSelect('e.game', 'game')
                    .addSelect('e.state', 'state')
                    .addSelect('e.amount::text', 'amount')
                    .addSelect('(select count(*)::int from escrow_seats s where s.escrow_id = e.id)', 'seats')
                    .addSelect('e.error', 'error')
                    .addSelect('e.open_tx', 'open_tx')
                    .addSelect('e.close_tx', 'close_tx')
                    .addSelect('e.updated_at', 'updated_at')
                    .where('e.state in (:...flight)', { flight: IN_FLIGHT })
                    .andWhere('(e.updated_at < now() - make_interval(mins => :minutes) or e.error is not null)', { minutes: STUCK_MINUTES })
                    .orderBy('e.updated_at', 'ASC')
                    .addOrderBy('e.id', 'ASC')
                    .limit(STUCK_MAX)
                    .getRawMany<StuckRow>()
            ]);
            const count = new Map(counted.map((row) => [row.state, row.count]));
            const gamePrice = GAME_GAS * ledger.gasPrice;
            const games = gamePrice === 0n ? null : ledger.gas / gamePrice;

            return {
                configured: true,
                vault: vault.address,
                chainId: vault.chainId,
                fee: ledger.terms.fee,
                minFee: MIN_FEE_BPS,
                maxFee: MAX_FEE_BPS,
                maxStake: ledger.terms.maxStake.toString(),
                reclaimAfter: Number(ledger.terms.reclaimAfter),
                paused: ledger.terms.paused,
                held: ledger.held.toString(),
                free: ledger.free.toString(),
                locked: ledger.locked.toString(),
                fees: ledger.fees.toString(),
                solvent: ledger.solvent,
                referee: {
                    address: vault.referee,
                    gas: ledger.gas.toString(),
                    ...(games === null ? {} : { games: games.toString() }),
                    low: games !== null && games < GAMES_LOW,
                    allowed: ledger.refereeAllowed
                },
                roles: { admin: ledger.adminAllowed, pauser: ledger.pauserAllowed },
                playing: count.get('open') ?? 0,
                states: ESCROW_STATES.map((state) => ({ state, count: count.get(state) ?? 0 })),
                stuck: stuck.map((row) => ({
                    id: row.id,
                    game: row.game,
                    state: row.state,
                    amount: row.amount,
                    seats: row.seats,
                    since: row.updated_at.toISOString(),
                    table: row.table_id,
                    ...(row.match_id === null ? {} : { match: row.match_id }),
                    ...(row.error === null ? {} : { error: row.error }),
                    ...(row.open_tx === null ? {} : { openTx: row.open_tx }),
                    ...(row.close_tx === null ? {} : { closeTx: row.close_tx })
                }))
            };
        },

        async fee(admin: Address, feeBps: number)
        {
            if (!vault.configured)
            {
                throw notOpen();
            }

            if (!Number.isInteger(feeBps) || feeBps < MIN_FEE_BPS || feeBps > MAX_FEE_BPS)
            {
                throw outOfRange();
            }

            return answered(admin, await vault.feeCall(admin, feeBps));
        },

        async ceiling(admin: Address, amount: string)
        {
            return answered(admin, await vault.ceilingCall(admin, amountOf(amount)));
        },

        async fees(admin: Address, amount: string)
        {
            return answered(admin, await vault.feesCall(admin, amountOf(amount)));
        },

        async pause(admin: Address, paused: boolean)
        {
            if (!vault.configured)
            {
                throw notOpen();
            }

            return answered(admin, await vault.pauseCall(admin, paused));
        }
    };
}
