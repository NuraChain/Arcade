import { leaveReach } from '../../lib/push.ts';
import { useSession } from '../../stores/session.store.ts';
import { useWallet } from '../../stores/wallet.store.ts';

const signInFor = (next: string | null) => (next === null ? '/sign-in' : `/sign-in?next=${ encodeURIComponent(next) }`);

const here = () => `${ window.location.pathname }${ window.location.search }`;

export async function signOut(next: string | null = null)
{
    useWallet().disconnect();
    await leaveReach();
    await useSession().signOut();
    window.location.replace(signInFor(next));
    return true;
}

export function watchSignedOut()
{
    let leaving = false;

    const ended = async () =>
    {
        if (leaving)
        {
            return;
        }

        leaving = true;
        useWallet().disconnect();
        await leaveReach();
        window.location.replace(signInFor(here()));
    };

    const left = (address: string) =>
    {
        const mine = useSession().account()?.address;

        if (leaving || mine === undefined || mine.toLowerCase() !== address.toLowerCase())
        {
            return;
        }

        leaving = true;
        void signOut(here());
    };

    const stops = [useSession().onEnded(() => void ended()), useWallet().onLeft(left)];

    return () =>
    {
        for (const stop of stops)
        {
            stop();
        }
    };
}
