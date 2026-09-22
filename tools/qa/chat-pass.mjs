/**
 * Two enrolled browsers in one thread, watching what a message ARRIVING does to the page.
 *
 *   npm run build && API_RATE_MAX=20000 SERVE_PAGES=true NODE_ENV=production PORT=5300 \
 *     PUBLIC_ORIGIN=http://localhost:5300 npm start
 *   QA_BASE=http://localhost:5300 node tools/qa/chat-pass.mjs
 *
 * It exists because of a flicker reported from a real browser that no gate could see. `npm run qa`
 * tours the chat route in 680 cells and never sends anything; `seal-pass.mjs` sends but looks at
 * whether the message arrives, not at what the page does while it does. The defect was in between:
 * a refetch tore the seal notice out and rebuilt it, shifting the thread, and disabled the composer
 * while it ran - so a focused textarea was blurred mid-sentence and a phone keyboard dropped.
 *
 * Both halves have to be REAL. A message can only be posted sealed - a raw api call is refused 422
 * - so the sender is a browser that enrolled through the real button, and the watcher is a second
 * browser that never touches anything. Everything asserted is asserted in the watcher, because a
 * page that only misbehaves for the person typing is not the case that was reported.
 *
 * The measurement is a MutationObserver rather than a screenshot, and that is the whole reason this
 * works: the page was rebuilt INSIDE one frame. Sampling the DOM twenty times a second found the
 * composer present on every single tick - there was no blink to catch - while the observer counted
 * the textarea being destroyed and a new one put in its place. A screenshot either side is
 * identical. What a person sees is the keyboard closing and the caret gone mid-sentence.
 */
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { privateKeyToAccount } from 'viem/accounts';

import { WALLET_FIXTURES } from '../../server/src/db/wallet-fixtures.ts';
import { sql as run } from './db.mjs';

function cachedChromium()
{
    const home = process.env.LOCALAPPDATA ?? process.env.HOME ?? '';
    const cache = process.env.PLAYWRIGHT_BROWSERS_PATH ?? join(home, 'ms-playwright');
    if (!existsSync(cache)) { return undefined; }
    const builds = readdirSync(cache).filter((name) => /^chromium-\d+$/.test(name))
        .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]));
    for (const build of builds)
    {
        for (const rel of ['chrome-win64/chrome.exe', 'chrome-win/chrome.exe', 'chrome-linux/chrome'])
        {
            const candidate = join(cache, build, rel);
            if (existsSync(candidate)) { return candidate; }
        }
    }
    return undefined;
}

const BASE = process.env.QA_BASE ?? 'http://localhost:5300';

/** How long a nudge, a refetch and a re-render may take before the watcher is expected to agree. */
const SETTLE_MS = 3000;

/**
 * Both accounts start with no device, which is the only way BOTH browsers can seal.
 *
 * Every device after an account's first arrives `pending`, and a pending device is in nobody's
 * recipient set - it can neither seal nor open. A fresh browser context has an empty keyring, so
 * without this the second run of this pass enrols a second device and the composer stays disabled;
 * the first run passes and every run after it fails, which is the worst kind of harness.
 *
 * `omid.k` is emptied as well as `dana.w`, and that is the difference from `seal-pass`. That one
 * only ever needs the near end to seal; this one needs the far end to OPEN what arrives, and a
 * seeded fixture device is one whose private half nobody holds.
 *
 * The epochs and the sealed messages go with them: an epoch wrapped to devices that no longer exist
 * is one nothing can adopt, and a text row whose key is gone renders as a locked bubble forever.
 */
function emptyBothAccounts(handles)
{
    const names = handles.map((one) => `'${ one }'`).join(', ');

    run([
        'delete from conversation_epochs',
        "delete from messages where kind = 'text'",
        `delete from epoch_archive where user_id in (select id from users where handle in (${ names }))`,
        `delete from recovery_vaults where user_id in (select id from users where handle in (${ names }))`,
        `delete from devices where user_id in (select id from users where handle in (${ names }))`
    ].join('; '));
}

const executablePath = cachedChromium();
const browser = await chromium.launch(executablePath === undefined ? {} : { executablePath });

const results = [];
const record = (name, ok, detail) =>
{
    results.push({ name, ok, detail });
    console.log(`  ${ ok ? 'PASS' : 'FAIL' }  ${ name }${ detail ? ' — ' + detail : '' }`);
};

/**
 * A browser signed in as a fixture, with that fixture's wallet injected.
 *
 * `dana.w` is the account with no seeded device, so it enrols its own and that enrolment is the
 * real path. The others hold a device whose private half nobody has, which is the honest shape for
 * the far end of a conversation and exactly wrong for the near end - so every seat here that has to
 * SEND gets its own empty keyring and enrols.
 */
