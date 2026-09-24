#!/usr/bin/env node

import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, 'out', 'matrix');

const BASE = process.env.QA_BASE ?? 'http://localhost:3100';
const ONLY = process.env.QA_ONLY;
const SHOTS = process.env.QA_SHOTS !== 'off';

function cachedChromium()
{
    const home = process.env.LOCALAPPDATA ?? process.env.HOME ?? '';
    const cache = process.env.PLAYWRIGHT_BROWSERS_PATH ?? join(home, 'ms-playwright');
    if (!existsSync(cache))
    {
        return undefined;
    }
    const builds = readdirSync(cache)
        .filter((name) => /^chromium-\d+$/.test(name))
        .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]));
    for (const build of builds)
    {
        for (const relative of ['chrome-win64/chrome.exe', 'chrome-win/chrome.exe', 'chrome-linux/chrome', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium'])
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

const WIDTHS = [320, 360, 375, 390, 412, 430, 768, 834, 1024, 1280, 1440, 1920];

const ROUTES = [
    { id: 'home', path: '/app' },
    { id: 'games', path: '/app/games' },
    { id: 'game', path: '/app/games/backgammon' },
    { id: 'create', path: '/app/games/hokm/create' },
    { id: 'friends', path: '/app/friends' },
    { id: 'person', path: '/app/people/sara.k' },
    { id: 'chats', path: '/app/chats' },
    { id: 'chat', path: '/app/chats/:conversation' },
    { id: 'group', path: '/app/groups/balcony-backgammon' },
    { id: 'play', path: '/app/play/:ludo' },
    { id: 'play-backgammon', path: '/app/play/:backgammon' },
    { id: 'play-poker', path: '/app/play/:poker' },
    { id: 'leaderboard', path: '/app/leaderboard' },
    { id: 'discover', path: '/app/discover' },
    { id: 'search', path: '/app/search' },
    { id: 'notifications', path: '/app/notifications' },
    { id: 'me', path: '/app/me' },
    { id: 'settings', path: '/app/me/settings' },
    { id: 'devices', path: '/app/me/devices' },
    { id: 'sign-in', path: '/sign-in', anonymous: true }
];

const LOCALES = ['en', 'fa'];

// The account the matrix tours as, and it signs in the way a person does: fetch the challenge,
// sign it with the wallet, post the signature. There is no demo door any more - and there should
// not be, because a sign-in path that exists only for the test suite is a sign-in path nobody
// tests. This exercises the real EIP-4361 round trip on every run.
//
// It needs `seedWalletFixtures` to have run, exactly as the old one needed the demo rows: a matrix
// against a database with no fixtures fails on the first line rather than touring 640 signed-out
// pages.
const TOUR_HANDLE = 'dana.w';

/** The second chair, so the play route has a board on it rather than a lobby. */
const PARTNER_HANDLE = 'mina';

async function signedIn(browser, handle = TOUR_HANDLE)
{
    const { privateKeyToAccount } = await import('viem/accounts');
    const { WALLET_FIXTURES } = await import('../../server/src/db/wallet-fixtures.ts');

    const fixture = WALLET_FIXTURES.find((one) => one.handle === handle);
    if (fixture === undefined)
    {
        throw new Error(`qa: no wallet fixture called ${ handle }`);
    }

    const wallet = privateKeyToAccount(fixture.privateKey);
    const context = await browser.newContext();

    const issued = await context.request.post(`${ BASE }/api/auth/challenge`, { data: { address: wallet.address } });
    if (!issued.ok())
    {
        throw new Error(`qa: no challenge for ${ handle } (${ issued.status() }). Is the api running?`);
    }
    const challenge = await issued.json();

    const response = await context.request.post(`${ BASE }/api/auth/wallet`, {
        data: {
            address: wallet.address,
            nonce: challenge.nonce,
            signature: await wallet.signMessage({ message: challenge.message })
        }
    });
    if (!response.ok())
    {
        throw new Error(`qa: could not sign in as ${ handle } (${ response.status() }). Has seedWalletFixtures run?`);
    }

    const state = await context.storageState();
    await context.close();
    return state;
}

/**
 * A table with a game actually running on it.
 *
 * The play route was not in this list for a long time, which meant the one screen carrying a board
 * was the one screen the gate never toured. Touring the LOBBY would not be enough either: the board
 * only exists once somebody starts a match, so this seats a second wallet fixture, readies both and
 * starts one - and reuses a live match when a previous run already left one behind, so repeated
 * runs do not litter the database with tables.
 */
async function playableTable(browser, storageState, game)
{
    const mine = await browser.newContext({ storageState });

    const seated = await mine.request.get(`${ BASE }/api/tables/mine`);
    const already = seated.ok() ? (await seated.json()).tables.find((one) => one.matchId !== undefined && one.game === game) : undefined;

    if (already !== undefined)
    {
        await mine.close();
        return already.id;
    }

    const made = await mine.request.post(`${ BASE }/api/tables/`, {
        data: {
            game,
            seats: 2,
            mode: game === 'poker' ? 'live' : 'turns',
            privacy: 'public',
            target: game === 'backgammon' ? 1 : 0,
            cube: false,
            blinds: 'low',
            chat: true,
            voice: false,
            invitees: []
        }
    });

    if (!made.ok())
    {
        await mine.close();
        throw new Error(`qa: could not open a ${ game } table (${ made.status() })`);
    }

    const table = (await made.json()).id;

    const otherState = await signedIn(browser, PARTNER_HANDLE);
    const other = await browser.newContext({ storageState: otherState });

    await other.request.post(`${ BASE }/api/tables/${ table }/seat`);
    await other.request.post(`${ BASE }/api/tables/${ table }/ready`, { data: { ready: true } });
    await mine.request.post(`${ BASE }/api/tables/${ table }/ready`, { data: { ready: true } });

    const started = await mine.request.post(`${ BASE }/api/tables/${ table }/start`);

    await other.close();
    await mine.close();

    if (!started.ok())
    {
        throw new Error(`qa: could not start a ${ game } match (${ started.status() })`);
    }

    return table;
}

function heightFor(width, landscape)
{
    if (landscape)
    {
        return Math.max(360, Math.round(width * 0.52));
    }
    return width < 768 ? Math.round(width * 2.1) : Math.round(width * 0.78);
}

async function audit(page)
{
    return page.evaluate(() =>
    {
        const problems = [];
        const root = document.documentElement;

        if (root.scrollWidth > root.clientWidth + 1)
        {
            problems.push({ kind: 'overflow', detail: `html ${ root.scrollWidth } > ${ root.clientWidth }` });
        }

        const scroller = document.querySelector('.page');
        if (scroller !== null && scroller.scrollWidth > scroller.clientWidth + 1)
        {
            problems.push({ kind: 'overflow', detail: `page ${ scroller.scrollWidth } > ${ scroller.clientWidth }` });
        }

        const scrolls = new Set(['auto', 'scroll']);
        const inside = (element) =>
        {
            for (let node = element.parentElement; node !== null; node = node.parentElement)
            {
                const style = getComputedStyle(node);
                if (scrolls.has(style.overflowX) || node.classList.contains('rail-x'))
                {
                    return true;
                }
            }
            return false;
        };

        const reaches = (control, box) =>
        {
            const cx = box.left + box.width / 2;
            const cy = box.top + box.height / 2;
            const probes = [[cx, cy - 21], [cx, cy + 21]];
            return probes.every(([x, y]) =>
            {
                if (x < 0 || y < 0 || x > root.clientWidth - 1 || y > root.clientHeight - 1)
                {
                    return true;
                }
                const hit = document.elementFromPoint(x, y);
                return hit !== null && (hit === control || control.contains(hit));
            });
        };

        const touch = window.matchMedia('(pointer: coarse)').matches;

        const controls = document.querySelectorAll('button, a[href], input, select, [role="tab"], [role="switch"]');
        const small = [];
        for (const control of controls)
        {
            if (control.hasAttribute('data-inline') || control.closest('[data-inline]') !== null)
            {
                continue;
            }
            const style = getComputedStyle(control);
            if (style.display === 'none' || style.visibility === 'hidden' || control.closest('[hidden]') !== null)
            {
                continue;
            }
            const box = control.getBoundingClientRect();
            if (box.width === 0 || box.height === 0)
            {
                continue;
            }
            if (touch && (box.height < 44 || box.width < 24) && !reaches(control, box))
            {
                small.push(`${ control.tagName.toLowerCase() }.${ (control.className || '').toString().split(' ')[0] } ${ Math.round(box.width) }x${ Math.round(box.height) }`);
            }
            if (box.right > root.clientWidth + 1 && !inside(control))
            {
                problems.push({ kind: 'offscreen', detail: `${ control.tagName.toLowerCase() } right ${ Math.round(box.right) }` });
            }
        }
        if (small.length > 0)
        {
            problems.push({ kind: 'target', detail: small.slice(0, 4).join(' · ') });
        }

        if (document.querySelector('main') === null && document.querySelector('#main') === null)
        {
            problems.push({ kind: 'landmark', detail: 'no main landmark' });
        }

        return problems;
    });
}

async function main()
{
    mkdirSync(OUT, { recursive: true });

    const executablePath = process.env.QA_CHROME ?? cachedChromium();
    const browser = await chromium.launch(executablePath === undefined ? {} : { executablePath });
    const storageState = await signedIn(browser);

    // The chat route needs a conversation that exists. Conversation ids are the server's now, so
    // the matrix asks for one instead of naming a fixture id that used to be a slug.
    const openable = await browser.newContext({ storageState });
    const inbox = await openable.request.get(`${ BASE }/api/chat/`);
    const conversations = inbox.ok() ? (await inbox.json()).conversations : [];
    await openable.close();

    if (conversations.length === 0)
    {
        throw new Error('qa: the signed-in account has no conversations. Are the development fixtures seeded?');
    }
    const conversation = conversations[0].id;

    const tables = {
        ludo: await playableTable(browser, storageState, 'ludo'),
        backgammon: await playableTable(browser, storageState, 'backgammon'),
        poker: await playableTable(browser, storageState, 'poker')
    };

    const keepDealing = async (page) =>
    {
        const seen = await page.request.get(`${ BASE }/api/tables/${ tables.poker }`);

        if (seen.ok() && (await seen.json()).matchId === undefined)
        {
            await page.request.post(`${ BASE }/api/tables/${ tables.poker }/start`);
        }
    };
    const failures = [];
    const rows = [];
    let cells = 0;

    for (const locale of LOCALES)
    {
        for (const width of WIDTHS)
        {
            const orientations = width < 1024 ? [false, true] : [false];
            for (const landscape of orientations)
            {
                const context = await browser.newContext({
                    viewport: { width, height: heightFor(width, landscape) },
                    deviceScaleFactor: 1,
                    hasTouch: width < 1024,
                    isMobile: width < 768,
                    locale: locale === 'fa' ? 'fa-IR' : 'en-US',
                    storageState
                });

                await context.addCookies([{ name: 'locale', value: locale, url: BASE }]);

                const page = await context.newPage();
                const noise = [];
                page.on('console', (message) =>
                {
                    if (message.type() === 'error' || message.type() === 'warning')
                    {
                        noise.push(`${ message.type() }: ${ message.text().slice(0, 140) }`);
                    }
                });
                page.on('pageerror', (error) => noise.push(`pageerror: ${ error.message.slice(0, 140) }`));

                for (const route of ROUTES)
                {
                    if (ONLY !== undefined && route.id !== ONLY)
                    {
                        continue;
                    }
                    noise.length = 0;
                    const label = `${ locale }-${ width }${ landscape ? 'l' : 'p' }-${ route.id }`;
                    cells += 1;

                    if (route.id === 'play-poker')
                    {
                        await keepDealing(page);
                    }

                    const target = route.path
                        .replace(':conversation', conversation)
                        .replace(':ludo', tables.ludo)
                        .replace(':backgammon', tables.backgammon)
                        .replace(':poker', tables.poker);
                    await page.goto(`${ BASE }${ target }`, { waitUntil: 'networkidle' }).catch(() => undefined);
                    await page.waitForTimeout(120);

                    let problems = await audit(page).catch(() => null);
                    if (problems === null)
                    {
                        await page.waitForTimeout(400);
                        noise.length = 0;
                        problems = await audit(page).catch(() => [{ kind: 'unreachable', detail: 'audit could not run' }]);
                    }
                    for (const message of noise)
                    {
                        problems.push({ kind: 'console', detail: message });
                    }

                    if (SHOTS && problems.length > 0)
                    {
                        await page.screenshot({ path: join(OUT, `${ label }.png`), fullPage: false }).catch(() => undefined);
                    }

                    rows.push({ label, problems: problems.length });
                    if (problems.length > 0)
                    {
                        failures.push({ label, problems });
                        process.stdout.write(`  ${ label.padEnd(28) }${ problems.map((problem) => problem.kind).join(',') }\n`);
                    }
                }

                await context.close();
            }
        }
    }

    await browser.close();

    writeFileSync(join(OUT, 'report.json'), JSON.stringify({ base: BASE, cells, failures }, null, 4));

    console.log(`\n  ${ cells } cells checked, ${ failures.length } with findings`);
    console.log(`  report       ${ join(OUT, 'report.json') }`);

    process.exit(failures.length > 0 ? 1 : 0);
}

await main();
