import { redirect, type GuardContext, type GuardVerdict } from 'azerothjs';

import { useSession } from '../stores/session.store.ts';

export function safeNext(candidate: string | string[] | undefined): string
{
    const value = Array.isArray(candidate) ? candidate[0] : candidate;
    return value !== undefined && value.startsWith('/app') && !value.startsWith('//') ? value : '/app';
}

export function requireSession(context: GuardContext): GuardVerdict
{
    if (useSession().signedIn())
    {
        return true;
    }
    return redirect({ pathname: '/sign-in', query: { next: context.pathname } });
}

export function requireAnonymous(context: GuardContext): GuardVerdict
{
    if (!useSession().signedIn())
    {
        return true;
    }
    return redirect(safeNext(context.query.next));
}
