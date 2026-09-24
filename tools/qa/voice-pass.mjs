/**
 * Two real browsers in one table's voice call, run by hand against the BUILT server.
 *
 *   QA_BASE=http://localhost:5300 node tools/qa/voice-pass.mjs
 *
 * Chromium's fake capture device supplies a microphone that plays a steady tone, so the call carries
 * real audio: the pass joins both players, unmutes one, and asserts in the OTHER browser that a live
 * remote track arrived and that the speaking indicator lit - then mutes, then leaves, and checks the
 * room follows. Nothing here is mocked below the browser; the offer, answer and candidates cross the
 * realtime socket exactly as they do for a person.
 */
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { privateKeyToAccount } from 'viem/accounts';

import { WALLET_FIXTURES } from '../../server/src/db/wallet-fixtures.ts';

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

const BASE = process.env.QA_BASE ?? 'http://localhost:5300';

const executablePath = cachedChromium();
const browser = await chromium.launch({
    ...(executablePath === undefined ? {} : { executablePath }),
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required']
});

const results = [];
const record = (name, ok, detail) =>
{
    results.push({ name, ok, detail });
    console.log(`  ${ ok ? 'PASS' : 'FAIL' }  ${ name }${ detail ? ' - ' + detail : '' }`);
};

async function seat(handle)
{
    const fixture = WALLET_FIXTURES.find((one) => one.handle === handle);
    const wallet = privateKeyToAccount(fixture.privateKey);
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'en-US', permissions: ['microphone'] });

    await context.addCookies([{ name: 'locale', value: 'en', url: BASE }]);

    const issued = await context.request.post(`${ BASE }/api/auth/challenge`, { data: { address: wallet.address } });
    const challenge = await issued.json();
    const signedIn = await context.request.post(`${ BASE }/api/auth/wallet`, {
        data: { address: wallet.address, nonce: challenge.nonce, signature: await wallet.signMessage({ message: challenge.message }) }
    });

    if (!signedIn.ok())
    {
        throw new Error(`voice-pass: could not sign in as ${ handle } (${ signedIn.status() })`);
    }

    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(`${ handle }: ${ String(error).slice(0, 160) }`));
    page.on('console', (event) =>
    {
        if (event.type() === 'error' && !event.text().includes('favicon'))
        {
            errors.push(`${ handle }: ${ event.text().slice(0, 160) }`);
        }
    });

    return { handle, context, page, errors };
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(check, ms = 15_000)
{
    const end = Date.now() + ms;
    while (Date.now() < end)
    {
        if (await check())
        {
            return true;
        }
        await wait(250);
    }
    return false;
}

const remoteAudio = (page) => page.evaluate(() =>
{
    const audio = [...document.querySelectorAll('audio')].find((one) => one.srcObject !== null);
    const track = audio?.srcObject?.getAudioTracks?.()[0];
    return track === undefined ? 'none' : track.readyState;
});

const players = async (page) =>
{
    if (await page.getByRole('tab', { name: 'Players' }).count() === 0 && await page.getByRole('button', { name: 'Players' }).count() === 0)
    {
        await page.locator('.table-pill').click();
        await wait(400);
    }
    await page.getByRole('button', { name: 'Players' }).first().click();
    await wait(300);
};

const pillOf = (page, handle) => page.locator('li', { hasText: handle }).locator('.sr-only').allInnerTexts();

const loudness = (page) => page.evaluate(() =>
{
    const audio = [...document.querySelectorAll('audio')].find((one) => one.srcObject !== null);
    return audio === undefined ? -1 : audio.volume;
});

const dana = await seat('dana.w');
const mina = await seat('mina');

const made = await dana.context.request.post(`${ BASE }/api/tables`, {
    data: { game: 'ludo', seats: 2, mode: 'live', privacy: 'invite', target: 0, cube: false, blinds: 'low', chat: true, voice: true, invitees: ['mina'] }
});
const table = await made.json();
record('a host can open a table with voice on', made.ok() && table.voice === true, made.ok() ? '' : String(made.status()));

await mina.context.request.post(`${ BASE }/api/tables/${ table.id }/seat`);

for (const one of [dana, mina])
{
    await one.page.goto(`${ BASE }/app/play/${ table.id }`);
    await one.page.waitForLoadState('networkidle');
}

for (const one of [dana, mina])
{
    await one.page.getByRole('button', { name: 'Join voice' }).first().click();
}

const bothIn = await until(async () =>
    (await dana.page.getByRole('button', { name: 'Leave voice' }).count()) > 0
    && (await mina.page.getByRole('button', { name: 'Leave voice' }).count()) > 0);
record('both players join the call', bothIn);

const heard = await until(async () => (await remoteAudio(dana.page)) === 'live' && (await remoteAudio(mina.page)) === 'live', 20_000);
record('each browser receives the other one\'s live audio track', heard, `dana: ${ await remoteAudio(dana.page) }, mina: ${ await remoteAudio(mina.page) }`);

await players(dana.page);
const mutedFirst = await until(async () => (await pillOf(dana.page, 'Mina')).some((text) => text === 'Muted'));
record('a player joins muted, and the other one sees it', mutedFirst, (await pillOf(dana.page, 'Mina')).join(', '));

await mina.page.getByRole('button', { name: 'Unmute your microphone' }).click();
const speaking = await until(async () => (await pillOf(dana.page, 'Mina')).some((text) => text === 'Speaking'), 15_000);
record('unmuted, the fake microphone\'s tone lights "speaking" in the other browser', speaking, (await pillOf(dana.page, 'Mina')).join(', '));