async function seat(handle)
{
    const fixture = WALLET_FIXTURES.find((one) => one.handle === handle);

    if (fixture === undefined)
    {
        throw new Error(`chat-pass: no wallet fixture called ${ handle }`);
    }

    const wallet = privateKeyToAccount(fixture.privateKey);
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'en-US' });

    await context.addInitScript(() =>
    {
        try { localStorage.setItem('nura-games.locale', 'en'); }
        catch { /* a refused store is a state the product handles */ }

        const provider = {
            async request({ method, params })
            {
                if (method === 'eth_requestAccounts' || method === 'eth_accounts') { return [window.__walletAddress]; }
                if (method === 'eth_chainId') { return '0x1'; }
                if (method === 'personal_sign') { return window.__walletSign(params[0]); }
                if (method === 'wallet_switchEthereumChain' || method === 'wallet_addEthereumChain') { return null; }
                throw Object.assign(new Error(`unsupported ${ method }`), { code: 4200 });
            },
            on() {},
            removeListener() {}
        };

        window.ethereum = provider;

        const announce = () => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', {
            detail: { info: { uuid: 'nura-test', name: 'MetaMask', icon: '', rdns: 'io.metamask' }, provider }
        }));

        window.addEventListener('eip6963:requestProvider', announce);
        announce();
    });

    await context.addInitScript((address) => { window.__walletAddress = address; }, wallet.address);
    await context.exposeFunction('__walletSign', (message) => wallet.signMessage({ message }));

    const issued = await context.request.post(`${ BASE }/api/auth/challenge`, { data: { address: wallet.address } });

    if (!issued.ok())
    {
        throw new Error(`chat-pass: no challenge for ${ handle } (${ issued.status() }). Is the api running?`);
    }

    const challenge = await issued.json();
    const signedIn = await context.request.post(`${ BASE }/api/auth/wallet`, {
        data: { address: wallet.address, nonce: challenge.nonce, signature: await wallet.signMessage({ message: challenge.message }) }
    });

    if (!signedIn.ok())
    {
        throw new Error(`chat-pass: could not sign in as ${ handle } (${ signedIn.status() }). Has seedWalletFixtures run?`);
    }

    const page = await context.newPage();
    const errors = [];

    page.on('console', (event) =>
    {
        if (event.type() === 'error' && !event.text().includes('favicon')) { errors.push(`${ handle }: ${ event.text().slice(0, 160) }`); }
    });
    page.on('pageerror', (error) => errors.push(`${ handle }: ${ String(error).slice(0, 160) }`));

    return { handle, context, page, errors, request: context.request };
}

/**
 * Watches the one thing a screenshot cannot show: a subtree being REMOVED.
 *
 * `composerGone` counts the times the textarea left the document, and `noticeGone` the times the
 * seal notice did. Either is a rebuild rather than an update, and a rebuild is what moves the page
 * under somebody's finger. `composerDisabled` is sampled rather than observed, because disabling is
 * an attribute change on an element that stays put - and it is the half that drops a keyboard.
 */
async function watchFor(page)
{
    await page.evaluate(() =>
    {
        const state = { composerGone: 0, noticeGone: 0, composerDisabled: 0, blurred: 0, scrollJumps: 0, what: [] };

        window.__watch = state;

        const main = document.querySelector('main');
        const textarea = document.querySelector('main textarea');

        if (textarea !== null)
        {
            textarea.focus();
            textarea.addEventListener('blur', () => { state.blurred += 1; });

            new MutationObserver(() =>
            {
                if (textarea.disabled) { state.composerDisabled += 1; }
            }).observe(textarea, { attributes: true, attributeFilter: ['disabled'] });
        }

        if (main !== null)
        {
            new MutationObserver((records) =>
            {
                for (const record of records)
                {
                    for (const gone of record.removedNodes)
                    {
                        if (!(gone instanceof HTMLElement)) { continue; }
                        if (gone.tagName === 'TEXTAREA' || gone.querySelector('textarea') !== null)
                        {
                            state.composerGone += 1;
                            state.what.push(`${ gone.tagName }.${ String(gone.className).slice(0, 50) } parent=${ record.target.tagName }.${ String(record.target.className).slice(0, 40) }`);
                        }
                        if (gone.textContent?.includes('sealed') === true) { state.noticeGone += 1; }
                    }
                }
            }).observe(main, { childList: true, subtree: true });
        }

        const scroller = [...document.querySelectorAll('main *')]
            .find((node) => node.scrollHeight > node.clientHeight + 40 && getComputedStyle(node).overflowY !== 'visible');

        if (scroller !== undefined)
        {
            let last = scroller.scrollTop;

            scroller.addEventListener('scroll', () =>
            {
                if (Math.abs(scroller.scrollTop - last) > 60) { state.scrollJumps += 1; }
                last = scroller.scrollTop;
            });
        }
    });
}

const pressable = async (page, name) =>
{
    const button = page.getByRole('button', { name }).first();

    return await button.isVisible().catch(() => false) ? button : null;
};

