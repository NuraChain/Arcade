import { leaveReach } from '../../lib/push.ts';
import { useSession } from '../../stores/session.store.ts';
import { useWallet } from '../../stores/wallet.store.ts';

export async function signOut()
{
    useWallet().disconnect();
    await leaveReach();
    await useSession().signOut();
    window.location.replace('/sign-in');
    return true;
}
