/**
 * An account for a pass that needs somebody nobody has ever been: a wallet minted here, signed in
 * through the routes a browser uses, with the device a real first sign-in enrols.
 *
 * It takes a `post(path, body)` that answers `{ status, body }`, so the same sign-in serves a pass
 * that talks to the api with `fetch` and one that drives a browser through its request context.
 * Nothing here loads Playwright: the api-only passes import this and must stay that light.
 *
 * The key is thrown away. It never held anything, it is never written anywhere, and the account it
 * opened is one more row in a database the passes are told to run against only when it is disposable.
 */
import { webcrypto } from 'node:crypto';

import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

import { deviceIdFrom } from '../../backend/src/domains/device/id.ts';

const spki = async (key) => Buffer.from(await webcrypto.subtle.exportKey('spki', key)).toString('base64url');

async function mintDevice()
{
    const exchange = await webcrypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
    const signing = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const exchangeKey = await spki(exchange.publicKey);
    const signingKey = await spki(signing.publicKey);

    return { id: deviceIdFrom(exchangeKey, signingKey), exchangeKey, signingKey };
}

const said = (answer) => `${ answer.status } ${ JSON.stringify(answer.body ?? '').slice(0, 200) }`;

export async function signInWallet(post, name)
{
    const wallet = privateKeyToAccount(generatePrivateKey());
    const device = await mintDevice();
    const issued = await post('/auth/challenge', { address: wallet.address, device: device.id });

    if (issued.status !== 200)
    {
        throw new Error(`no challenge for ${ name }: ${ said(issued) }; is the api running?`);
    }

    const signedIn = await post('/auth/wallet', {
        address: wallet.address,
        nonce: issued.body.nonce,
        signature: await wallet.signMessage({ message: issued.body.message }),
        device: { ...device, label: 'A pass' }
    });

    if (signedIn.status !== 200)
    {
        throw new Error(`wallet sign-in for ${ name } failed: ${ said(signedIn) }`);
    }

    const named = await post('/auth/profile', { displayName: name.slice(0, 40), bio: '' });

    if (named.status !== 200)
    {
        throw new Error(`could not name ${ name }: ${ said(named) }`);
    }

    return { handle: named.body.handle, address: wallet.address.toLowerCase(), device: device.id };
}
