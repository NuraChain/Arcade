import { createResource, createSignal, createStore, type Getter } from 'azerothjs';

import { client, type RecoveryState } from '../api.ts';
import { forgetArchiveKey, heldEpochKeys, recallArchiveKey, rememberArchiveKey, rememberEpochKey } from '../lib/epoch-keys.ts';
import { forget } from '../lib/crypto.ts';
import {
    checkValueOf,
    deriveRecovery,
    groupPhrase,
    mintArchiveKey,
    mintPhrase,
    mintSalt,
    normalisePhrase,
    openArchiveKey,
    openFromArchive,
    sealArchiveKey,
    sealForArchive,
    signRecovery
} from '../lib/recovery.ts';
import { useSession } from './session.store.ts';

/**
 * The recovery phrase: making one, rolling it, turning it off, and using one.
 *
 * The phrase is shown EXACTLY ONCE, by this store, and is never written anywhere it could be read
 * back. That is not squeamishness - a phrase a browser can re-display is a phrase sitting in
 * storage, and the entire premise is that it exists only where the person put it.
 *
 * Every operation here is slow by design: PBKDF2 runs 600,000 iterations, which is a noticeable
 * fraction of a second and a real one on a phone. `busy` is what the page renders while it happens,
 * because a button that appears to do nothing for half a second is a button people press twice.
 */

export type RecoverOutcome = 'ok' | 'bad-phrase' | 'no-vault' | 'failed';

export interface RecoveryApi
{
    state: Getter<RecoveryState | null>;
    loading: Getter<boolean>;

    /** A derivation is running. Long enough to matter, on every device. */
    busy: Getter<boolean>;

    /**
     * The phrase just made, for as long as it is on the screen.
     *
     * Null before and after. Nothing puts it in storage, so navigating away loses it - which is
     * why the page that shows it asks for confirmation before letting that happen.
     */
    freshPhrase: Getter<string | null>;

    /** How many epoch keys the last restore brought back. */
    restored: Getter<number>;

    dismissPhrase(): void;
    setUp(): Promise<boolean>;
    turnOff(): Promise<void>;
    recover(deviceId: string, typed: string): Promise<RecoverOutcome>;
    refresh(): Promise<void>;
}

export const useRecovery = createStore((): RecoveryApi =>
{
    const session = useSession();

    const [busy, setBusy] = createSignal(false);
    const [freshPhrase, setFreshPhrase] = createSignal<string | null>(null);
    const [restored, setRestored] = createSignal(0);

    const answer = createResource<RecoveryState, boolean>(
        () => (session.account() === null ? null : true),
        async (): Promise<RecoveryState> => client.devices.recovery(),
        { name: 'devices.recovery' }
    );

    return {
        state: () => answer.data() ?? null,
        loading: () => answer.loading(),
        busy,
        freshPhrase,
        restored,

        dismissPhrase()
        {
            setFreshPhrase(null);
        },

        async refresh()
        {
            await answer.refetch();
        },

        /**
         * Makes a phrase, or replaces the one this account has.
         *
         * Replacing keeps the ARCHIVE key and re-seals it, so everything already backed up stays
         * readable and only the outer wrapping changes. Minting a fresh archive key instead would
         * silently orphan every epoch key already in the archive - the rows would still be there
         * and nothing would ever open them again.
         */
        async setUp(): Promise<boolean>
        {
            setBusy(true);

            try
            {
                // Canonical, because that is what `normalisePhrase` will produce when it is typed
                // back in. Grouping happens on the way to the screen and nowhere else.
                const phrase = mintPhrase();
                const salt = mintSalt();

                const keys = await deriveRecovery(phrase, salt);
                const archiveKey = await recallArchiveKey() ?? mintArchiveKey();

                await client.devices.setRecovery({
                    input: {
                        salt,
                        publicKey: keys.signer.publicKey,
                        wrapped: await sealArchiveKey(keys, archiveKey),
                        checkValue: await checkValueOf(keys)
                    }
                });

                await rememberArchiveKey(archiveKey);

                // Everything this browser already holds goes in now. A key learned after this point
                // is archived as it is learned, so this sweep happens exactly once.
                for (const held of await heldEpochKeys())
                {
                    await client.devices.archive({
                        input: {
                            conversationId: held.conversationId,
                            epoch: held.epoch,
                            wrapped: await sealForArchive(archiveKey, held.key)
                        }
                    }).catch(() => undefined);

                    forget(held.key);
                }

                forget(archiveKey);

                setFreshPhrase(groupPhrase(phrase));
                await answer.refetch();
                return true;
            }
            catch
            {
                return false;
            }
            finally
            {
                setBusy(false);
            }
        },

        /**
         * Turns recovery off, here and on the server.
         *
         * The server drops the vault and the archive together. This browser drops its working copy
         * of the archive key, because keeping one for an archive that no longer exists is holding a
         * key to a door somebody demolished.
         */
        async turnOff(): Promise<void>
        {
            setBusy(true);

            try
            {
                await client.devices.clearRecovery();
                await forgetArchiveKey();
                setFreshPhrase(null);
                await answer.refetch();
            }
            finally
            {
                setBusy(false);
            }
        },

        /**
         * Uses a phrase to confirm THIS browser and take back what it can read.
         *
         * The order matters. The signature confirms the device first, because a browser that cannot
         * be sealed to has no use for an archive; then the archive key comes back sealed under the
         * phrase, and every epoch key follows. A restore that stopped halfway leaves the device
         * confirmed with fewer keys than it could have, which is recoverable by trying again -
         * whereas keys with no confirmation would be a browser that can read the past and not the
         * present.
         */
        async recover(deviceId: string, typed: string): Promise<RecoverOutcome>
        {
            const phrase = normalisePhrase(typed);

            if (phrase === null)
            {
                return 'bad-phrase';
            }

            const accountId = session.account()?.id;

            if (accountId === undefined)
            {
                return 'failed';
            }

            setBusy(true);

            try
            {
                const challenge = await client.devices.recoveryChallenge({ input: { deviceId } })
                    .catch(() => null);

                if (challenge === null)
                {
                    return 'no-vault';
                }

                const keys = await deriveRecovery(phrase, challenge.salt);

                const confirmed = await client.devices.recoverDevice({
                    input: {
                        deviceId,
                        nonce: challenge.nonce,
                        signature: await signRecovery(keys, accountId, deviceId, challenge.nonce)
                    }
                }).catch(() => null);

                if (confirmed === null)
                {
                    return 'bad-phrase';
                }

                const archiveKey = await openArchiveKey(keys, confirmed.wrapped);

                if (archiveKey === null)
                {
                    // The server accepted the signature, so the phrase is right and this is the
                    // archive being wrong rather than the person. Saying `failed` keeps those two
                    // apart, which is the whole reason the vault carries a check value.
                    return 'failed';
                }

                await rememberArchiveKey(archiveKey);

                const { entries } = await client.devices.archived();
                let back = 0;

                for (const entry of entries)
                {
                    const key = await openFromArchive(archiveKey, entry.wrapped);

                    if (key === null)
                    {
                        continue;
                    }

                    await rememberEpochKey(entry.conversationId, entry.epoch, key);
                    forget(key);
                    back += 1;
                }

                forget(archiveKey);
                setRestored(back);
                await answer.refetch();
                return 'ok';
            }
            catch
            {
                return 'failed';
            }
            finally
            {
                setBusy(false);
            }
        }
    };
});
