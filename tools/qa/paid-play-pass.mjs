/**
 * Two real browsers play a game of Ludo for NURA through the pages a person uses, on the built server
 * and a local chain. Each puts NURA in the vault from the wallet page, one opens a table played for
 * NURA from the create form and the other sits down, and each Ready asks that player's wallet to sign
 * the stake. The stakes lock, the game is played by pressing the die and the pawns, and when it ends
 * each page says what it came to; the wallet page then shows both balances as the vault holds them,
 * and the winner takes their NURA out.
 *
 *   QA_BASE=http://localhost:5300 node tools/qa/paid-play-pass.mjs
 *
 * The server and the node are set up as `paid-pass.mjs` wants them, on a node whose clock has not
 * been moved (QA_RPC, http://127.0.0.1:8645): run this one first, or on a node of its own. Each
 * page's wallet is an EIP-1193 provider the pass puts in the page, which answers from a key the pass
 * keeps in memory, the way an extension would: it signs the stake and the transactions here, sends
 * them to the node, and passes every read through. One player is on a desk in English and the other
 * on a phone in Persian, and every control is found by the catalogue's own words.
 */
import { createPublicClient, createWalletClient, http, toHex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { hardhat } from 'viem/chains';

import { app as englishApp } from '../../frontend/src/locales/en/app.ts';
import { play as englishPlay } from '../../frontend/src/locales/en/play.ts';
import { vault as englishVault } from '../../frontend/src/locales/en/vault.ts';
import { app as persianApp } from '../../frontend/src/locales/fa/app.ts';
import { play as persianPlay } from '../../frontend/src/locales/fa/play.ts';
import { vault as persianVault } from '../../frontend/src/locales/fa/vault.ts';
import { BASE, launch, recorder, waitFor, walletSeat } from './seats.mjs';
import { vaultArtifact } from './vault-deploy.mjs';

const RPC = process.env.QA_RPC ?? 'http://127.0.0.1:8645';

const WEI = 10n ** 18n;

const PUT_IN = 20n;

const STAKE = 10n;

const MOVES = 8;

const WORDS = {
    en: { ...englishApp, ...englishPlay, ...englishVault },
    fa: { ...persianApp, ...persianPlay, ...persianVault }
};

const ABI = vaultArtifact().abi;

const chain = { ...hardhat, rpcUrls: { default: { http: [RPC] } } };

const reader = createPublicClient({ chain, transport: http(RPC) });

const { record, finish } = recorder('paid-play-pass');

let vault = null;

const node = async (method, params = []) =>
{
    const response = await fetch(RPC, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
    });
    const answer = await response.json();

    if (answer.error !== undefined)
    {
        const refused = new Error(answer.error.message);

        refused.code = answer.error.code;
        throw refused;
    }

    return answer.result;
};

const latin = (text) => text
    .replace(/[‎‏⁦-⁩]/g, '')
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .replace(/٫/g, '.')
    .replace(/(\d)[,٬](\d)/g, '$1$2');

const fill = (template, values) => Object.entries(values).reduce((text, [key, value]) => text.replaceAll(`{${ key }}`, String(value)), template);

const providerFor = (account) =>
{
    const client = createWalletClient({ account, chain, transport: http(RPC) });
    const asked = [];

    const answer = async (method, params) =>
    {
        asked.push(method);

        if (method === 'eth_requestAccounts' || method === 'eth_accounts')
        {
            return [account.address];
        }

        if (method === 'eth_chainId')
        {
            return toHex(chain.id);
        }

        if (method === 'wallet_switchEthereumChain' || method === 'wallet_addEthereumChain')
        {
            return null;
        }

        if (method === 'wallet_getPermissions' || method === 'wallet_requestPermissions')
        {
            return [{ parentCapability: 'eth_accounts' }];
        }

        if (method === 'personal_sign')
        {
            return account.signMessage({ message: /^0x[0-9a-f]*$/i.test(params[0]) ? { raw: params[0] } : params[0] });
        }

        if (method === 'eth_signTypedData_v4')
        {
            const typed = JSON.parse(params[1]);
            const types = Object.fromEntries(Object.entries(typed.types).filter(([name]) => name !== 'EIP712Domain'));

            return account.signTypedData({ domain: typed.domain, types, primaryType: typed.primaryType, message: typed.message });
        }

        if (method === 'eth_sendTransaction')
        {
            const [sent] = params;

            return client.sendTransaction({
                to: sent.to,
                data: sent.data,
                value: BigInt(sent.value ?? '0x0'),
                ...(sent.gasPrice === undefined ? {} : { gasPrice: BigInt(sent.gasPrice) })
            });
        }

        return node(method, params);
    };

    return { answer, asked };
};

