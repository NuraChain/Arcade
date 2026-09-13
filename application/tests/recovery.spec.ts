import { describe, it, expect } from 'vitest';

import { recoveryChallenge } from '../../server/src/domains/device/recovery.ts';
import { fromBase64Url, toBase64Url } from '../src/lib/device-id.ts';
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
    phraseMatches,
    sealArchiveKey,
    sealForArchive,
    signRecovery
} from '../src/lib/recovery.ts';

/**
 * The recovery phrase, which is the most dangerous thing in this product.
 *
 * Everything else here can be revoked. This cannot: whoever holds the phrase can read every message
 * the account has ever received, for as long as the account exists. So the tests that matter are
 * the ones about what it does NOT do - a wrong phrase must be told apart from a corrupt archive, a
 * signature for one device must not confirm another, and the server must never be given anything it
 * could open the archive with.
 *
 * PBKDF2 at 600,000 iterations is slow on purpose, so the derivations here are shared rather than
 * repeated: a spec that derived per assertion would take a minute and get skipped.
 */

const salt = mintSalt();

let phrase: string;
let keys: Awaited<ReturnType<typeof deriveRecovery>>;

const ready = async (): Promise<void> =>
{
    phrase ??= mintPhrase();
    keys ??= await deriveRecovery(phrase, salt);
};

describe('the phrase', () =>
{
    it('is minted in canonical form, and grouped only for the screen', () =>
    {
        const minted = mintPhrase();

        expect(minted).toMatch(/^[0-9A-HJKMNP-TV-Z]{24}$/);
        expect(groupPhrase(minted)).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){5}$/);
    });

    it('round-trips through the form a person is shown', async () =>
    {
        // The bug this pins: a phrase minted pre-grouped derives from a string that no typed phrase
        // can ever equal, so setting up recovery and using it produce different keys and the whole
        // feature fails silently. A browser pass found it; this is what stops it coming back.
        const minted = mintPhrase();
        const shown = groupPhrase(minted);

        expect(normalisePhrase(shown)).toBe(minted);

        const there = await deriveRecovery(minted, salt);
        const back = await deriveRecovery(normalisePhrase(shown) ?? '', salt);

        expect(back.signer.publicKey).toBe(there.signer.publicKey);
        expect(await phraseMatches(back, await checkValueOf(there))).toBe(true);
    });

    it('is different every time', () =>
    {
        const many = new Set(Array.from({ length: 32 }, () => mintPhrase()));
        expect(many.size).toBe(32);
    });

    it('forgives the characters people confuse when they copy it off paper', () =>
    {
        // Crockford excludes I, L and O precisely because a person writing a phrase down will
        // produce them anyway. Folding them back is the difference between "you typed it wrong"
        // and a phrase that simply works.
        expect(normalisePhrase('km70 abcd efgh jkmn pqrs tvwx'))
            .toBe(normalisePhrase('KM7O-ABCD-EFGH-JKMN-PQRS-TVWX'));

        expect(normalisePhrase('1BCD-EFGH-JKMN-PQRS-TVWX-YZ01'))
            .toBe(normalisePhrase('IBCD.EFGH.JKMN.PQRS.TVWX.YZ0L'));
    });

    it('refuses anything that is not a phrase', () =>
    {
        expect(normalisePhrase('')).toBeNull();
        expect(normalisePhrase('too short')).toBeNull();
        expect(normalisePhrase(`${ mintPhrase() }EXTRA`)).toBeNull();

        // U is not in the alphabet at all, so a phrase containing one was mistyped rather than
        // merely misread, and saying so is more useful than folding it to something.
        expect(normalisePhrase('UBCD-EFGH-JKMN-PQRS-TVWX-YZ01')).toBeNull();
    });

    it('groups a normalised phrase back into what somebody wrote down', () =>
    {
        const minted = mintPhrase();
        expect(groupPhrase(normalisePhrase(groupPhrase(minted)) ?? '')).toBe(groupPhrase(minted));
    });
});

