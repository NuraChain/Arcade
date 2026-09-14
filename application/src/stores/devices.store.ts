import { createStore, createResource, createSignal, type Getter } from 'azerothjs';

import { ApiError, client, type Device } from '../api.ts';
import { deviceVerifies } from '../lib/device-id.ts';
import { keyStore, type DeviceKeys } from '../lib/device-keys.ts';
import { deviceState, readinessOf, type DeviceState, type Readiness } from '../lib/device-state.ts';
import { useAccount } from './account.store.ts';
import { useWallet } from './wallet.store.ts';

export type EnrolFailure = 'unsupported' | 'refused' | 'unavailable';

export interface DevicesApi
{
    devices: Getter<Device[]>;

    /** The id of the device this browser is signed in on, according to the server. */
    current: Getter<string | null>;

    loading: Getter<boolean>;
    failed: Getter<unknown>;
    busy: Getter<boolean>;
    failure: Getter<EnrolFailure | null>;

    readiness: Getter<Readiness>;

    /**
     * Whether `readiness()` is an ANSWER yet, rather than the shape of one.
     *
     * `readinessOf` is handed `current: local()?.id ?? null`, and `local()` is null until `refresh()`
     * has read the keyring - so before that, every browser reports `absent`, including one that holds
     * perfectly good keys. Anything that acts on `absent` without checking this first accuses a
     * browser of a state nobody has measured: a composer would render disabled on every cold load and
     * silently enable a moment later, and on a slow device list it would simply stay disabled.
     *
     * "Not there" and "not there YET" are different answers - the same distinction `chat.page` draws
     * about a missing conversation, and for the same reason: a page that confidently renders the
     * wrong one passes every gate this project has.
     *
     * An UNSUPPORTED browser is known immediately and with no request, because nothing about it
     * depends on the server.
     */
    known: Getter<boolean>;

    stateOf(device: Device): DeviceState;

    enrol(label: string): Promise<void>;
    confirm(id: string): Promise<void>;
    rename(id: string, label: string): Promise<void>;
    revoke(id: string): Promise<void>;

    refresh(): Promise<void>;
    reset(): void;
}

interface Listing
{
    devices: Device[];
    current: string | null;

    /** The ids whose published keys really do hash to them. Computed here, never sent. */
    verified: Set<string>;
}

/**
 * The devices on this account, and what this browser is among them.
 *
 * Two things here are not bookkeeping.
 *
 * **Every id is re-derived from the keys beside it** before anything is rendered. A device whose
 * id does not match its keys is `tampered` and is never drawn as a device - it is the one signal a
 * client has that the list it was handed is not the list the account owns, and it costs one hash
 * per row to keep.
 *
 * **A revoked device's keys are burned.** If this browser was signed out from another device and
 * comes back holding the old keys, enrolment is refused with a 409; the answer is to forget them
 * and mint new ones, which is done once and only for that refusal. The consequence is real and
 * the copy says it: the new keys cannot read what the old ones could.
 */