await dana.page.screenshot({ path: 'tools/qa/out/voice-dana.png' });

await mina.page.getByRole('button', { name: 'Mute your microphone' }).click();
const mutedAgain = await until(async () => (await pillOf(dana.page, 'Mina')).some((text) => text === 'Muted'));
record('muting shows in the other browser', mutedAgain);

for (const one of [dana, mina])
{
    await one.context.request.post(`${ BASE }/api/tables/${ table.id }/ready`, { data: { ready: true } });
}
const started = await dana.context.request.post(`${ BASE }/api/tables/${ table.id }/start`);
await wait(3000);
const throughStart = started.ok()
    && (await remoteAudio(dana.page)) === 'live'
    && (await remoteAudio(mina.page)) === 'live'
    && (await dana.page.getByRole('button', { name: 'Leave voice' }).count()) > 0;
record('the call carries on when the match starts', throughStart, started.ok() ? '' : `start ${ started.status() }`);

const marked = await until(async () => (await dana.page.locator('.table-plate-voice[data-mark]').count()) >= 2);
record('every player in the call carries a voice mark on their plate', marked, String(await dana.page.locator('.table-plate-voice').count()));

await players(dana.page);
const slider = dana.page.getByRole('slider', { name: /How loud Mina/ });
record('the players list offers a volume for each other person in the call', (await slider.count()) > 0);
await slider.first().focus();
await dana.page.keyboard.press('Home');
record('turning one person down reaches their audio and nobody else\'s', await until(async () => (await loudness(dana.page)) === 0), String(await loudness(dana.page)));
await dana.page.keyboard.press('End');
record('turning them back up restores it', await until(async () => (await loudness(dana.page)) === 1), String(await loudness(dana.page)));

await dana.page.getByRole('button', { name: 'Stop hearing everybody' }).click();
record('deafening silences everybody for the one who deafened', await until(async () => (await loudness(dana.page)) === 0));
await players(mina.page);
record('deafening shows as muted in the other browser', await until(async () => (await pillOf(mina.page, 'Dana')).some((text) => text === 'Muted')), (await pillOf(mina.page, 'Dana')).join(', '));
await dana.page.getByRole('button', { name: 'Hear everybody again' }).click();
record('undeafening gives the sound back', await until(async () => (await loudness(dana.page)) === 1));

await mina.page.getByRole('button', { name: 'Leave voice' }).click();
const gone = await until(async () => (await remoteAudio(dana.page)) === 'none');
record('leaving takes the other player\'s audio away', gone);

await mina.page.evaluate(() =>
{
    const stored = JSON.parse(localStorage.getItem('nura-games.settings') ?? '{}');
    localStorage.setItem('nura-games.settings', JSON.stringify({ ...stored, voicePushToTalk: true }));
});
await mina.page.reload();
await mina.page.waitForLoadState('networkidle');
await mina.page.getByRole('button', { name: 'Join voice' }).first().click();
await until(async () => (await remoteAudio(dana.page)) === 'live' && (await remoteAudio(mina.page)) === 'live', 20_000);
await players(dana.page);
await wait(2500);
record('with push to talk, an idle microphone stays quiet in the other browser', !(await pillOf(dana.page, 'Mina')).some((text) => text === 'Speaking'), (await pillOf(dana.page, 'Mina')).join(', '));
await mina.page.locator('body').click({ position: { x: 5, y: 5 } }).catch(() => undefined);
await mina.page.keyboard.down('v');
record('holding the talk key lights "speaking" in the other browser', await until(async () => (await pillOf(dana.page, 'Mina')).some((text) => text === 'Speaking'), 10_000), (await pillOf(dana.page, 'Mina')).join(', '));
await mina.page.keyboard.up('v');
record('letting go of the key goes quiet again', await until(async () => !(await pillOf(dana.page, 'Mina')).some((text) => text === 'Speaking'), 10_000));
await mina.page.evaluate(() =>
{
    const stored = JSON.parse(localStorage.getItem('nura-games.settings') ?? '{}');
    localStorage.setItem('nura-games.settings', JSON.stringify({ ...stored, voicePushToTalk: false }));
});

await dana.page.getByRole('button', { name: 'Turn voice off for this table' }).first().click();
record('the host turning voice off takes everybody out of the call', await until(async () =>
    (await dana.page.getByRole('button', { name: 'Leave voice' }).count()) === 0
    && (await mina.page.getByRole('button', { name: 'Leave voice' }).count()) === 0
    && (await mina.page.getByRole('button', { name: 'Join voice' }).count()) === 0));

await dana.page.getByRole('button', { name: 'Turn voice on for this table' }).first().click();
record('turning it back on offers the call to the other player without a reload', await until(async () =>
    (await mina.page.getByRole('button', { name: 'Join voice' }).count()) > 0
    && (await mina.page.getByText('This table has voice. Join to talk while you play.').count()) > 0));

const errors = [...dana.errors, ...mina.errors];
record('no console errors', errors.length === 0, errors.slice(0, 4).join(' | '));

await dana.context.request.post(`${ BASE }/api/tables/${ table.id }/close`).catch(() => undefined);
await browser.close();

const failed = results.filter((one) => !one.ok).length;
console.log(`\n  ${ results.length - failed }/${ results.length } voice checks passed`);
process.exit(failed === 0 ? 0 : 1);
