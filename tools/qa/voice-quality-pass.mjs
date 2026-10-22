/**
 * How a call sounds, measured: two real browsers on the BUILT server, run by hand.
 *
 *   QA_BASE=http://localhost:5300 node tools/qa/voice-quality-pass.mjs
 *
 * The server has to take writes from the proxy's origin: start it with
 * PUBLIC_ORIGIN=http://localhost:5310 (QA_PROXY_PORT moves it). Each browser's microphone plays a
 * speech-like signal this pass writes itself (voiced syllables on six vowels, fricatives, phrases and
 * pauses, at -20 dBFS), and for the noise cases a room under it (pink noise, mains hum and typing).
 * The listener's received audio is recorded from the page, lined up against the clean signal and
 * scored: speech that went missing, the longest break, the level of speech, of the room between
 * phrases and of the typing in it. A proxy that keeps every byte in order delays the browsers'
 * traffic like Wi-Fi or a phone network, so what is measured is the call as a person on such a line
 * hears it. QA_ONLY=line,carried,noise runs only the cases whose names start with one of those.
 */
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import net from 'node:net';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { privateKeyToAccount } from 'viem/accounts';

import { WALLET_FIXTURES } from '../../backend/src/db/wallet-fixtures.ts';
import { tableBody } from './tables.mjs';
import { RATE, analyse, noiseBed, speechLike, writeWav } from './voice-signal.mjs';

const UPSTREAM = new URL(process.env.QA_BASE ?? 'http://localhost:5300');
const PORT = Number(process.env.QA_PROXY_PORT ?? 5310);
const BASE = `http://localhost:${ PORT }`;
const SECONDS = Number(process.env.QA_SECONDS ?? 15);
const OUT = join(import.meta.dirname, 'out', 'voice-quality');
const ONLY = (process.env.QA_ONLY ?? '').split(',').filter((one) => one !== '');

mkdirSync(OUT, { recursive: true });

const clean = speechLike(18);
const noise = noiseBed(clean.length);
const noisy = clean.map((value, index) => value + noise[index]);
const signals = { clean: join(OUT, 'clean.wav'), noisy: join(OUT, 'noisy.wav') };

writeWav(signals.clean, clean);
writeWav(signals.noisy, noisy);
writeWav(join(OUT, 'noise.wav'), noise);

let seed = 11;

const random = () =>
{
    seed = (seed * 1_664_525 + 1_013_904_223) >>> 0;
    return seed / 4_294_967_296;
};

const PROFILES = {
    none: () => 0,
    wifi: () => 4 + random() * 8 + (random() < 0.03 ? 40 + random() * 110 : 0),
    mobile: () => 20 + random() * 35 + (random() < 0.06 ? 90 + random() * 220 : 0)
};

let profile = 'none';

const proxy = net.createServer((client) =>
{
    const server = net.connect(Number(UPSTREAM.port || 80), UPSTREAM.hostname === 'localhost' ? '127.0.0.1' : UPSTREAM.hostname);
    let socket = false;
    const lanes = { up: { last: 0, queue: [], timer: null }, down: { last: 0, queue: [], timer: null } };

    const flush = (lane, to) =>
    {
        lane.timer = null;

        while (lane.queue.length > 0 && lane.queue[0].at <= Date.now())
        {
            const { chunk } = lane.queue.shift();

            if (!to.destroyed)
            {
                to.write(chunk);
            }
        }

        if (lane.queue.length > 0)
        {
            lane.timer = setTimeout(() => flush(lane, to), Math.max(0, lane.queue[0].at - Date.now()));
        }
    };

    const carry = (name, chunk, to) =>
    {
        const lane = lanes[name];

        if ((!socket || profile === 'none') && lane.queue.length === 0)
        {
            to.write(chunk);
            return;
        }

        const at = Math.max(lane.last, Date.now() + PROFILES[profile]());

        lane.last = at;
        lane.queue.push({ at, chunk });

        if (lane.timer === null)
        {
            lane.timer = setTimeout(() => flush(lane, to), Math.max(0, lane.queue[0].at - Date.now()));
        }
    };

    client.on('data', (chunk) =>
    {
        if (!socket && /upgrade:\s*websocket/i.test(chunk.toString('latin1', 0, Math.min(chunk.length, 2048))))
        {
            socket = true;
        }

        carry('up', chunk, server);
    });
    server.on('data', (chunk) => carry('down', chunk, client));
    client.on('error', () => server.destroy());
    server.on('error', () => client.destroy());
    client.on('close', () => server.destroy());
    server.on('close', () => client.destroy());
});

