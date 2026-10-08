import { createStore, createSignal, type Getter } from 'azerothjs';

import { useDevice } from './device.store.ts';
import { useDevices } from './devices.store.ts';
import { useLocale } from './locale.store.ts';
import { useSeal } from './seal.store.ts';
import { useToasts } from './toasts.store.ts';
import { useWallet } from './wallet.store.ts';

/**
 * What this browser is missing, when it is something a person can act on.
 *
 * `absent` is no keys at all: nothing sealed can be read or sent here.
 */
export type KeyGap = 'absent';

export interface EnrolmentApi
{
    gap: Getter<KeyGap | null>;
    asking: Getter<boolean>;
    dismiss(): void;
    give(): Promise<void>;
    reset(): void;
}

/**
 * Giving this browser device keys, from wherever somebody notices it has none.
 *
 * The routine below lived in `chat.page` and was the right thing in the wrong place. It is a
 * sequence of DECISIONS - a locked wallet says something different from a refused signature - and
 * the moment a second surface offers the same button, a second copy of those decisions is a second chance to
 * say the wrong one. The seal notice offers it at the composer, where somebody is stuck; the
 * banner offers it anywhere, because a person who has not opened a chat yet has no way to learn
 * that this browser cannot read one.
 *
 * `give` NEVER rejects. `devices.enrol` swallows everything into `failure()`, so a caller that
 * awaited and carried on would make a refused wallet signature silent - the button spins, stops,
 * and nothing changes or is said. Every outcome is read back and spoken here, once, so no caller
 * has to remember to.
 */
export const useEnrolment = createStore((): EnrolmentApi =>
{
    const device = useDevice();
    const devices = useDevices();
    const locale = useLocale();
    const seal = useSeal();
    const toasts = useToasts();
    const wallet = useWallet();

    const [dismissed, setDismissed] = createSignal(false);

    /**
     * Held for this browsing session and not written down.
     *
     * A key gap is not a preference: it is the state in which nothing sealed can be read or sent,
     * and a flag in `localStorage` would silence it on a browser that still cannot send - for
     * good, on the one machine where the answer matters. Dismissing clears the strip now and the
     * next load asks again, which is the smallest promise that is still true.
     */
    const gap = (): KeyGap | null =>
    {
        if (!devices.known())
        {
            return null;
        }

        const readiness = devices.readiness();

        // `unsupported` is deliberately absent. There is nothing behind the button on a browser
        // with no secure storage - a private window, or an insecure origin - and a strip that
        // cannot be acted on is furniture that never goes away.
        return readiness === 'absent' ? readiness : null;
    };

    return {
        gap,

        asking: () => gap() !== null && !dismissed(),

        dismiss()
        {
            setDismissed(true);
        },

        async give()
        {
            if (devices.busy())
            {
                return;
            }

            // A locked extension has no address to sign with, and `sign` answers null rather than
            // throwing - which `publish` turns into "the wallet did not sign", blaming a refusal
            // that never happened. Say the true thing instead.
            if (wallet.address() === null && await wallet.reach() === null)
            {
                toasts.show({ kind: 'warning', text: locale.t('wallet.error.noWallet'), dedupe: 'devices.enrol' });
                return;
            }

            await devices.enrol(locale.t(device.posture() === 'phone' ? 'devices.namePhone' : 'devices.nameDesktop'));

            const failure = devices.failure();
            if (failure !== null)
            {
                toasts.show({
                    kind: 'error',
                    text: locale.t(failure === 'refused' ? 'devices.refused' : 'devices.unavailable'),
                    dedupe: 'devices.enrol'
                });
                return;
            }

            // Any open room has to be asked again: whether it can be sealed to now depends on a
            // device that did not exist a moment ago.
            await seal.refresh();

            toasts.show({ kind: 'success', text: locale.t('devices.enrolled'), dedupe: 'devices.enrol' });
        },

        reset()
        {
            setDismissed(false);
        }
    };
});