const player = async (browser, name, language, viewport) =>
{
    const account = privateKeyToAccount(generatePrivateKey());
    const seated = await walletSeat(browser, name, viewport, account);
    const wallet = providerFor(account);

    await seated.context.addCookies([{ name: 'locale', value: language, url: BASE }]);
    await seated.context.exposeFunction('nuraWallet', (method, params) => wallet.answer(method, params));
    await seated.context.addInitScript(() =>
    {
        window.ethereum = {
            request: ({ method, params }) => window.nuraWallet(method, params ?? []),
            on: () => undefined,
            removeListener: () => undefined
        };
    });
    await node('hardhat_setBalance', [account.address, toHex(100n * WEI)]);

    const refused = [];

    seated.page.on('response', (response) =>
    {
        if (response.status() >= 400)
        {
            refused.push(`${ response.status() } ${ response.request().method() } ${ new URL(response.url()).pathname }`);
        }
    });

    return { ...seated, label: `${ name } (${ language }, ${ viewport.width })`, account, address: account.address.toLowerCase(), words: WORDS[language], wallet, refused };
};

const pressed = async (who, name) =>
{
    const button = who.page.getByRole('button', { name }).first();

    try
    {
        await button.click({ timeout: 10_000 });
    }
    catch (error)
    {
        const shot = `tools/qa/out/paid-play-${ who.address.slice(2, 8) }.png`;
        const seen = await who.page.getByRole('button').evaluateAll((all) =>
            all.map((one) => `${ (one.getAttribute('aria-label') ?? one.textContent ?? '').trim().slice(0, 40) }${ one.disabled || one.getAttribute('aria-disabled') === 'true' ? ' (off)' : '' }`).filter((text) => text !== ''));

        await who.page.screenshot({ path: shot, scale: 'css' }).catch(() => undefined);
        throw new Error(`${ who.label } could not press "${ name }" at ${ who.page.url() }: buttons ${ seen.join(', ') }; screenshot ${ shot }; ${ String(error).split('\n')[0] }`);
    }
};

const freeOf = (who) => reader.readContract({ address: vault, abi: ABI, functionName: 'balanceOf', args: [who.address] });

const lockedOf = (who) => reader.readContract({ address: vault, abi: ABI, functionName: 'lockedOf', args: [who.address] });

const shown = async (who) => latin(await who.page.locator('main').innerText().catch(() => ''));

const figure = async (who, key) =>
{
    const value = await who.page.evaluate((label) =>
    {
        const term = [...document.querySelectorAll('dt')].find((one) => one.textContent.trim() === label);

        return term?.nextElementSibling?.querySelector('.tally')?.textContent?.trim() ?? null;
    }, who.words[key]);

    return value === null ? null : latin(value);
};

const openWallet = async (who) =>
{
    await who.page.goto(`${ BASE }/app/me/wallet`);
    await who.page.getByRole('heading', { name: who.words['vault.title'] }).first().waitFor({ timeout: 15_000 });
};

const move = async (who, way, amount) =>
{
    await who.page.getByRole('group', { name: who.words['vault.move'] }).getByRole('button', { name: who.words[way === 'in' ? 'vault.in' : 'vault.out'] }).click();

    if (amount === null)
    {
        await pressed(who, who.words['vault.max']);
    }
    else
    {
        await who.page.getByLabel(who.words['vault.amount'], { exact: true }).fill(String(amount));
    }

    await pressed(who, who.words[way === 'in' ? 'vault.send.in' : 'vault.send.out']);

    const told = who.page.getByText(who.words[way === 'in' ? 'vault.deposited' : 'vault.withdrawn']).first();

    return waitFor(async () => await told.isVisible().catch(() => false), 30_000);
};

const matchOf = async (who, matchId) => (await who.api('GET', `/matches/${ matchId }`)).body;

const tableOf = async (who, tableId) => (await who.api('GET', `/tables/${ tableId }`)).body;

const pressPawn = async (who) =>
{
    const pawn = who.page.locator('.board-canvas .lp[data-movable] .lp-pawn').first();

    if (!await waitFor(async () => await pawn.count() > 0, 5000))
    {
        return false;
    }

    const box = await pawn.boundingBox();

    await who.page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

    return true;
};

const pressDie = async (who) =>
{
    const die = who.page.locator('button.board-roll');

    if (!await waitFor(async () => await die.isVisible().catch(() => false) && await die.isEnabled().catch(() => false), 5000))
    {
        return false;
    }

    await die.click();

    return true;
};

const browser = await launch();
const desk = await player(browser, `Desk ${ Math.floor(Math.random() * 100000) }`, 'en', { width: 1280, height: 900 });
const phone = await player(browser, `Phone ${ Math.floor(Math.random() * 100000) }`, 'fa', { width: 390, height: 844 });