await new Promise((done) => proxy.listen(PORT, '127.0.0.1', done));

function cachedChromium()
{
    const home = process.env.LOCALAPPDATA ?? process.env.HOME ?? '';
    const cache = process.env.PLAYWRIGHT_BROWSERS_PATH ?? join(home, 'ms-playwright');

    if (!existsSync(cache))
    {
        return undefined;
    }

    const builds = readdirSync(cache).filter((n) => /^chromium-\d+$/.test(n)).sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]));

    for (const build of builds)
    {
        for (const rel of ['chrome-win64/chrome.exe', 'chrome-win/chrome.exe', 'chrome-linux/chrome'])
        {
            const candidate = join(cache, build, rel);

            if (existsSync(candidate))
            {
                return candidate;
            }
        }
    }

    return undefined;
}

const executablePath = cachedChromium();

const results = [];

const record = (name, ok, detail) =>
{
    results.push({ name, ok, detail });
    console.log(`  ${ ok ? 'PASS' : 'FAIL' }  ${ name }${ detail ? ' - ' + detail : '' }`);
};

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(check, ms = 20_000)
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

async function seat(browser, handle, settings, carried)
{
    const fixture = WALLET_FIXTURES.find((one) => one.handle === handle);
    const wallet = privateKeyToAccount(fixture.privateKey);
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'en-US', permissions: ['microphone'] });

    await context.addCookies([{ name: 'locale', value: 'en', url: BASE }]);
    await context.addInitScript(({ only, settings }) =>
    {
        try
        {
            const stored = JSON.parse(localStorage.getItem('baziche.settings') ?? '{}');

            localStorage.setItem('baziche.settings', JSON.stringify({ ...stored, ...settings }));
        }
        catch
        {
        }

        const Real = window.RTCPeerConnection;

        window.__calls = [];
        window.RTCPeerConnection = function (...given)
        {
            const made = new Real(...given);

            window.__calls.push(made);

            return made;
        };
        window.RTCPeerConnection.prototype = Real.prototype;

        if (only)
        {
            Real.prototype.addIceCandidate = function ()
            {
                return Promise.resolve();
            };
        }

        const RealSocket = window.WebSocket;

        window.__sound = [];
        window.WebSocket = function (...given)
        {
            const made = new RealSocket(...given);

            made.addEventListener('message', (event) =>
            {
                if (typeof event.data === 'string' && event.data.includes('"t":"sound"'))
                {
                    try
                    {
                        const frame = JSON.parse(event.data);

                        window.__sound.push({ t: performance.now(), size: frame.data.length, codec: frame.codec });
                    }
                    catch
                    {
                    }
                }
            });

            return made;
        };
        window.WebSocket.prototype = RealSocket.prototype;

        for (const state of ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'])
        {
            window.WebSocket[state] = RealSocket[state];
        }
    }, { only: carried, settings: { voiceAutoJoin: false, ...settings } });

    const issued = await context.request.post(`${ BASE }/api/auth/challenge`, { data: { address: wallet.address } });
    const challenge = await issued.json();
    const signedIn = await context.request.post(`${ BASE }/api/auth/wallet`, {
        data: { address: wallet.address, nonce: challenge.nonce, signature: await wallet.signMessage({ message: challenge.message }) }
    });

    if (!signedIn.ok())
    {
        throw new Error(`could not sign in as ${ handle } (${ signedIn.status() })`);
    }

    const page = await context.newPage();
    const errors = [];

    page.on('pageerror', (error) => errors.push(`${ handle }: ${ String(error).slice(0, 200) }`));
    page.on('console', (event) =>
    {
        if (event.type() === 'error')
        {
            errors.push(`${ handle }: ${ event.text().slice(0, 200) }`);
        }
    });

    return { context, page, errors };
}

