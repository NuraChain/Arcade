import { useAccount } from '../../stores/account.store.ts';
import { useLocale } from '../../stores/locale.store.ts';
import { useOverlay } from '../../stores/overlay.store.ts';
import { useSession } from '../../stores/session.store.ts';
import { useWallet } from '../../stores/wallet.store.ts';
import ConfirmSheet from './confirm-sheet.component.azeroth';

export async function signOut()
{
    if (!useAccount().isWallet())
    {
        const locale = useLocale();
        const yes = await useOverlay().open(
            ConfirmSheet,
            {
                title: locale.t('me.signOut.guestTitle'),
                lead: locale.t('me.signOut.guestLead'),
                confirm: locale.t('app.nav.signOut'),
                destructive: true
            },
            { label: locale.t('me.signOut.guestTitle') }
        ).closed;

        if (yes !== true)
        {
            return false;
        }
    }

    useWallet().disconnect();
    await useSession().signOut();
    window.location.replace('/sign-in');
    return true;
}
