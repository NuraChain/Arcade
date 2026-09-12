import type { ConversationDevices, PeerDevice } from '../api.ts';

/**
 * Whether the people in a conversation can be sealed to, decided HERE.
 *
 * The server reports facts - who is in the conversation, what devices they published, what proof
 * came with each - and this file decides what those facts mean. That split is the whole point: a
 * server that told the client "this conversation is sealed" would be a server the client trusts
 * about the one thing it must not be trusted about.
 *
 * Nothing is sealed yet. What this produces today is the reason a conversation CANNOT be sealed,
 * which is a true sentence about every conversation in the product right now, and stays true for
 * the ones that still cannot be when sealing arrives.
 */

export type MemberSealState =
    /** Has at least one device this browser verified for itself. */
    | 'ready'

    /** Signed in without a wallet, so there is no proof to check. */
    | 'no-wallet'

    /** Has a wallet but no confirmed device: nothing to wrap a key to. */
    | 'no-device'

    /** Only contract wallets, which this browser cannot check without a chain call. */
    | 'needs-chain'

    /** A device in their list did not verify. Not a degradation - an alarm. */
    | 'tampered';

export interface MemberSeal
{
    handle: string;
    state: MemberSealState;

    /** Whether this member is the person reading. The sentence is in a different person if so. */
    isMe: boolean;

    /** The devices that verified. Empty unless `state` is `ready`. */
    devices: PeerDevice[];
}

export interface Sealability
{
    members: MemberSeal[];

    /** Every member has at least one verified device. */
    ready: boolean;

    /**
     * The member standing in the way, and why. Null when `ready`.
     *
     * One member rather than a list, because the sentence this becomes names somebody: "sara.k is
     * signed in without a wallet" is something a person can act on, and "2 members cannot be sealed
     * to" is not.
     *
     * Two rules decide which one. A tampered list wins over everything else whatever order the
     * members are in, because it is the only state that means something is WRONG rather than
     * merely absent. Otherwise somebody else is named ahead of the reader - being told about your
     * own account in the third person reads like a bug, and if the only thing in the way is you,
     * the sentence should say so directly.
     */
    blocked: MemberSeal | null;
}

/**
 * The signature check, fetched the first time something actually needs checking.
 *
 * `attestation.ts` pulls in secp256k1 and keccak, which is 13 KB gzip of elliptic-curve code for a
 * question most conversations never get to ask - a thread where nobody has a provable device is
 * answered entirely by the empty-array branch below. A static import put all of it in the chat
 * page's chunk and pushed that chunk past its budget, for code that would not run.
 *
 * The module is cached after the first call, so a thread that does verify pays once.
 */
const checker = async (): Promise<typeof import('./attestation.ts').verifyPeerDevice> =>
    (await import('./attestation.ts')).verifyPeerDevice;

async function sealOf(member: ConversationDevices['members'][number], me: string): Promise<MemberSeal>
{
    const base = { handle: member.handle, isMe: member.handle === me };

    if (member.devices.length === 0)
    {
        // The server lists a member with no sealable device as an empty array rather than leaving
        // them out, so this is a real answer and not a half-loaded one.
        return { ...base, state: member.kind === 'wallet' ? 'no-device' : 'no-wallet', devices: [] };
    }

    const verifyPeerDevice = await checker();

    const verdicts = await Promise.all(member.devices.map(async (device) => ({
        device,
        verdict: await verifyPeerDevice(device)
    })));

    // One bad device condemns the whole list. A list that contains something which does not verify
    // is not a trustworthy statement about the rest of it either, and quietly using the good ones
    // is how a fabricated device gets wrapped in beside the real ones.
    if (verdicts.some((one) => one.verdict !== 'ok' && one.verdict !== 'needs-chain'))
    {
        return { ...base, state: 'tampered', devices: [] };
    }

    const usable = verdicts.filter((one) => one.verdict === 'ok').map((one) => one.device);

    return usable.length === 0
        ? { ...base, state: 'needs-chain', devices: [] }
        : { ...base, state: 'ready', devices: usable };
}

export async function sealabilityOf(answer: ConversationDevices, me: string): Promise<Sealability>
{
    const members = await Promise.all(answer.members.map((member) => sealOf(member, me)));

    const stuck = members.filter((member) => member.state !== 'ready');

    const blocked = stuck.find((member) => member.state === 'tampered')
        ?? stuck.find((member) => !member.isMe)
        ?? stuck[0]
        ?? null;

    return { members, ready: blocked === null, blocked };
}