const lineSent = (page, seconds) => page.evaluate(async (seconds) =>
{
    const series = [];
    const end = performance.now() + seconds * 1000;

    while (performance.now() < end)
    {
        let bytes = 0;

        for (const one of (window.__calls ?? []).filter((call) => call.connectionState === 'connected'))
        {
            for (const report of (await one.getStats()).values())
            {
                if (report.type === 'outbound-rtp' && report.kind === 'audio')
                {
                    bytes += report.bytesSent ?? 0;
                }
            }
        }

        series.push({ t: performance.now(), bytes });
        await new Promise((done) => setTimeout(done, 100));
    }

    return series;
}, seconds);

const carriedHeard = (page) => page.evaluate(() => (window.__sound ?? []).map((one) => ({ t: one.t, bytes: one.size * 0.75 })));

const percentile = (values, share) =>
{
    const sorted = [...values].sort((a, b) => a - b);

    return sorted.length === 0 ? 0 : sorted[Math.min(sorted.length - 1, Math.floor(share * sorted.length))];
};

const speakingRate = (series) =>
{
    const rates = [];

    for (let index = 0; index < series.length; index += 1)
    {
        const later = series.find((one) => one.t - series[index].t >= 500);

        if (later !== undefined)
        {
            rates.push((later.bytes - series[index].bytes) * 8 / (later.t - series[index].t));
        }
    }

    return Math.round(percentile(rates, 0.9));
};

const framesRate = (frames, from, to) =>
{
    const rates = [];

    for (let start = from; start + 500 <= to; start += 100)
    {
        rates.push(frames.filter((one) => one.t >= start && one.t < start + 500).reduce((sum, one) => sum + one.bytes, 0) * 8 / 500);
    }

    return Math.round(percentile(rates, 0.9));
};

const sentOf = (page) => page.evaluate(async () =>
{
    let bytes = 0;

    for (const one of (window.__calls ?? []).filter((call) => call.connectionState === 'connected'))
    {
        for (const report of (await one.getStats()).values())
        {
            if (report.type === 'outbound-rtp' && report.kind === 'audio')
            {
                bytes += report.bytesSent ?? 0;
            }
        }
    }

    return { bytes, at: performance.now(), carried: (window.__sound ?? []).reduce((sum, one) => sum + one.size * 0.75, 0) };
});

