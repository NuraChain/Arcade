#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { launchChrome } from '../chrome.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const WORLD = join(ROOT, 'application', 'public', 'world');
const BASE = process.env.QA_BASE ?? 'http://localhost:5300';

export const POSTERS = [
    { file: 'poster-portrait.webp', width: 390, height: 844, scale: 2, locale: 'en', budget: 90 * 1024 },
    { file: 'poster-wide-ltr.webp', width: 1920, height: 1080, scale: 1, locale: 'en', budget: 130 * 1024 },
    { file: 'poster-wide-rtl.webp', width: 1920, height: 1080, scale: 1, locale: 'fa', budget: 130 * 1024 }
];

function filesUnder(directory)
{
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory() ? filesUnder(join(directory, entry.name)) : [join(directory, entry.name)]);
}

export function inputs()
{
    return [
        join(WORLD, 'showcase-desktop.glb'),
        join(WORLD, 'showcase-phone.glb'),
        join(ROOT, 'application', 'src', 'data', 'games.ts'),
        ...filesUnder(join(ROOT, 'application', 'src', 'world'))
    ].map((path) => relative(ROOT, path).replaceAll('\\', '/')).sort();
}

export function fingerprint()
{
    const hash = createHash('sha256');
    for (const input of inputs())
    {
        hash.update(input);
        hash.update(readFileSync(join(ROOT, input)));
    }
    const stage = readFileSync(join(ROOT, 'application', 'src', 'components', 'world', 'world-canvas.component.azeroth'), 'utf8');
    hash.update(stage.split('\n').filter((line) => line.includes('--subject-') || line.includes('/world/poster-')).join('\n'));
    return hash.digest('hex');
}

async function capture(browser, poster)
{
    const context = await browser.newContext({
        viewport: { width: poster.width, height: poster.height },
        deviceScaleFactor: poster.scale
    });
    await context.addCookies([{ name: 'locale', value: poster.locale, url: BASE }]);
    const page = await context.newPage();
    await page.addInitScript(() =>
    {
        const style = document.createElement('style');
        style.textContent = 'html{scrollbar-width:none}.scene-overlay,.site-header,.scrim{visibility:hidden!important}';
        document.addEventListener('DOMContentLoaded', () => document.head.append(style));
    });
    await page.goto(`${ BASE }/`, { waitUntil: 'load' });
    await page.waitForSelector('.world-canvas.is-live', { timeout: 30000 });
    await page.waitForTimeout(1500);
    const png = await page.locator('.world-canvas').screenshot({ scale: 'device', animations: 'disabled' });
    await context.close();
    return png;
}

async function encode(browser, png, budget)
{
    const page = await browser.newPage();
    const result = await page.evaluate(async ({ source, limit }) =>
    {
        const image = new Image();
        image.src = source;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        canvas.getContext('2d').drawImage(image, 0, 0);
        for (let step = 18; step >= 8; step -= 1)
        {
            const quality = step / 20;
            const url = canvas.toDataURL('image/webp', quality);
            const bytes = Math.floor((url.length - 'data:image/webp;base64,'.length) * 0.75);
            if (bytes <= limit)
            {
                return { url, quality, width: canvas.width, height: canvas.height };
            }
        }
        return null;
    }, { source: `data:image/png;base64,${ png.toString('base64') }`, limit: budget });
    await page.close();
    return result;
}

if (process.argv[1] === fileURLToPath(import.meta.url))
{
    for (const set of ['desktop', 'phone'])
    {
        const served = await fetch(`${ BASE }/world/showcase-${ set }.glb`).then((response) => response.arrayBuffer()).catch(() => null);
        const local = readFileSync(join(WORLD, `showcase-${ set }.glb`));
        if (served === null || !local.equals(Buffer.from(served)))
        {
            console.error(`  ${ BASE } does not serve this checkout's showcase-${ set }.glb - build, restart the server, then capture`);
            process.exit(1);
        }
    }

    const browser = await launchChrome({ headless: false, args: ['--use-angle=d3d11', '--window-position=-2400,0'] });
    let failed = false;
    for (const poster of POSTERS)
    {
        const png = await capture(browser, poster);
        const webp = await encode(browser, png, poster.budget);
        if (webp === null)
        {
            failed = true;
            console.log(`  ${ poster.file.padEnd(24) } could not fit ${ poster.budget / 1024 } KB`);
            continue;
        }
        const bytes = Buffer.from(webp.url.split(',')[1], 'base64');
        writeFileSync(join(WORLD, poster.file), bytes);
        console.log(`  ${ poster.file.padEnd(24) } ${ webp.width }x${ webp.height }  ${ (bytes.length / 1024).toFixed(1) } KB  q${ webp.quality.toFixed(2) }`);
    }
    await browser.close();
    if (!failed)
    {
        writeFileSync(join(WORLD, 'poster.json'), `${ JSON.stringify({ inputs: fingerprint() }, null, 4) }\n`);
    }
    process.exit(failed ? 1 : 0);
}
