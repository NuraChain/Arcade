import type { DataSource } from 'typeorm';

import { Match, MatchPlayer, Referral, User } from '../../entities/index.ts';

export type InviteService = ReturnType<typeof createInviteService>;

export function createInviteService(db: DataSource)
{
    return {
        /**
         * Credits a new account to whoever's link it came through, once and for good.
         *
         * A name that is nobody, a suspended account or the new account itself is let go of
         * without a word: an invite is a courtesy, and a sign-in never fails for one.
         */
        async refer(inviteeId: string, ref: string | undefined)
        {
            const handle = (ref ?? '').trim().replace(/^@/, '');

            if (handle === '')
            {
                return;
            }

            const inviter = await db.getRepository(User).findOne({ select: { id: true }, where: { handle, isSuspended: false } });

            if (inviter === null || inviter.id === inviteeId)
            {
                return;
            }

            await db.getRepository(Referral).createQueryBuilder()
                .insert()
                .values({ inviteeId, inviterId: inviter.id })
                .orIgnore()
                .execute();
        },

        /** Counts the invites of whoever just finished a first game, and names who invited them. */
        async counted(inviteeIds: readonly string[])
        {
            if (inviteeIds.length === 0)
            {
                return [];
            }

            const rows = await db.getRepository(Referral).createQueryBuilder()
                .update()
                .set({ countedAt: () => 'now()' })
                .where('invitee_id in (:...inviteeIds)', { inviteeIds })
                .andWhere('counted_at is null')
                .andWhere('inviter_id is not null')
                .returning(['inviter_id', 'invitee_id'])
                .execute();

            return (rows.raw as { inviter_id: string; invitee_id: string }[]).map((row) => ({ inviterId: row.inviter_id, inviteeId: row.invitee_id }));
        },

        /** The invites a finished game made count: every seat that played it out, a void one not. */
        async countedBy(matchId: string)
        {
            const [match, played] = await Promise.all([
                db.getRepository(Match).findOneBy({ id: matchId }),
                db.getRepository(MatchPlayer).find({ select: { userId: true, result: true }, where: { matchId } })
            ]);
            const counted = match === null || match.finishedAt === null
                ? []
                : await this.counted(played.filter((one) => one.result !== null && one.result !== 'void').map((one) => one.userId));

            return { game: match?.game ?? '', counted };
        }
    };
}
