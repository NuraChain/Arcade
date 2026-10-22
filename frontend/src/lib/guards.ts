import { redirect, type GuardContext, type GuardVerdict } from 'azerothjs';

import { may, type Ability } from '../../../backend/src/domains/admin/roles.ts';

export function safeNext(candidate: string | string[] | undefined)
{
    const value = Array.isArray(candidate) ? candidate[0] : candidate;
    return value !== undefined && value.startsWith('/app') && !value.startsWith('//') ? value : '/app';
}

async function settled(): Promise<{ signedIn: () => boolean }>
{
    const { useSession } = await import('../stores/session.store.ts');
    const session = useSession();
    await session.ready();
    return session;
}

export async function requireSession(context: GuardContext): Promise<GuardVerdict>
{
    if ((await settled()).signedIn())
    {
        return true;
    }
    return redirect({ pathname: '/sign-in', query: { next: context.pathname } });
}

export const requireAbility = (ability: Ability) => async (): Promise<GuardVerdict> =>
{
    const { useSession } = await import('../stores/session.store.ts');
    const session = useSession();
    await session.ready();
    return may(session.account()?.staff ?? null, ability);
};

export async function requireAnonymous(context: GuardContext): Promise<GuardVerdict>
{
    if (!(await settled()).signedIn())
    {
        return true;
    }
    return redirect(safeNext(context.query.next));
}
