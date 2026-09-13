import type { Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

import type { ChatMessage, ConversationDevices } from '../src/api.ts';
import {
    commitmentOf,
    confirmationOf,
    forget,
    mintEpochKey,
    mintFrankingKey,
    sealText,
    signRecipients,
    wrapEpochKey
} from '../src/lib/crypto.ts';
import { THREAD_FIXTURES } from './fixtures.ts';
import { makeDevice, type TestDevice } from './keys.ts';

/**
 * The fixture conversations, actually sealed.
 *
 * Under `nura-e2ee/v1` a text message in a database is ciphertext and an envelope - the CHECK
 * constraints make anything else unrepresentable - so a fake server handing the browser plaintext
 * would be testing a wire format this product does not have. Every browser spec that reads a thread
 * would be exercising a path that cannot occur, and the one that matters would be exercised
 * nowhere.
 *
 * So this builds a real sealed corpus once, at module load: a device per fixture person with real
 * P-256 keys and a real wallet attestation, one epoch per thread wrapped to every member device,
 * and every line sealed by its own sender under its own per-sender key with the real AAD. The
 * browser then opens it with exactly the code the product ships.
 *
 * It is built ONCE and copied by `reset()`, because sealing is asynchronous and `reset()` is not -
 * and making every spec await its own fixtures would be a worse trade than a few milliseconds of
 * elliptic curve at import time.
 *
 * The private keys are the integers 1, 2, 3 and so on. They are valid secp256k1 keys, they are
 * deterministic so a failure reproduces, and they control nothing anywhere.
 */

export interface SealedEpoch
{
    epoch: number;
    mintedBy: string;
    recipients: string;
    signature: string;
    confirmation: string;
    keys: Record<string, { ephemeralKey: string; wrapped: string }>;
}

export interface SealedFixtures
{
    devices: Map<string, TestDevice>;
    members: Record<string, ConversationDevices>;
    epochs: Record<string, SealedEpoch[]>;
    messages: Record<string, ChatMessage[]>;
}

export const accountIdOf = (handle: string): string => `u-${ handle }`;

const keyFor = (index: number): Hex => `0x${ (index + 1).toString(16).padStart(64, '0') }` as Hex;

const at = (minutesAgo: number): string => new Date(1_700_000_000_000 - minutesAgo * 60_000).toISOString();

export async function buildSealedFixtures(): Promise<SealedFixtures>
{
    const handles = [...new Set(THREAD_FIXTURES.flatMap((thread) => thread.members))].sort();

    const devices = new Map<string, TestDevice>();

    for (const [index, handle] of handles.entries())
    {
        devices.set(handle, await makeDevice(privateKeyToAccount(keyFor(index))));
    }

    const members: Record<string, ConversationDevices> = {};
    const epochs: Record<string, SealedEpoch[]> = {};
    const messages: Record<string, ChatMessage[]> = {};

    let counter = 0;

    for (const thread of THREAD_FIXTURES)
    {
        const seats = thread.members
            .map((handle) => ({ handle, device: devices.get(handle) }))
            .filter((seat): seat is { handle: string; device: TestDevice } => seat.device !== undefined);

        members[thread.slug] = {
            members: seats.map((seat) => ({
                accountId: accountIdOf(seat.handle),
                handle: seat.handle,
                kind: 'wallet' as const,
                devices: [seat.device.peer]
            }))
        };

        const minter = seats[0];
        const recipients = seats.map((seat) => seat.device.id).sort();
        const key = mintEpochKey();

        // The confirmation is signed together with the recipients, because the signature has to pin
        // WHICH key this epoch is and not only who may read it.
        const confirmation = await confirmationOf(key, thread.slug, 1);

        epochs[thread.slug] = [{
            epoch: 1,
            mintedBy: minter.device.id,
            recipients: recipients.join(','),
            signature: await signRecipients(minter.device.secrets, thread.slug, 1, minter.device.id, recipients, confirmation),
            confirmation,
            keys: Object.fromEntries(await Promise.all(seats.map(async (seat) =>
            {
                const wrap = await wrapEpochKey(key, thread.slug, 1, seat.device);
                return [seat.device.id, { ephemeralKey: wrap.ephemeralKey, wrapped: wrap.wrapped }] as const;
            })))
        }];

        // One counter per sender device, because that is what `seq` is: a device's own count inside
        // an epoch, never a position in the conversation.
        const seqs = new Map<string, number>();
        const written: ChatMessage[] = [];

        for (const message of thread.messages)
        {
            counter += 1;

            const id = `m-${ counter }`;
            const when = at(message.minutesAgo);

            if (message.kind !== undefined)
            {
                written.push({
                    id,
                    conversationId: thread.slug,
                    kind: message.kind,
                    from: message.from,
                    at: when,
                    ...(message.payload === undefined ? {} : { payload: message.payload })
                });
                continue;
            }

            const sender = devices.get(message.from);

            if (sender === undefined)
            {
                continue;
            }

            const seq = (seqs.get(sender.id) ?? 0) + 1;
            seqs.set(sender.id, seq);

            const clientAt = Date.parse(when);

            const frankingKey = mintFrankingKey();
            const commitment = await commitmentOf(frankingKey, message.body ?? '');

            const sealed = await sealText(key, sender.secrets, {
                conversationId: thread.slug,
                epoch: 1,
                seq,
                messageId: id,
                senderAccountId: accountIdOf(message.from),
                senderDeviceId: sender.id,
                kind: 'text',
                clientAt,
                commitment,
                expiresAt: 0
            }, message.body ?? '', frankingKey);

            written.push({
                id,
                conversationId: thread.slug,
                kind: 'text',
                from: message.from,
                at: when,
                body: sealed.body,
                epoch: 1,
                seq,
                iv: sealed.iv,
                senderDeviceId: sender.id,
                senderAccountId: accountIdOf(message.from),
                signature: sealed.signature,
                clientAt: new Date(clientAt).toISOString(),
                commitment
            });
        }

        forget(key);
        messages[thread.slug] = written;
    }

    return { devices, members, epochs, messages };
}
