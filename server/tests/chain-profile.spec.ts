import { decodeFunctionData } from 'viem';
import { describe, expect, it } from 'vitest';

import { callsFor, createChainProfiles, REGISTRY_ABI } from '../src/chain/profile.ts';

const REGISTRY = '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512';
const LENS = '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0';
const RPC = 'http://127.0.0.1:1';

const decode = (data: string): { functionName: string; args: readonly unknown[] } =>
{
    const answer = decodeFunctionData({ abi: REGISTRY_ABI, data: data as `0x${ string }` });
    return { functionName: answer.functionName, args: answer.args ?? [] };
};

/**
 * What the browser hands its wallet, decoded back.
 *
 * This is the one half of the chain path that fails SILENTLY. A read that goes wrong throws and
 * a page renders the failure; a write with the wrong selector, the wrong argument order or a
 * mistyped field key lands in storage nobody reads, costs real gas, and the chain reports
 * success. The registry stores values addressed by (profile, key, language) and gives them no
 * schema at all, so there is nothing on that side to refuse `displayNmae`.
 */
describe('composing the registry write', () =>
{
    it('creates the profile, carrying both fields, when the address has none', () =>
    {
        const [call] = callsFor(REGISTRY, 0n, 'Dana Whitfield', 'Backgammon, mostly.');

        expect(call.kind).toBe('create');
        expect(call.to).toBe(REGISTRY);
        expect(decode(call.data)).toEqual({
            functionName: 'createProfile',
            args: ['', 'Dana Whitfield', 'Backgammon, mostly.', '']
        });
    });

    /**
     * Empty, not the @handle. An on-chain username is claimed against a global index and can be
     * refused, and the handle beside it accepts Persian - which the registry's ASCII alphabet
     * does not. They are two namespaces on purpose.
     */
    it('claims no username on the way past', () =>
    {
        const [call] = callsFor(REGISTRY, 0n, 'تخته‌باز', '');

        expect(decode(call.data).args[0]).toBe('');
    });

    it('writes the fields of a profile that already exists', () =>
    {
        const [call] = callsFor(REGISTRY, 7n, 'Dana Whitfield', 'Backgammon, mostly.');

        expect(call.kind).toBe('fields');
        expect(decode(call.data)).toEqual({
            functionName: 'setFields',
            args: [7n, [
                { key: 'displayName', lang: '', value: 'Dana Whitfield' },
                { key: 'bio', lang: '', value: 'Backgammon, mostly.' }
            ]]
        });
    });

    /**
     * The default language, which is the empty tag. An account holds ONE bio here, so writing it
     * under `en` would hide it from a Persian reader resolving `fa` with fallback, while claiming
     * to be the English of something nobody ever localized.
     */
    it('writes both fields under the default language', () =>
    {
        const [call] = callsFor(REGISTRY, 7n, 'Dana', 'Hello');
        const fields = decode(call.data).args[1] as { lang: string }[];

        expect(fields.map((field) => field.lang)).toEqual(['', '']);
    });

    it('always answers with exactly one transaction, so a publish is one signature', () =>
    {
        expect(callsFor(REGISTRY, 0n, 'a', 'b')).toHaveLength(1);
        expect(callsFor(REGISTRY, 9n, 'a', 'b')).toHaveLength(1);
    });
});

/**
 * Pointed at no registry, which is what every deployment is until somebody sets three variables.
 *
 * It has to answer rather than fail: the profile page asks on every visit, and a throw here is a
 * 500 on a page whose chain half simply is not configured. The rpc url below names a port nothing
 * listens on, so a test that reached the network would hang or throw instead of passing.
 */
describe('a deployment with no registry behind it', () =>
{
    it('is unconfigured when the addresses are missing', () =>
    {
        expect(createChainProfiles({ rpcUrl: RPC, registry: '', lens: '' }).configured).toBe(false);
    });

    it('is unconfigured when the rpc url is missing', () =>
    {
        expect(createChainProfiles({ rpcUrl: '', registry: REGISTRY, lens: LENS }).configured).toBe(false);
    });

    it('is unconfigured when only half the pair is set', () =>
    {
        expect(createChainProfiles({ rpcUrl: RPC, registry: REGISTRY, lens: '' }).configured).toBe(false);
        expect(createChainProfiles({ rpcUrl: RPC, registry: '', lens: LENS }).configured).toBe(false);
    });

    it('refuses an address that is not one, rather than asking the chain about it', () =>
    {
        expect(createChainProfiles({ rpcUrl: RPC, registry: 'the-registry', lens: LENS }).configured).toBe(false);
    });

    it('publishes nothing and says nobody has a profile, without opening a socket', async () =>
    {
        const chain = createChainProfiles({ rpcUrl: RPC, registry: '', lens: '' });

        await expect(chain.profile('0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266', 'en')).resolves.toBeNull();
        await expect(chain.publish({ address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266', displayName: 'Dana', bio: '' })).resolves.toEqual([]);
        expect(chain.registry).toBe('');
    });

    /** A configured deployment still refuses a caller with no wallet before it asks the chain. */
    it('answers nothing for an address that is not one', async () =>
    {
        const chain = createChainProfiles({ rpcUrl: RPC, registry: REGISTRY, lens: LENS });

        await expect(chain.profile('', 'en')).resolves.toBeNull();
        await expect(chain.publish({ address: '', displayName: 'Dana', bio: '' })).resolves.toEqual([]);
    });
});
