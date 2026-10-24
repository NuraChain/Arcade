import type { DataSource } from 'typeorm';

import { Referral, User } from '../../entities/index.ts';

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
        }
    };
}
