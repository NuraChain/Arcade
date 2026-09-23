import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { privateKeyToAccount } from 'viem/accounts';

import { WALLET_FIXTURES } from '../../server/src/db/wallet-fixtures.ts';

export const BASE = process.env.QA_BASE ?? 'http://localhost:5300';

function cachedChromium()
{
    const home = process.env.LOCALAPPDATA ?? process.env.HOME ?? '';
    const cache = process.env.PLAYWRIGHT_BROWSERS_PATH ?? join(home, 'ms-playwright');

    if (!existsSync(cache))
    {
        return undefined;
    }

    const builds = readdirSync(cache).filter((name) => /^chromium-\d+$/.test(name))
        .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]));

    for (const build of builds)
    {
        for (const relative of ['chrome-win64/chrome.exe', 'chrome-win/chrome.exe', 'chrome-linux/chrome'])
        {
            const candidate = join(cache, build, relative);

            if (existsSync(candidate))
            {
                return candidate;
            }
        }
    }

    return undefined;
}

export async function launch()
{
    const executablePath = cachedChromium();

    return await chromium.launch(executablePath === undefined ? {} : { executablePath });
}

export function recorder(name)
{
    const results = [];

    const record = (label, ok, detail = '') =>
    {
        results.push({ label, ok, detail });
        console.log(`  ${ ok ? 'PASS' : 'FAIL' }  ${ label }${ detail ? ' — ' + detail : '' }`);
    };

    const finish = () =>
    {
        const failed = results.filter((one) => !one.ok);

        console.log('\n------------------------------------------');
        console.log(`${ name }: ${ failed.length === 0 ? 'clean' : `${ failed.length } FAILED` }, ${ results.length } checks`);

        for (const one of failed)
        {
            console.log(`  FAIL  ${ one.label }${ one.detail ? ' — ' + one.detail : '' }`);
        }

        process.exitCode = failed.length === 0 ? 0 : 1;
    };

    return { record, finish };
}

export async function seat(browser, handle, viewport = { width: 1280, height: 900 })
{
    const fixture = WALLET_FIXTURES.find((one) => one.handle === handle);

    if (fixture === undefined)
    {
        throw new Error(`no wallet fixture called ${ handle }`);
    }

    const wallet = privateKeyToAccount(fixture.privateKey);
    const context = await browser.newContext({ viewport, locale: 'en-US' });

    await context.addInitScript(() =>
    {
        try
        {
            localStorage.setItem('nura-games.locale', 'en');
        }
        catch
        {
            return;
        }
    });

    const issued = await context.request.post(`${ BASE }/api/auth/challenge`, { data: { address: wallet.address } });

    if (!issued.ok())
    {
        throw new Error(`no challenge for ${ handle } (${ issued.status() }); is the api running?`);
    }

    const challenge = await issued.json();
    const signedIn = await context.request.post(`${ BASE }/api/auth/wallet`, {
        data: { address: wallet.address, nonce: challenge.nonce, signature: await wallet.signMessage({ message: challenge.message }) }
    });

    if (!signedIn.ok())
    {
        throw new Error(`could not sign in as ${ handle } (${ signedIn.status() }); has seedWalletFixtures run?`);
    }

    const page = await context.newPage();
    const errors = [];

    page.on('console', (event) =>
    {
        if ((event.type() === 'error' || event.type() === 'warning') && !event.text().includes('favicon'))
        {
            errors.push(`${ handle }: ${ event.text().slice(0, 160) }`);
        }
    });
    page.on('pageerror', (error) => errors.push(`${ handle }: ${ String(error).slice(0, 160) }`));

    const api = async (method, path, data) =>
    {
        const response = method === 'GET'
            ? await context.request.get(`${ BASE }/api${ path }`)
            : await context.request.post(`${ BASE }/api${ path }`, data === undefined ? {} : { data });

        return { ok: response.ok(), status: response.status(), body: await response.json().catch(() => null) };
    };

    return { handle, context, page, errors, api };
}

export async function clearTables(...players)
{
    for (const player of players)
    {
        const seated = await player.api('GET', '/tables/mine');

        for (const one of seated.body?.tables ?? [])
        {
            await player.api('POST', `/tables/${ one.id }/leave`);
        }
    }
}

export async function pressable(page, name)
{
    const button = page.getByRole('button', { name }).first();

    if (await button.count() === 0)
    {
        return null;
    }

    return await button.isDisabled() ? null : button;
}

export async function waitFor(check, timeout = 6000)
{
    const until = Date.now() + timeout;

    while (Date.now() < until)
    {
        if (await check())
        {
            return true;
        }

        await new Promise((resolve) => setTimeout(resolve, 150));
    }

    return false;
}
