import { redirect, type GuardContext, type GuardVerdict } from 'azerothjs';

import { may, type Ability } from '../../../backend/src/domains/admin/roles.ts';
import { sectionsFor } from './admin-sections.ts';

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

async function staffRole()
{
    const { useSession } = await import('../stores/session.store.ts');
    const session = useSession();
    await session.ready();
    return session.account()?.staff ?? null;
}

export const requireAbility = (ability: Ability) => async (): Promise<GuardVerdict> => may(await staffRole(), ability);

export async function requireStaff(): Promise<GuardVerdict>
{
    return sectionsFor(await staffRole()).length > 0;
}

export async function firstSection(): Promise<GuardVerdict>
{
    const [first] = sectionsFor(await staffRole());
    return first === undefined ? false : redirect(`/admin/${ first }`);
}

export async function requireAnonymous(context: GuardContext): Promise<GuardVerdict>
{
    if (!(await settled()).signedIn())
    {
        return true;
    }
    return redirect(safeNext(context.query.next));
}