/** Enrols this browser if it holds no keys yet, which every fresh context does. */
async function enrol(who)
{
    /*
     * Two doors say the same thing and either may be the one on screen: the shell's keys banner
     * offers "Give it keys" on every route, and the seal notice above a composer this browser
     * cannot use offers "Give this browser keys". Whichever is there, pressing it is the real
     * enrolment - the same button a person presses, signing with the injected wallet.
     */
    const button = await pressable(who.page, /Give it keys|Give this browser keys/i);

    if (button === null)
    {
        return false;
    }

    await button.click();
    await who.page.waitForTimeout(SETTLE_MS * 2);

    return true;
}

const sender = await seat('dana.w');
let watcher = null;

try
{
    // ---------------------------------------------------------------- 1. a thread with two people
    console.log('\n[1] a sealed thread both browsers can see');

    const threads = await (await sender.request.get(`${ BASE }/api/chat/`)).json();
    const direct = (threads.conversations ?? []).find((one) => one.kind === 'direct');

    record('the seed left a direct thread to open', direct !== undefined);

    if (direct === undefined)
    {
        throw new Error('chat-pass: no direct conversation; has seedWalletFixtures run?');
    }

    const other = (direct.members ?? []).map((one) => one.handle ?? one).find((one) => one !== 'dana.w');

    record('and it has somebody on the other side', other !== undefined, String(other));

    emptyBothAccounts(['dana.w', other]);

    record('both accounts start with no device, so each enrolment is a first one', true, `dana.w, ${ other }`);

    watcher = await seat(other);

    await sender.page.goto(`${ BASE }/app/chats/${ direct.id }`, { waitUntil: 'networkidle' });
    await watcher.page.goto(`${ BASE }/app/chats/${ direct.id }`, { waitUntil: 'networkidle' });
    await sender.page.waitForTimeout(SETTLE_MS);

    const gaveSender = await enrol(sender);
    const gaveWatcher = await enrol(watcher);

    record('both browsers were offered the real enrolment button', gaveSender && gaveWatcher,
        `sender ${ gaveSender }, watcher ${ gaveWatcher }`);

    await sender.page.reload({ waitUntil: 'networkidle' });
    await watcher.page.reload({ waitUntil: 'networkidle' });
    await sender.page.waitForTimeout(SETTLE_MS);

    const canType = await sender.page.evaluate(() => document.querySelector('main textarea')?.disabled === false);

    record('the sending browser can type in the thread', canType);

    if (!canType)
    {
        const why = await sender.page.evaluate(() =>
            [...document.querySelectorAll('main p, main div')]
                .map((node) => node.textContent?.trim() ?? '')
                .find((text) => /seal|wallet|browser|key/i.test(text) && text.length < 200) ?? 'no notice found');

        throw new Error(`chat-pass: the composer is disabled, so nothing can be sent - ${ why }`);
    }

    // ---------------------------------------------------------------- 2. the watcher holds still
    console.log('\n[2] a message arrives, and the page under it holds still');

    await watchFor(watcher.page);

    const composer = sender.page.locator('main textarea');

    if (await composer.isVisible().catch(() => false))
    {
        await composer.fill('chat pass, holding still');
        await composer.press('Enter');
    }

    await watcher.page.waitForTimeout(SETTLE_MS * 2);

    const seen = await watcher.page.evaluate(() => window.__watch);
    const arrived = await watcher.page.evaluate(() =>
        document.querySelector('main')?.textContent?.includes('holding still') === true);

    record('the message reaches the other browser', arrived);

    /*
     * The four claims this pass exists for. Each was false before `seal.store.ts` learned that
     * loading means "nothing to show yet" rather than "a request is in flight".
     */
    record('the composer is never torn out and rebuilt', seen.composerGone === 0, `${ seen.composerGone } rebuilds ${ JSON.stringify(seen.what) }`);
    record('the seal notice is never torn out and rebuilt', seen.noticeGone === 0, `${ seen.noticeGone } rebuilds`);
    record('the composer is never disabled while a message lands', seen.composerDisabled === 0, `${ seen.composerDisabled } times`);
    record('and a focused textarea keeps its focus', seen.blurred === 0, `${ seen.blurred } blurs`);
    record('the thread does not jump under the reader', seen.scrollJumps === 0, `${ seen.scrollJumps } jumps`);

    // ---------------------------------------------------------------- 3. the console
    console.log('\n[3] the console, in both browsers');
    record('nothing was logged', sender.errors.length === 0 && watcher.errors.length === 0,
        [...sender.errors, ...watcher.errors].slice(0, 2).join(' | '));
}
finally
{
    await sender.context.close();
    if (watcher !== null) { await watcher.context.close(); }
    await browser.close();
}

const failed = results.filter((one) => !one.ok);

console.log('\n------------------------------------------');
console.log(`chat pass: ${ failed.length === 0 ? 'clean' : `${ failed.length } FAILED` }, ${ results.length } checks`);

if (failed.length > 0)
{
    for (const one of failed)
    {
        console.log(`  FAIL  ${ one.name }${ one.detail ? ' — ' + one.detail : '' }`);
    }
    process.exitCode = 1;
}
