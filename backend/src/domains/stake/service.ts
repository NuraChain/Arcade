import { NotFoundError, type HttpError } from '@azerothjs/http';
import { IsNull, type DataSource, type EntityManager } from 'typeorm';
import { getAddress, toHex, type Address, type Hex } from 'viem';

import { commitOf, freshBytes, vaultIdOf, type Refusal, type Stake, type Vault, type VaultCall } from '../../chain/vault.ts';
import { EscrowSeat } from '../../entities/escrow-seat.entity.ts';
import { Escrow } from '../../entities/escrow.entity.ts';
import { Match } from '../../entities/match.entity.ts';
import { PaidAccount } from '../../entities/paid-account.entity.ts';
import { StakeConsent } from '../../entities/stake-consent.entity.ts';
import { TableSeat } from '../../entities/table-seat.entity.ts';
import { TableStake } from '../../entities/table-stake.entity.ts';
import { Table } from '../../entities/table.entity.ts';
import { User } from '../../entities/user.entity.ts';
import type { VaultState } from '../../schemas.ts';
import { lockTable, lockingAt, stillLocking, tableRefusal } from '../table/service.ts';
import { CONSENT_MS, eligibilityOf, onLadder, potOf, seatsOfMask, shareOf, STAKE_LADDER, weiOf, type BreakDays, type Eligibility, type EscrowState } from './policy.ts';

interface StandingRow
{
    minor: boolean;
    address: string | null;
    accepted: boolean;
    resting: boolean;
    break_until: Date | null;
}

interface ConsentRow
{
    nonce: string;
    user_id: string;
    game: string;
    amount: string;
    fee_bps: number;
    address: string;
    commitment: string;
    secret: string;
    deadline: Date;
    signature: string | null;
    fresh: boolean;
}

interface EscrowRow
{
    id: string;
    table_id: string;
    game: string;
    amount: string;
    fee_bps: number;
    state: EscrowState;
    winners: number | null;
    open_tx: string | null;
    close_tx: string | null;
    expired: boolean;
    resting: boolean;
}

export interface StakeHooks
{
    begin(escrowId: string): Promise<string | null>;
    began(matchId: string): Promise<void>;
    changed(tableId: string, players: readonly string[]): Promise<void>;
}

export interface StakeSweep
{
    begun: number;
    sent: number;
    closed: number;
    failed: number;
    faults: { escrow: string; error: string }[];
}

const LOCK_MARGIN_S = 120;

const SWEEP_MAX = 32;

const RETRY_AFTER_S = 30;

const LIVE = `e.state in ('locking', 'open', 'settling', 'refunding')`;

const REFUSED = {
    'paid-wallet': () => tableRefusal('paid-wallet', 'Playing for NURA needs a wallet account.'),
    'paid-minor': () => tableRefusal('paid-minor', 'Playing for NURA is for adults only.'),
    'paid-terms': () => tableRefusal('paid-terms', 'Confirm the terms of playing for NURA first.'),
    'paid-break': () => tableRefusal('paid-break', 'You asked for a break from playing for NURA.')
} satisfies Record<Exclude<Eligibility, 'yes'>, () => HttpError>;

export const notOpen = () => tableRefusal('paid-off', 'Playing for NURA is not open here.');

const notAmount = () => tableRefusal('paid-amount', 'That is not an amount of NURA.');

const halted = () => tableRefusal('paid-paused', 'The vault is not taking deposits or new games right now.');

const notStake = () => tableRefusal('paid-stake', 'That is not a stake a table can be played for.');

const unsigned = () => tableRefusal('paid-consent', 'Sign your stake for this game again.');

const short = () => tableRefusal('paid-funds', 'There is not that much NURA free in your vault balance.');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SIGNATURE = /^0x(?:[0-9a-fA-F]{2})+$/;

const GAMES_PAGE = 20;

