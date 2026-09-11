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
    { id: 'chat', path: '/app/chats/c-friday' },
    { id: 'group', path: '/app/groups/g-balcony' },
    { id: 'discover', path: '/app/discover' },
    { id: 'search', path: '/app/search' },
    { id: 'notifications', path: '/app/notifications' },
    { id: 'me', path: '/app/me' },
    { id: 'settings', path: '/app/me/settings' },
    { id: 'sign-in', path: '/sign-in', anonymous: true }
];

const LOCALES = ['en', 'fa'];

const SESSION = JSON.stringify({ id: 'alex', handle: 'alex', kind: 'demo' });

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
                    locale: locale === 'fa' ? 'fa-IR' : 'en-US'
                });

                await context.addInitScript(([session, tag]) =>
                {
                    localStorage.setItem('nura-games.session', session);
                    localStorage.setItem('nura-games.locale', tag);
                }, [SESSION, locale]);

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

                    await page.goto(`${ BASE }${ route.path }`, { waitUntil: 'networkidle' }).catch(() => undefined);
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