async function measure(browser, { name, carried, line, settings = {} })
{
    if (ONLY.length > 0 && !ONLY.some((one) => name.startsWith(one)))
    {
        return null;
    }

    profile = 'none';

    const dana = await seat(browser, 'dana.w', { voiceStartMuted: true, ...settings }, carried);
    const mina = await seat(browser, 'mina', { voiceStartMuted: false, ...settings }, carried);
    let table = null;

    try
    {
        const made = await dana.context.request.post(`${ BASE }/api/tables`, {
            data: tableBody({ game: 'ludo', seats: 2, mode: 'live', privacy: 'invite', voice: 'table', invitees: ['mina'] })
        });

        table = await made.json();

        if (!made.ok())
        {
            throw new Error(`table ${ made.status() } ${ JSON.stringify(table) }`);
        }

        await mina.context.request.post(`${ BASE }/api/tables/${ table.id }/seat`);

        for (const one of [dana, mina])
        {
            await one.page.goto(`${ BASE }/app/play/${ table.id }`);
            await one.page.getByRole('button', { name: 'Join voice' }).first().click();
        }

        const joined = await until(async () => (await dana.page.getByRole('button', { name: 'Leave voice' }).count()) > 0 && (await mina.page.getByRole('button', { name: 'Leave voice' }).count()) > 0);
        const hearing = joined && await until(() => dana.page.evaluate(() =>
        {
            const audio = [...document.querySelectorAll('audio')].find((one) => one.srcObject !== null && !one.muted);

            return audio !== undefined && audio.srcObject.getAudioTracks().some((track) => track.readyState === 'live');
        }), 25_000);

        if (!hearing)
        {
            record(`${ name }: the listener hears the speaker`, false, `joined ${ joined }`);
            return null;
        }

        profile = line;
        await wait(3000);

        const before = await sentOf(mina.page);
        const heard = await sentOf(dana.page);
        const sampled = carried ? Promise.resolve([]) : lineSent(mina.page, SECONDS);
        const received = await dana.page.evaluate(async (seconds) =>
        {
            const audio = [...document.querySelectorAll('audio')].find((one) => one.srcObject !== null && !one.muted);
            const context = new AudioContext({ sampleRate: 48_000 });

            await context.resume();

            const code = 'class R extends AudioWorkletProcessor { process(inputs) { const channel = inputs[0] && inputs[0][0]; this.port.postMessage(channel ? channel.slice(0) : new Float32Array(128)); return true; } } registerProcessor(\'quality-recorder\', R);';
            const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));

            await context.audioWorklet.addModule(url);

            const source = context.createMediaStreamSource(audio.srcObject);
            const node = new AudioWorkletNode(context, 'quality-recorder');
            const chunks = [];

            node.port.onmessage = (event) => chunks.push(event.data);
            source.connect(node);
            node.connect(context.destination);
            await new Promise((done) => setTimeout(done, seconds * 1000));
            source.disconnect();
            node.disconnect();
            await context.close();

            const total = chunks.reduce((sum, one) => sum + one.length, 0);
            const pcm = new Int16Array(total);
            let at = 0;

            for (const one of chunks)
            {
                for (let index = 0; index < one.length; index += 1)
                {
                    pcm[at] = Math.max(-32768, Math.min(32767, Math.round(one[index] * 32767)));
                    at += 1;
                }
            }

            const bytes = new Uint8Array(pcm.buffer);
            let text = '';

            for (let index = 0; index < bytes.length; index += 0x8000)
            {
                text += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
            }

            return btoa(text);
        }, SECONDS);
        const after = await sentOf(mina.page);
        const heardAfter = await sentOf(dana.page);
        const series = await sampled;
        const frames = carried ? await carriedHeard(dana.page) : [];
        const raw = Buffer.from(received, 'base64');
        const samples = Float32Array.from(new Int16Array(raw.buffer, raw.byteOffset, raw.length / 2), (one) => one / 32768);
        const metrics = analyse(samples, { clean, noise });
        const span = (after.at - before.at) / 1000;

        writeWav(join(OUT, `${ name }.wav`), samples, RATE);

        return {
            ...metrics,
            lineKbps: Math.round((after.bytes - before.bytes) * 8 / span / 1000),
            carriedKbps: Math.round((heardAfter.carried - heard.carried) * 8 / ((heardAfter.at - heard.at) / 1000) / 1000),
            lineSpeakingKbps: speakingRate(series),
            carriedSpeakingKbps: framesRate(frames, heard.at, heardAfter.at),
            errors: [...dana.errors, ...mina.errors]
        };
    }
    finally
    {
        profile = 'none';

        if (table?.id !== undefined)
        {
            await dana.context.request.post(`${ BASE }/api/tables/${ table.id }/leave`, { data: { forfeit: true } }).catch(() => undefined);
            await mina.context.request.post(`${ BASE }/api/tables/${ table.id }/leave`, { data: { forfeit: true } }).catch(() => undefined);
        }

        await dana.context.close();
        await mina.context.close();
    }
}