try
{
    const standing = (await desk.api('GET', '/vault')).body;

    if (standing?.configured !== true)
    {
        throw new Error(`the server on ${ BASE } has no vault`);
    }

    vault = standing.vault;

    console.log('[NURA put in the vault from the wallet page]');

    for (const who of [desk, phone])
    {
        await openWallet(who);

        const adult = who.page.getByRole('switch', { name: who.words['vault.terms.adult'] });

        await adult.waitFor({ timeout: 15_000 });
        await adult.click();
        await pressed(who, who.words['vault.terms.accept']);
        await who.page.getByLabel(who.words['vault.amount'], { exact: true }).waitFor({ timeout: 15_000 });

        const landed = await move(who, 'in', PUT_IN);

        record(`${ who.label }: accepts the terms and puts ${ PUT_IN } NURA in, and the page says it landed`, landed);
        record(`${ who.label }: the vault holds it`, await freeOf(who) === PUT_IN * WEI, `${ await freeOf(who) }`);
        record(`${ who.label }: and the page shows what the vault holds`, await waitFor(async () => await figure(who, 'vault.free') === String(PUT_IN), 10_000),
            `${ await figure(who, 'vault.free') }`);
    }

    console.log('\n[a table played for NURA, opened from the create form]');

    await desk.page.goto(`${ BASE }/app/games/ludo/create`);
    await desk.page.getByRole('button', { name: fill(desk.words['common.players'].other, { count: 2 }), exact: true }).click();
    await desk.page.getByRole('group', { name: desk.words['create.pace'] }).getByRole('button', { name: desk.words['games.mode.live'] }).click();
    await desk.page.getByRole('group', { name: desk.words['create.privacy'] }).getByRole('button', { name: desk.words['create.privacy.public'] }).click();
    await desk.page.getByRole('button', { name: `${ STAKE } NURA`, exact: true }).click();

    const share = STAKE * 2n - STAKE * 2n * BigInt(standing.fee) / 10_000n;

    record('the form says what the pot comes to, the fee and what the winner takes',
        await waitFor(async () => (await shown(desk)).includes(fill(desk.words['create.stake.pot'], { pot: STAKE * 2n, fee: STAKE * 2n - share, share })), 5000));
    await pressed(desk, desk.words['create.submit']);
    await desk.page.waitForURL(/\/app\/play\//, { timeout: 15_000 });

    const tableId = desk.page.url().split('/app/play/')[1].split(/[?#]/)[0];
    const opened = await tableOf(desk, tableId);

    record(`the table is opened at ${ STAKE } NURA`, opened?.stake === (STAKE * WEI).toString(), `${ opened?.stake }`);

    await phone.page.goto(`${ BASE }/app/play/${ tableId }`);
    await pressed(phone, phone.words['play.table.sitDown']);
    record('the other player sits down', await waitFor(async () => (await tableOf(desk, tableId))?.taken === 2, 10_000));

    for (const who of [desk, phone])
    {
        record(`${ who.label }: the waiting room says what each stakes and what the winner takes`,
            await waitFor(async () => (await shown(who)).includes(latin(fill(who.words['play.stake.each'], { stake: STAKE, share }))), 10_000));
    }

    for (const who of [desk, phone])
    {
        const before = who.wallet.asked.filter((one) => one === 'eth_signTypedData_v4').length;

        await pressed(who, who.words['play.lobby.ready']);
        record(`${ who.label }: Ready asks the wallet for one signature and no transaction`,
            await waitFor(() => who.wallet.asked.filter((one) => one === 'eth_signTypedData_v4').length === before + 1, 10_000));
    }

    const started = await waitFor(async () => (await tableOf(desk, tableId))?.money?.state === 'open', 30_000);
    const table = await tableOf(desk, tableId);

    record('the stakes lock on the chain and the game is dealt', started && table?.matchId !== undefined, JSON.stringify(table?.money ?? {}));
    record('the vault holds both stakes in play', await lockedOf(desk) === STAKE * WEI && await lockedOf(phone) === STAKE * WEI);
    record('both pages show the board', await waitFor(async () =>
        await desk.page.locator('.table-stage[data-rev]').count() > 0 && await phone.page.locator('.table-stage[data-rev]').count() > 0, 15_000));

    console.log('\n[the game, played by pressing the die and the pawns]');

    const matchId = table.matchId;
    const seatOf = new Map(table.chairs.map((chair) => [chair.who, chair.seat]));
    let taken = 0;
    let presses = 0;

    for (let step = 0; step < MOVES; step += 1)
    {
        const state = await matchOf(desk, matchId);

        if (state?.finishedAt !== undefined)
        {
            break;
        }

        const actor = seatOf.get(desk.handle) === state.turn ? desk : phone;
        const own = await matchOf(actor, matchId);
        const done = own.view.die === undefined ? await pressDie(actor) : await pressPawn(actor);

        presses += done ? 1 : 0;

        if (done && await waitFor(async () => (await matchOf(desk, matchId))?.rev > own.rev, 10_000))
        {
            taken += 1;
        }

        await desk.page.waitForTimeout(400);
    }

    record(`every press of the die and of a pawn is a move the server takes (${ taken } of ${ MOVES })`, presses === MOVES && taken === MOVES, `${ presses } pressed, ${ taken } taken`);

    const resigned = await phone.api('POST', `/matches/${ matchId }/resign`, { key: `resign-${ matchId.slice(0, 8) }` });

    record('the player on the phone gives up', resigned.ok, `${ resigned.status }`);

    console.log('\n[what each page says the game came to]');

    const won = fill(desk.words['match.money.won'], { amount: share });
    const paying = fill(desk.words['match.money.winning'], { amount: share });
    const lost = latin(fill(phone.words['match.money.lost'], { amount: STAKE }));

    record('the winner\'s card says what they won once the pot is paid', await waitFor(async () =>
    {
        const said = latin(await desk.page.locator('[data-money]').first().innerText().catch(() => ''));

        return said.includes(won) && !said.includes(paying);
    }, 45_000), latin(await desk.page.locator('[data-money]').first().innerText().catch(() => '')));
    record('and offers to check the game', (await desk.page.locator('[data-check]').first().getAttribute('href').catch(() => null))?.endsWith(matchId) === true);
    record('the loser\'s card, in Persian, says what they lost', await waitFor(async () =>
        latin(await phone.page.locator('[data-money]').first().innerText().catch(() => '')).includes(lost), 30_000),
    latin(await phone.page.locator('[data-money]').first().innerText().catch(() => '')));
    record('the vault paid the winner the pot less the fee and holds nothing in play',
        await freeOf(desk) === (PUT_IN - STAKE + share) * WEI && await freeOf(phone) === (PUT_IN - STAKE) * WEI && await lockedOf(desk) === 0n && await lockedOf(phone) === 0n,
        `${ await freeOf(desk) } ${ await freeOf(phone) }`);

    console.log('\n[the wallet page after the game, and the winnings taken out]');

    for (const [who, held, word] of [[desk, PUT_IN - STAKE + share, 'vault.games.won'], [phone, PUT_IN - STAKE, 'vault.games.lost']])
    {
        await openWallet(who);
        record(`${ who.label }: the page shows ${ held } NURA in the vault`, await waitFor(async () => await figure(who, 'vault.free') === String(held), 10_000), `${ await figure(who, 'vault.free') }`);
        record(`${ who.label }: and lists the game as ${ who.words[word] }`, await waitFor(async () => (await shown(who)).includes(latin(who.words[word])), 10_000));
    }

    const before = await reader.getBalance({ address: desk.account.address });
    const out = await move(desk, 'out', null);
    const after = await reader.getBalance({ address: desk.account.address });

    record('the winner takes all of it out from the wallet page, and the page says it is in their wallet', out);
    record('the vault holds nothing of theirs and the wallet holds it, less the gas', await freeOf(desk) === 0n && after - before > (PUT_IN - STAKE + share) * WEI - WEI / 100n,
        `${ await freeOf(desk) } ${ after - before }`);
    record('and the page shows the vault empty', await waitFor(async () => await figure(desk, 'vault.free') === '0', 10_000), `${ await figure(desk, 'vault.free') }`);
    record('the wallet was asked to send two transactions, NURA in and out, and to sign one stake',
        desk.wallet.asked.filter((one) => one === 'eth_sendTransaction').length === 2 && desk.wallet.asked.filter((one) => one === 'eth_signTypedData_v4').length === 1,
        `${ desk.wallet.asked.filter((one) => one === 'eth_sendTransaction').length } sent, ${ desk.wallet.asked.filter((one) => one === 'eth_signTypedData_v4').length } signed`);
}
catch (error)
{
    record('the pass ran to its end', false, error instanceof Error ? error.message.split('\n')[0] : String(error));
}
finally
{
    record('no page said anything in its console, and nothing it asked for was refused', desk.errors.length === 0 && phone.errors.length === 0 && desk.refused.length === 0 && phone.refused.length === 0,
        [...desk.errors, ...phone.errors, ...desk.refused, ...phone.refused].slice(0, 6).join(' | '));
    await browser.close();
}

finish();