export const useDevices = createStore((): DevicesApi =>
{
    const account = useAccount();
    const wallet = useWallet();

    const [local, setLocal] = createSignal<DeviceKeys | null>(null);
    const [looked, setLooked] = createSignal(false);
    const [busy, setBusy] = createSignal(false);
    const [failure, setFailure] = createSignal<EnrolFailure | null>(null);

    const who = (): string | null => account.user()?.id ?? null;

    const listing = createResource<Listing, string>(who, async (): Promise<Listing> =>
    {
        const answer = await client.devices.list();
        const verified = new Set<string>();

        for (const device of answer.devices)
        {
            if (await deviceVerifies(device))
            {
                verified.add(device.id);
            }
        }

        return { devices: answer.devices, current: answer.current ?? null, verified };
    }, { name: 'devices.list' });

    const devices = (): Device[] => listing.data()?.devices ?? [];
    const current = (): string | null => listing.data()?.current ?? null;

    const refresh = async (): Promise<void> =>
    {
        // The keyring FIRST, because everything below is a statement about this browser rather than
        // about the account, and a stale answer to "do I hold keys" is the one that lies.
        setLocal(await keyStore().load());
        setLooked(true);
        await listing.refetch();
    };

    /**
     * Sends one enrolment.
     *
     * A wallet account signs for its devices and the server refuses it any other way, so the
     * challenge is fetched and the wallet asked before anything is written. The signed message
     * names this device in its `Resources` line - the signature cannot be carried to another one.
     */
    const publish = async (keys: DeviceKeys, label: string): Promise<void> =>
    {
        if (!account.isWallet())
        {
            await client.devices.enrol({ input: { ...keys, label } });
            return;
        }

        const challenge = await client.devices.challenge({ input: { id: keys.id } });
        const signature = await wallet.sign(challenge.message);

        if (signature === null)
        {
            throw new ApiError(401, 'refused', 'The wallet did not sign.', undefined);
        }

        await client.devices.enrol({ input: { ...keys, label, nonce: challenge.nonce, signature } });
    };

    const write = async (work: () => Promise<unknown>): Promise<void> =>
    {
        setBusy(true);
        try
        {
            await work();
            await refresh();
        }
        finally
        {
            setBusy(false);
        }
    };

    return {
        devices,
        current,

        loading: () => listing.loading(),
        failed: () => listing.error(),
        busy,
        failure,

        // The list has to have RESOLVED, not merely settled: a browser whose `devices.list` failed
        // has not been able to ask, and must not be told it holds nothing.
        known: () => !keyStore().available() || (looked() && listing.data() !== undefined),

        /**
         * What THIS BROWSER can do, answered by this browser's keyring and nothing else.
         *
         * It used to fall back to the server's `current` - the device the session is bound to - and
         * that reads as reasonable until the keyring is gone: a browser whose keys were cleared, or
         * evicted under storage pressure, would go on reporting `ready` because the SESSION still
         * named a device. The panel said "This browser is set up" while the chat silently refused
         * to send anything, which is the exact situation recovery exists for and the one place the
         * product must not be confidently wrong. A browser pass found it.
         *
         * The server's `current` is still what labels a row "This one" for a browser that does hold
         * keys; it is not evidence that this browser holds them.
         *
         * It is only an answer once `known()` is true. Before that every browser reports `absent`.
         */
        readiness: () => readinessOf({
            supported: keyStore().available(),
            current: local()?.id ?? null,
            devices: devices()
        }),

        stateOf: (device) => deviceState(device, {
            current: local()?.id ?? null,
            verified: listing.data()?.verified.has(device.id) ?? false
        }),

        async enrol(label)
        {
            const store = keyStore();
            if (!store.available())
            {
                setFailure('unsupported');
                return;
            }

            setFailure(null);
            setBusy(true);

            try
            {
                let keys = await store.load() ?? await store.mint();

                try
                {
                    await publish(keys, label);
                }
                catch (error)
                {
                    // 409 here means exactly one thing: these keys belong to a device that was
                    // revoked, or to somebody else's. Either way this browser needs new ones, and
                    // it gets them once rather than in a loop.
                    if (!(error instanceof ApiError) || error.status !== 409)
                    {
                        throw error;
                    }
                    keys = await store.mint();
                    await publish(keys, label);
                }

                setLocal(keys);
                await refresh();
            }
            catch (error)
            {
                setFailure(error instanceof ApiError && error.status === 401 ? 'refused' : 'unavailable');
            }
            finally
            {
                setBusy(false);
            }
        },

        confirm: (id) => write(() => client.devices.confirm({ params: { id } })),
        rename: (id, label) => write(() => client.devices.rename({ params: { id }, input: { label } })),
        revoke: (id) => write(() => client.devices.revoke({ params: { id } })),

        refresh,

        reset()
        {
            setLocal(null);
            setLooked(false);
            setBusy(false);
            setFailure(null);
            void listing.refetch();
        }
    };
});
