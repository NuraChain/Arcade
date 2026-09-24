import { createPublicClient, http, parseAbi } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

import { WALLET_FIXTURES } from '../../server/src/db/wallet-fixtures.ts';
import { BASE, clearTables, guestSeat, launch, recorder, seat } from './seats.mjs';

const RPC = process.env.QA_RPC ?? 'http://127.0.0.1:8645';

const REGISTRY = parseAbi([
    'function profileIdOf(address owner) view returns (uint256)',
    'function getField(uint256 profileId, string key) view returns (string)'
]);

const { record, finish } = recorder('chain-pass');

const soon = async (check, ms = 30_000) =>
{
    const until = Date.now() + ms;

    while (Date.now() < until)
    {
        if (await check().catch(() => false))
        {
            return true;
        }
        await new Promise((resolve) => setTimeout(resolve, 400));
    }

    return false;
};

const rpc = async (method, params = []) =>
{
    const response = await fetch(RPC, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
    });
    const body = await response.json();

    if (body.error !== undefined)
    {
        throw new Error(body.error.message);
    }

    return body.result;
};

const address = privateKeyToAccount(WALLET_FIXTURES.find((one) => one.handle === 'dana.w').privateKey).address;

const browser = await launch();
const dana = await seat(browser, 'dana.w');

await dana.context.exposeFunction('nuraRpc', (method, params) => (method === 'eth_requestAccounts' || method === 'eth_accounts' ? [address] : rpc(method, params)));
await dana.context.addInitScript(() =>
{
    window.ethereum = {
        request: ({ method, params }) => window.nuraRpc(method, params ?? []),
        on: () => undefined,
        removeListener: () => undefined
    };
});

const finishOne = async () =>
{
    const guest = await guestSeat(browser, `Chain ${ Math.floor(Math.random() * 100000) }`);
    const made = await dana.api('POST', '/tables/', {
        game: 'ludo', seats: 2, mode: 'turns', privacy: 'public', target: 0, cube: false, blinds: 'low', chat: true, voice: false, invitees: []
    });
    await guest.api('POST', `/tables/${ made.body.id }/seat`);
    await dana.api('POST', `/tables/${ made.body.id }/ready`, { ready: true });
    await guest.api('POST', `/tables/${ made.body.id }/ready`, { ready: true });
    const started = await dana.api('POST', `/tables/${ made.body.id }/start`);
    await guest.api('POST', `/matches/${ started.body.id }/resign`, { key: `resign-${ started.body.id }` });
    await guest.context.close();
    await clearTables(dana);
};

const chain = createPublicClient({ transport: http(RPC) });

const published = async (registry) =>
{
    const id = await chain.readContract({ address: registry, abi: REGISTRY, functionName: 'profileIdOf', args: [address] });
    return id === 0n ? null : await chain.readContract({ address: registry, abi: REGISTRY, functionName: 'getField', args: [id, 'games.nura.record'] });
};

const openAbout = async () =>
{
    await dana.page.goto(`${ BASE }/app/me`);
    await dana.page.waitForSelector('main');
    await dana.page.getByRole('tab', { name: 'About' }).click();
};

try
{
    await clearTables(dana);
    await finishOne();

    const state = (await dana.api('GET', '/chain/profile')).body;
    record('the server is pointed at a registry', state?.configured === true, JSON.stringify(state).slice(0, 120));
    record('it has a record to publish once a game is finished', (state?.record ?? '') !== '', state?.record?.slice(0, 80));

    const before = await published(state.registry);

    await openAbout();

    const button = dana.page.getByRole('button', { name: before === null ? 'Create my Nura Profile' : 'Publish this to the chain' });
    record('the profile panel offers the publish', await soon(async () => await button.count() > 0), before === null ? 'create' : 'publish');
    await button.first().click();

    record('publishing says it landed', await soon(async () => await dana.page.getByText('Published. The registry now says what this page does.').count() > 0));
    record('the page says the record on the profile is up to date', await soon(async () => await dana.page.getByText(/Your game record on the profile is up to date/).count() > 0));

    const first = (await dana.api('GET', '/chain/profile')).body.record;
    record('the registry holds exactly the record the server composed', (await published(state.registry)) === first);

    const parsed = JSON.parse(first);
    record('the record is the level, the ratings and the medal count and nothing else', parsed.v === 1 && Array.isArray(parsed.games) && typeof parsed.medals?.earned === 'number' && Object.keys(parsed).sort().join() === 'games,level,medals,v,xp');

    await finishOne();
    await openAbout();

    record('another finished game makes the published record stale', await soon(async () => await dana.page.getByText(/You have played since your record was last published/).count() > 0));

    await dana.page.getByRole('button', { name: 'Publish this to the chain' }).first().click();
    record('publishing again brings it up to date', await soon(async () => await dana.page.getByText(/Your game record on the profile is up to date/).count() > 0));

    const second = (await dana.api('GET', '/chain/profile')).body.record;
    record('the registry now holds the newer record', second !== first && (await published(state.registry)) === second);

    record('no console errors', dana.errors.length === 0, dana.errors.slice(0, 3).join(' | '));
}
finally
{
    await clearTables(dana).catch(() => undefined);
    await browser.close();
    finish();
}
