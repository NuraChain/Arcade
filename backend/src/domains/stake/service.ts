import type { HttpError } from '@azerothjs/http';
import type { DataSource } from 'typeorm';
import { getAddress, toHex, type Address } from 'viem';

import type { Vault, VaultCall } from '../../chain/vault.ts';
import { PaidAccount } from '../../entities/paid-account.entity.ts';
import { User } from '../../entities/user.entity.ts';
import type { VaultState } from '../../schemas.ts';
import { tableRefusal } from '../table/service.ts';
import { eligibilityOf, STAKE_LADDER, weiOf, type BreakDays, type Eligibility } from './policy.ts';

interface StandingRow
{
    minor: boolean;
    address: string | null;
    accepted: boolean;
    resting: boolean;
    break_until: Date | null;
}

const REFUSED = {
    'paid-wallet': () => tableRefusal('paid-wallet', 'Playing for NURA needs a wallet account.'),
    'paid-minor': () => tableRefusal('paid-minor', 'Playing for NURA is for adults only.'),
    'paid-terms': () => tableRefusal('paid-terms', 'Confirm the terms of playing for NURA first.'),
    'paid-break': () => tableRefusal('paid-break', 'You asked for a break from playing for NURA.')
} satisfies Record<Exclude<Eligibility, 'yes'>, () => HttpError>;

export const notOpen = () => tableRefusal('paid-off', 'Playing for NURA is not open here.');

const notAmount = () => tableRefusal('paid-amount', 'That is not an amount of NURA.');

const halted = () => tableRefusal('paid-paused', 'The vault is not taking deposits or new games right now.');

const wireCall = (from: Address, call: VaultCall) => ({
    from,
    to: call.to,
    data: call.data,
    value: toHex(call.value),
    chainId: call.chainId,
    ...(call.gasPrice === null ? {} : { gasPrice: toHex(call.gasPrice) })
});

export type StakeService = ReturnType<typeof createStakeService>;

export function createStakeService(db: DataSource, vault: Vault)
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

    return {
        configured: vault.configured,

        standingOf,

        playerOf,

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
        }
    };
}
