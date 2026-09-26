import { createPublicClient, encodeFunctionData, http, isAddress, parseAbi, type Address, type PublicClient } from 'viem';

import type { ChainCall, ChainProfile, PersonRecord } from '../schemas.ts';

export const RECORD_KEY = 'games.nura.record';

export const RECORD_MAX_BYTES = 4096;

export function recordValue(record: PersonRecord | null): string
{
    if (record === null || record.games.every((one) => one.played === 0))
    {
        return '';
    }

    const value = JSON.stringify({
        v: 1,
        level: record.progress.level,
        xp: record.progress.xp,
        games: record.games
            .filter((one) => one.played > 0)
            .map((one) => ({ game: one.game, rating: one.rating, peak: one.peak, played: one.played, won: one.won })),
        medals: {
            earned: record.achievements.scopes.reduce((sum, scope) => sum + scope.earned, 0),
            total: record.achievements.scopes.reduce((sum, scope) => sum + scope.total, 0)
        }
    });

    if (new TextEncoder().encode(value).length > RECORD_MAX_BYTES)
    {
        throw new Error(`a game record of ${ value.length } characters does not fit the registry's ${ RECORD_MAX_BYTES } bytes`);
    }

    return value;
}

/**
 * The NuraProfile registry, as much of it as this product uses.
 *
 * Written as human-readable ABI rather than shipped as a compiled artifact: five signatures
 * against fifty kilobytes of JSON, and the `struct` lines are the contract's own declarations
 * from `ProfileTypes.sol`, so a reader can compare them by eye. The contracts live in the
 * SmartContract project; nothing here needs them built.
 *
 * `ProfileView` is the LENS's projection - seven well-known keys resolved in one language with
 * fallback to the default - and not storage the core has a struct for. The core stores values
 * addressed by (profile, key, language) and gives them no schema, which is the whole design.
 */
const LENS_ABI = parseAbi([
    'struct ProfileView { uint256 id; address owner; string username; uint64 createdAt; uint64 updatedAt; string displayName; string bio; string avatar; string cover; string location; string jobTitle; string company; }',
    'function getProfile(address owner, string lang) view returns (ProfileView)'
]);

export const REGISTRY_ABI = parseAbi([
    'struct FieldInput { string key; string lang; string value; }',
    'function profileIdOf(address owner) view returns (uint256)',
    'function createProfile(string username, string displayName, string bio, string avatar) returns (uint256)',
    'function setFields(uint256 profileId, FieldInput[] fields)',
    'function getField(uint256 profileId, string key) view returns (string)'
]);

/**
 * The transaction that would make the registry agree, and which one depends on whether the
 * address has a profile yet.
 *
 * Pure, and exported, because this is the half that fails SILENTLY: a wrong selector or a
 * mistyped field key writes somewhere nobody reads and the chain reports success. A test can
 * decode what comes out of here; nothing can decode what a person's wallet already sent.
 *
 * `createProfile` carries the display name and the bio itself, so a first publish is one
 * signature rather than a create followed by a write. The username is deliberately left empty:
 * an on-chain name is claimed against a global index and can be refused, which is a second
 * refusal path this product's profile sheet does not have - and the @handle beside it is a
 * different namespace that accepts scripts the registry's alphabet does not.
 *
 * Both values go under the DEFAULT language. This account holds one bio, not one per language,
 * and writing it under `en` would hide it from a Persian reader while claiming to be the
 * English of something nobody localized.
 */
export function callsFor(registry: string, profileId: bigint, displayName: string, bio: string, record = ''): ChainCall[]
{
    if (profileId === 0n)
    {
        return [{
            to: registry,
            kind: 'create',
            data: encodeFunctionData({
                abi: REGISTRY_ABI,
                functionName: 'createProfile',
                args: ['', displayName, bio, '']
            })
        }];
    }

    return [{
        to: registry,
        kind: 'fields',
        data: encodeFunctionData({
            abi: REGISTRY_ABI,
            functionName: 'setFields',
            args: [profileId, [
                { key: 'displayName', lang: '', value: displayName },
                { key: 'bio', lang: '', value: bio },
                ...(record === '' ? [] : [{ key: RECORD_KEY, lang: '', value: record }])
            ]]
        })
    }];
}

export interface ChainSettings
{
    rpcUrl: string;

    /** The ERC-1967 proxy. The implementation's address is not a thing any caller ever uses. */
    registry: string;

    lens: string;
}

export interface ChainProfiles
{
    readonly configured: boolean;
    readonly registry: string;

    profile(address: string, lang: string): Promise<ChainProfile | null>;

    publish(input: { address: string; displayName: string; bio: string; record: string }): Promise<ChainCall[]>;
}

/**
 * Reading the registry, and composing the writes somebody else signs.
 *
 * Unconfigured is an ordinary state, not a failure: with no rpc url or no addresses the product
 * simply has no chain half and says so, the way it has no push without VAPID keys. What it never
 * does is answer "no profile" for a read it could not make - a dropped rpc throws and the page
 * renders the failure, because "nobody has one" and "I could not ask" are different answers.
 *
 * Nothing here signs. `publish` returns calldata for the browser to hand its wallet, which is
 * what keeps this server free of a key that could write to anybody's profile.
 */
export function createChainProfiles(settings: ChainSettings): ChainProfiles
{
    const configured = settings.rpcUrl !== '' && isAddress(settings.registry) && isAddress(settings.lens);
    const registry = settings.registry as Address;
    const lens = settings.lens as Address;

    let client: PublicClient | null = null;

    /** Built on first use, so an unconfigured deployment opens no transport at all. */
    const reader = (): PublicClient =>
    {
        client ??= createPublicClient({ transport: http(settings.rpcUrl) });
        return client;
    };

    return {
        configured,
        registry: configured ? registry : '',

        async profile(address, lang)
        {
            if (!configured || !isAddress(address))
            {
                return null;
            }

            const view = await reader().readContract({
                address: lens,
                abi: LENS_ABI,
                functionName: 'getProfile',
                args: [address, lang]
            });

            // The lens answers an empty view rather than reverting for an address that has never
            // created one, so id zero IS the answer and not an error to translate.
            if (view.id === 0n)
            {
                return null;
            }

            const record = await reader().readContract({
                address: registry,
                abi: REGISTRY_ABI,
                functionName: 'getField',
                args: [view.id, RECORD_KEY]
            });

            return {
                id: view.id.toString(),
                owner: view.owner,
                username: view.username,
                displayName: view.displayName,
                bio: view.bio,
                avatar: view.avatar,
                cover: view.cover,
                location: view.location,
                jobTitle: view.jobTitle,
                company: view.company,
                record,
                updatedAt: new Date(Number(view.updatedAt) * 1000).toISOString()
            };
        },

        async publish(input)
        {
            if (!configured || !isAddress(input.address))
            {
                return [];
            }

            const profileId = await reader().readContract({
                address: registry,
                abi: REGISTRY_ABI,
                functionName: 'profileIdOf',
                args: [input.address]
            });

            return callsFor(registry, profileId, input.displayName, input.bio, input.record);
        }
    };
}