describe('the vault', () =>
{
    it('gives back the archive key, and a different phrase does not', async () =>
    {
        await ready();

        const archive = mintArchiveKey();
        const wrapped = await sealArchiveKey(keys, archive);

        expect(await openArchiveKey(keys, wrapped)).toEqual(archive);

        const other = await deriveRecovery(mintPhrase(), salt);
        expect(await openArchiveKey(other, wrapped)).toBeNull();
    });

    it('is bound to its own salt', async () =>
    {
        await ready();

        const archive = mintArchiveKey();
        const wrapped = await sealArchiveKey(keys, archive);

        // The right phrase against the wrong vault. A salt is not a secret, but it is part of the
        // key, so two accounts using one phrase do not share a wrapping key.
        const elsewhere = await deriveRecovery(phrase, mintSalt());
        expect(await openArchiveKey(elsewhere, wrapped)).toBeNull();
    });

    it('tells a wrong phrase apart from a corrupt archive', async () =>
    {
        await ready();

        const check = await checkValueOf(keys);

        expect(await phraseMatches(keys, check)).toBe(true);

        const wrong = await deriveRecovery(mintPhrase(), salt);
        expect(await phraseMatches(wrong, check)).toBe(false);
    });

    it('restores every epoch key from one archive key', async () =>
    {
        const archive = mintArchiveKey();

        const epochs = [
            crypto.getRandomValues(new Uint8Array(32)),
            crypto.getRandomValues(new Uint8Array(32))
        ];

        const sealed = await Promise.all(epochs.map((one, index) => sealForArchive(archive, 'c-1', index + 1, one)));

        expect(await openFromArchive(archive, 'c-1', 1, sealed[0])).toEqual(epochs[0]);
        expect(await openFromArchive(archive, 'c-1', 2, sealed[1])).toEqual(epochs[1]);

        // A different archive key opens none of it, which is what makes the phrase the only way in.
        expect(await openFromArchive(mintArchiveKey(), 'c-1', 1, sealed[0])).toBeNull();
    });

    it('refuses an archived key that was filed under another slot', async () =>
    {
        const archive = mintArchiveKey();
        const key = crypto.getRandomValues(new Uint8Array(32));

        const sealed = await sealForArchive(archive, 'c-1', 1, key);

        // The server hands back rows keyed by (conversation, epoch) and a recovering browser
        // believes the labels. Relabelling one key onto another conversation would make that
        // conversation permanently unreadable on the recovered device - and the entry is preferred
        // over the server's own wrap and never evicted, so it would not heal.
        expect(await openFromArchive(archive, 'c-2', 1, sealed)).toBeNull();
        expect(await openFromArchive(archive, 'c-1', 2, sealed)).toBeNull();
        expect(await openFromArchive(archive, 'c-1', 1, sealed)).toEqual(key);
    });
});

describe('proving the phrase to the server', () =>
{
    const verifier = async (publicKey: string): Promise<CryptoKey> =>
    {
        const point = fromBase64Url(publicKey);

        // The uncompressed point, as the server takes it: 0x04 then x then y. Built as a JWK rather
        // than hand-rolled DER, because a wrong SPKI prefix fails in a way nothing explains.
        return crypto.subtle.importKey(
            'jwk',
            {
                kty: 'EC',
                crv: 'P-256',
                x: toBase64Url(point.slice(1, 33)),
                y: toBase64Url(point.slice(33, 65))
            },
            { name: 'ECDSA', namedCurve: 'P-256' },
            false,
            ['verify']
        );
    };

    const holds = async (publicKey: string, signature: string, challenge: string): Promise<boolean> =>
        crypto.subtle.verify(
            { name: 'ECDSA', hash: 'SHA-256' },
            await verifier(publicKey),
            fromBase64Url(signature) as BufferSource,
            new TextEncoder().encode(challenge) as BufferSource
        );

    it('verifies against the public key the server stores, and nothing secret', async () =>
    {
        await ready();

        const signature = await signRecovery(keys, 'u-1', 'device-1', 'nonce-1');

        expect(await holds(keys.signer.publicKey, signature, recoveryChallenge('u-1', 'device-1', 'nonce-1')))
            .toBe(true);
    });

    it('does not confirm a device it was not made for', async () =>
    {
        await ready();

        const signature = await signRecovery(keys, 'u-1', 'device-1', 'nonce-1');

        // The attack the enrolment message's `Resources` line exists to stop, arriving by another
        // door: a signature captured while confirming one browser must not confirm another.
        expect(await holds(keys.signer.publicKey, signature, recoveryChallenge('u-1', 'device-2', 'nonce-1')))
            .toBe(false);
    });

    it('does not carry to another account or another nonce', async () =>
    {
        await ready();

        const signature = await signRecovery(keys, 'u-1', 'device-1', 'nonce-1');

        expect(await holds(keys.signer.publicKey, signature, recoveryChallenge('u-2', 'device-1', 'nonce-1')))
            .toBe(false);
        expect(await holds(keys.signer.publicKey, signature, recoveryChallenge('u-1', 'device-1', 'nonce-2')))
            .toBe(false);
    });

    it('a different phrase produces a different public key', async () =>
    {
        await ready();

        const other = await deriveRecovery(mintPhrase(), salt);
        expect(other.signer.publicKey).not.toBe(keys.signer.publicKey);
    });

    it('the same phrase and salt always produce the same keys', async () =>
    {
        await ready();

        const again = await deriveRecovery(phrase, salt);

        expect(again.signer.publicKey).toBe(keys.signer.publicKey);
        expect(await phraseMatches(again, await checkValueOf(keys))).toBe(true);
    });
});
