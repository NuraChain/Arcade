import type { ConversationDevices, PeerDevice } from '../api.ts';
import type { Readiness } from './device-state.ts';

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

/**
 * The address a member's devices must be attested by.
 *
 * Comparing the attestation against the account's OWN wallet is what stops `verifyPeerDevice` being
 * self-referential. On its own it checks four values from one response against each other: the id
 * hashes the keys, the signed message names the id, the signature recovers to the address beside it.
 * A server that minted a device and signed its enrolment with any key it liked passes all three.
 * Anchoring to the wallet the account signs in with means a fabricated device has to carry that
 * address too - so the lie has to be told in a second place, one the product shows a person.
 */
const attestedByTheAccount = (member: ConversationDevices['members'][number], device: PeerDevice): boolean =>
    member.address !== undefined && device.address.toLowerCase() === member.address.toLowerCase();

export interface MemberSeal
{
    handle: string;
    state: MemberSealState;

    /** Whether this member is the person reading. The sentence is in a different person if so. */
    isMe: boolean;

    /** The devices that verified. Empty unless `state` is `ready`. */
    devices: PeerDevice[];
}

/**
 * A member who is in the WAY, which is a member whose state is never `ready`.
 *
 * `blocked` is drawn from `members.filter((member) => member.state !== 'ready')`, so it cannot be
 * `ready` - but `filter` does not narrow an element type, so the compiler kept believing it could.
 * Every sentence map keyed on the blocked states then had to be indexed with a value the type said
 * might be `ready`, which is the lookup that returns undefined and takes the page down.
 */
export interface BlockedMember extends MemberSeal
{
    state: Exclude<MemberSealState, 'ready'>;
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
    blocked: BlockedMember | null;
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

    const verdicts = await Promise.all(member.devices.map(async (device) =>
    {
        const verdict = await verifyPeerDevice(device);

        // The signature has to check out AND be by this account's own wallet. A device attested by
        // an address that is not the member's is a device somebody else vouched for - and the curve
        // work is done once, because it is the most expensive thing on this path.
        return {
            device,
            verdict: verdict === 'ok' && !attestedByTheAccount(member, device) ? 'wrong-address' as const : verdict
        };
    }));

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

    const stuck = members.filter((member): member is BlockedMember => member.state !== 'ready');

    const blocked = stuck.find((member) => member.state === 'tampered')
        ?? stuck.find((member) => !member.isMe)
        ?? stuck[0]
        ?? null;

    return { members, ready: blocked === null, blocked };
}

/**
 * Why nothing can be SENT here, which is a bigger question than whether the room can be sealed.
 *
 * Two facts have to agree and they come from different places. `Sealability` is the server's word
 * about the members' ACCOUNTS: whether every one of them has published a device worth wrapping a key
 * to. `Readiness` is about the machine in front of the reader: whether THIS browser holds keys of
 * its own. `post` in `chat.source.ts` refuses on the second, and the composer was disabled on only
 * the first - so a person whose account was enrolled on another browser saw the padlock, typed into
 * an enabled box, and got `This browser has no device keys` in the console when they pressed Send.
 */
export type SendBlock =
    | { reason: 'member'; member: BlockedMember }
    | { reason: 'browser'; readiness: Exclude<Readiness, 'ready'> }

    /**
     * The room's answer has not landed yet. This is not a reason a person is shown - both pages
     * hide the notice while the fetch runs - but the composer has to stand down for it: without
     * this, the first moments of a cold load read as "nothing is in the way", an enabled box took
     * a message, and `post` refused it with the one generic sentence.
     */
    | { reason: 'pending' };

/**
 * Which of the two is in the way, in the order that serves the reader.
 *
 * `tampered` first, because it is the only state that means something is WRONG rather than merely
 * absent, and it is not a thing to work around. Then this browser, because it is the one the reader
 * can fix from where they are standing. Then everybody else.
 *
 * `known` is what stops the browser rule firing before anybody has looked: `readiness()` answers
 * `absent` until the keyring has been read, so acting on it unguarded would disable the composer on
 * every cold load and enable it a moment later. `isWallet` is the other guard - a guest's devices
 * are server-attested and are filtered out of every peer list, so enrolling one changes nothing
 * about sealing, and offering it would be a button that lies. A guest's honest answer is `no-wallet`.
 */
export function sendBlockOf(options: {
    sealability: Sealability | null;
    readiness: Readiness;
    known: boolean;
    isWallet: boolean;

    /** True while the room's answer is still in flight. */
    pending?: boolean;
}): SendBlock | null
{
    const blocked = options.sealability?.blocked ?? null;

    if (blocked !== null && blocked.state === 'tampered')
    {
        return { reason: 'member', member: blocked };
    }

    if (options.pending === true)
    {
        return { reason: 'pending' };
    }

    if (options.isWallet && options.known && options.readiness !== 'ready')
    {
        return { reason: 'browser', readiness: options.readiness };
    }

    return blocked === null ? null : { reason: 'member', member: blocked };
}
