import { decodeFunctionData, encodeFunctionResult, toFunctionSelector, type Address } from 'viem';
import { afterEach, describe, expect, it } from 'vitest';

import { callsFor, createChainProfiles, LENS_ABI, RECORD_KEY, recordValue, REGISTRY_ABI } from '../src/chain/profile.ts';
import type { PersonRecord } from '../src/schemas.ts';
import { callOf, closeChains, fakeChain, lookupGateway, offchainLookup, silentChain, type Answer, type Rpc } from './fake-chain.ts';

const REGISTRY = '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512';
const LENS = '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0';
const RPC = 'http://127.0.0.1:1';
const PICTURE = `http://localhost:3100/avatars/${ 'ab'.repeat(32) }.webp`;

const fieldsOf = (displayName: string, bio: string, record = '', avatar = ''): { displayName: string; bio: string; avatar: string; record: string } =>
    ({ displayName, bio, avatar, record });

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
    it('creates the profile, carrying the name, the bio and the picture, when the address has none', () =>
    {
        const [call] = callsFor(REGISTRY, 0n, fieldsOf('Dana Whitfield', 'Backgammon, mostly.', '', PICTURE));

        expect(call.kind).toBe('create');
        expect(call.to).toBe(REGISTRY);
        expect(decode(call.data)).toEqual({
            functionName: 'createProfile',
            args: ['', 'Dana Whitfield', 'Backgammon, mostly.', PICTURE]
        });
    });

    /**
     * Empty, not the @handle. An on-chain username is claimed against a global index and can be
     * refused, and the handle beside it accepts Persian - which the registry's ASCII alphabet
     * does not. They are two namespaces on purpose.
     */
    it('claims no username on the way past', () =>
    {
        const [call] = callsFor(REGISTRY, 0n, fieldsOf('تخته‌باز', ''));

        expect(decode(call.data).args[0]).toBe('');
    });

    it('writes the fields of a profile that already exists', () =>
    {
        const [call] = callsFor(REGISTRY, 7n, fieldsOf('Dana Whitfield', 'Backgammon, mostly.', '', PICTURE));

        expect(call.kind).toBe('fields');
        expect(decode(call.data)).toEqual({
            functionName: 'setFields',
            args: [7n, [
                { key: 'displayName', lang: '', value: 'Dana Whitfield' },
                { key: 'bio', lang: '', value: 'Backgammon, mostly.' },
                { key: 'avatar', lang: '', value: PICTURE }
            ]]
        });
    });

    it('writes an empty picture, which is how the registry removes one', () =>
    {
        const [call] = callsFor(REGISTRY, 7n, fieldsOf('Dana', 'Hello'));
        const fields = decode(call.data).args[1] as { key: string; value: string }[];

        expect(fields.find((field) => field.key === 'avatar')).toEqual({ key: 'avatar', lang: '', value: '' });
    });

    /**
     * The default language, which is the empty tag. An account holds ONE bio here, so writing it
     * under `en` would hide it from a Persian reader resolving `fa` with fallback, while claiming
     * to be the English of something nobody ever localized.
     */
    it('writes every field under the default language', () =>
    {
        const [call] = callsFor(REGISTRY, 7n, fieldsOf('Dana', 'Hello', '', PICTURE));
        const fields = decode(call.data).args[1] as { lang: string }[];

        expect(fields.map((field) => field.lang)).toEqual(['', '', '']);
    });

    it('always answers with exactly one transaction, so a publish is one signature', () =>
    {
        expect(callsFor(REGISTRY, 0n, fieldsOf('a', 'b'))).toHaveLength(1);
        expect(callsFor(REGISTRY, 9n, fieldsOf('a', 'b'))).toHaveLength(1);
    });
});

const played = (game: string, played: number, won: number, rating: number) => ({
    game, rating, peak: rating + 12, played, won, abandoned: 0, streak: 1, bestStreak: 3, tallies: { rolls: 40 }, xp: rating * 8
} as PersonRecord['games'][number]);

const recordOf = (games: PersonRecord['games']) => ({
    handle: 'dana.w',
    progress: { xp: 420, level: 4, into: 20, span: 250 },
    games,
    achievements: {
        scopes: [{ earned: 3, total: 1000 }, { game: 'ludo', earned: 12, total: 1000 }],
        families: [],
        recent: []
    }
} as PersonRecord);