const GAMES_CURSOR = /^([0-9T:.\-Z]+)\|([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

interface PlayedRow
{
    id: string;
    game: string;
    amount: string;
    fee_bps: number;
    state: EscrowState;
    winners: number | null;
    open_tx: string | null;
    close_tx: string | null;
    created_at: Date;
    seat: number;
    seats: number;
}

const gamesAfter = (cursor: string | null) =>
{
    const found = cursor === null ? null : GAMES_CURSOR.exec(cursor);
    const at = found === null ? null : new Date(found[1]);

    return found === null || at === null || Number.isNaN(at.getTime()) ? null : { at, id: found[2] };
};

const wireCall = (from: Address, call: VaultCall) => ({
    from,
    to: call.to,
    data: call.data,
    value: toHex(call.value),
    chainId: call.chainId,
    ...(call.gasPrice === null ? {} : { gasPrice: toHex(call.gasPrice) })
});

const consentQuery = (from: DataSource | EntityManager) => from.getRepository(StakeConsent)
    .createQueryBuilder('c')
    .select('c.nonce', 'nonce')
    .addSelect('c.user_id', 'user_id')
    .addSelect('c.game', 'game')
    .addSelect('c.amount::text', 'amount')
    .addSelect('c.fee_bps', 'fee_bps')
    .addSelect('c.address', 'address')
    .addSelect('c.commitment', 'commitment')
    .addSelect('c.secret', 'secret')
    .addSelect('c.deadline', 'deadline')
    .addSelect('c.signature', 'signature')
    .addSelect('c.deadline > now() + make_interval(secs => :margin)', 'fresh')
    .setParameter('margin', LOCK_MARGIN_S);

const stakeFrom = (row: { address: string; game: string; amount: string; fee_bps: number; commitment: string; nonce: string; deadline: Date }): Stake => ({
    player: getAddress(row.address),
    game: row.game,
    amount: BigInt(row.amount),
    feeBps: row.fee_bps,
    commit: row.commitment as Hex,
    nonce: row.nonce as Hex,
    deadline: BigInt(Math.floor(row.deadline.getTime() / 1000))
});

export type StakeService = ReturnType<typeof createStakeService>;

export function createStakeService(db: DataSource, vault: Vault, hooks: StakeHooks)
{
    const standingOf = async (me: string) =>
    {
        const row = await db.getRepository(User).createQueryBuilder('u')
            .select('u.is_minor', 'minor')
            .addSelect('(select w.address from wallets w where w.user_id = u.id order by w.last_used_at desc nulls last limit 1)', 'address')
            .addSelect('p.user_id is not null', 'accepted')
            .addSelect('coalesce(p.break_until > now(), false)', 'resting')
            .addSelect('p.break_until', 'break_until')
            .leftJoin(PaidAccount, 'p', 'p.user_id = u.id')
            .where('u.id = :me', { me })
            .getRawOne<StandingRow>();

        return {
            address: row?.address ?? null,
            minor: row?.minor ?? false,
            accepted: row?.accepted ?? false,
            onBreak: row?.resting ?? false,
            breakUntil: row?.resting === true ? row.break_until : null
        };
    };

    const playerOf = async (me: string) =>
    {
        if (!vault.configured)
        {
            throw notOpen();
        }

        const standing = await standingOf(me);

        if (standing.address === null)
        {
            throw REFUSED['paid-wallet']();
        }

        const may = eligibilityOf(standing);

        if (may !== 'yes')
        {
            throw REFUSED[may]();
        }

        return getAddress(standing.address);
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

    const composed = (player: Address, game: string, amount: string, feeBps: number) =>
    {
        const secret = freshBytes();
        const deadline = new Date(Math.floor((Date.now() + CONSENT_MS) / 1000) * 1000);
        const stake: Stake = {
            player,
            game,
            amount: BigInt(amount),
            feeBps,
            commit: commitOf(secret),
            nonce: freshBytes(),
            deadline: BigInt(deadline.getTime() / 1000)
        };

        return {
            stake,
            terms: { typedData: vault.stakeTypedData(stake), deadline: deadline.toISOString() },
            row: (userId: string, tableId: string | null) => ({
                nonce: stake.nonce,
                userId,
                tableId,
                game,
                amount,
                feeBps,
                address: player.toLowerCase(),
                commitment: stake.commit,
                secret,
                deadline
            })
        };
    };

    const verified = async (player: Address, held: ConsentRow | undefined, signature: string | undefined) =>
    {
        if (held === undefined || !held.fresh || signature === undefined || !SIGNATURE.test(signature))
        {
            throw unsigned();
        }

        const stake = stakeFrom(held);

        if (!await vault.signedBy(player, stake, signature as Hex))
        {
            throw unsigned();
        }

        const [terms, money] = await Promise.all([vault.terms(), vault.balances(player)]);

        if (terms.paused)
        {
            throw halted();
        }

        if (terms.fee !== held.fee_bps)
        {
            throw unsigned();
        }

        if (stake.amount > terms.maxStake)
        {
            throw notStake();
        }

        if (money.free < stake.amount)
        {
            throw short();
        }

        return { nonce: held.nonce, signature };
    };

    const seatsOf = async (escrowId: string) => await db.getRepository(EscrowSeat).find({
        where: { escrowId },
        order: { seat: 'ASC' }
    });

    const playersOf = async (escrowId: string) => (await seatsOf(escrowId)).map((seat) => seat.userId);

    let running: Promise<StakeSweep> | null = null;
    let again = false;

    const lockIfReady = async (tableId: string) =>
    {
        if (!vault.configured)
        {
            return { locked: null, dropped: [] as string[] };
        }

        const done = await db.transaction(async (tx) =>
        {
            await lockTable(tx, tableId);

            const table = await tx.getRepository(Table).findOne({ select: { id: true, game: true, status: true, seats: true }, where: { id: tableId } });
            const stake = await tx.getRepository(TableStake).findOne({ where: { tableId } });

            if (table === null || stake === null || table.status === 'closed')
            {
                return { locked: null, dropped: [] as string[] };
            }

            const busy = await tx.getRepository(Escrow).createQueryBuilder('e')
                .where('e.table_id = :tableId', { tableId })
                .andWhere(LIVE)
                .getExists();

            if (busy || await tx.getRepository(Match).existsBy({ tableId, finishedAt: IsNull() }))
            {
                return { locked: null, dropped: [] as string[] };
            }

            const chairs = await tx.getRepository(TableSeat).find({ where: { tableId }, order: { seat: 'ASC' } });

            if (chairs.length !== table.seats || chairs.some((chair) => chair.userId === null || !chair.ready))
            {
                return { locked: null, dropped: [] as string[] };
            }

            const consents = await consentQuery(tx)
                .where('c.table_id = :tableId', { tableId })
                .andWhere('c.signature is not null')
                .getRawMany<ConsentRow>();
            const byUser = new Map(consents.map((consent) => [consent.user_id, consent]));
            const fees = new Set(consents.map((consent) => consent.fee_bps));
            const stale = chairs.filter((chair) =>
            {
                const consent = byUser.get(chair.userId as string);
                return consent === undefined || !consent.fresh;
            });
            const dropped = fees.size > 1 ? chairs : stale;

            if (dropped.length > 0)
            {
                for (const chair of dropped)
                {
                    await tx.getRepository(TableSeat).update({ tableId, userId: chair.userId as string }, { ready: false });
                    await tx.getRepository(StakeConsent).delete({ tableId, userId: chair.userId as string });
                }

                return { locked: null, dropped: dropped.map((chair) => chair.userId as string) };
            }

            const opened = await tx.getRepository(Escrow).insert({
                tableId,
                game: table.game,
                amount: stake.amount,
                feeBps: [...fees][0],
                state: 'locking'
            });
            const escrowId = opened.identifiers[0].id as string;

            await tx.getRepository(EscrowSeat).insert(chairs.map((chair) =>
            {
                const consent = byUser.get(chair.userId as string) as ConsentRow;

                return {
                    escrowId,
                    seat: chair.seat,
                    userId: consent.user_id,
                    address: consent.address,
                    nonce: consent.nonce,
                    commitment: consent.commitment,
                    secret: consent.secret,
                    deadline: consent.deadline,
                    signature: consent.signature as string
                };
            }));

            await tx.getRepository(StakeConsent).delete({ tableId });

            return { locked: escrowId, dropped: [] as string[] };
        });

        if (done.locked !== null)
        {
            kick();
        }

        return done;
    };

    const fail = async (row: EscrowRow, refusal: Refusal) =>
    {
        const seats = await seatsOf(row.id);
        const named = refusal.player === null ? undefined : seats.find((seat) => seat.address === refusal.player?.toLowerCase());

        await db.transaction(async (tx) =>
        {
            await lockTable(tx, row.table_id);

            const ended = await tx.getRepository(Escrow).update(
                { id: row.id, state: 'locking' },
                { state: 'failed', error: refusal.error.slice(0, 64), failedSeat: named?.seat ?? null, updatedAt: () => 'now()' }
            );

            if ((ended.affected ?? 0) === 0)
            {
                return;
            }

            for (const seat of named === undefined ? seats : [named])
            {
                await tx.getRepository(TableSeat).update({ tableId: row.table_id, userId: seat.userId }, { ready: false });
            }

            if (named === undefined)
            {
                return;
            }

            const kept = seats.filter((seat) => seat.seat !== named.seat);

            if (kept.length === 0)
            {
                return;
            }

            await tx.getRepository(EscrowSeat).delete(kept.map((seat) => ({ escrowId: row.id, seat: seat.seat })));
            await tx.getRepository(StakeConsent).insert(kept.map((seat) => ({
                nonce: seat.nonce,
                userId: seat.userId,
                tableId: row.table_id,
                game: row.game,
                amount: row.amount,
                feeBps: row.fee_bps,
                address: seat.address,
                commitment: seat.commitment,
                secret: seat.secret,
                deadline: seat.deadline,
                signature: seat.signature
            })));
        });

        await hooks.changed(row.table_id, []);

        return 'failed' as const;
    };

    const begin = async (row: EscrowRow) =>
    {
        const matchId = await hooks.begin(row.id);

        if (matchId !== null)
        {
            await hooks.began(matchId);
        }

        await hooks.changed(row.table_id, await playersOf(row.id));

        return matchId === null ? 'closed' as const : 'begun' as const;
    };

    const finish = async (row: EscrowRow, state: 'settled' | 'refunded' | 'reclaimed') =>
    {
        await db.getRepository(Escrow).update(
            { id: row.id, state: row.state },
            { state, error: null, ...(state === 'settled' ? {} : { winners: null }), updatedAt: () => 'now()' }
        );
        await hooks.changed(row.table_id, await playersOf(row.id));

        return 'closed' as const;
    };

    const mark = async (row: EscrowRow, error: string, sent: Partial<{ openTx: string | null; closeTx: string | null }> = {}) =>
    {
        await db.getRepository(Escrow).update({ id: row.id, state: row.state }, { error: error.slice(0, 64), ...sent, updatedAt: () => 'now()' });
    };

    const locking = async (row: EscrowRow) =>
    {
        const id = vaultIdOf(row.id);

        if (row.open_tx === null)
        {
            const there = await vault.game(id);

            if (there.status === 'open')
            {
                return await begin(row);
            }

            if (row.expired)
            {
                return await fail(row, { error: 'StakeExpired', player: null });
            }

            const seats = await seatsOf(row.id);
            const sent = await vault.open(id, row.game, BigInt(row.amount), row.fee_bps, seats.map((seat) => ({
                player: getAddress(seat.address),
                commit: seat.commitment as Hex,
                nonce: seat.nonce as Hex,
                deadline: BigInt(Math.floor(seat.deadline.getTime() / 1000)),
                signature: seat.signature as Hex
            })));

            if (!sent.ok)
            {
                return await fail(row, sent.refusal);
            }

            await db.getRepository(Escrow).update({ id: row.id, state: 'locking', openTx: IsNull() }, { openTx: sent.hash, updatedAt: () => 'now()' });

            return 'sent' as const;
        }

        const mined = await vault.mined(row.open_tx as Hex);

        if (mined === 'success')
        {
            return await begin(row);
        }

        if (mined === 'pending' && !row.expired)
        {
            return 'waiting' as const;
        }

        const there = await vault.game(id);

        if (there.status === 'open')
        {
            return await begin(row);
        }

        return await fail(row, { error: mined === 'pending' ? 'StakeExpired' : 'reverted', player: null });
    };

    const paying = async (row: EscrowRow) =>
    {
        const id = vaultIdOf(row.id);

        if (row.close_tx !== null)
        {
            const mined = await vault.mined(row.close_tx as Hex);

            if (mined === 'pending')
            {
                return 'waiting' as const;
            }

            if (mined === 'success')
            {
                return await finish(row, row.state === 'settling' ? 'settled' : 'refunded');
            }

            await mark(row, 'reverted', { closeTx: null });

            return 'waiting' as const;
        }

        if (row.resting)
        {
            return 'waiting' as const;
        }

        const there = await vault.game(id);

        if (there.status === 'settled' || there.status === 'refunded' || there.status === 'reclaimed')
        {
            return await finish(row, there.status);
        }

        if (there.status !== 'open')
        {
            await mark(row, 'missing');
            return 'waiting' as const;
        }

        const sent = row.state === 'settling'
            ? await vault.settle(id, BigInt(row.winners ?? 0), (await seatsOf(row.id)).map((seat) => seat.secret as Hex))
            : await vault.refund(id);

        if (!sent.ok)
        {
            await mark(row, sent.refusal.error);
            return 'waiting' as const;
        }

        await db.getRepository(Escrow).update({ id: row.id, state: row.state, closeTx: IsNull() }, { closeTx: sent.hash, error: null, updatedAt: () => 'now()' });

        return 'sent' as const;
    };

    const sweepOnce = async (budgetMs: number) =>
    {
        const began = performance.now();
        const tally: StakeSweep = { begun: 0, sent: 0, closed: 0, failed: 0, faults: [] };

        const rows = await db.getRepository(Escrow).createQueryBuilder('e')
            .select('e.id', 'id')
            .addSelect('e.table_id', 'table_id')
            .addSelect('e.game', 'game')
            .addSelect('e.amount::text', 'amount')
            .addSelect('e.fee_bps', 'fee_bps')
            .addSelect('e.state', 'state')
            .addSelect('e.winners', 'winners')
            .addSelect('e.open_tx', 'open_tx')
            .addSelect('e.close_tx', 'close_tx')
            .addSelect(`coalesce((select min(s.deadline) + interval '1 minute' < now() from escrow_seats s where s.escrow_id = e.id), false)`, 'expired')
            .addSelect('(e.error is not null and e.updated_at > now() - make_interval(secs => :retry))', 'resting')
            .where(`e.state in ('locking', 'settling', 'refunding')`)
            .setParameter('retry', RETRY_AFTER_S)
            .orderBy('e.updated_at', 'ASC')
            .limit(SWEEP_MAX)
            .getRawMany<EscrowRow>();

        for (const row of rows)
        {
            if (performance.now() - began > budgetMs)
            {
                break;
            }

            try
            {
                const step = row.state === 'locking' ? await locking(row) : await paying(row);

                if (step === 'begun')
                {
                    tally.begun += 1;
                }
                else if (step === 'sent')
                {
                    tally.sent += 1;
                }
                else if (step === 'closed')
                {
                    tally.closed += 1;
                }
                else if (step === 'failed')
                {
                    tally.failed += 1;
                }
            }
            catch (error)
            {
                tally.faults.push({ escrow: row.id, error: error instanceof Error ? error.message : String(error) });
            }
        }

        const idle = await db.getRepository(Table).createQueryBuilder('t')
            .innerJoin(TableStake, 'k', 'k.table_id = t.id')
            .select('t.id', 'id')
            .where(`t.status <> 'closed'`)
            .andWhere('not exists (select 1 from matches m where m.table_id = t.id and m.finished_at is null)')
            .andWhere(`not exists (select 1 from escrows e where e.table_id = t.id and ${ LIVE })`)
            .andWhere('(select count(*) from table_seats s where s.table_id = t.id and s.user_id is not null and s.ready) = t.seats')
            .limit(SWEEP_MAX)
            .getRawMany<{ id: string }>();

        for (const { id } of idle)
        {
            try
            {
                const done = await lockIfReady(id);

                if (done.dropped.length > 0)
                {
                    await hooks.changed(id, []);
                }
            }
            catch (error)
            {
                tally.faults.push({ escrow: id, error: error instanceof Error ? error.message : String(error) });
            }
        }

        return tally;
    };

    const sweep = (budgetMs: number): Promise<StakeSweep> =>
    {
        if (!vault.configured)
        {
            return Promise.resolve({ begun: 0, sent: 0, closed: 0, failed: 0, faults: [] });
        }

        if (running !== null)
        {
            again = true;
            return running;
        }

        running = (async () =>
        {
            try
            {
                let tally = await sweepOnce(budgetMs);

                while (again)
                {
                    again = false;
                    tally = await sweepOnce(budgetMs);
                }

                return tally;
            }
            finally
            {
                running = null;
            }
        })();

        return running;
    };

    const kick = () =>
    {
        if (!vault.configured)
        {
            return;
        }

        void sweep(4000).catch((error: unknown) =>
        {
            process.stderr.write(`stake sweep failed: ${ error instanceof Error ? error.message : String(error) }\n`);
        });
    };

    return {
        configured: vault.configured,

        standingOf,

        playerOf,

        lockIfReady,

        sweep,

        kick,

        async state(me: string): Promise<VaultState>
        {
            if (vault.address === null)
            {
                return { configured: false };
            }

            const standing = await standingOf(me);
            const owner = standing.address === null ? null : getAddress(standing.address);
            const [terms, held] = await Promise.all([
                vault.terms(),
                owner === null ? null : vault.balances(owner).then((money) => ({
                    address: owner,
                    free: money.free.toString(),
                    locked: money.locked.toString(),
                    wallet: money.wallet.toString()
                }))
            ]);

            return {
                configured: true,
                vault: vault.address,
                chainId: vault.chainId,
                fee: terms.fee,
                maxStake: terms.maxStake.toString(),
                reclaimAfter: Number(terms.reclaimAfter),
                paused: terms.paused,
                ladder: STAKE_LADDER.filter((amount) => BigInt(amount) <= terms.maxStake),
                may: eligibilityOf(standing),
                ...(standing.breakUntil === null ? {} : { breakUntil: standing.breakUntil.toISOString() }),
                ...(held === null ? {} : { balances: held })
            };
        },

        async accept(me: string)
        {
            if (!vault.configured)
            {
                throw notOpen();
            }

            const may = eligibilityOf(await standingOf(me));

            if (may === 'paid-wallet' || may === 'paid-minor')
            {
                throw REFUSED[may]();
            }

            await db.getRepository(PaidAccount).createQueryBuilder()
                .insert()
                .into(PaidAccount)
                .values({ userId: me, acceptedAt: () => 'now()' })
                .orIgnore()
                .execute();

            return this.state(me);
        },

        async rest(me: string, days: BreakDays)
        {
            if (!vault.configured)
            {
                throw notOpen();
            }

            const may = eligibilityOf(await standingOf(me));

            if (may === 'paid-wallet' || may === 'paid-minor' || may === 'paid-terms')
            {
                throw REFUSED[may]();
            }

            await db.getRepository(PaidAccount).createQueryBuilder()
                .update(PaidAccount)
                .set({ breakUntil: () => 'greatest(coalesce(break_until, now()), now() + make_interval(days => :days))' })
                .where('user_id = :me', { me })
                .setParameter('days', days)
                .execute();

            return this.state(me);
        },

        async deposit(me: string, amount: string)
        {
            const wei = amountOf(amount);
            const owner = await playerOf(me);

            if ((await vault.terms()).paused)
            {
                throw halted();
            }

            return wireCall(owner, await vault.depositCall(wei));
        },

        async withdraw(me: string, amount: string)
        {
            const wei = amountOf(amount);
            const { address } = await standingOf(me);

            if (address === null)
            {
                throw REFUSED['paid-wallet']();
            }

            return wireCall(getAddress(address), await vault.withdrawCall(wei));
        },

        async games(me: string, cursor: string | null)
        {
            if (!vault.configured)
            {
                throw notOpen();
            }

            const after = gamesAfter(cursor);
            const query = db.getRepository(Escrow).createQueryBuilder('e')
                .innerJoin(EscrowSeat, 'mine', 'mine.escrow_id = e.id and mine.user_id = :me', { me })
                .select('e.id', 'id')
                .addSelect('e.game', 'game')
                .addSelect('e.amount::text', 'amount')
                .addSelect('e.fee_bps', 'fee_bps')
                .addSelect('e.state', 'state')
                .addSelect('e.winners', 'winners')
                .addSelect('e.open_tx', 'open_tx')
                .addSelect('e.close_tx', 'close_tx')
                .addSelect('e.created_at', 'created_at')
                .addSelect('mine.seat', 'seat')
                .addSelect('(select count(*)::int from escrow_seats s where s.escrow_id = e.id)', 'seats')
                .where(`e.state <> 'failed'`);

            if (after !== null)
            {
                query.andWhere('(e.created_at, e.id) < (:at, :id)', { at: after.at, id: after.id });
            }

            const rows = await query
                .orderBy('e.created_at', 'DESC')
                .addOrderBy('e.id', 'DESC')
                .limit(GAMES_PAGE + 1)
                .getRawMany<PlayedRow>();
            const page = rows.slice(0, GAMES_PAGE);
            const last = page.at(-1);

            return {
                games: page.map((row) =>
                {
                    const won = row.winners !== null && seatsOfMask(row.winners).includes(row.seat);

                    return {
                        id: row.id,
                        game: row.game,
                        amount: row.amount,
                        feeBps: row.fee_bps,
                        seats: row.seats,
                        seat: row.seat,
                        state: row.state,
                        ...(row.winners === null ? {} : { won }),
                        ...(won && row.state === 'settled'
                            ? { share: shareOf(potOf(BigInt(row.amount), row.seats), row.fee_bps, seatsOfMask(row.winners as number).length).toString() }
                            : {}),
                        ...(row.open_tx === null ? {} : { openTx: row.open_tx }),
                        ...(row.close_tx === null ? {} : { closeTx: row.close_tx }),
                        at: row.created_at.toISOString()
                    };
                }),
                ...(rows.length > GAMES_PAGE && last !== undefined ? { cursor: `${ last.created_at.toISOString() }|${ last.id }` } : {})
            };
        },

        async reclaim(me: string, escrowId: string)
        {
            if (!vault.configured)
            {
                throw notOpen();
            }

            const mine = UUID.test(escrowId)
                ? await db.getRepository(EscrowSeat).findOne({ select: { address: true }, where: { escrowId, userId: me } })
                : null;

            if (mine === null)
            {
                throw new NotFoundError('No game there.');
            }

            const id = vaultIdOf(escrowId);
            const [there, terms] = await Promise.all([vault.game(id), vault.terms()]);

            if (there.status !== 'open')
            {
                throw tableRefusal('paid-done', 'The stakes of that game are not locked any more.');
            }

            if (Number(there.openedAt + terms.reclaimAfter) * 1000 > Date.now())
            {
                throw tableRefusal('paid-early', 'The stakes of that game can be taken back once the vault\'s wait has passed.');
            }

            return wireCall(getAddress(mine.address), await vault.reclaimCall(id));
        },

        async mayOpen(me: string, stake: string | undefined, mode: string)
        {
            if (stake === undefined)
            {
                return null;
            }

            if (!vault.configured)
            {
                throw notOpen();
            }

            if (mode !== 'live')
            {
                throw tableRefusal('paid-pace', 'Only a live table can be played for NURA.');
            }

            await playerOf(me);

            const terms = await vault.terms();

            if (terms.paused)
            {
                throw halted();
            }

            if (!onLadder(stake, terms.maxStake))
            {
                throw notStake();
            }

            return stake;
        },

        async prepare(me: string, tableId: string)
        {
            const player = await playerOf(me);

            if (!UUID.test(tableId))
            {
                throw new NotFoundError('No table there.');
            }

            const table = await db.getRepository(Table).createQueryBuilder('t')
                .innerJoin(TableSeat, 's', 's.table_id = t.id and s.user_id = :me', { me })
                .innerJoin(TableStake, 'k', 'k.table_id = t.id')
                .select('t.game', 'game')
                .addSelect('t.status', 'status')
                .addSelect('k.amount::text', 'amount')
                .where('t.id = :tableId', { tableId })
                .getRawOne<{ game: string; status: string; amount: string }>();

            if (table === undefined)
            {
                throw new NotFoundError('No table there.');
            }

            if (table.status === 'closed')
            {
                throw tableRefusal('table-closed', 'That table has closed.');
            }

            const terms = await vault.terms();

            if (terms.paused)
            {
                throw halted();
            }

            if (BigInt(table.amount) > terms.maxStake)
            {
                throw notStake();
            }

            const made = composed(player, table.game, table.amount, terms.fee);

            await db.transaction(async (tx) =>
            {
                await lockTable(tx, tableId);

                if (await lockingAt(tx, tableId))
                {
                    throw stillLocking();
                }

                if (await tx.getRepository(Match).existsBy({ tableId, finishedAt: IsNull() }))
                {
                    throw tableRefusal('playing', 'A game is being played at that table.');
                }

                await tx.getRepository(StakeConsent).delete({ tableId, userId: me });
                await tx.getRepository(StakeConsent).insert(made.row(me, tableId));
                await tx.getRepository(TableSeat).update({ tableId, userId: me }, { ready: false });
            });

            return made.terms;
        },

        async prepareSearch(me: string, game: string, amount: string)
        {
            const player = await playerOf(me);
            const terms = await vault.terms();

            if (terms.paused)
            {
                throw halted();
            }

            if (!onLadder(amount, terms.maxStake))
            {
                throw notStake();
            }

            const made = composed(player, game, amount, terms.fee);

            await db.transaction(async (tx) =>
            {
                await tx.getRepository(StakeConsent).delete({ userId: me, tableId: IsNull() });
                await tx.getRepository(StakeConsent).insert(made.row(me, null));
            });

            return made.terms;
        },

        async signedSearch(me: string, ask: { game: string; mode?: string; stake?: string; signature?: string })
        {
            if (ask.stake === undefined)
            {
                return null;
            }

            const player = await playerOf(me);

            if ((ask.mode ?? 'live') !== 'live')
            {
                throw tableRefusal('paid-pace', 'Only a live table can be played for NURA.');
            }

            if (!onLadder(ask.stake, (await vault.terms()).maxStake))
            {
                throw notStake();
            }

            const held = await consentQuery(db)
                .where('c.user_id = :me and c.table_id is null and c.game = :game and c.amount = cast(:amount as numeric)', { me, game: ask.game, amount: ask.stake })
                .getRawOne<ConsentRow>();
            const { nonce, signature } = await verified(player, held, ask.signature);

            await db.getRepository(StakeConsent).update({ nonce, tableId: IsNull() }, { signature });

            return nonce;
        },

        async attach(tx: EntityManager, nonce: string, tableId: string)
        {
            const bound = await tx.getRepository(StakeConsent).update({ nonce, tableId: IsNull() }, { tableId });

            if ((bound.affected ?? 0) === 0)
            {
                throw unsigned();
            }
        },

        async consent(me: string, tableId: string, signature: string | undefined)
        {
            const player = await playerOf(me);
            const held = await consentQuery(db)
                .where('c.table_id = :tableId and c.user_id = :me', { tableId, me })
                .getRawOne<ConsentRow>();
            const { nonce } = await verified(player, held, signature);

            await db.transaction(async (tx) =>
            {
                const signed = await tx.getRepository(StakeConsent).update({ nonce, userId: me, tableId }, { signature });

                if ((signed.affected ?? 0) === 0)
                {
                    throw unsigned();
                }

                await tx.getRepository(TableSeat).update({ tableId, userId: me }, { ready: true });
            });
        },

        async unready(me: string, tableId: string)
        {
            await db.transaction(async (tx) =>
            {
                await lockTable(tx, tableId);

                if (await lockingAt(tx, tableId))
                {
                    throw stillLocking();
                }

                await tx.getRepository(StakeConsent).delete({ tableId, userId: me });
                await tx.getRepository(TableSeat).update({ tableId, userId: me }, { ready: false });
            });
        }
    };
}
