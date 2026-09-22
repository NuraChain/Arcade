import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'application', 'public');
const ICON = readFileSync(join(PUBLIC, 'favicon.svg'), 'utf8');
const ART = ['hokm', 'ludo', 'backgammon', 'poker'].map((game) => readFileSync(join(PUBLIC, 'art', 'games', `${ game }.svg`), 'utf8'));

const dataUrl = (svg) => `data:image/svg+xml;base64,${ Buffer.from(svg).toString('base64') }`;

const SHARE = `<!doctype html><html><body style="margin:0">
<div id="share" style="position:relative;width:1200px;height:630px;overflow:hidden;background:#0B1220;font-family:'Segoe UI','Inter',Arial,sans-serif">
    <div style="position:absolute;inset:0;background:radial-gradient(60% 80% at 18% 20%,rgba(37,99,235,0.45),transparent 70%),radial-gradient(50% 70% at 95% 100%,rgba(59,130,246,0.25),transparent 70%)"></div>
    <div style="position:absolute;left:72px;top:84px;display:flex;align-items:center;gap:20px">
        <img src="${ dataUrl(ICON) }" style="width:84px;height:84px;border-radius:20px;box-shadow:0 0 48px rgba(59,130,246,0.55)">
        <span style="font-size:58px;font-weight:800;letter-spacing:-1.5px;color:#F8FAFC">Nura <span style="color:#3B82F6">Games</span></span>
    </div>
    <p style="position:absolute;left:72px;top:210px;margin:0;width:520px;font-size:34px;line-height:1.25;font-weight:700;color:#F8FAFC">Sit down with the people you actually want to play with.</p>
    <p style="position:absolute;left:72px;top:340px;margin:0;width:500px;font-size:22px;line-height:1.45;color:#94A3B8">Hokm and Ludo at real tables, with friends, groups and chat that only the table can read.</p>
    <div style="position:absolute;right:56px;top:70px;display:grid;grid-template-columns:repeat(2,250px);gap:18px">
        ${ ART.map((svg) => `<div style="width:250px;height:167px;border-radius:18px;overflow:hidden;border:1px solid #1F2937;box-shadow:0 18px 40px -18px rgba(0,0,0,0.8)"><img src="${ dataUrl(svg) }" style="width:100%;height:100%;object-fit:cover"></div>`).join('') }
    </div>
    <div style="position:absolute;left:72px;bottom:64px;display:flex;align-items:center;gap:12px;color:#94A3B8;font-size:20px">
        <span style="width:10px;height:10px;border-radius:50%;background:#22C55E;box-shadow:0 0 12px #22C55E"></span>
        Web3 social gaming on NuraChain
    </div>
</div>
</body></html>`;

const browser = await chromium.launch(process.env.QA_CHROME === undefined ? {} : { executablePath: process.env.QA_CHROME });
const page = await browser.newPage({ deviceScaleFactor: 1 });

for (const [name, size] of [['favicon-16.png', 16], ['favicon-32.png', 32], ['apple-touch-icon.png', 180], ['icon-512.png', 512]])
{
    const rounded = name === 'apple-touch-icon.png' ? ICON.replace('rx="8"', 'rx="0"') : ICON;

    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<body style="margin:0;background:transparent"><img id="icon" src="${ dataUrl(rounded) }" style="display:block;width:${ size }px;height:${ size }px"></body>`);
    await page.locator('#icon').screenshot({ path: join(PUBLIC, name), omitBackground: true });
    console.log(`raster ${ name }`);
}

await page.setViewportSize({ width: 1200, height: 630 });
await page.setContent(SHARE);
await page.locator('#share').screenshot({ path: join(PUBLIC, 'share.jpg'), type: 'jpeg', quality: 86 });
console.log('raster share.jpg');

await browser.close();

writeFileSync(join(PUBLIC, 'site.webmanifest'), `${ JSON.stringify({
    name: 'Nura Games',
    short_name: 'Nura Games',
    start_url: '/app',
    display: 'standalone',
    background_color: '#0B1220',
    theme_color: '#0B1220',
    icons: [
        { src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml' },
        { src: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
        { src: '/icon-512.png', sizes: '512x512', type: 'image/png' }
    ]
}, null, 4) }\n`);
console.log('manifest site.webmanifest');
