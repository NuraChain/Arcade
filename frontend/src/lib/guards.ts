import { redirect, type GuardContext, type GuardVerdict } from 'azerothjs';

export function safeNext(candidate: string | string[] | undefined): string
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

export async function requireAnonymous(context: GuardContext): Promise<GuardVerdict>
{
    if (!(await settled()).signedIn())
    {
        return true;
    }
    return redirect(safeNext(context.query.next));
}