const launch = (file) => chromium.launch({
    ...(executablePath === undefined ? {} : { executablePath }),
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-audio-capture=${ file }`, '--autoplay-policy=no-user-gesture-required']
});

const shown = (found) => `missing ${ found.dropoutPct }% in ${ found.dropoutRuns } breaks${ found.breaksAt.length > 0 ? ` (${ found.breaksAt.join(', ') })` : '' }, longest ${ found.longestBreakMs } ms, speech ${ found.speechDb } dB, room ${ found.roomDb } dB, clicks ${ found.roomClickDb } dB, aligned ${ found.aligned }, recorder gaps ${ found.recorderGaps }`;

const speaking = await launch(signals.clean);

try
{
    const direct = await measure(speaking, { name: 'line', carried: false, line: 'none' });

    if (direct !== null)
    {
        record('a direct line carries the voice whole', direct.aligned > 0.6 && direct.dropoutPct <= 0.5 && direct.dropoutRuns <= 2, shown(direct));
        record('a direct line sends at the High preset while she speaks', direct.lineSpeakingKbps >= 50, `${ direct.lineSpeakingKbps } kbps while speaking, ${ direct.lineKbps } on average with the pauses`);
        record('a direct line logs nothing', direct.errors.length === 0, direct.errors.join(' | '));
    }

    for (const [line, most, breaks] of [['none', 0.5, 2], ['wifi', 1, 4], ['mobile', 1.5, 6]])
    {
        const found = await measure(speaking, { name: `carried-${ line }`, carried: true, line });

        if (found === null)
        {
            continue;
        }

        record(`the server carries the voice on a ${ line === 'none' ? 'quiet' : line } line with ${ most }% of it missing at most`, found.aligned > 0.6 && found.dropoutPct <= most, shown(found));
        record(`on that line the voice breaks ${ breaks } times at most, none longer than 200 ms`, found.dropoutRuns <= breaks && found.longestBreakMs <= 200, shown(found));
        record(`while she speaks the server carries her at 45 kbps or more, High asking for 64 at most (${ line })`, found.carriedSpeakingKbps >= 45, `${ found.carriedSpeakingKbps } kbps while speaking, ${ found.carriedKbps } on average with the pauses`);
        record(`the carried call logs nothing (${ line })`, found.errors.length === 0, found.errors.join(' | '));
    }
}
finally
{
    await speaking.close();
}

const roomy = await launch(signals.noisy);

try
{
    const usual = await measure(roomy, { name: 'noise-usual', carried: false, line: 'none', settings: { voiceNoise: 'standard' } });
    const open = { voiceAuto: false, voiceThreshold: -80 };
    const off = await measure(roomy, { name: 'noise-off', carried: false, line: 'none', settings: { voiceNoise: 'off', ...open } });
    const standard = await measure(roomy, { name: 'noise-standard', carried: false, line: 'none', settings: { voiceNoise: 'standard', ...open } });
    const strong = await measure(roomy, { name: 'noise-strong', carried: false, line: 'none', settings: { voiceNoise: 'strong', ...open } });

    if (usual !== null)
    {
        record('as a call starts, standard suppression and the gate keep the room 25 dB under the voice', usual.roomDb <= usual.speechDb - 25, shown(usual));
    }

    if (standard !== null)
    {
        record('with the gate held open, standard suppression alone keeps the room 20 dB under the voice', standard.roomDb <= standard.speechDb - 20, shown(standard));
    }

    if (off !== null && standard !== null)
    {
        record('with the gate held open, standard suppression takes the room 10 dB under what it is with none', standard.roomDb <= off.roomDb - 10, `standard ${ standard.roomDb } dB, none ${ off.roomDb } dB`);
        record('with the gate held open, standard suppression takes the typing 6 dB under what it is with none', standard.roomClickDb <= off.roomClickDb - 6, `standard ${ standard.roomClickDb } dB, none ${ off.roomClickDb } dB`);
    }

    if (standard !== null && strong !== null)
    {
        record('with the gate held open, strong suppression takes the room down further than standard', strong.roomDb <= standard.roomDb - 4, `strong ${ strong.roomDb } dB, standard ${ standard.roomDb } dB`);
        record('with the gate held open, strong suppression takes the typing down at least as far as standard', strong.roomClickDb <= standard.roomClickDb + 2, `strong ${ strong.roomClickDb } dB, standard ${ standard.roomClickDb } dB`);
        record('strong suppression keeps the voice', Math.abs(strong.speechDb - standard.speechDb) <= 3 && strong.dropoutPct <= 2, shown(strong));
    }
}
finally
{
    await roomy.close();
}

proxy.close();

const failed = results.filter((one) => !one.ok).length;

console.log(`\n  ${ results.length - failed }/${ results.length } voice quality checks passed`);
process.exit(failed === 0 ? 0 : 1);
