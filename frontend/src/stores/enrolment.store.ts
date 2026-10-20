import { createStore } from 'azerothjs';

import { useDevice } from './device.store.ts';
import { useDevices } from './devices.store.ts';
import { useLocale } from './locale.store.ts';
import { useSeal } from './seal.store.ts';
import { useToasts } from './toasts.store.ts';
import { useWallet } from './wallet.store.ts';

export interface EnrolmentApi
{
    give(): Promise<void>;
}

/**
 * Adding this browser to the account with the wallet, for a session that has no keys here.
 *
 * Connecting the wallet adds the browser in the same signature, so this is only reached by a
 * session that began somewhere else: a cookie this browser kept while its keys were cleared. It
 * is offered where that is in the way, above a composer.
 *
 * `give` NEVER rejects. `devices.enrol` swallows everything into `failure()`, so a caller that
 * awaited and carried on would make a refused wallet signature silent. Every outcome is read
 * back and spoken here, once, so no caller has to remember to.
 */
export const useEnrolment = createStore((): EnrolmentApi =>
{
    const device = useDevice();
    const devices = useDevices();
    const locale = useLocale();
    const seal = useSeal();
    const toasts = useToasts();
    const wallet = useWallet();

    return {
        async give()
        {
            if (devices.busy())
            {
                return;
            }

            if (wallet.address() === null && await wallet.reach() === null)
            {
                toasts.show({ kind: 'warning', text: locale.t('wallet.error.noWallet'), dedupe: 'devices.enrol' });
                return;
            }

            const added = async () =>
            {
                await devices.enrol(locale.t(device.posture() === 'phone' ? 'devices.namePhone' : 'devices.nameDesktop'));

                const failure = devices.failure();

                if (failure !== null)
                {
                    throw failure;
                }

                await seal.refresh();
            };

            await toasts.promise(added(), {
                pending: locale.t('devices.adding'),
                done: () => locale.t('devices.enrolled'),
                failed: (failure) => locale.t(failure === 'refused' ? 'devices.refused' : 'devices.unavailable')
            }).catch(() => undefined);
        }
    };
});
