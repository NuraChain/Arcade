/**
 * The browser pass for behaviour no other gate can see, run by hand against the BUILT server.
 *
 *   npm run build && API_RATE_MAX=20000 SERVE_PAGES=true NODE_ENV=production npm start
 *   node tools/qa/regression-pass.mjs
 *
 * `npm run qa` tours 640 cells for overflow, hit targets, a `main` landmark and a clean console;
 * every check here is one that matrix passes while the product is wrong. A page confidently
 * scrolled to the top, a thread that says it does not exist while it is still loading, a button
 * that stays spinning after the server says no - all four gates stay green through every one.
 *
 * The wallet is an injected EIP-1193 provider over a hardhat key, the same shape
 * `seal-pass.mjs` uses. The signatures are real and this server verifies them like anybody's;
 * what is skipped is the extension UI, not the cryptography.
 */
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { privateKeyToAccount } from 'viem/accounts';

function cachedChromium()
{
    const home = process.env.LOCALAPPDATA ?? process.env.HOME ?? '';
    const cache = process.env.PLAYWRIGHT_BROWSERS_PATH ?? join(home, 'ms-playwright');
    if (!existsSync(cache)) { return undefined; }
    const builds = readdirSync(cache).filter((n) => /^chromium-\d+$/.test(n))
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

const BASE = process.env.QA_BASE ?? 'http://localhost:3200';
const wallet = privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80');

const executablePath = cachedChromium();
const browser = await chromium.launch(executablePath === undefined ? {} : { executablePath });

const results = [];
const record = (name, ok, detail) =>
{
    results.push({ name, ok, detail });
    console.log(`  ${ ok ? 'PASS' : 'FAIL' }  ${ name }${ detail ? ' — ' + detail : '' }`);
};

async function open({ width = 1280, height = 900, locale = 'en' } = {})
{
    const context = await browser.newContext({
        viewport: { width, height },
        locale: locale === 'fa' ? 'fa-IR' : 'en-US'
    });

    await context.addCookies([{ name: 'locale', value: locale, url: BASE }]);

    await context.addInitScript(() =>
    {
        const provider = {
            isNuraTest: true,
            async request({ method, params })
            {
                if (method === 'eth_requestAccounts' || method === 'eth_accounts')
                {
                    return [window.__walletAddress];
                }
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

    const page = await context.newPage();
    const errors = [];
    const apiFailures = [];
    page.on('console', (e) =>
    {
        if (e.type() === 'error' && !e.text().includes('favicon'))
        {
            errors.push(e.text().slice(0, 160));
        }
    });
    page.on('pageerror', (e) => errors.push(String(e).slice(0, 160)));
    page.on('response', (r) =>
    {
        if (r.url().includes('/api/') && r.status() >= 400)
        {
            apiFailures.push(`${ r.status() } ${ r.request().method() } ${ new URL(r.url()).pathname }`);
        }
    });
    return { context, page, errors, apiFailures };
}

const signInWithWallet = async (page) =>
{
    await page.goto(`${ BASE }/sign-in`, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: /^(Connect|اتصال)/ }).first().click();
    await page.waitForURL(/\/app/, { timeout: 30000 });
};

// ------------------------------------------------------------------ 1. wallet sign-in
console.log('\n[1] wallet sign-in (real EIP-4361 round trip)');
{
    const { context, page, errors } = await open();
    try
    {
        await signInWithWallet(page);
        record('signs in with a wallet', page.url().includes('/app'), page.url().replace(BASE, ''));
        record('console clean on sign-in', errors.length === 0, errors.slice(0, 3).join(' ; '));
    }
    catch (e)
    {
        record('signs in with a wallet', false, String(e.message).slice(0, 120));
    }
    await context.close();
}

// ------------------------------------------------------------------ 2. chat cold load
console.log('\n[2] chat cold load — the thread is loading, not missing');
{
    const { context, page, errors } = await open();
    try
    {
        await signInWithWallet(page);
        await page.goto(`${ BASE }/app/chats`, { waitUntil: 'networkidle' });
        await page.waitForTimeout(1500);

        const firstThread = page.locator('a[href^="/app/chats/"]').first();
        const href = await firstThread.getAttribute('href').catch(() => null);
        if (!href)
        {
            record('found a conversation to open', false, 'no chat links on the list');
        }
        else
        {
            // A COLD load of the thread url: the list has not arrived, which is exactly
            // the window that used to render "No such conversation".
            await page.goto(`${ BASE }${ href }`);
            await page.waitForTimeout(250);
            const early = await page.locator('body').innerText().catch(() => '');
            const cried = /No such conversation|گفتگویی با این نشانی نیست/i.test(early);
            record('no "No such conversation" flash on cold load', !cried, cried ? early.slice(0, 90) : href);

            await page.waitForTimeout(3000);
            const late = await page.locator('body').innerText().catch(() => '');
            record('the thread resolves after loading', !/No such conversation/i.test(late), '');
            record('console clean in chat', errors.length === 0, errors.slice(0, 3).join(' ; '));
        }
    }
    catch (e)
    {
        record('chat cold load', false, String(e.message).slice(0, 120));
    }
    await context.close();
}

// ------------------------------------------------------------------ 3. guest sign-in
console.log('\n[3] guest sign-in — refuses locally, and never gets stuck');
{
    const { context, page, errors } = await open();
    try
    {
        await page.goto(`${ BASE }/sign-in`, { waitUntil: 'networkidle' });
        const box = page.locator('#sign-in-name');
        const submit = page.locator('form button[type="submit"]').first();

        const apiCalls = [];
        page.on('request', (r) => { if (r.url().includes('/auth/guest')) { apiCalls.push(r.url()); } });

        await box.fill('admin');
        await submit.click();
        await page.waitForTimeout(1200);
        let text = await page.locator('body').innerText();
        record('a reserved name is refused in the browser',
            /kept for the product itself/i.test(text) && apiCalls.length === 0,
            apiCalls.length ? `asked the server ${ apiCalls.length }x` : 'no request made');
        record('the button is still usable after a refusal', await submit.isEnabled(), '');

        await box.fill('...');
        await submit.click();
        await page.waitForTimeout(1000);
        text = await page.locator('body').innerText();
        record('a name that folds to nothing is refused',
            /at least three letters or digits/i.test(text) && apiCalls.length === 0, '');

        await box.fill('Testy Tester');
        await submit.click();
        await page.waitForURL(/\/app/, { timeout: 20000 });
        record('a good name signs in', page.url().includes('/app'), page.url().replace(BASE, ''));
        record('console clean on guest sign-in', errors.length === 0, errors.slice(0, 3).join(' ; '));
    }
    catch (e)
    {
        record('guest sign-in', false, String(e.message).slice(0, 120));
    }
    await context.close();
}

// ------------------------------------------------------------------ 4. guest settings
console.log('\n[4] the guest seat — no button that signs you out under a wallet label');
{
    const { context, page, errors } = await open();
    try
    {
        await page.goto(`${ BASE }/sign-in`, { waitUntil: 'networkidle' });
        await page.locator('#sign-in-name').fill('Seat Tester');
        await page.locator('form button[type="submit"]').first().click();
        await page.waitForURL(/\/app/, { timeout: 20000 });

        await page.goto(`${ BASE }/app/me/settings`, { waitUntil: 'networkidle' });
        await page.waitForTimeout(1500);
        const text = await page.locator('body').innerText();
        record('settings offers no "Connect a wallet"', !/Connect a wallet/i.test(text), '');
        const card = page.locator('section#settings-account');
        const signOuts = await card.getByRole('button', { name: /^Sign out$/ }).count();
        const primaries = await card.locator('button').count();
        record('the account card has exactly one sign-out', signOuts === 1, `found ${ signOuts } of ${ primaries } buttons`);

        await page.goto(`${ BASE }/app/me`, { waitUntil: 'networkidle' });
        await page.waitForTimeout(1200);
        const me = await page.locator('body').innerText();
        record('the profile says the seat is this browser', /This seat is this browser/i.test(me), '');
        record('it no longer promises the seat follows you', !/follow you to any device/i.test(me), '');
        record('console clean on settings', errors.length === 0, errors.slice(0, 3).join(' ; '));
    }
    catch (e)
    {
        record('guest settings', false, String(e.message).slice(0, 120));
    }
    await context.close();
}

// ------------------------------------------------------------------ 5. scroll restore
console.log('\n[5] scroll memory — back lands where you left, not at the top');
{
    const { context, page } = await open({ width: 390, height: 640 });
    try
    {
        await signInWithWallet(page);
        await page.goto(`${ BASE }/app/me/settings`, { waitUntil: 'networkidle' });
        await page.waitForTimeout(2000);

        const scroller = page.locator('.page').first();
        const reach = await scroller.evaluate((el) => ({ height: el.scrollHeight, view: el.clientHeight }));
        if (reach.height <= reach.view + 40)
        {
            record('a list long enough to scroll', false, `content ${ reach.height }px in ${ reach.view }px`);
        }
        else
        {
            const target = Math.min(200, reach.height - reach.view);
            await scroller.evaluate((el, y) => { el.scrollTop = y; }, target);
            await page.waitForTimeout(900);
            const before = await scroller.evaluate((el) => el.scrollTop);

            await page.getByRole('link', { name: /Chats|گفتگو/ }).first().click().catch(async () =>
            {
                await page.goto(`${ BASE }/app/chats`);
            });
            await page.waitForTimeout(2200);
            await page.goBack();
            await page.waitForTimeout(2500);

            const after = await page.locator('.page').first().evaluate((el) => el.scrollTop);
            record('back restores the scroll position', Math.abs(after - before) <= 24,
                `left at ${ Math.round(before) }px, came back to ${ Math.round(after) }px`);
        }
    }
    catch (e)
    {
        record('scroll memory', false, String(e.message).slice(0, 140));
    }
    await context.close();
}

// ------------------------------------------------------------------ 6. table rules
console.log('\n[6] the server decides what a table may be');
{
    const { context, page } = await open();
    try
    {
        await signInWithWallet(page);
        const attempts = await page.evaluate(async () =>
        {
            const post = async (body) =>
            {
                const r = await fetch('/api/tables', {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify(body)
                });
                return { status: r.status, body: (await r.text()).slice(0, 120) };
            };
            /*
             * Every config here names LUDO, because ludo is the only game with an engine and the
             * only one `games.status` calls available - the others are `coming-soon`, and
             * `table.create` joins `games` on that status, so a hokm table is refused for a reason
             * that has nothing to do with the config being checked. Pointing the legal case at a
             * game the server will not open is how this check came to assert 422 and pass.
             */
            const legal = { game: 'ludo', seats: 4, mode: 'live', privacy: 'invite', target: 0, cube: false, blinds: 'low', chat: true, voice: false, invitees: [] };
            return {
                badSeats: await post({ ...legal, seats: 5 }),
                badMode: await post({ ...legal, mode: 'nonsense' }),
                legalTable: await post({ ...legal, seats: 2 }),
                hugeSeats: await post({ ...legal, seats: 99999 }),
                noGame: await post({ ...legal, game: 'not-a-game' })
            };
        });

        for (const [name, r] of Object.entries(attempts))
        {
            if (name === 'legalTable')
            {
                record('still opens a table the game really plays', r.status === 200, `${ r.status }`);
                continue;
            }
            const ok = r.status >= 400 && r.status < 500;
            record(`refuses ${ name } with a 4xx, never a 500`, ok, `${ r.status } ${ r.body.slice(0, 70) }`);
        }
    }
    catch (e)
    {
        record('table rules', false, String(e.message).slice(0, 140));
    }
    await context.close();
}


// ------------------------------------------------------------------ 7. the Persian half
console.log('\n[7] Persian — the new copy exists in both languages');
{
    const { context, page, errors } = await open({ locale: 'fa', width: 390, height: 700 });
    try
    {
        await page.goto(`${ BASE }/sign-in`, { waitUntil: 'networkidle' });
        await page.waitForTimeout(1200);
        const dir = await page.locator('html').getAttribute('dir');
        record('the page reads right to left', dir === 'rtl', `dir=${ dir }`);

        await page.locator('#sign-in-name').fill('admin');
        await page.locator('form button[type="submit"]').first().click();
        await page.waitForTimeout(1200);
        const refused = await page.locator('body').innerText();
        record('a reserved name is refused in Persian', refused.includes('برای خودِ محصول نگه داشته شده'), '');

        await page.locator('#sign-in-name').fill('مهمان تستی');
        await page.locator('form button[type="submit"]').first().click();
        await page.waitForURL(/\/app/, { timeout: 20000 });

        await page.goto(`${ BASE }/app/me`, { waitUntil: 'networkidle' });
        await page.waitForTimeout(1500);
        const me = await page.locator('body').innerText();
        record('the guest seat copy is Persian too', me.includes('این صندلی، همین مرورگر است'), '');

        await page.goto(`${ BASE }/app/me/settings`, { waitUntil: 'networkidle' });
        await page.waitForTimeout(1200);
        const settings = await page.locator('body').innerText();
        record('settings offers no wallet button in Persian', !settings.includes('اتصال کیف پول'), '');
        record('console clean in Persian', errors.length === 0, errors.slice(0, 3).join(' ; '));
    }
    catch (e)
    {
        record('persian pass', false, String(e.message).slice(0, 140));
    }
    await context.close();
}

// ------------------------------------------------------------------ 8. the wallet chooser
console.log('\n[8] sign-in offers more than one wallet');
{
    const { context, page, errors } = await open();
    try
    {
        await page.goto(`${ BASE }/sign-in`, { waitUntil: 'networkidle' });
        await page.waitForTimeout(2000);

        const other = page.getByRole('button', { name: /Use a different wallet/i }).first();
        record('sign-in offers a way to pick another wallet', await other.count() > 0, '');

        await other.click();
        await page.waitForTimeout(2500);
        const shown = await page.locator('body').innerText();

        // The injected provider announces only io.metamask, so MetaMask is the present one and the
        // other two have to be offered as something rather than omitted.
        record('the chooser lists MetaMask', /MetaMask/.test(shown), '');
        record('the chooser lists Trust Wallet', /Trust Wallet/.test(shown), '');
        record('the chooser lists Nura Wallet', /Nura Wallet/.test(shown), '');
        record('console clean with the chooser open', errors.length === 0, errors.slice(0, 3).join(' ; '));
    }
    catch (e)
    {
        record('wallet chooser', false, String(e.message).slice(0, 140));
    }
    await context.close();
}

// ------------------------------------------------------------------ 9. the landing CTA
console.log('\n[9] the landing offers the way BACK to somebody already signed in');
{
    /*
     * The matrix tours `/` six hundred times and never sees this, because every context it builds
     * is signed in and it only ever reads overflow, hit targets, a landmark and the console - and
     * "Connect wallet" in front of somebody who is already connected is none of those. It is the
     * same blind spot the guest settings check exists for, from the other end.
     *
     * The structural half matters more than the copy: signed out the control is a BUTTON that
     * opens the chooser, and returning it is a LINK to /app. A check on the words alone would pass
     * against a button that says Play and does nothing.
     *
     * `exact` is not decoration. Playwright matches an accessible name by SUBSTRING unless told
     * otherwise, and the Persian brand mark is `بازی‌های نورا` - which contains `بازی`, the word
     * this check looks for. Without it the brand link answered for the CTA, so the signed-out cell
     * reported a link to the app that was not there and the returning cell passed on an href of
     * `/`. English said nothing, because `Play` is not a substring of `Nura Games`.
     */
    for (const locale of ['en', 'fa'])
    {
        const connect = locale === 'fa' ? 'اتصال کیف پول' : 'Connect wallet';
        const enter = locale === 'fa' ? 'بازی' : 'Play';

        const fresh = await open({ locale });
        try
        {
            await fresh.page.goto(`${ BASE }/`, { waitUntil: 'networkidle' });
            await fresh.page.waitForTimeout(1200);

            const header = fresh.page.locator('header').first();
            record(`[${ locale }] signed out, the header offers the wallet chooser`,
                await header.getByRole('button', { name: connect, exact: true }).count() > 0, '');
            record(`[${ locale }] signed out, the header does not link to /app`,
                await header.getByRole('link', { name: enter, exact: true }).count() === 0, '');
        }
        catch (e)
        {
            record(`[${ locale }] signed-out landing CTA`, false, String(e.message).slice(0, 140));
        }
        await fresh.context.close();

        const back = await open({ locale });
        try
        {
            await signInWithWallet(back.page);

            await back.page.goto(`${ BASE }/`, { waitUntil: 'networkidle' });
            await back.page.waitForTimeout(1200);

            const header = back.page.locator('header').first();
            const way = header.getByRole('link', { name: enter, exact: true }).first();

            record(`[${ locale }] returning, the header offers the way in`, await way.count() > 0, '');
            record(`[${ locale }] returning, it is a link to /app`,
                (await way.count() > 0) && (await way.getAttribute('href')) === '/app',
                await way.count() > 0 ? String(await way.getAttribute('href')) : 'absent');
            record(`[${ locale }] returning, no wallet chooser in the header`,
                await header.getByRole('button', { name: connect, exact: true }).count() === 0, '');

            /*
             * Pressed rather than merely read: a link whose href is right and whose click is
             * swallowed is the shape `lib/open-table.ts` exists to stop, and nothing else here
             * would notice it.
             */
            await way.click();
            await back.page.waitForURL(/\/app/, { timeout: 15000 });
            record(`[${ locale }] pressing it lands in the app`, back.page.url().includes('/app'),
                back.page.url().replace(BASE, ''));
            record(`[${ locale }] console clean across the round trip`, back.errors.length === 0,
                back.errors.slice(0, 3).join(' ; '));
        }
        catch (e)
        {
            record(`[${ locale }] returning landing CTA`, false, String(e.message).slice(0, 140));
        }
        await back.context.close();
    }
}

console.log('\n[10] the landing asks the server for nothing, rests when nothing moves, and stays readable');
{
    const fresh = await open({ locale: 'en', width: 390, height: 844 });
    const asked = [];
    fresh.page.on('request', (request) =>
    {
        const path = new URL(request.url()).pathname;
        if (path.startsWith('/api') || path.startsWith('/ws'))
        {
            asked.push(path);
        }
    });
    fresh.page.on('websocket', (socket) => asked.push(new URL(socket.url()).pathname));
    try
    {
        await fresh.page.goto(`${ BASE }/`, { waitUntil: 'networkidle' });
        const shape = await fresh.page.evaluate(() => ({
            h1: document.querySelectorAll('h1').length,
            beats: [...document.querySelectorAll('[data-beat]')].map((element) => element.dataset.beat)
        }));
        record('the landing has one h1', shape.h1 === 1, `${ shape.h1 }`);
        record('the landing carries its five beats in order', shape.beats.join(',') === 'arrival,games,together,compete,finale', shape.beats.join(','));
        record('signed out, the arrival offers a button that opens the chooser',
            await fresh.page.locator('main').getByRole('button', { name: 'Start playing', exact: true }).count() > 0, '');

        for (let step = 0; step < 8; step += 1)
        {
            await fresh.page.mouse.wheel(0, 700);
            await fresh.page.waitForTimeout(150);
        }
        await fresh.page.evaluate(() => window.scrollTo(0, 0));

        await fresh.page.getByRole('button', { name: 'Menu', exact: true }).click();
        await fresh.page.waitForSelector('dialog.site-drawer[open]', { timeout: 5000 });
        record('the menu opens a drawer', true, '');
        await fresh.page.keyboard.press('Escape');
        await fresh.page.waitForTimeout(400);
        await fresh.page.getByRole('button', { name: 'Menu', exact: true }).click();
        await fresh.page.waitForSelector('dialog.site-drawer[open]', { timeout: 5000 });
        await fresh.page.locator('dialog.site-drawer').getByRole('radio', { name: 'فارسی' }).or(fresh.page.locator('dialog.site-drawer').getByRole('button', { name: 'فارسی' })).first().click();
        await fresh.page.waitForFunction(() => document.documentElement.lang === 'fa', null, { timeout: 5000 });
        await fresh.page.waitForTimeout(600);
        const title = await fresh.page.locator('h1').innerText();
        record('the language switch turns the page Persian in place', title.includes('بازی‌های همیشگی'), title.replace(/\s+/g, ' ').slice(0, 60));
        record('the landing made no request to the api or the socket', asked.length === 0, asked.slice(0, 4).join(' '));
        record('console clean on the landing', fresh.errors.length === 0, fresh.errors.slice(0, 3).join(' ; '));
    }
    catch (e)
    {
        record('landing tour', false, String(e.message).slice(0, 140));
    }
    await fresh.context.close();

    for (const [label, headers] of [['a cookie', { cookie: 'locale=fa' }], ['Accept-Language', { 'accept-language': 'fa-IR,fa;q=0.9' }]])
    {
        const html = await (await fetch(`${ BASE }/`, { headers })).text();
        record(`with no JavaScript, ${ label } gets the Persian page`,
            /<html[^>]*lang="fa"/.test(html) && /<html[^>]*dir="rtl"/.test(html) && html.includes('بازی‌های همیشگی') && !html.includes('Classic games'), '');
    }

    const gpu = await chromium.launch({
        ...(executablePath === undefined ? {} : { executablePath }),
        headless: false,
        args: ['--use-angle=d3d11', '--window-position=-2400,0']
    });

    const luminance = async (png, boxes) =>
    {
        const page = await gpu.newPage();
        const result = await page.evaluate(async ({ source, boxes }) =>
        {
            const image = new Image();
            image.src = source;
            await image.decode();
            const canvas = document.createElement('canvas');
            canvas.width = image.naturalWidth;
            canvas.height = image.naturalHeight;
            const context = canvas.getContext('2d');
            context.drawImage(image, 0, 0);
            const linear = (value) =>
            {
                const channel = value / 255;
                return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
            };
            const of = (r, g, b) => 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
            return boxes.map((box) =>
            {
                const x = Math.max(0, Math.floor(box.x));
                const y = Math.max(0, Math.floor(box.y));
                const width = Math.min(canvas.width - x, Math.ceil(box.width));
                const height = Math.min(canvas.height - y, Math.ceil(box.height));
                if (width <= 0 || height <= 0)
                {
                    return null;
                }
                const data = context.getImageData(x, y, width, height).data;
                let brightest = 0;
                for (let index = 0; index < data.length; index += 4)
                {
                    brightest = Math.max(brightest, of(data[index], data[index + 1], data[index + 2]));
                }
                const [r, g, b] = box.colour;
                const ink = of(r, g, b);
                return (Math.max(ink, brightest) + 0.05) / (Math.min(ink, brightest) + 0.05);
            });
        }, { source: `data:image/png;base64,${ png.toString('base64') }`, boxes });
        await page.close();
        return result;
    };

    for (const [locale, width, height] of [['en', 1440, 900], ['fa', 1440, 900], ['en', 390, 844]])
    {
        const context = await gpu.newContext({ viewport: { width, height } });
        await context.addCookies([{ name: 'locale', value: locale, url: BASE }]);
        await context.addInitScript(() =>
        {
            const original = window.requestAnimationFrame.bind(window);
            window.__frames = 0;
            window.requestAnimationFrame = (callback) =>
            {
                window.__frames += 1;
                return original(callback);
            };
        });
        const page = await context.newPage();
        const cell = `[${ locale } ${ width }]`;
        try
        {
            await page.goto(`${ BASE }/`, { waitUntil: 'networkidle' });
            const live = await page.waitForSelector('.world-canvas.is-live', { timeout: 30000 }).then(() => true).catch(() => false);
            record(`${ cell } the world goes live on a real GPU`, live, '');
            await page.waitForTimeout(1500);
            await page.evaluate(() => { window.__frames = 0; });
            await page.waitForTimeout(3000);
            const frames = await page.evaluate(() => window.__frames);
            record(`${ cell } no frame is drawn while nothing moves`, frames === 0, `${ frames } in 3s`);

            const arrivals = await page.evaluate(() =>
            {
                const stage = document.querySelector('.stage').clientHeight;
                return [...document.querySelectorAll('[data-beat]')].map((element, index) =>
                {
                    const box = element.getBoundingClientRect();
                    return index === 0 ? 0 : Math.max(0, Math.round(box.top + window.scrollY + Math.min(0, (box.height - stage) / 2)));
                });
            });
            const beats = ['arrival', 'games', 'together', 'compete', 'finale'];
            let worst = Infinity;
            let where = '';
            const unmeasured = [];
            for (const [index, at] of arrivals.entries())
            {
                await page.evaluate((y) => window.scrollTo(0, y), at);
                await page.waitForTimeout(2600);
                const boxes = await page.evaluate(() =>
                {
                    const found = [];
                    for (const element of document.querySelectorAll('.scene-column :is(h1 > span, h2, h3, p)'))
                    {
                        const box = element.getBoundingClientRect();
                        if (box.bottom <= 0 || box.top >= window.innerHeight || box.width === 0)
                        {
                            continue;
                        }
                        const colour = getComputedStyle(element).color.match(/[\d.]+/g).slice(0, 3).map(Number);
                        found.push({ x: box.left, y: box.top, width: box.width, height: box.height, colour, text: element.textContent.trim().slice(0, 40) });
                    }
                    const style = document.createElement('style');
                    style.id = 'qa-ink';
                    style.textContent = '.scene-overlay *, .site-header * { color: transparent !important; } .scene-overlay svg, .scene-overlay img, .scene-overlay [aria-hidden="true"] { visibility: hidden !important; }';
                    document.head.append(style);
                    return found;
                });
                const png = await page.screenshot();
                await page.evaluate(() => document.getElementById('qa-ink')?.remove());
                const ratios = await luminance(png, boxes);
                if (ratios.filter((ratio) => ratio !== null).length === 0)
                {
                    unmeasured.push(beats[index]);
                }
                ratios.forEach((ratio, at) =>
                {
                    if (ratio !== null && ratio < worst)
                    {
                        worst = ratio;
                        where = `${ beats[index] }: ${ boxes[at].text }`;
                    }
                });
            }
            record(`${ cell } every beat has copy to measure`, unmeasured.length === 0, unmeasured.join(', '));
            record(`${ cell } every line of copy clears 4.5:1 against the brightest pixel behind it`, worst >= 4.5, `${ worst.toFixed(2) }:1 at ${ where }`);
        }
        catch (e)
        {
            record(`${ cell } landing on a GPU`, false, String(e.message).slice(0, 140));
        }
        await context.close();
    }
    await gpu.close();
}

await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n${ results.length - failed.length }/${ results.length } checks passed`);
if (failed.length)
{
    console.log('\nFAILURES:');
    for (const f of failed)
    {
        console.log(`  - ${ f.name }${ f.detail ? ': ' + f.detail : '' }`);
    }
    process.exitCode = 1;
}
