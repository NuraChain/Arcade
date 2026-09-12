/**
 * The browser pass for the sealing, in a real browser.
 *
 * Temporary: run by hand, not part of any gate.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { privateKeyToAccount } from 'viem/accounts';

function cachedChromium()
{
    const home = process.env.LOCALAPPDATA ?? process.env.HOME ?? '';
    const cache = process.env.PLAYWRIGHT_BROWSERS_PATH ?? join(home, 'ms-playwright');
    if (!existsSync(cache)) { return undefined; }
    const builds = readdirSync(cache).filter((name) => /^chromium-\d+$/.test(name))
        .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]));
    for (const build of builds)
    {
        for (const relative of ['chrome-win64/chrome.exe', 'chrome-win/chrome.exe', 'chrome-linux/chrome'])
        {
            const candidate = join(cache, build, relative);
            if (existsSync(candidate)) { return candidate; }
        }
    }
    return undefined;
}

const BASE = process.env.QA_BASE ?? 'http://localhost:3200';

const wallet = privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80');

const SIZES = [
    { name: '390', width: 390, height: 844 },
    { name: '1280', width: 1280, height: 900 }
];

/**
 * Every context is a fresh browser with an empty keyring, so every one of them enrols. The account
 * has to be empty first or the second enrolment is a SECOND device - pending, unconfirmable, and
 * unable to seal - which is the correct product behaviour and not what this pass is measuring.
 */
function emptyTheAccount()
{
    const sql = [
        'delete from conversation_epochs',
        "delete from messages where kind = 'text'",
        "delete from devices where user_id = (select id from users where handle = 'dana.w')"
    ].join('; ');

    execFileSync('psql', ['-U', 'postgres', '-h', '127.0.0.1', '-d', 'nura_games', '-q', '-c', sql], {
        env: { ...process.env, PGPASSWORD: 'root' },
        stdio: 'ignore'
    });
}

const executablePath = cachedChromium();
const browser = await chromium.launch(executablePath === undefined ? {} : { executablePath });

const problems = [];

async function open(size, theme, locale)
{
    const context = await browser.newContext({
        viewport: { width: size.width, height: size.height },
        locale: locale === 'fa' ? 'fa-IR' : 'en-US'
    });

    await context.addInitScript(([themeName, localeName]) =>
    {
        try
        {
            localStorage.setItem('nura-games.theme', themeName);
            localStorage.setItem('nura-games.locale', localeName);
        }
        catch
        {
            // A context with storage refused is a state the product already handles.
        }

        const provider = {
            isNuraTest: true,
            async request({ method, params })
            {
                if (method === 'eth_requestAccounts' || method === 'eth_accounts')
                {
                    return [window.__walletAddress];
                }
                if (method === 'eth_chainId')
                {
                    return '0x1';
                }
                if (method === 'personal_sign')
                {
                    return window.__walletSign(params[0]);
                }
                if (method === 'wallet_switchEthereumChain' || method === 'wallet_addEthereumChain')
                {
                    return null;
                }
                throw Object.assign(new Error(`unsupported ${ method }`), { code: 4200 });
            },
            on() {},
            removeListener() {}
        };

        window.ethereum = provider;

        const announce = () => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', {
            detail: {
                info: { uuid: 'nura-test', name: 'MetaMask', icon: '', rdns: 'io.metamask' },
                provider
            }
        }));

        window.addEventListener('eip6963:requestProvider', announce);
        announce();
    }, [theme, locale]);

    await context.addInitScript((address) => { window.__walletAddress = address; }, wallet.address);
    await context.exposeFunction('__walletSign', (message) => wallet.signMessage({ message }));

    const page = await context.newPage();

    const console_ = [];
    page.on('console', (entry) => { if (entry.type() === 'error') { console_.push(entry.text()); } });
    page.on('pageerror', (error) => console_.push(String(error)));

    return { context, page, console_ };
}

const label = (size, theme, locale) => `${ size.name } ${ theme } ${ locale }`;

for (const size of SIZES)
{
    for (const theme of ['dark', 'light'])
    {
        for (const locale of ['en', 'fa'])
        {
            const where = label(size, theme, locale);
            emptyTheAccount();
            const { context, page, console_ } = await open(size, theme, locale);

            // ---------------------------------------------------------- sign in
            await page.goto(`${ BASE }/sign-in`, { waitUntil: 'networkidle' });

            await page.getByRole('button', { name: /^(Connect|اتصال)/ }).first().click();
            await page.waitForURL(/\/app/, { timeout: 30_000 });

            // ---------------------------------------------------------- enrol
            await page.goto(`${ BASE }/app/me/devices`, { waitUntil: 'networkidle' });

            const enrol = page.getByRole('button', { name: /Give this browser keys|کلید/i }).first();

            if (await enrol.count() > 0)
            {
                await enrol.click();
                await page.waitForTimeout(1500);
            }

            const deviceState = await page.locator('main').innerText();

            // ---------------------------------------------------------- chat
            await page.goto(`${ BASE }/app/chats`, { waitUntil: 'networkidle' });
            await page.waitForTimeout(500);

            const firstThread = page.locator('a[href^="/app/chats/"]').first();
            let threadText = '(no thread)';
            let sent = false;

            if (await firstThread.count() > 0)
            {
                await firstThread.click();
                await page.waitForTimeout(2500);

                threadText = await page.locator('main').innerText();

                const composer = page.locator('textarea, input[type="text"]').last();

                if (await composer.count() > 0)
                {
                    const said = locale === 'fa' ? 'سلام از مرورگر' : 'hello from the browser';
                    await composer.fill(said);
                    await composer.press('Enter');
                    await page.waitForTimeout(3000);

                    const after = await page.locator('main').innerText();
                    sent = after.includes(said);
                }
            }

            const overflow = await page.evaluate(() =>
                document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);

            console.log(`\n=== ${ where } ===`);
            console.log('  devices panel :', deviceState.split('\n').filter(Boolean).slice(0, 4).join(' / ').slice(0, 160));
            console.log('  seal line     :', (threadText.match(/.*(Only the devices|فقط دستگاه|not sealed|مهروموم نشده).*/i)?.[0] ?? '(none)').slice(0, 150));
            console.log('  sent + read   :', sent);
            console.log('  h-overflow    :', overflow);
            console.log('  console errors:', console_.length, console_.slice(0, 3).join(' | ').slice(0, 200));

            if (!sent || overflow || console_.length > 0)
            {
                problems.push(`${ where }: sent=${ sent } overflow=${ overflow } console=${ console_.length }`);
            }

            await context.close();
        }
    }
}

await browser.close();

console.log('\n------------------------------------------');
console.log(problems.length === 0 ? 'browser pass: clean' : `browser pass: ${ problems.length } problem(s)`);
for (const problem of problems)
{
    console.log('  ' + problem);
}