describe('the game record on the profile', () =>
{
    it('writes the record beside the name and the bio, in the one signature a publish already is', () =>
    {
        const record = recordValue(recordOf([played('ludo', 9, 4, 1232)]));
        const [call] = callsFor(REGISTRY, 7n, fieldsOf('Dana', 'Hello', record));
        const fields = decode(call.data).args[1] as { key: string; lang: string; value: string }[];

        expect(fields.map((field) => field.key)).toEqual(['displayName', 'bio', 'avatar', RECORD_KEY]);
        expect(fields[3]).toEqual({ key: 'games.nura.record', lang: '', value: record });
    });

    it('says what a finished game counts and nothing else: no tallies, no streaks, no games never played', () =>
    {
        const value = JSON.parse(recordValue(recordOf([played('ludo', 9, 4, 1232), played('hokm', 0, 0, 1200)])));

        expect(value).toEqual({
            v: 1,
            level: 4,
            xp: 420,
            games: [{ game: 'ludo', rating: 1232, peak: 1244, played: 9, won: 4 }],
            medals: { earned: 15, total: 2000 }
        });
    });

    it('writes nothing for an account that has not finished a game, rather than a record of zeroes', () =>
    {
        expect(recordValue(null)).toBe('');
        expect(recordValue(recordOf([played('ludo', 0, 0, 1200)]))).toBe('');

        const [call] = callsFor(REGISTRY, 7n, fieldsOf('Dana', 'Hello'));
        expect((decode(call.data).args[1] as { key: string }[]).map((field) => field.key)).toEqual(['displayName', 'bio', 'avatar']);
    });

    it('fits the value limit of the registry with every game played', () =>
    {
        const all = ['ludo', 'hokm', 'backgammon', 'poker'].map((game) => played(game, 99_999, 99_999, 3200));

        expect(new TextEncoder().encode(recordValue(recordOf(all))).length).toBeLessThanOrEqual(4096);
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
        await expect(chain.publish({ address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266', ...fieldsOf('Dana', '') })).resolves.toEqual([]);
        expect(chain.registry).toBe('');
    });

    /** A configured deployment still refuses a caller with no wallet before it asks the chain. */
    it('answers nothing for an address that is not one', async () =>
    {
        const chain = createChainProfiles({ rpcUrl: RPC, registry: REGISTRY, lens: LENS });

        await expect(chain.profile('', 'en')).resolves.toBeNull();
        await expect(chain.publish({ address: '', ...fieldsOf('Dana', '') })).resolves.toEqual([]);
    });
});

describe('reading a registry that may not answer', () =>
{
    const OWNER: Address = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
    const RECORD = '{"v":1,"level":4}';
    const GET_PROFILE = toFunctionSelector('getProfile(address,string)');

    afterEach(closeChains);

    const viewOf = (id: bigint) => ({
        id,
        owner: OWNER,
        username: 'dana',
        createdAt: 1_700_000_000n,
        updatedAt: 1_760_000_000n,
        displayName: 'Dana Whitfield',
        bio: 'Backgammon, mostly.',
        avatar: PICTURE,
        cover: '',
        location: 'Tehran',
        jobTitle: '',
        company: ''
    });

    const registry = (id: bigint, heard: string[]) => (rpc: Rpc): Answer =>
    {
        const { to, data } = callOf(rpc);
        if (to?.toLowerCase() === LENS.toLowerCase())
        {
            const { args } = decodeFunctionData({ abi: LENS_ABI, data });
            heard.push(`getProfile ${ args.join(' ') }`);
            return { result: encodeFunctionResult({ abi: LENS_ABI, functionName: 'getProfile', result: viewOf(id) }) };
        }
        const call = decodeFunctionData({ abi: REGISTRY_ABI, data });
        heard.push(`${ call.functionName } ${ (call.args ?? []).map((arg) => typeof arg === 'object' ? JSON.stringify(arg) : String(arg)).join(' ') }`);
        return call.functionName === 'getField'
            ? { result: encodeFunctionResult({ abi: REGISTRY_ABI, functionName: 'getField', result: RECORD }) }
            : { result: encodeFunctionResult({ abi: REGISTRY_ABI, functionName: 'profileIdOf', result: id }) };
    };

    it('reads the profile through the lens in the reader\'s language, and the record through the registry', async () =>
    {
        const heard: string[] = [];
        const fake = await fakeChain(registry(7n, heard));
        const chain = createChainProfiles({ rpcUrl: fake.url, registry: REGISTRY, lens: LENS });

        await expect(chain.profile(OWNER, 'fa')).resolves.toEqual({
            id: '7',
            owner: OWNER,
            username: 'dana',
            displayName: 'Dana Whitfield',
            bio: 'Backgammon, mostly.',
            avatar: PICTURE,
            cover: '',
            location: 'Tehran',
            jobTitle: '',
            company: '',
            record: RECORD,
            updatedAt: new Date(1_760_000_000_000).toISOString()
        });
        expect(heard).toEqual([`getProfile ${ OWNER } fa`, `getField 7 ${ RECORD_KEY }`]);
    });

    it('answers no profile for an address the lens has never seen, and asks the registry nothing', async () =>
    {
        const heard: string[] = [];
        const fake = await fakeChain(registry(0n, heard));

        await expect(createChainProfiles({ rpcUrl: fake.url, registry: REGISTRY, lens: LENS }).profile(OWNER, 'en')).resolves.toBeNull();
        expect(fake.asked).toEqual(['eth_call']);
    });

    it('composes the write from the profile id the registry holds', async () =>
    {
        const fake = await fakeChain(registry(7n, []));
        const [call] = await createChainProfiles({ rpcUrl: fake.url, registry: REGISTRY, lens: LENS }).publish({ address: OWNER, ...fieldsOf('Dana', 'Hello') });

        expect(call.kind).toBe('fields');
        expect(decode(call.data).args[0]).toBe(7n);
    });

    it('fails both reads against a chain that takes the connection and never answers, well inside the browser\'s patience', async () =>
    {
        const chain = createChainProfiles({ rpcUrl: await silentChain(), registry: REGISTRY, lens: LENS });
        const started = performance.now();

        const [profile, publish] = await Promise.allSettled([chain.profile(OWNER, 'en'), chain.publish({ address: OWNER, ...fieldsOf('Dana', '') })]);
        expect(profile.status).toBe('rejected');
        expect(publish.status).toBe('rejected');
        expect(performance.now() - started).toBeLessThan(6_000);
    }, 12_000);

    it('fails a read against a chain that sends the headers and then stalls the body, within the same patience', async () =>
    {
        const fake = await fakeChain(() => 'stall');
        const chain = createChainProfiles({ rpcUrl: fake.url, registry: REGISTRY, lens: LENS });
        const started = performance.now();

        await expect(chain.profile(OWNER, 'en')).rejects.toThrow();
        expect(performance.now() - started).toBeLessThan(6_000);
    }, 12_000);

    it('fails a read whose answer stalls after the first call has landed, within the same patience', async () =>
    {
        const fake = await fakeChain((rpc) => callOf(rpc).data.startsWith(GET_PROFILE)
            ? { result: encodeFunctionResult({ abi: LENS_ABI, functionName: 'getProfile', result: viewOf(7n) }) }
            : 'stall');
        const chain = createChainProfiles({ rpcUrl: fake.url, registry: REGISTRY, lens: LENS });
        const started = performance.now();

        await expect(chain.profile(OWNER, 'en')).rejects.toThrow();
        expect(fake.asked).toEqual(['eth_call', 'eth_call']);
        expect(performance.now() - started).toBeLessThan(6_000);
    }, 12_000);

    it('never follows an offchain lookup the lens answers with, and fails the read instead', async () =>
    {
        const gateway = await lookupGateway();
        const fake = await fakeChain((rpc) => callOf(rpc).data.startsWith(GET_PROFILE) ? offchainLookup(LENS, gateway.url) : { result: '0x' });

        await expect(createChainProfiles({ rpcUrl: fake.url, registry: REGISTRY, lens: LENS }).profile(OWNER, 'en')).rejects.toThrow();
        expect(gateway.hits()).toBe(0);
        expect(fake.asked).toEqual(['eth_call']);
    });
});
